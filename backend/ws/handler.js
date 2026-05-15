const { WebSocketServer } = require('ws')
const { logQueries, envQueries } = require('../lib/db')

// Map of envId -> Set of WebSocket connections
const connections = new Map()

const TERMINAL_STATUSES = new Set(['running', 'failed', 'destroyed'])
const STATUS_REPLAY_MESSAGES = {
  running:   'Environment is running.',
  failed:    'Provisioning failed — see logs above.',
  destroyed: 'Environment has been destroyed.',
}

function initWs(server) {
  const wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (ws, req) => {
    // Client connects with ?envId=xxx
    const url = new URL(req.url, 'http://localhost')
    const envId = url.searchParams.get('envId')

    if (!envId) {
      ws.close(1008, 'envId required')
      return
    }

    // Register connection
    if (!connections.has(envId)) {
      connections.set(envId, new Set())
    }
    connections.get(envId).add(ws)

    console.log(`[WS] Client connected for env: ${envId}`)

    ws.on('close', () => {
      const set = connections.get(envId)
      if (set) {
        set.delete(ws)
        if (set.size === 0) connections.delete(envId)
      }
      console.log(`[WS] Client disconnected for env: ${envId}`)
    })

    ws.on('error', (err) => {
      console.error(`[WS] Error for env ${envId}:`, err.message)
    })

    // Replay stored log history so client always sees full output
    const history = logQueries.getByEnv(envId)
    for (const entry of history) {
      ws.send(JSON.stringify({ type: 'log', line: entry.line, timestamp: entry.timestamp }))
    }

    // If env is already in a terminal state, send the status so the frontend
    // shows the status banner and stops reconnecting
    const env = envQueries.getById(envId)
    if (env && TERMINAL_STATUSES.has(env.status)) {
      ws.send(JSON.stringify({
        type: 'status',
        status: env.status,
        message: STATUS_REPLAY_MESSAGES[env.status] || env.status,
        timestamp: new Date().toISOString(),
      }))
    }

    // Send connected
    ws.send(JSON.stringify({ type: 'connected', envId, timestamp: new Date().toISOString() }))
  })

  console.log('WebSocket server initialized on /ws')
  return wss
}

function broadcast(envId, message) {
  const set = connections.get(envId)
  if (!set || set.size === 0) return

  const payload = JSON.stringify(message)
  for (const ws of set) {
    if (ws.readyState === 1) { // OPEN
      ws.send(payload)
    }
  }
}

module.exports = { initWs, broadcast }
