import { useEffect, useRef } from 'react'
import { useWebSocket } from '../hooks/useWebSocket'
import './LogPane.css'

export default function LogPane({ envId, onStatusChange }) {
  const { logs, status, connected } = useWebSocket(envId)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  useEffect(() => {
    if (status && onStatusChange) onStatusChange(status)
  }, [status, onStatusChange])

  return (
    <div className="log-pane">
      <div className="log-header">
        <span className="log-title">LIVE OUTPUT</span>
        <span className={`log-conn ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? '● CONNECTED' : '○ DISCONNECTED'}
        </span>
      </div>
      <div className="log-body">
        {logs.length === 0 && (
          <div className="log-empty">Waiting for output...</div>
        )}
        {logs.map((entry, i) => (
          <div key={i} className="log-line">
            <span className="log-ts">{new Date(entry.timestamp).toLocaleTimeString()}</span>
            <span className="log-text">{entry.line}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {status && (
        <div className={`log-status log-status--${status.status}`}>
          {status.message}
        </div>
      )}
    </div>
  )
}
