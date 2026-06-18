const express = require('express')
const http = require('http')
const fs = require('fs')
const cors = require('cors')
const path = require('path')
const { initDb, pluginQueries } = require('./lib/db')
const { initWs } = require('./ws/handler')
const environmentRoutes = require('./routes/environments')
const adminRoutes = require('./routes/admin')
const pluginRoutes = require('./routes/plugins')
const { restoreTtlSchedules } = require('./lib/terraform')
const { getById: getTemplateById } = require('./lib/templates')

const app = express()
const server = http.createServer(app)

app.use(cors())
app.use(express.json())

const { TEMPLATES } = require('./lib/templates')

// Init DB then start everything
initDb().then(() => {
  // Restore any TTL schedules that survived a restart
  restoreTtlSchedules()

  // Init WebSocket server (attached to same HTTP server)
  initWs(server)

  // Routes
  app.use('/api/environments', environmentRoutes)
  app.use('/api/admin', adminRoutes)
  app.use('/api/plugins', pluginRoutes)

  // Template list — by default filtered to templates whose required plugin is active.
  // Pass ?all=true to bypass the filter (used by detail views).
  app.get('/api/templates', (req, res) => {
    const showAll = req.query.all === 'true' || req.query.all === '1'
    const activePluginIds = new Set(
      pluginQueries.getAll().filter((p) => p.status === 'active').map((p) => p.id)
    )
    const visible = showAll ? TEMPLATES : TEMPLATES.filter((t) => {
      const required = t.requiredPlugins || []
      if (required.length === 0) return true
      return required.some((id) => activePluginIds.has(id))
    })
    res.json(visible)
  })

  app.get('/api/templates/:id', (req, res) => {
    const t = getTemplateById(req.params.id)
    if (!t) return res.status(404).json({ error: 'template not found' })
    res.json(t)
  })

  app.get('/api/templates/:id/code', (req, res) => {
    const t = getTemplateById(req.params.id)
    if (!t) return res.status(404).json({ error: 'template not found' })
    const codePath = path.join(__dirname, '..', 'terraform', 'templates', t.id, 'main.tf')
    try {
      const code = fs.readFileSync(codePath, 'utf8')
      res.json({ id: t.id, filename: 'main.tf', code })
    } catch (err) {
      res.status(500).json({ error: `cannot read template source: ${err.message}` })
    }
  })

  app.get('/api/health', (req, res) => res.json({ status: 'ok', version: process.env.npm_package_version || '1.0.0', mode: process.env.INFRA_MODE || 'local' }))

  const PORT = process.env.PORT || 3001
  server.listen(PORT, () => {
    console.log(`Runway backend running on port ${PORT}`)
  })
}).catch(err => {
  console.error('Failed to initialize database:', err)
  process.exit(1)
})
