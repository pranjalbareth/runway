import { useState } from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import './App.css'

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  return (
    <div className="app">
      <nav className="nav">
        <div className="nav-brand">
          <span className="nav-logo">▲</span>
          <span className="nav-name">RUNWAY</span>
          <span className="nav-tag">IDP</span>
        </div>
        <div className="nav-links">
          <NavLink to="/catalog" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>
            Catalog
          </NavLink>
          <NavLink to="/dashboard" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>
            Environments
          </NavLink>
          <NavLink to="/audit" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>
            Audit Log
          </NavLink>
          <NavLink to="/plugins" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>
            Plugins
          </NavLink>
        </div>
        <div className="nav-mode">
          <span className="mode-dot" />
          LOCAL MODE
          <button
            className="nav-settings"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </nav>
      <main className="main">
        <Outlet />
      </main>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

function SettingsModal({ onClose }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  async function doFlush() {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch('/api/admin/flush', { method: 'POST' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      setResult(data)
      // Reload so any open dashboards drop their now-orphaned state
      setTimeout(() => window.location.reload(), 1200)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Settings</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="settings-section">
            <div className="settings-section-title">Flush all resources</div>
            <div className="settings-section-desc">
              Permanently delete every environment record, audit log entry, terraform output, and
              the entire <code>.runway-work</code> directory. This cannot be undone.
            </div>
            {result ? (
              <div className="settings-success">
                ✓ Flushed {result.environmentsDeleted} environment(s).
                {result.workDirsSkipped > 0 && ` (${result.workDirsSkipped} work dir(s) still locked — they will clear when the process exits)`}
                {' '}Reloading…
              </div>
            ) : !confirming ? (
              <button className="btn-danger" onClick={() => setConfirming(true)}>
                Flush everything…
              </button>
            ) : (
              <div className="settings-confirm">
                <span>Are you sure?</span>
                <button className="btn-danger" onClick={doFlush} disabled={busy}>
                  {busy ? 'Flushing…' : 'Yes, wipe everything'}
                </button>
                <button className="btn-ghost" onClick={() => setConfirming(false)} disabled={busy}>
                  Cancel
                </button>
              </div>
            )}
            {error && <div className="settings-error">✕ {error}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
