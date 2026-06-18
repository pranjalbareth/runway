const express = require('express')
const router = express.Router()
const { pluginQueries } = require('../lib/db')
const { runHealthCheck, getDefinition, getAllDefinitions } = require('../lib/plugins')

function hydrate(row) {
  const def = getDefinition(row.id)
  return {
    id: row.id,
    name: def?.name || row.id,
    description: def?.description || '',
    icon: def?.icon || '',
    status: row.status,
    last_check_at: row.last_check_at,
    last_check_ok: row.last_check_ok === 1,
    last_check_message: row.last_check_message,
    activated_at: row.activated_at
  }
}

router.get('/', (req, res) => {
  const rows = pluginQueries.getAll()
  // ensure every defined plugin appears even if seed somehow missed it
  const byId = new Map(rows.map((r) => [r.id, r]))
  const all = getAllDefinitions().map((def) => byId.get(def.id) || {
    id: def.id,
    status: 'inactive',
    last_check_at: null,
    last_check_ok: 0,
    last_check_message: null,
    activated_at: null
  })
  res.json(all.map(hydrate))
})

router.post('/:id/activate', async (req, res) => {
  const { id } = req.params
  if (!getDefinition(id)) return res.status(404).json({ error: `unknown plugin: ${id}` })
  const result = await runHealthCheck(id)
  pluginQueries.recordCheck(id, result.ok, result.message)
  if (!result.ok) {
    return res.status(400).json({ error: result.message, ok: false })
  }
  pluginQueries.setStatus(id, 'active')
  res.json(hydrate(pluginQueries.getById(id)))
})

router.post('/:id/deactivate', (req, res) => {
  const { id } = req.params
  if (!getDefinition(id)) return res.status(404).json({ error: `unknown plugin: ${id}` })
  pluginQueries.setStatus(id, 'inactive')
  res.json(hydrate(pluginQueries.getById(id)))
})

router.post('/:id/check', async (req, res) => {
  const { id } = req.params
  if (!getDefinition(id)) return res.status(404).json({ error: `unknown plugin: ${id}` })
  const result = await runHealthCheck(id)
  pluginQueries.recordCheck(id, result.ok, result.message)
  res.json(hydrate(pluginQueries.getById(id)))
})

module.exports = router
