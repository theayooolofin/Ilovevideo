import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

const API_URL = import.meta.env.VITE_API_URL || 'http://72.62.154.2'

export default function StatsBar() {
  const [stats, setStats] = useState(null)

  useEffect(() => {
    const load = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) return
        const res = await fetch(`${API_URL}/api/stats`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (res.ok) setStats(await res.json())
      } catch {}
    }
    load()
  }, [])

  if (!stats) return null

  return (
    <div style={{
      background: 'linear-gradient(90deg, #1e1b4b, #312e81)',
      padding: '8px 24px',
      display: 'flex',
      justifyContent: 'center',
      gap: '32px',
      flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: '13px', color: '#c7d2fe', fontWeight: '500' }}>
        🎬 <strong style={{ color: '#fff' }}>{stats.total_videos_compressed}</strong> videos compressed
      </span>
      <span style={{ fontSize: '13px', color: '#c7d2fe', fontWeight: '500' }}>
        🖼️ <strong style={{ color: '#fff' }}>{stats.total_images_compressed}</strong> images compressed
      </span>
      <span style={{ fontSize: '13px', color: '#c7d2fe', fontWeight: '500' }}>
        💾 <strong style={{ color: '#fff' }}>{Number(stats.total_mb_saved).toFixed(1)} MB</strong> saved
      </span>
    </div>
  )
}
