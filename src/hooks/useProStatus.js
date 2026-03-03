import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const API_URL = import.meta.env.VITE_API_URL || 'http://72.62.154.2'

const normalizeEmail = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '')

export default function useProStatus(email) {
  const normalizedEmail = useMemo(() => normalizeEmail(email), [email])
  const requestIdRef = useRef(0)
  const [isPro, setIsPro] = useState(false)
  const [loading, setLoading] = useState(Boolean(normalizedEmail))
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    if (!normalizedEmail) {
      setIsPro(false)
      setLoading(false)
      setError(null)
      return false
    }

    setLoading(true)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        if (requestId !== requestIdRef.current) return false
        setIsPro(false)
        return false
      }

      const res = await fetch(`${API_URL}/api/me`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })

      if (requestId !== requestIdRef.current) return false
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data = await res.json()
      const proStatus = Boolean(data?.is_pro)
      setIsPro(proStatus)
      return proStatus
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return false
      setIsPro(false)
      setError(loadError)
      return false
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [normalizedEmail])

  useEffect(() => {
    load()
    return () => {
      requestIdRef.current += 1
    }
  }, [load])

  return { isPro, loading, error, refresh: load }
}
