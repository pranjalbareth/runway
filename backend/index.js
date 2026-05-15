const express = require('express')
const http = require('http')
const cors = require('cors')
const path = require('path')
const { initDb } = require('./lib/db')
const { initWs } = require('./ws/handler')
const environmentRoutes = require('./routes/environments')
const adminRoutes = require('./routes/admin')
const { restoreTtlSchedules } = require('./lib/terraform')

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
  app.get('/api/templates', (req, res) => res.json(TEMPLATES))
  app.get('/api/health', (req, res) => res.json({ status: 'ok', version: process.env.npm_package_version || '1.0.0', mode: process.env.INFRA_MODE || 'local' }))

  const PORT = process.env.PORT || 3001
  server.listen(PORT, () => {
    console.log(`Runway backend running on port ${PORT}`)
  })
}).catch(err => {
  console.error('Failed to initialize database:', err)
  process.exit(1)
})
