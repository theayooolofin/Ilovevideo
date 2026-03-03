import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const API_URL = import.meta.env.VITE_API_URL || 'http://72.62.154.2'

const PRO_TOOLS = [
  { id: 'compress',      emoji: '🗜️', name: 'Compress',       desc: 'WhatsApp, TikTok, Instagram',  color: '#2563eb', bg: '#eff6ff' },
  { id: 'resize',        emoji: '📐', name: 'Resize',          desc: 'Perfect 9:16 dimensions',      color: '#7c3aed', bg: '#f5f3ff' },
  { id: 'convert',       emoji: '🔄', name: 'Convert to MP4',  desc: 'MOV, MKV, AVI → MP4',          color: '#0891b2', bg: '#ecfeff' },
  { id: 'extract-audio', emoji: '🎵', name: 'Extract Audio',   desc: 'Pull MP3 from any video',      color: '#059669', bg: '#ecfdf5' },
  { id: 'gif',           emoji: '🎞️', name: 'GIF Maker',       desc: 'Clips into animated GIFs',     color: '#d97706', bg: '#fffbeb' },
  { id: 'watermark',     emoji: '💧', name: 'Watermark',       desc: 'Brand videos with your logo',  color: '#dc2626', bg: '#fef2f2' },
  { id: 'trim',          emoji: '✂️', name: 'Trim',            desc: 'Cut clips — any length',       color: '#6d28d9', bg: '#f5f3ff' },
  { id: 'cartoonify',    emoji: '🎨', name: 'Cartoon Filter',  desc: 'Comic, Anime or Sketch',       color: '#db2777', bg: '#fdf2f8' },
]

function WaIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  )
}

export default function ProDashboard({ user, isPro, proPrice, handleGoPro, handleCancelPro, onNavigateHome, onNavigateToTool }) {
  const [billingInfo, setBillingInfo] = useState(null)
  const [userStats, setUserStats] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [cancelLoading, setCancelLoading] = useState(false)

  useEffect(() => {
    if (!user) { setLoading(false); return }
    loadData()
  }, [user?.id])

  const loadData = async () => {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const authHeader = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {}
      const [meRes, statsRes] = await Promise.all([
        fetch(`${API_URL}/api/me`, { headers: authHeader }),
        fetch(`${API_URL}/api/stats`, { headers: authHeader }),
      ])
      if (meRes.ok) setBillingInfo(await meRes.json())
      if (statsRes.ok) setUserStats(await statsRes.json())
      const { data } = await supabase
        .from('compress_history')
        .select('id, filename, file_name, original_size, compressed_size, mb_saved, created_at, type')
        .order('created_at', { ascending: false })
        .limit(10)
      if (data) setHistory(data)
    } catch {}
    setLoading(false)
  }

  const handleCancel = async () => {
    if (!window.confirm("Cancel your Pro subscription? You'll lose unlimited access.")) return
    setCancelLoading(true)
    await handleCancelPro()
    setCancelLoading(false)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const authHeader = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
      const res = await fetch(`${API_URL}/api/me`, { headers: authHeader })
      if (res.ok) setBillingInfo(await res.json())
    } catch {}
  }

  const handleInvite = () => {
    const refCode = user?.id?.slice(0, 8) ?? 'friend'
    const text = `I use iLoveVideo to compress videos for WhatsApp, TikTok & Instagram — try it free!\nhttps://ilovevideo.fun?ref=${refCode}`
    if (navigator.share) {
      navigator.share({ title: 'iLoveVideo', text }).catch(() => {
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
      })
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
    }
  }

  const goToTool = (toolId) => {
    if (onNavigateToTool) onNavigateToTool(toolId)
    else onNavigateHome?.()
  }

  // ── Derived values ───────────────────────────────────────────────────────────
  const displayName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'there'
  const initials = displayName.split(/[\s._@-]+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('')

  const totalCompressed = Number(userStats?.total_videos_compressed ?? 0)
  const totalMBSaved = Number(userStats?.total_mb_saved ?? 0)
  const totalStorageSaved = totalMBSaved >= 1024
    ? `${(totalMBSaved / 1024).toFixed(2)} GB`
    : `${Math.round(totalMBSaved)} MB`

  const ratioPairs = history.filter(h => h.original_size > 0 && h.compressed_size > 0)
  const avgRatio = ratioPairs.length > 0
    ? Math.round(ratioPairs.reduce((s, h) => s + (1 - h.compressed_size / h.original_size) * 100, 0) / ratioPairs.length)
    : null

  const proSince = billingInfo?.pro_since
    ? new Date(billingInfo.pro_since).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : null

  // ── Access gates ─────────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px', padding: '48px 24px', textAlign: 'center' }}>
        <h2 style={{ fontSize: '22px', fontWeight: '700', color: '#111827', margin: 0 }}>Sign in to access your dashboard</h2>
        <button onClick={onNavigateHome} style={{ padding: '11px 28px', borderRadius: '10px', border: 'none', background: '#2563eb', color: '#fff', fontSize: '15px', fontWeight: '600', cursor: 'pointer' }}>
          Back to Home
        </button>
      </div>
    )
  }

  if (!isPro) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0c1445 0%, #1a2980 50%, #0c1445 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '24px', padding: '48px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: '64px', filter: 'drop-shadow(0 8px 24px rgba(245,158,11,0.5))' }}>⚡</div>
        <div>
          <h2 style={{ fontSize: '32px', fontWeight: '900', color: '#fff', margin: '0 0 12px' }}>Unlock Pro Dashboard</h2>
          <p style={{ fontSize: '16px', color: '#94a3b8', maxWidth: '380px', lineHeight: '1.7', margin: 0 }}>
            Unlimited compressions, 8 Pro tools, and your personal usage analytics.
          </p>
        </div>
        <button onClick={handleGoPro} style={{ padding: '16px 44px', borderRadius: '14px', border: 'none', background: 'linear-gradient(135deg, #f59e0b, #ef4444)', color: '#fff', fontSize: '17px', fontWeight: '800', cursor: 'pointer', boxShadow: '0 8px 32px rgba(245,158,11,0.4)' }}>
          Go Pro — {proPrice}/mo
        </button>
        <button onClick={onNavigateHome} style={{ padding: '10px 24px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: '#cbd5e1', fontSize: '14px', fontWeight: '500', cursor: 'pointer' }}>
          Back to Home
        </button>
      </div>
    )
  }

  // ── Stat rows ─────────────────────────────────────────────────────────────────
  const heroStats = [
    { icon: '🎬', value: loading ? '—' : totalCompressed.toLocaleString(), label: 'Videos Processed' },
    { icon: '💾', value: loading ? '—' : totalStorageSaved, label: 'Storage Saved' },
    ...(avgRatio !== null ? [{ icon: '📉', value: `${avgRatio}%`, label: 'Avg Reduction' }] : []),
    { icon: '∞', value: 'Unlimited', label: 'Daily Uses' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#f0f4ff' }}>

      {/* ── Hero ──────────────────────────────────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(135deg, #0c1445 0%, #1c2f8a 40%, #0d47a1 70%, #0c1445 100%)',
        padding: '40px 24px 90px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Decorative glows */}
        <div style={{ position: 'absolute', top: '-100px', right: '-60px', width: '400px', height: '400px', background: 'radial-gradient(circle, rgba(99,102,241,0.25) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: '-80px', left: '5%', width: '300px', height: '300px', background: 'radial-gradient(circle, rgba(14,165,233,0.15) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: '30%', left: '55%', width: '200px', height: '200px', background: 'radial-gradient(circle, rgba(168,85,247,0.12) 0%, transparent 70%)', pointerEvents: 'none' }} />

        <div style={{ maxWidth: '1060px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
          {/* Back */}
          <button onClick={onNavigateHome} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#94a3b8', fontSize: '13px', fontWeight: '500', padding: '7px 14px', borderRadius: '8px', cursor: 'pointer', marginBottom: '40px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            ← Back to Tools
          </button>

          {/* Identity row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '18px', marginBottom: '48px', flexWrap: 'wrap' }}>
            <div style={{ width: '68px', height: '68px', borderRadius: '22px', background: 'linear-gradient(135deg, #f59e0b, #ef4444)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px', fontWeight: '900', color: '#fff', flexShrink: 0, boxShadow: '0 8px 28px rgba(245,158,11,0.45)', letterSpacing: '-1px' }}>
              {initials || '?'}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
                <h1 style={{ margin: 0, fontSize: '28px', fontWeight: '900', color: '#fff', lineHeight: 1.15, letterSpacing: '-0.5px' }}>
                  Welcome back, {displayName} 👋
                </h1>
                <span style={{ background: 'linear-gradient(135deg, #fbbf24, #f59e0b)', color: '#78350f', fontSize: '11px', fontWeight: '900', padding: '4px 11px', borderRadius: '999px', letterSpacing: '0.08em', boxShadow: '0 2px 8px rgba(245,158,11,0.4)' }}>
                  ⚡ PRO
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>{user.email}</p>
              {proSince && <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#475569' }}>Pro member since {proSince}</p>}
            </div>
          </div>

          {/* Glassmorphism stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '14px' }}>
            {heroStats.map((stat, i) => (
              <div key={i} style={{
                background: 'rgba(255,255,255,0.06)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '18px',
                padding: '22px 20px',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '30px', marginBottom: '10px' }}>{stat.icon}</div>
                <p style={{ margin: 0, fontSize: '24px', fontWeight: '900', color: '#fff', lineHeight: 1, letterSpacing: '-0.5px' }}>{stat.value}</p>
                <p style={{ margin: '7px 0 0', fontSize: '11px', color: '#94a3b8', fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div style={{ maxWidth: '1060px', margin: '-44px auto 0', padding: '0 20px 80px', position: 'relative', zIndex: 2 }}>

        {/* Access banner */}
        <div style={{
          background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
          borderRadius: '18px',
          padding: '20px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '24px',
          boxShadow: '0 8px 36px rgba(37,99,235,0.35)',
          flexWrap: 'wrap',
          gap: '14px',
        }}>
          <div>
            <p style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: '#fff' }}>All 8 Pro tools are unlocked for you</p>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#bfdbfe' }}>Unlimited processing · No watermarks · Priority servers</p>
          </div>
          <button onClick={() => goToTool('compress')} style={{ padding: '11px 24px', borderRadius: '10px', border: 'none', background: '#fff', color: '#2563eb', fontSize: '14px', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>
            Start Compressing →
          </button>
        </div>

        <div className="pro-dashboard-grid">

          {/* ── LEFT: Tools + Invite ─────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* Tools grid */}
            <div style={{ background: '#fff', borderRadius: '20px', padding: '24px', border: '1.5px solid #e5e7eb', boxShadow: '0 2px 16px rgba(0,0,0,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
                <h2 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#111827' }}>Your Pro Tools</h2>
                <span style={{ fontSize: '12px', color: '#6b7280', background: '#f3f4f6', padding: '3px 10px', borderRadius: '999px', fontWeight: '600' }}>8 tools</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {PRO_TOOLS.map(tool => (
                  <button
                    key={tool.id}
                    className="pro-tool-card"
                    onClick={() => goToTool(tool.id)}
                    style={{ '--hover-bg': tool.bg, '--hover-color': tool.color }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = tool.bg
                      e.currentTarget.style.borderColor = tool.color + '50'
                      e.currentTarget.style.boxShadow = `0 6px 20px ${tool.color}20`
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = '#fafafa'
                      e.currentTarget.style.borderColor = '#f0f0f0'
                      e.currentTarget.style.boxShadow = 'none'
                    }}
                  >
                    <div style={{ fontSize: '24px', marginBottom: '9px' }}>{tool.emoji}</div>
                    <p style={{ margin: 0, fontSize: '13px', fontWeight: '700', color: '#111827' }}>{tool.name}</p>
                    <p style={{ margin: '3px 0 0', fontSize: '11px', color: '#9ca3af', lineHeight: 1.45 }}>{tool.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Invite card */}
            <div style={{
              background: 'linear-gradient(135deg, #064e3b, #065f46)',
              borderRadius: '20px',
              padding: '24px',
              boxShadow: '0 4px 20px rgba(6,78,59,0.3)',
            }}>
              <p style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: '800', color: '#fff' }}>📱 Invite Friends</p>
              <p style={{ margin: '0 0 18px', fontSize: '13px', color: '#6ee7b7', lineHeight: 1.55 }}>
                Share iLoveVideo and help your contacts compress videos for free
              </p>
              <button onClick={handleInvite} style={{ width: '100%', padding: '13px', borderRadius: '12px', border: 'none', background: '#25D366', color: '#fff', fontSize: '14px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', boxShadow: '0 4px 14px rgba(37,211,102,0.4)' }}>
                <WaIcon /> Share on WhatsApp
              </button>
            </div>
          </div>

          {/* ── RIGHT: Subscription + Activity ───────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* Subscription card */}
            <div style={{ background: '#fff', borderRadius: '20px', padding: '24px', border: '1.5px solid #e5e7eb', boxShadow: '0 2px 16px rgba(0,0,0,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '22px' }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'linear-gradient(135deg, #f59e0b, #ef4444)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', flexShrink: 0, boxShadow: '0 4px 14px rgba(245,158,11,0.35)' }}>⚡</div>
                <div>
                  <p style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#111827' }}>Pro Monthly</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                    <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 6px #10b981' }} />
                    <span style={{ fontSize: '12px', color: '#10b981', fontWeight: '700' }}>Active</span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0', borderRadius: '14px', overflow: 'hidden', border: '1.5px solid #f3f4f6', marginBottom: '18px' }}>
                {[
                  ['Price', `${proPrice}/month`, false],
                  proSince ? ['Member since', proSince, false] : null,
                  ['Compressions', '∞ Unlimited', true],
                  ['Pro tools', '8 unlocked', true],
                ].filter(Boolean).map(([label, value, isGreen], i, arr) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 16px', background: i % 2 === 0 ? '#fafafa' : '#fff', borderBottom: i < arr.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                    <span style={{ fontSize: '13px', color: '#6b7280' }}>{label}</span>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: isGreen ? '#059669' : '#111827' }}>{value}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={handleCancel}
                disabled={cancelLoading}
                style={{ width: '100%', padding: '11px', borderRadius: '10px', border: '1.5px solid #fecaca', background: 'transparent', color: '#b91c1c', fontSize: '13px', fontWeight: '600', cursor: cancelLoading ? 'not-allowed' : 'pointer', opacity: cancelLoading ? 0.6 : 1, transition: 'background 0.15s' }}
                onMouseEnter={e => { if (!cancelLoading) e.currentTarget.style.background = '#fef2f2' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                {cancelLoading ? 'Cancelling…' : 'Cancel Subscription'}
              </button>
            </div>

            {/* Recent activity */}
            <div style={{ background: '#fff', borderRadius: '20px', border: '1.5px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,0.05)' }}>
              <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: '#111827' }}>Recent Compressions</h3>
                {history.length > 0 && <span style={{ fontSize: '12px', color: '#9ca3af', fontWeight: '500' }}>{history.length} files</span>}
              </div>

              {loading ? (
                <div style={{ padding: '48px 24px', textAlign: 'center', color: '#9ca3af', fontSize: '14px' }}>Loading your history…</div>
              ) : history.length === 0 ? (
                <div style={{ padding: '48px 24px', textAlign: 'center' }}>
                  <div style={{ fontSize: '36px', marginBottom: '12px', opacity: 0.5 }}>🎬</div>
                  <p style={{ margin: '0 0 14px', fontSize: '14px', color: '#6b7280', fontWeight: '500' }}>No compressions yet</p>
                  <button onClick={() => goToTool('compress')} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '14px', fontWeight: '700', padding: 0 }}>
                    Compress your first video →
                  </button>
                </div>
              ) : (
                <div>
                  {history.map((item, i) => {
                    const name = item.filename ?? item.file_name ?? 'Video'
                    const shrinkPct = item.original_size > 0 && item.compressed_size > 0
                      ? Math.round((1 - item.compressed_size / item.original_size) * 100)
                      : null
                    const date = item.created_at
                      ? new Date(item.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                      : ''
                    const isImage = item.type === 'image'
                    return (
                      <div key={item.id ?? i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 24px', borderBottom: i < history.length - 1 ? '1px solid #f9fafb' : 'none', transition: 'background 0.12s' }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#fafbff' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '11px', minWidth: 0 }}>
                          <div style={{ width: '34px', height: '34px', borderRadius: '10px', background: isImage ? '#fdf2f8' : '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '15px' }}>
                            {isImage ? '🖼️' : '🎬'}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <p style={{ margin: 0, fontSize: '13px', fontWeight: '600', color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>{name}</p>
                            <p style={{ margin: 0, fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>{date}</p>
                          </div>
                        </div>
                        {shrinkPct !== null && shrinkPct > 0 ? (
                          <span style={{ flexShrink: 0, fontSize: '12px', fontWeight: '700', color: '#059669', background: '#ecfdf5', padding: '3px 10px', borderRadius: '999px' }}>−{shrinkPct}%</span>
                        ) : (
                          <span style={{ flexShrink: 0, fontSize: '12px', color: '#d1d5db' }}>—</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
