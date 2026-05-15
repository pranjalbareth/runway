import { useState, useEffect } from 'react'
import './AuditLog.css'

export default function AuditLog() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/environments/audit/all')
      .then(r => r.json())
      .then(data => { setLogs(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div className="audit">
      <div className="page-header">
        <div className="page-title">Audit Log</div>
        <div className="page-subtitle">All provisioning and destroy events</div>
      </div>

      {loading && <div className="audit-loading">Loading...</div>}

      {!loading && logs.length === 0 && (
        <div className="audit-empty">No events yet. Provision an environment to see audit entries.</div>
      )}

      {logs.length > 0 && (
        <div className="audit-table">
          <div className="audit-row audit-row--header">
            <span>Time</span>
            <span>Action</span>
            <span>Environment</span>
            <span>Status</span>
            <span>Message</span>
          </div>
          {logs.map(log => (
            <div key={log.id} className="audit-row">
              <span className="audit-ts">{new Date(log.created_at).toLocaleString()}</span>
              <span className={`audit-action audit-action--${log.action}`}>{log.action}</span>
              <span className="audit-env">{log.environment_id.slice(0, 8)}…</span>
              <span className={`audit-status audit-status--${log.status}`}>{log.status}</span>
              <span className="audit-msg">{log.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
