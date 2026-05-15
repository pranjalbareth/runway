import { useEffect, useRef, useState, useCallback } from 'react'

export function useWebSocket(envId) {
  const [logs, setLogs] = useState([])
  const [status, setStatus] = useState(null)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef(null)
  const retryRef = useRef(null)
  const retryCount = useRef(0)
  const terminalRef = useRef(false)

  const connect = useCallback(() => {
    if (!envId) return
    if (terminalRef.current) return // don't reconnect after terminal state
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?envId=${envId}`)

    ws.onopen = () => {
      setConnected(true)
      retryCount.current = 0
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)

      if (msg.type === 'log') {
        setLogs(prev => [...prev, { line: msg.line, timestamp: msg.timestamp }])
      }

      if (msg.type === 'status') {
        setStatus({ status: msg.status, message: msg.message })
        if (['running', 'failed', 'destroyed'].includes(msg.status)) {
          terminalRef.current = true
          setTimeout(() => ws.close(), 2000)
        }
      }
    }

    ws.onclose = () => {
      setConnected(false)
      wsRef.current = null
      // Exponential backoff reconnect — only if not in terminal state
      if (!terminalRef.current) {
        const delay = Math.min(1000 * 2 ** retryCount.current, 30000)
        retryCount.current += 1
        retryRef.current = setTimeout(connect, delay)
      }
    }

    ws.onerror = () => {
      setConnected(false)
    }

    wsRef.current = ws
  }, [envId])

  useEffect(() => {
    terminalRef.current = false
    retryCount.current = 0
    connect()
    return () => {
      terminalRef.current = true
      clearTimeout(retryRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  const clearLogs = () => setLogs([])

  return { logs, status, connected, clearLogs, reconnect: connect }
}
