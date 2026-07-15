import { useEffect, useState } from 'react'
import './Plugins.css'

export default function Plugins() {
  const [plugins, setPlugins] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [errorById, setErrorById] = useState({})

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/plugins')
      const data = await r.json()
      setPlugins(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function call(id, action) {
    setBusyId(`${id}:${action}`)
    setErrorById((m) => ({ ...m, [id]: null }))
    try {
      const r = await fetch(`/api/plugins/${id}/${action}`, { method: 'POST' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      // merge updated row in place (no full reload — feels snappier)
      setPlugins((rows) => rows.map((p) => p.id === id ? data : p))
    } catch (e) {
      setErrorById((m) => ({ ...m, [id]: e.message }))
      // refresh so the recorded check shows up even on activation failure
      load()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="plugins">
      <div className="page-header">
        <div className="page-title">Plugins</div>
        <div className="page-subtitle">Activate a plugin to unlock its templates. Each plugin runs a health check before going active.</div>
      </div>

      {loading ? (
        <div className="plugins-loading">Loading plugins…</div>
      ) : (
        <div className="plugins-grid">
          {plugins.map((p) => (
            <PluginCard
              key={p.id}
              plugin={p}
              busy={busyId}
              error={errorById[p.id]}
              onActivate={() => call(p.id, 'activate')}
              onDeactivate={() => call(p.id, 'deactivate')}
              onCheck={() => call(p.id, 'check')}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PluginCard({ plugin, busy, error, onActivate, onDeactivate, onCheck }) {
  const isActive = plugin.status === 'active'
  const lastOk = plugin.last_check_ok
  const lastAt = plugin.last_check_at
  const lastMsg = plugin.last_check_message
  const busyKey = (action) => busy === `${plugin.id}:${action}`

  return (
    <div className={`plugin-card ${isActive ? 'is-active' : 'is-inactive'}`}>
      <div className="plugin-head">
        <div className="plugin-icon">{plugin.icon || '◆'}</div>
        <div className="plugin-title">
          <div className="plugin-name">{plugin.name}</div>
          <div className="plugin-id">{plugin.id}</div>
        </div>
        <StatusBadge status={plugin.status} lastOk={lastOk} hasCheck={!!lastAt} />
      </div>

      <div className="plugin-desc">{plugin.description}</div>

      <div className="plugin-check">
        {lastAt ? (
          <>
            <div className={`check-row ${lastOk ? 'check-ok' : 'check-fail'}`}>
              <span className="check-dot" />
              <span className="check-msg">{lastMsg || (lastOk ? 'healthy' : 'unhealthy')}</span>
            </div>
            <div className="check-time">last checked {fmtTime(lastAt)}</div>
          </>
        ) : (
          <div className="check-row check-idle">No health check run yet.</div>
        )}
        {error && <div className="check-error">✕ {error}</div>}
      </div>

      <div className="plugin-actions">
        {isActive ? (
          <button className="btn-ghost" onClick={onDeactivate} disabled={busyKey('deactivate')}>
            {busyKey('deactivate') ? 'Deactivating…' : 'Deactivate'}
          </button>
        ) : (
          <button className="btn-primary" onClick={onActivate} disabled={busyKey('activate')}>
            {busyKey('activate') ? 'Checking…' : 'Activate'}
          </button>
        )}
        <button className="btn-ghost" onClick={onCheck} disabled={busyKey('check')}>
          {busyKey('check') ? 'Testing…' : 'Test connection'}
        </button>
      </div>
    </div>
  )
}

function StatusBadge({ status, lastOk, hasCheck }) {
  if (status === 'active') return <span className="badge badge-active">ACTIVE</span>
  if (hasCheck && !lastOk) return <span className="badge badge-error">ERROR</span>
  return <span className="badge badge-inactive">INACTIVE</span>
}

function fmtTime(iso) {
  try {
    const d = new Date(iso)
    return d.toLocaleString()
  } catch (_) { return iso }
}
