const { spawn } = require('child_process')
const http = require('http')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { broadcast } = require('../ws/handler')
const { envQueries, auditQueries, logQueries } = require('./db')
const { v4: uuidv4 } = require('uuid')

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
async function createLocalSqsQueues(endpoint, envName) {
  await sqsPost(endpoint, { Action: 'CreateQueue', QueueName: `runway-${envName}-dlq`, 'Attribute.1.Name': 'MessageRetentionPeriod', 'Attribute.1.Value': '1209600' })
  await sqsPost(endpoint, { Action: 'CreateQueue', QueueName: `runway-${envName}-queue`, 'Attribute.1.Name': 'VisibilityTimeout', 'Attribute.1.Value': '30', 'Attribute.2.Name': 'MessageRetentionPeriod', 'Attribute.2.Value': '86400' })
}
async function deleteLocalSqsQueues(endpoint, envName) {
  const base = endpoint.endsWith('/') ? endpoint : endpoint + '/'
  await sqsPost(endpoint, { Action: 'DeleteQueue', QueueUrl: `${base}000000000000/runway-${envName}-queue` }).catch(() => {})
  await sqsPost(endpoint, { Action: 'DeleteQueue', QueueUrl: `${base}000000000000/runway-${envName}-dlq` }).catch(() => {})
}

// ── DynamoDB ──
async function createLocalDynamoTable(endpoint, envName) {
  await dynamoPost(endpoint, 'DynamoDB_20120810.CreateTable', {
    TableName: `runway-${envName}`,
    BillingMode: 'PAY_PER_REQUEST',
    KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }, { AttributeName: 'SK', KeyType: 'RANGE' }],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' }, { AttributeName: 'SK', AttributeType: 'S' },
      { AttributeName: 'GSI1PK', AttributeType: 'S' }, { AttributeName: 'GSI1SK', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [{
      IndexName: 'GSI1',
      KeySchema: [{ AttributeName: 'GSI1PK', KeyType: 'HASH' }, { AttributeName: 'GSI1SK', KeyType: 'RANGE' }],
      Projection: { ProjectionType: 'ALL' }
    }]
  })
}
async function deleteLocalDynamoTable(endpoint, envName) {
  await dynamoPost(endpoint, 'DynamoDB_20120810.DeleteTable', { TableName: `runway-${envName}` }).catch(() => {})
}

// Dispatch map: template name → { create, delete } hooks for local mode
const LOCAL_HOOKS = {
  'sqs-worker':   { create: createLocalSqsQueues,   delete: deleteLocalSqsQueues },
  'dynamodb-app': { create: createLocalDynamoTable,  delete: deleteLocalDynamoTable },
}

function logLine(envId, line) {
  const timestamp = new Date().toISOString()
  logQueries.insert(envId, line, timestamp)
  broadcast(envId, { type: 'log', line, timestamp })
}
const INFRA_MODE = process.env.INFRA_MODE || 'local' // 'local' = docker provider, 'aws' = real AWS

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

function runTerraform(args, workDir, envId, onLine) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      TF_IN_AUTOMATION: '1',
      TF_CLI_ARGS: '-no-color',
    }

    // Inject mode-specific env vars
    if (INFRA_MODE === 'local') {
      env.INFRA_MODE = 'local'
    }

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

async function runTerraformWithRetry(args, workDir, envId, onLine, maxRetries = 2) {
  let lastErr
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await runTerraform(args, workDir, envId, onLine)
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
  const logs = []

  const onLine = (line) => logs.push(line)

  try {
    broadcast(id, { type: 'status', status: 'provisioning', message: 'Starting provisioning...' })

    // Guard: check terraform binary exists before doing anything
    await new Promise((resolve, reject) => {
      const tf = spawn('terraform', ['version'], { cwd: workDir })
      tf.on('close', code => code === 0 ? resolve() : reject(new Error('Terraform binary not found. Install Terraform: https://developer.hashicorp.com/terraform/install')))
      tf.on('error', () => reject(new Error('Terraform binary not found. Install Terraform: https://developer.hashicorp.com/terraform/install')))
    })

    // Pre-create resources in local mock before Terraform runs, avoiding
    // unsupported API calls (ListQueueTags, DescribeTimeToLive, etc.)
    if (INFRA_MODE === 'local' && LOCAL_HOOKS[template]) {
      const endpoint = process.env.MOCKCLOUD_ENDPOINT || 'http://localhost:4566'
      logLine(id, `→ Pre-creating local mock resources for ${template} (${endpoint})...`)
      await LOCAL_HOOKS[template].create(endpoint, name)
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
      infra_mode:         INFRA_MODE,
      mockcloud_endpoint: process.env.MOCKCLOUD_ENDPOINT || 'http://localhost:4566',
      aws_region:         process.env.AWS_REGION || 'us-east-1',
    })

    // terraform init
    logLine(id, '→ Running terraform init...')
    await runTerraformWithRetry(['init', '-no-color'], workDir, id, onLine)

    // terraform apply
    logLine(id, '→ Running terraform apply...')
    await runTerraformWithRetry(['apply', '-auto-approve', '-no-color'], workDir, id, onLine)

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
        infra_mode:         INFRA_MODE,
        mockcloud_endpoint: process.env.MOCKCLOUD_ENDPOINT || 'http://localhost:4566',
        aws_region:         process.env.AWS_REGION || 'us-east-1',
      })
      await runTerraform(['init', '-no-color'], workDir, envId, onLine)
    }

    // Clean up local mock resources created outside of Terraform state
    if (INFRA_MODE === 'local' && LOCAL_HOOKS[environment.template]) {
      const endpoint = process.env.MOCKCLOUD_ENDPOINT || 'http://localhost:4566'
      await LOCAL_HOOKS[environment.template].delete(endpoint, environment.name)
    }

    await runTerraform(['destroy', '-auto-approve', '-no-color'], workDir, envId, onLine)

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
