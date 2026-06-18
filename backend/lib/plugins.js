// plugins.js — health-check dispatcher for the three Runway plugins.
// Plugin == cloud/runtime provider that templates depend on.

const { spawn } = require('child_process')
const http = require('http')
const { URL } = require('url')

const PLUGIN_DEFINITIONS = {
  docker: {
    id: 'docker',
    name: 'Docker',
    description: 'Local Docker daemon for container-based templates (Hangar, Squadron, Beacon).',
    icon: '🐳'
  },
  mockcloud: {
    id: 'mockcloud',
    name: 'MockCloud',
    description: 'LocalStack-style emulator at MOCKCLOUD_ENDPOINT. Lets cloud templates run locally without AWS credentials.',
    icon: '☁️'
  },
  aws: {
    id: 'aws',
    name: 'AWS',
    description: 'Real AWS account. Requires AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION env vars.',
    icon: '🛰️'
  }
}

function checkDocker() {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['info'], { stdio: 'ignore' })
    let settled = false
    const done = (ok, msg) => {
      if (settled) return
      settled = true
      resolve({ ok, message: msg })
    }
    proc.on('error', () => done(false, 'docker CLI not found on PATH'))
    proc.on('exit', (code) => {
      if (code === 0) done(true, 'docker daemon reachable')
      else done(false, `docker info exited ${code} — is Docker Desktop running?`)
    })
    setTimeout(() => {
      try { proc.kill() } catch (_) {}
      done(false, 'docker info timed out after 5s')
    }, 5000)
  })
}

function probe(endpoint, pathname) {
  return new Promise((resolve) => {
    let url
    try {
      url = new URL(pathname, endpoint)
    } catch (e) {
      return resolve({ ok: false, status: 0, error: `invalid endpoint: ${endpoint}` })
    }
    const req = http.get({
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      timeout: 4000
    }, (res) => {
      res.resume()
      resolve({ ok: true, status: res.statusCode })
    })
    req.on('error', (err) => resolve({ ok: false, status: 0, error: err.code || err.message }))
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, error: 'timeout' }) })
  })
}

async function checkMockcloud() {
  const endpoint = process.env.MOCKCLOUD_ENDPOINT || 'http://localhost:4566'

  // Try LocalStack's well-known endpoint first; if that 404s the server is still
  // up (it answered), so any HTTP response counts as healthy. Only connection
  // errors / timeouts mean MockCloud is genuinely unreachable.
  const ls = await probe(endpoint, '/_localstack/health')
  if (ls.ok && ls.status === 200) {
    return { ok: true, message: `MockCloud (LocalStack) healthy at ${endpoint}` }
  }
  if (ls.ok) {
    return { ok: true, message: `MockCloud reachable at ${endpoint} (responded ${ls.status} on /_localstack/health)` }
  }

  // /_localstack/health didn't even connect — try root as a fallback
  const root = await probe(endpoint, '/')
  if (root.ok) {
    return { ok: true, message: `MockCloud reachable at ${endpoint} (responded ${root.status} on /)` }
  }

  return { ok: false, message: `cannot reach ${endpoint} — ${root.error || ls.error || 'no response'}` }
}

function checkAws() {
  const required = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION']
  const missing = required.filter((k) => !process.env[k])
  if (missing.length > 0) {
    return Promise.resolve({
      ok: false,
      message: `missing env var(s): ${missing.join(', ')}`
    })
  }
  return Promise.resolve({
    ok: true,
    message: `credentials configured for region ${process.env.AWS_REGION}`
  })
}

const CHECKERS = {
  docker: checkDocker,
  mockcloud: checkMockcloud,
  aws: checkAws
}

async function runHealthCheck(id) {
  const checker = CHECKERS[id]
  if (!checker) return { ok: false, message: `unknown plugin: ${id}` }
  return checker()
}

function getDefinition(id) {
  return PLUGIN_DEFINITIONS[id] || null
}

function getAllDefinitions() {
  return Object.values(PLUGIN_DEFINITIONS)
}

module.exports = {
  runHealthCheck,
  getDefinition,
  getAllDefinitions,
  PLUGIN_DEFINITIONS
}
