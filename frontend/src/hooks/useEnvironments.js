import { useState, useEffect, useCallback } from 'react'

export function useEnvironments() {
  const [environments, setEnvironments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchEnvironments = useCallback(async () => {
    try {
      const res = await fetch('/api/environments')
      const data = await res.json()
      setEnvironments(data)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchEnvironments()
    // Poll every 5s to catch status updates
    const interval = setInterval(fetchEnvironments, 5000)
    return () => clearInterval(interval)
  }, [fetchEnvironments])

  const provision = async (payload) => {
    const res = await fetch('/api/environments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const data = await res.json()
    if (!res.ok) throw data
    await fetchEnvironments()
    return data
  }

  const destroy = async (id) => {
    const res = await fetch(`/api/environments/${id}/destroy`, { method: 'POST' })
    const data = await res.json()
    if (!res.ok) throw data
    await fetchEnvironments()
    return data
  }

  return { environments, loading, error, provision, destroy, refresh: fetchEnvironments }
}
