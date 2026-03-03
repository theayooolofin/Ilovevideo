import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const API_URL = import.meta.env.VITE_API_URL || 'http://72.62.154.2'

function StatCard({ emoji, label, value }) {
  return (
    <div style={{
      background: '#fff',
      borderRadius: '14px',
      padding: '20px 22px',
      border: '1.5px solid #e5e7eb',
      boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
    }}>
      <div style={{ fontSize: '26px', marginBottom: '10px' }}>{emoji}</div>
      <p style={{ margin: 0, fontSize: '24px', fontWeight: '800', color: '#111827', lineHeight: 1.1 }}>{value}</p>
      <p style={{ margin: '5px 0 0', fontSize: '12px', color: '#6b7280', fontWeight: '500' }}>{label}</p>
    </div>
  )
}

function BillingRow({ label, value, valueColor }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: '13px', color: '#6b7280' }}>{label}</span>
      <span style={{ fontSize: '13px', fontWeight: '600', color: valueColor ?? '#111827' }}>{value}</span>
    </div>
  )
}

function WaIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="#25D366">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  )
}

export default function ProDashboard({ user, isPro, proPrice, handleGoPro, handleCancelPro, onNavigateHome }) {
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
    const text = `I use iLoveVideo to compress and resize videos for WhatsApp, TikTok & Instagram — try it free!\nhttps://ilovevideo.fun?ref=${refCode}`
    if (navigator.share) {
      navigator.share({ title: 'iLoveVideo', text }).catch(() => {
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
      })
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
    }
  }

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
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '20px', padding: '48px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: '52px' }}>⚡</div>
        <h2 style={{ fontSize: '26px', fontWeight: '800', color: '#111827', margin: 0 }}>Pro Dashboard</h2>
        <p style={{ fontSize: '15px', color: '#6b7280', maxWidth: '360px', lineHeight: '1.65', margin: 0 }}>
          Unlock unlimited compressions and access your personal usage dashboard.
        </p>
        <button onClick={handleGoPro} style={{ padding: '14px 36px', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg,#f59e0b,#ef4444)', color: '#fff', fontSize: '16px', fontWeight: '700', cursor: 'pointer' }}>
          Go Pro — {proPrice}/mo
        </button>
        <button onClick={onNavigateHome} style={{ padding: '10px 24px', borderRadius: '10px', border: '1.5px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: '14px', fontWeight: '500', cursor: 'pointer' }}>
          Back to Home
        </button>
      </div>
    )
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────
  const totalCompressed = Number(userStats?.total_videos_compressed ?? 0)
  const totalMBSaved = Number(userStats?.total_mb_saved ?? 0)
  const totalGBSaved = (totalMBSaved / 1024).toFixed(2)

  const ratioPairs = history.filter(h => h.original_size > 0 && h.compressed_size > 0)
  const avgRatio = ratioPairs.length > 0
    ? Math.round(ratioPairs.reduce((s, h) => s + (1 - h.compressed_size / h.original_size) * 100, 0) / ratioPairs.length)
    : null

  const proSince = billingInfo?.pro_since
    ? new Date(billingInfo.pro_since).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : null

  return (
    <div style={{ maxWidth: '1060px', margin: '0 auto', padding: '36px 20px 60px' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <span style={{ display: 'inline-block', background: 'linear-gradient(135deg,#fef3c7,#fde68a)', color: '#92400e', fontSize: '11px', fontWeight: '700', padding: '3px 10px', borderRadius: '999px', letterSpacing: '0.05em', marginBottom: '10px' }}>
          ⚡ PRO MEMBER
        </span>
        <h1 style={{ fontSize: '28px', fontWeight: '800', color: '#111827', margin: 0, lineHeight: 1.2 }}>Your Dashboard</h1>
        <p style={{ fontSize: '13px', color: '#9ca3af', marginTop: '4px' }}>{user.email}</p>
      </div>

      {/* Responsive 2-col grid — stacks on mobile */}
      <div className="pro-dashboard-grid">
        {/* ── LEFT COLUMN ─────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Subscription card */}
          <div style={{ background: '#fff', borderRadius: '16px', padding: '28px', border: '1.5px solid #e5e7eb', boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '22px' }}>
              <div style={{ width: '46px', height: '46px', borderRadius: '12px', background: 'linear-gradient(135deg,#f59e0b,#ef4444)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', flexShrink: 0 }}>⚡</div>
              <div>
                <p style={{ margin: 0, fontSize: '17px', fontWeight: '700', color: '#111827' }}>Pro Monthly</p>
                <span style={{ display: 'inline-block', background: '#d1fae5', color: '#065f46', fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '999px', marginTop: '3px' }}>Active</span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '11px', paddingBottom: '22px', borderBottom: '1px solid #f3f4f6', marginBottom: '22px' }}>
              <BillingRow label="Price" value={`${proPrice}/month`} />
              {proSince && <BillingRow label="Member since" value={proSince} />}
              <BillingRow label="Compressions" value="Unlimited" valueColor="#059669" />
              <BillingRow label="Status" value="Active" valueColor="#059669" />
            </div>

            <button
              onClick={handleCancel}
              disabled={cancelLoading}
              style={{ width: '100%', padding: '10px', borderRadius: '10px', border: 'none', background: '#fee2e2', color: '#b91c1c', fontSize: '13px', fontWeight: '600', cursor: cancelLoading ? 'not-allowed' : 'pointer', opacity: cancelLoading ? 0.6 : 1 }}
            >
              {cancelLoading ? 'Cancelling…' : 'Cancel Subscription'}
            </button>
          </div>

          {/* CTA buttons */}
          <button
            onClick={onNavigateHome}
            style={{ width: '100%', padding: '14px', borderRadius: '12px', border: 'none', background: '#2563eb', color: '#fff', fontSize: '15px', fontWeight: '700', cursor: 'pointer' }}
          >
            Compress Now →
          </button>
          <button
            onClick={handleInvite}
            style={{ width: '100%', padding: '13px', borderRadius: '12px', border: '1.5px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: '14px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
          >
            <WaIcon />
            Invite Friends
          </button>
        </div>

        {/* ── RIGHT COLUMN ────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {loading ? (
            <div style={{ background: '#fff', borderRadius: '16px', padding: '48px', border: '1.5px solid #e5e7eb', textAlign: 'center', color: '#9ca3af', fontSize: '14px' }}>
              Loading your stats…
            </div>
          ) : (
            <>
              {/* Stats cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px' }}>
                <StatCard emoji="🎬" label="Videos Compressed" value={totalCompressed.toLocaleString()} />
                <StatCard emoji="💾" label="Total GB Saved" value={`${totalGBSaved} GB`} />
                {avgRatio !== null && (
                  <StatCard emoji="📉" label="Avg Reduction" value={`${avgRatio}%`} />
                )}
              </div>

              {/* Recent activity feed */}
              <div style={{ background: '#fff', borderRadius: '16px', border: '1.5px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
                <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid #f3f4f6' }}>
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '700', color: '#111827' }}>Recent Compressions</h3>
                </div>
                {history.length === 0 ? (
                  <div style={{ padding: '36px 24px', textAlign: 'center', color: '#9ca3af', fontSize: '14px' }}>
                    No compressions yet —{' '}
                    <button onClick={onNavigateHome} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '14px', fontWeight: '600', padding: 0 }}>
                      compress your first video
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
                      return (
                        <div
                          key={item.id ?? i}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 24px', borderBottom: i < history.length - 1 ? '1px solid #f9fafb' : 'none' }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                            <div style={{ width: '34px', height: '34px', borderRadius: '8px', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="#2563eb">
                                <path d="m15 10 4.553-2.276A1 1 0 0 1 21 8.723v6.554a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                              </svg>
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <p style={{ margin: 0, fontSize: '13px', fontWeight: '600', color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '260px' }}>{name}</p>
                              <p style={{ margin: 0, fontSize: '11px', color: '#9ca3af', marginTop: '1px' }}>{date}</p>
                            </div>
                          </div>
                          {shrinkPct !== null && shrinkPct > 0 ? (
                            <span style={{ flexShrink: 0, fontSize: '12px', fontWeight: '700', color: '#059669', background: '#ecfdf5', padding: '3px 8px', borderRadius: '999px' }}>-{shrinkPct}%</span>
                          ) : (
                            <span style={{ flexShrink: 0, fontSize: '12px', color: '#9ca3af' }}>—</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
