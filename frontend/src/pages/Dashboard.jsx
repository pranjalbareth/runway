import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useEnvironments } from '../hooks/useEnvironments'
import LogPane from '../components/LogPane'
import './Dashboard.css'

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function ttlRemaining(expiresAt) {
  if (!expiresAt) return null
  const diff = new Date(expiresAt).getTime() - Date.now()
  if (diff <= 0) return 'Expired'
  if (diff < 60000) return `${Math.ceil(diff / 1000)}s`
  const hrs = Math.floor(diff / 3600000)
  const mins = Math.floor((diff % 3600000) / 60000)
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`
}

export default function Dashboard() {
  const { environments, loading, destroy, refresh } = useEnvironments()
  const [activeLog, setActiveLog] = useState(null)
  const [destroying, setDestroying] = useState(null)
  const [searchParams] = useSearchParams()

  // 1-second tick so TTL countdowns stay live without waiting for the 5s poll
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  // Auto-open log pane for newly provisioned env
  useEffect(() => {
    const highlight = searchParams.get('highlight')
    if (highlight) setActiveLog(highlight)
  }, [searchParams])

  const handleDestroy = async (id) => {
    setDestroying(id)
    try {
      await destroy(id)
      setActiveLog(id) // show destroy logs
    } catch (err) {
      console.error(err)
    } finally {
      setDestroying(null)
      setTimeout(refresh, 1000)
    }
  }

  const active = environments.filter(e => !['destroyed'].includes(e.status))
  const archived = environments.filter(e => e.status === 'destroyed')

  if (loading) {
    return (
      <div className="dashboard">
        <div className="page-header">
          <div className="page-title">Environments</div>
        </div>
        <div className="loading">Loading environments...</div>
      </div>
    )
  }

  return (
    <div className="dashboard">
      <div className="page-header">
        <div className="page-title">Environments</div>
        <div className="page-subtitle">{active.length} active · {archived.length} archived</div>
      </div>

      {environments.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">◻</div>
          <div className="empty-title">No environments yet</div>
          <div className="empty-sub">Go to the Catalog to provision your first environment</div>
        </div>
      )}

      {active.length > 0 && (
        <div className="env-section">
          <div className="env-list">
            {active.map(env => (
              <div key={env.id} className={`env-card ${activeLog === env.id ? 'env-card--active' : ''}`}>
                <div className="env-card-header">
                  <div className="env-card-left">
                    <span className="env-name">{env.name}</span>
                    <span className={`badge ${env.status}`}>{env.status}</span>
                    {env.drift_detected === 1 && (
                      <span className="drift-badge">⚠ DRIFT</span>
                    )}
                  </div>
                  <div className="env-card-right">
                    <span className="env-meta">{env.template}</span>
                    <span className="env-meta">{env.instance_type}</span>
                    {env.status === 'running' && env.port && (
                      <a
                        href={`http://localhost:${env.port}`}
                        target="_blank"
                        rel="noreferrer"
                        className="env-link"
                      >
                        :{env.port} ↗
                      </a>
                    )}
                  </div>
                </div>

                <div className="env-card-meta">
                  <span>Created {timeAgo(env.created_at)}</span>
                  {env.expires_at && ['provisioning', 'running'].includes(env.status) && (() => {
                    const remaining = ttlRemaining(env.expires_at)
                    if (!remaining) return null
                    const expired = remaining === 'Expired'
                    return (
                      <span className={`ttl-remaining${expired ? ' ttl-expired' : ''}`}>
                        ⏱ TTL: {expired ? 'Expired' : `${remaining} remaining`}
                      </span>
                    )
                  })()}
                </div>

                <div className="env-card-actions">
                  <button
                    className="btn-log"
                    onClick={() => setActiveLog(activeLog === env.id ? null : env.id)}
                  >
                    {activeLog === env.id ? 'Hide logs' : 'View logs'}
                  </button>
                  {['running', 'failed'].includes(env.status) && (
                    <button
                      className="btn-destroy"
                      onClick={() => handleDestroy(env.id)}
                      disabled={destroying === env.id}
                    >
                      {destroying === env.id ? 'Destroying...' : 'Destroy'}
                    </button>
                  )}
                </div>

                {activeLog === env.id && (
                  <div className="env-log-pane">
                    <LogPane envId={env.id} onStatusChange={() => refresh()} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {archived.length > 0 && (
        <div className="env-section">
          <div className="env-section-title">Archived</div>
          <div className="env-list">
            {archived.map(env => (
              <div key={env.id} className="env-card env-card--archived">
                <div className="env-card-header">
                  <div className="env-card-left">
                    <span className="env-name env-name--muted">{env.name}</span>
                    <span className={`badge ${env.status}`}>{env.status}</span>
                  </div>
                  <div className="env-card-right">
                    <span className="env-meta">{env.template}</span>
                    <span className="env-meta">
                      Destroyed {env.destroyed_at ? timeAgo(env.destroyed_at) : '—'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
