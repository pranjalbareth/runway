// db.js — SQLite via sql.js (pure JS, no native compilation needed)
const initSqlJs = require('sql.js')
const path = require('path')
const fs = require('fs')

const DB_PATH = path.join(__dirname, '../../runway.db')

// sql.js works in-memory; we persist by writing the binary to disk on every write
let db = null

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS environments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    template TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'provisioning',
    instance_type TEXT,
    port INTEGER,
    region TEXT DEFAULT 'local',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    destroyed_at TEXT,
    ttl_hours INTEGER DEFAULT 24,
    expires_at TEXT,
    drift_detected INTEGER DEFAULT 0,
    policy_violations TEXT,
    ttl_scheduled_at TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    environment_id TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS env_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    env_id TEXT NOT NULL,
    line TEXT NOT NULL,
    timestamp TEXT NOT NULL
  );
`

function persist() {
  if (!db) return
  const data = db.export()
  fs.writeFileSync(DB_PATH, Buffer.from(data))
}

function rowToObj(stmt, row) {
  if (!row) return null
  const cols = stmt.getColumnNames()
  const obj = {}
  row.forEach((val, i) => { obj[cols[i]] = val })
  return obj
}

function runQuery(sql, params = []) {
  db.run(sql, params)
  persist()
}

function getOne(sql, params = []) {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  if (stmt.step()) {
    const cols = stmt.getColumnNames()
    const vals = stmt.get()
    stmt.free()
    const obj = {}
    cols.forEach((c, i) => { obj[c] = vals[i] })
    return obj
  }
  stmt.free()
  return null
}

function getAll(sql, params = []) {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows = []
  while (stmt.step()) {
    const cols = stmt.getColumnNames()
    const vals = stmt.get()
    const obj = {}
    cols.forEach((c, i) => { obj[c] = vals[i] })
    rows.push(obj)
  }
  stmt.free()
  return rows
}

async function initDb() {
  const SQL = await initSqlJs()

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH)
    db = new SQL.Database(fileBuffer)
  } else {
    db = new SQL.Database()
  }

  db.run(SCHEMA)
  persist()
  console.log('Database initialized')
  return db
}

function getDb() {
  if (!db) throw new Error('DB not initialized — await initDb() first')
  return db
}

// Environment queries
const envQueries = {
  create: (env) => {
    runQuery(
      `INSERT INTO environments (id, name, template, status, instance_type, port, region, created_at, updated_at, ttl_hours, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [env.id, env.name, env.template, env.status, env.instance_type, env.port, env.region,
       env.created_at, env.updated_at, env.ttl_hours, env.expires_at]
    )
  },

  getAll: () => getAll('SELECT * FROM environments ORDER BY created_at DESC'),

  getById: (id) => getOne('SELECT * FROM environments WHERE id = ?', [id]),

  updateStatus: (id, status, extra = {}) => {
    const now = new Date().toISOString()
    runQuery(
      'UPDATE environments SET status = ?, updated_at = ?, destroyed_at = ? WHERE id = ?',
      [status, now, extra.destroyed_at || null, id]
    )
  },

  updateDrift: (id, driftDetected) => {
    runQuery(
      'UPDATE environments SET drift_detected = ?, updated_at = ? WHERE id = ?',
      [driftDetected ? 1 : 0, new Date().toISOString(), id]
    )
  },

  setTtlScheduled: (id, scheduledAt) => {
    runQuery('UPDATE environments SET ttl_scheduled_at = ? WHERE id = ?', [scheduledAt, id])
  },

  getPendingTtl: () => getAll(
    `SELECT * FROM environments
     WHERE status = 'running' AND expires_at IS NOT NULL AND destroyed_at IS NULL`
  )
}

// Audit log queries
const auditQueries = {
  log: (entry) => {
    runQuery(
      `INSERT INTO audit_log (id, environment_id, action, status, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [entry.id, entry.environment_id, entry.action, entry.status, entry.message, entry.created_at]
    )
  },

  getByEnv: (environmentId) => getAll(
    'SELECT * FROM audit_log WHERE environment_id = ? ORDER BY created_at DESC',
    [environmentId]
  ),

  getAll: () => getAll('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100')
}

// Log persistence queries
const logQueries = {
  insert: (envId, line, timestamp) => {
    runQuery(
      'INSERT INTO env_logs (env_id, line, timestamp) VALUES (?, ?, ?)',
      [envId, line, timestamp]
    )
  },

  getByEnv: (envId) => getAll(
    'SELECT line, timestamp FROM env_logs WHERE env_id = ? ORDER BY id ASC',
    [envId]
  )
}

module.exports = { initDb, getDb, envQueries, auditQueries, logQueries }
