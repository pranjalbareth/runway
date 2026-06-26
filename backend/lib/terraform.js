const { spawn } = require('child_process')
const http = require('http')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { broadcast } = require('../ws/handler')
const { envQueries, auditQueries, logQueries, pluginQueries } = require('./db')
const { v4: uuidv4 } = require('uuid')
const { getById: getTemplateById } = require('./templates')

const TEMPLATES_DIR = path.join(__dirname, '../../terraform/templates')

// ---------------------------------------------------------------------------
// Local mock helpers — pre-create / delete resources via HTTP so Terraform
// never calls operations unsupported by elasticmq / old LocalStack
// (ListQueueTags, GetEventSourceMapping, DescribeTimeToLive, etc.)
// ---------------------------------------------------------------------------

function mockPost(endpoint, contentType, targetHeader, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(endpoint.endsWith('/') ? endpoint : endpoint + '/')
    const headers = { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) }
    if (targetHeader) headers['X-Amz-Target'] = targetHeader
    const req = http.request(
      { hostname: u.hostname, port: Number(u.port) || 80, path: u.pathname, method: 'POST', headers },
      (res) => { res.resume(); res.on('end', resolve) }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

const sqsPost   = (ep, fields) => mockPost(ep, 'application/x-www-form-urlencoded', null, new URLSearchParams(fields).toString())
const dynamoPost = (ep, target, body) => mockPost(ep, 'application/x-amz-json-1.0', target, JSON.stringify(body))

// ── SQS ──
async function createSqsQueuePair(endpoint, queueName, dlqName) {
  await sqsPost(endpoint, { Action: 'CreateQueue', QueueName: dlqName,   'Attribute.1.Name': 'MessageRetentionPeriod', 'Attribute.1.Value': '1209600' })
  await sqsPost(endpoint, { Action: 'CreateQueue', QueueName: queueName, 'Attribute.1.Name': 'VisibilityTimeout', 'Attribute.1.Value': '30', 'Attribute.2.Name': 'MessageRetentionPeriod', 'Attribute.2.Value': '86400' })
}
async function deleteSqsQueuePair(endpoint, queueName, dlqName) {
  const base = endpoint.endsWith('/') ? endpoint : endpoint + '/'
  await sqsPost(endpoint, { Action: 'DeleteQueue', QueueUrl: `${base}000000000000/${queueName}` }).catch(() => {})
  await sqsPost(endpoint, { Action: 'DeleteQueue', QueueUrl: `${base}000000000000/${dlqName}`   }).catch(() => {})
}
// Back-compat shorthand for cascade (uses the original `${envName}-queue/-dlq` naming)
const createLocalSqsQueues = (ep, envName) => createSqsQueuePair(ep, `runway-${envName}-queue`, `runway-${envName}-dlq`)
const deleteLocalSqsQueues = (ep, envName) => deleteSqsQueuePair(ep, `runway-${envName}-queue`, `runway-${envName}-dlq`)

// ── S3 ──
// Best-effort delete of every object in a MockCloud bucket then the bucket
// itself. Sends the dummy AWS SigV4 Authorization header that LocalStack
// requires to actually process the request (it doesn't validate the signature
// but rejects/ignores requests without one).
function s3Request(endpoint, method, pathname) {
  return new Promise((resolve) => {
    const u = new URL(endpoint.endsWith('/') ? endpoint : endpoint + '/')
    const req = http.request({
      hostname: u.hostname,
      port: Number(u.port) || 80,
      path: pathname,
      method,
      timeout: 5000,
      headers: {
        'Authorization':         'AWS4-HMAC-SHA256 Credential=mock/20250101/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=0000000000000000000000000000000000000000000000000000000000000000',
        'x-amz-date':            '20250101T000000Z',
        'x-amz-content-sha256':  'UNSIGNED-PAYLOAD',
        'Host':                  `${u.hostname}:${u.port || 80}`
      }
    }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode || 0, body }))
    })
    req.on('error', (err) => resolve({ status: 0, body: '', error: err.code || err.message }))
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', error: 'timeout' }) })
    req.end()
  })
}

async function emptyAndDeleteS3Bucket(endpoint, bucket, log) {
  const say = (m) => { if (log) log(`[s3] ${m}`) }

  // List objects (path-style on LocalStack / MockCloud)
  let listed = await s3Request(endpoint, 'GET', `/${bucket}?list-type=2`)
  if (listed.status === 0) {
    say(`could not reach S3 at ${endpoint} (${listed.error || 'no response'}) — skipping cleanup`)
    return false
  }
  if (listed.status === 404 || listed.status === 204) {
    say(`bucket "${bucket}" does not exist — clean slate`)
    return true
  }

  const keys = [...(listed.body || '').matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1])
  if (keys.length > 0) {
    say(`emptying "${bucket}" (${keys.length} object${keys.length === 1 ? '' : 's'})`)
    for (const key of keys) {
      await s3Request(endpoint, 'DELETE', `/${bucket}/${encodeURIComponent(key)}`)
    }
  }

  // DELETE the bucket itself — NO trailing slash, otherwise S3 treats it as a key op
  const del = await s3Request(endpoint, 'DELETE', `/${bucket}`)
  if (del.status === 204 || del.status === 200 || del.status === 404) {
    say(`deleted bucket "${bucket}" (status ${del.status})`)
    return true
  }
  say(`bucket "${bucket}" delete returned ${del.status} (continuing — terraform may still succeed)`)
  return false
}

// ── DynamoDB ──
async function createDynamoTable(endpoint, tableName) {
  await dynamoPost(endpoint, 'DynamoDB_20120810.CreateTable', {
    TableName: tableName,
    BillingMode: 'PAY_PER_REQUEST',
    KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }, { AttributeName: 'SK', KeyType: 'RANGE' }],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' }, { AttributeName: 'SK', AttributeType: 'S' }
    ]
  })
}
async function deleteDynamoTable(endpoint, tableName) {
  await dynamoPost(endpoint, 'DynamoDB_20120810.DeleteTable', { TableName: tableName }).catch(() => {})
}

// Dispatch map: template id → { create, delete } hooks for local/MockCloud mode.
// Hooks pre-create resources outside Terraform state to avoid unsupported APIs
// (ListQueueTags, DescribeTimeToLive, etc.) on the lighter mock backend.
const LOCAL_HOOKS = {
  jetstream: {
    create: (ep, name) => createDynamoTable(ep, `runway-${name}`),
    delete: (ep, name) => deleteDynamoTable(ep, `runway-${name}`)
  },
  cascade: {
    create: async (ep, name) => {
      await createLocalSqsQueues(ep, name)
      await createDynamoTable(ep, `runway-${name}-results`)
    },
    delete: async (ep, name) => {
      await deleteLocalSqsQueues(ep, name)
      await deleteDynamoTable(ep, `runway-${name}-results`)
    }
  },
  cargo: {
    // S3 ingest bucket gets a forced cleanup so MockCloud doesn't carry
    // BucketAlreadyExists across retries; DynamoDB catalog is pre-created.
    create: async (ep, name, envId, log) => {
      await emptyAndDeleteS3Bucket(ep, bucketName(name, envId, 'ingest'), log)
      await createDynamoTable(ep, `runway-${name}-catalog`)
    },
    delete: async (ep, name, envId, log) => {
      await emptyAndDeleteS3Bucket(ep, bucketName(name, envId, 'ingest'), log)
      await deleteDynamoTable(ep, `runway-${name}-catalog`)
    }
  },
  tower: {
    create: (ep, name, envId, log) => emptyAndDeleteS3Bucket(ep, bucketName(name, envId, 'assets'), log),
    delete: (ep, name, envId, log) => emptyAndDeleteS3Bucket(ep, bucketName(name, envId, 'assets'), log),
  },
  raptor: {
    create: async (ep, name, envId, log) => {
      await emptyAndDeleteS3Bucket(ep, bucketName(name, envId, 'raptor-assets'), log)
      await createDynamoTable(ep, `runway-${name}-raptor`)
      await createSqsQueuePair(ep, `runway-${name}-raptor-queue`, `runway-${name}-raptor-dlq`)
    },
    delete: async (ep, name, envId, log) => {
      await emptyAndDeleteS3Bucket(ep, bucketName(name, envId, 'raptor-assets'), log)
      await deleteDynamoTable(ep, `runway-${name}-raptor`)
      await deleteSqsQueuePair(ep, `runway-${name}-raptor-queue`, `runway-${name}-raptor-dlq`)
    },
  }
}

// MockCloud's S3 emulator persists bucket names across applies (it reports
// 404 to GET but BucketAlreadyExists to PUT — its name reservation outlives
// the actual storage). Mixing the env_id into the bucket name guarantees
// every fresh provision uses a name MockCloud has never seen, sidestepping
// the namespace bug entirely. The Terraform templates compute the same name
// via substr(env_id, 0, 8), so both sides agree.
function bucketName(envName, envId, suffix) {
  // First 8 chars of a UUID like "75acc791-cf28-..." → "75acc791".
  // Matches the Terraform side: substr(var.env_id, 0, 8).
  const idShort = String(envId || '').slice(0, 8) || 'noid'
  return `runway-${envName}-${idShort}-${suffix}`
}

function logLine(envId, line) {
  const timestamp = new Date().toISOString()
  logQueries.insert(envId, line, timestamp)
  broadcast(envId, { type: 'log', line, timestamp })
}
// Resolve infra mode at provision time based on which plugin is active.
// Docker templates ignore this. Cloud templates (mockcloud OR aws) prefer real
// AWS when its plugin is active, otherwise fall back to local/MockCloud.
function resolveInfraMode(template) {
  const t = typeof template === 'string' ? getTemplateById(template) : template
  const required = (t && t.requiredPlugins) || []

  function isActive(id) {
    const row = pluginQueries.getById(id)
    return row && row.status === 'active'
  }

  if (required.includes('aws') && isActive('aws')) return 'aws'
  if (required.includes('mockcloud') && isActive('mockcloud')) return 'local'
  return process.env.INFRA_MODE || 'local'
}

function getTemplatePath(template) {
  return path.join(TEMPLATES_DIR, template)
}

function createWorkDir(envId) {
  // Use a local runway-work dir instead of system temp to avoid Windows EPERM on AppData paths
  const baseDir = path.join(__dirname, '../../.runway-work')
  const workDir = path.join(baseDir, `env-${envId}`)
  fs.mkdirSync(workDir, { recursive: true })
  return workDir
}

function writeTfvars(workDir, vars) {
  const lines = Object.entries(vars)
    .map(([k, v]) => `${k} = ${JSON.stringify(String(v))}`)
    .join('\n')
  fs.writeFileSync(path.join(workDir, 'terraform.tfvars'), lines)
}

// Skip these when copying templates - they are Terraform internals or OS artifacts
const SKIP_ENTRIES = new Set(['.terraform', '.terraform.lock.hcl', 'terraform.tfstate', 'terraform.tfstate.backup', '.DS_Store'])

function copyTemplate(templatePath, workDir) {
  const entries = fs.readdirSync(templatePath)
  for (const entry of entries) {
    if (SKIP_ENTRIES.has(entry)) continue  // skip .terraform dir and state files
    const src = path.join(templatePath, entry)
    const dest = path.join(workDir, entry)
    const stat = fs.statSync(src)
    if (stat.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true })
      copyTemplate(src, dest)  // recurse
    } else {
      fs.copyFileSync(src, dest)
    }
  }
}

function runTerraform(args, workDir, envId, onLine, infraMode) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      TF_IN_AUTOMATION: '1',
      TF_CLI_ARGS: '-no-color',
    }

    if (infraMode) env.INFRA_MODE = infraMode

    const tf = spawn('terraform', args, { cwd: workDir, env })

    tf.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean)
      lines.forEach(line => {
        onLine(line)
        logLine(envId, line)
      })
    })

    tf.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean)
      lines.forEach(line => {
        onLine(`[stderr] ${line}`)
        logLine(envId, `[stderr] ${line}`)
      })
    })

    tf.on('close', (code) => {
      if (code === 0) resolve(code)
      else reject(new Error(`Terraform exited with code ${code}`))
    })

    tf.on('error', (err) => {
      reject(new Error(`Failed to spawn terraform: ${err.message}`))
    })
  })
}

async function runTerraformWithRetry(args, workDir, envId, onLine, infraMode, maxRetries = 2) {
  let lastErr
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await runTerraform(args, workDir, envId, onLine, infraMode)
    } catch (err) {
      lastErr = err
      if (attempt <= maxRetries) {
        const delay = attempt * 3000
        const msg = `[Retry] Attempt ${attempt} failed — retrying in ${delay / 1000}s... (${err.message})`
        onLine(msg)
        logLine(envId, msg)
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }
  throw lastErr
}

async function provision(environment) {
  const { id, template, name, instance_type, port, ttl_hours } = environment
  const workDir = createWorkDir(id)
  const templatePath = getTemplatePath(template)
  const infraMode = resolveInfraMode(template)
  const logs = []

  const onLine = (line) => logs.push(line)

  try {
    broadcast(id, { type: 'status', status: 'provisioning', message: 'Starting provisioning...' })
    logLine(id, `→ Infra mode resolved: ${infraMode}`)

    // Guard: check terraform binary exists before doing anything
    await new Promise((resolve, reject) => {
      const tf = spawn('terraform', ['version'], { cwd: workDir })
      tf.on('close', code => code === 0 ? resolve() : reject(new Error('Terraform binary not found. Install Terraform: https://developer.hashicorp.com/terraform/install')))
      tf.on('error', () => reject(new Error('Terraform binary not found. Install Terraform: https://developer.hashicorp.com/terraform/install')))
    })

    // Pre-create resources in local mock before Terraform runs, avoiding
    // unsupported API calls (ListQueueTags, DescribeTimeToLive, etc.)
    if (infraMode === 'local' && LOCAL_HOOKS[template]) {
      const endpoint = process.env.MOCKCLOUD_ENDPOINT || 'http://localhost:4566'
      logLine(id, `→ Pre-creating local mock resources for ${template} (${endpoint})...`)
      await LOCAL_HOOKS[template].create(endpoint, name, id, (msg) => logLine(id, msg))
      logLine(id, '✓ Local mock resources ready')
    }

    // Copy template files to work dir
    copyTemplate(templatePath, workDir)

    // Write tfvars
    writeTfvars(workDir, {
      env_name:           name,
      env_id:             id,
      instance_type:      instance_type || 't3.micro',
      app_port:           port || 3000,
      infra_mode:         infraMode,
      mockcloud_endpoint: process.env.MOCKCLOUD_ENDPOINT || 'http://localhost:4566',
      aws_region:         process.env.AWS_REGION || 'us-east-1',
    })

    // terraform init
    logLine(id, '→ Running terraform init...')
    await runTerraformWithRetry(['init', '-no-color'], workDir, id, onLine, infraMode)

    // terraform apply
    logLine(id, '→ Running terraform apply...')
    await runTerraformWithRetry(['apply', '-auto-approve', '-no-color'], workDir, id, onLine, infraMode)

    // Update DB to running
    envQueries.updateStatus(id, 'running')
    broadcast(id, { type: 'status', status: 'running', message: 'Environment provisioned successfully!' })

    // Audit log
    auditQueries.log({
      id: uuidv4(),
      environment_id: id,
      action: 'provision',
      status: 'success',
      message: `Provisioned ${template} environment "${name}"`,
      created_at: new Date().toISOString()
    })

    // Schedule TTL auto-destroy
    scheduleDestroy(id, ttl_hours)

  } catch (err) {
    envQueries.updateStatus(id, 'failed')
    broadcast(id, { type: 'status', status: 'failed', message: err.message })

    auditQueries.log({
      id: uuidv4(),
      environment_id: id,
      action: 'provision',
      status: 'failed',
      message: err.message,
      created_at: new Date().toISOString()
    })
  }
}

async function destroy(envId) {
  const environment = envQueries.getById(envId)
  if (!environment) throw new Error('Environment not found')

  const workDir = path.join(__dirname, `../../.runway-work/env-${envId}`)
  const infraMode = resolveInfraMode(environment.template)
  const logs = []
  const onLine = (line) => logs.push(line)

  try {
    broadcast(envId, { type: 'status', status: 'destroying', message: 'Destroying environment...' })
    envQueries.updateStatus(envId, 'destroying')

    // Work dir may still exist from provision - if not, re-copy template
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true })
      copyTemplate(getTemplatePath(environment.template), workDir)
      writeTfvars(workDir, {
        env_name:           environment.name,
        env_id:             envId,
        instance_type:      environment.instance_type || 't3.micro',
        app_port:           environment.port || 3000,
        infra_mode:         infraMode,
        mockcloud_endpoint: process.env.MOCKCLOUD_ENDPOINT || 'http://localhost:4566',
        aws_region:         process.env.AWS_REGION || 'us-east-1',
      })
      await runTerraform(['init', '-no-color'], workDir, envId, onLine, infraMode)
    }

    // Clean up local mock resources created outside of Terraform state
    if (infraMode === 'local' && LOCAL_HOOKS[environment.template]) {
      const endpoint = process.env.MOCKCLOUD_ENDPOINT || 'http://localhost:4566'
      await LOCAL_HOOKS[environment.template].delete(endpoint, environment.name, envId, (msg) => logLine(envId, msg))

      // Some resources (notably aws_instance) hang Terraform's destroy waiter
      // because MockCloud returns NotFound where the provider expects to see
      // a "terminated" lifecycle. Drop them from state so destroy skips them.
      const toRemove = LOCAL_HOOKS[environment.template].preDestroyStateRm || []
      for (const addr of toRemove) {
        logLine(envId, `→ Dropping ${addr} from terraform state (MockCloud handles cleanup directly)...`)
        await runTerraform(['state', 'rm', '-no-color', addr], workDir, envId, onLine, infraMode).catch((err) => {
          logLine(envId, `  (state rm ${addr} skipped: ${err.message.split('\n')[0]})`)
        })
      }
    }

    await runTerraform(['destroy', '-auto-approve', '-no-color'], workDir, envId, onLine, infraMode)

    const now = new Date().toISOString()
    envQueries.updateStatus(envId, 'destroyed', { destroyed_at: now })
    broadcast(envId, { type: 'status', status: 'destroyed', message: 'Environment destroyed.' })

    auditQueries.log({
      id: uuidv4(),
      environment_id: envId,
      action: 'destroy',
      status: 'success',
      message: `Destroyed environment "${environment.name}"`,
      created_at: new Date().toISOString()
    })

    // Cleanup work dir
    fs.rmSync(workDir, { recursive: true, force: true })

  } catch (err) {
    envQueries.updateStatus(envId, 'failed')
    broadcast(envId, { type: 'status', status: 'failed', message: err.message })

    auditQueries.log({
      id: uuidv4(),
      environment_id: envId,
      action: 'destroy',
      status: 'failed',
      message: err.message,
      created_at: new Date().toISOString()
    })
  }
}

function scheduleDestroy(envId, ttlHours) {
  const ms = ttlHours * 60 * 60 * 1000
  const scheduledAt = new Date(Date.now() + ms).toISOString()
  envQueries.setTtlScheduled(envId, scheduledAt)
  console.log(`[TTL] Environment ${envId} will auto-destroy in ${ttlHours}h (at ${scheduledAt})`)
  setTimeout(async () => {
    const env = envQueries.getById(envId)
    if (env && env.status === 'running') {
      console.log(`[TTL] Auto-destroying ${envId}`)
      logLine(envId, `[TTL] Auto-destroying environment after ${ttlHours}h TTL`)
      await destroy(envId)
    }
  }, ms)
}

// Call this on server boot to re-schedule any TTLs that survived a restart
function restoreTtlSchedules() {
  const pending = envQueries.getPendingTtl()
  if (pending.length === 0) return
  console.log(`[TTL] Restoring ${pending.length} pending TTL schedule(s) after restart`)
  for (const env of pending) {
    const expiresAt = new Date(env.expires_at).getTime()
    const now = Date.now()
    const remaining = expiresAt - now
    if (remaining <= 0) {
      // Already expired while server was down — destroy immediately
      console.log(`[TTL] ${env.id} expired while server was down, destroying now`)
      destroy(env.id).catch(console.error)
    } else {
      const remainingHours = remaining / (1000 * 60 * 60)
      console.log(`[TTL] Rescheduling ${env.id} — ${Math.round(remainingHours * 10) / 10}h remaining`)
      setTimeout(async () => {
        const latest = envQueries.getById(env.id)
        if (latest && latest.status === 'running') {
          console.log(`[TTL] Auto-destroying ${env.id} (restored schedule)`)
          logLine(env.id, '[TTL] Auto-destroying environment (TTL expired)')
          await destroy(env.id)
        }
      }, remaining)
    }
  }
}

module.exports = { provision, destroy, restoreTtlSchedules }
