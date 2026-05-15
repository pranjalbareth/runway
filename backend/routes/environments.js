const express = require('express')
const { v4: uuidv4 } = require('uuid')
const { envQueries, auditQueries } = require('../lib/db')
const { evaluatePolicies } = require('../lib/policy')
const { provision, destroy } = require('../lib/terraform')

const router = express.Router()

// GET /api/environments - list all
router.get('/', (req, res) => {
  const envs = envQueries.getAll()
  res.json(envs)
})

// GET /api/environments/:id - get one
router.get('/:id', (req, res) => {
  const env = envQueries.getById(req.params.id)
  if (!env) return res.status(404).json({ error: 'Not found' })
  res.json(env)
})

// GET /api/environments/:id/logs - audit logs for an env
router.get('/:id/logs', (req, res) => {
  const logs = auditQueries.getByEnv(req.params.id)
  res.json(logs)
})

// GET /api/audit - full audit log
router.get('/audit/all', (req, res) => {
  const logs = auditQueries.getAll()
  res.json(logs)
})

// POST /api/environments - provision new environment
router.post('/', async (req, res) => {
  const { name, template, instance_type, port, ttl_hours } = req.body

  // Validate required fields
  if (!name || !template) {
    return res.status(400).json({ error: 'name and template are required' })
  }

  // Sanitize name — alphanumeric and hyphens only, no path traversal
  const sanitizedName = String(name).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  if (!sanitizedName || sanitizedName.length < 2) {
    return res.status(400).json({ error: 'name must be at least 2 alphanumeric characters' })
  }

  // Sanitize template — must be a known identifier, no slashes
  const sanitizedTemplate = String(template).replace(/[^a-z0-9-_]/g, '')
  if (!sanitizedTemplate || sanitizedTemplate !== template) {
    return res.status(400).json({ error: 'invalid template identifier' })
  }

  const provisionRequest = { name: sanitizedName, template: sanitizedTemplate, instance_type, port, ttl_hours: ttl_hours || 24 }

  // Run policy engine
  const policyResult = evaluatePolicies(provisionRequest)
  if (!policyResult.allowed) {
    return res.status(422).json({
      error: 'Policy violations detected',
      violations: policyResult.violations
    })
  }

  // Create environment record
  const id = uuidv4()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + (provisionRequest.ttl_hours * 60 * 60 * 1000))

  const environment = {
    id,
    name: sanitizedName,
    template: sanitizedTemplate,
    status: 'provisioning',
    instance_type: instance_type || 't3.micro',
    port: port || 3000,
    region: (process.env.INFRA_MODE === 'aws') ? (process.env.AWS_REGION || 'us-east-1') : 'local',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    ttl_hours: provisionRequest.ttl_hours,
    expires_at: expiresAt.toISOString()
  }

  envQueries.create(environment)

  // Respond immediately - provisioning happens async
  res.status(202).json({ id, message: 'Provisioning started', environment })

  // Kick off terraform async (don't await)
  provision(environment).catch(console.error)
})

// POST /api/environments/:id/destroy
router.post('/:id/destroy', async (req, res) => {
  const env = envQueries.getById(req.params.id)
  if (!env) return res.status(404).json({ error: 'Not found' })
  if (['destroyed', 'destroying'].includes(env.status)) {
    return res.status(400).json({ error: `Environment is already ${env.status}` })
  }

  res.json({ message: 'Destroy initiated', id: req.params.id })

  destroy(req.params.id).catch(console.error)
})

module.exports = router
