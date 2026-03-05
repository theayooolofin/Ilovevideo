import posthog from 'posthog-js'
posthog.init(import.meta.env.VITE_POSTHOG_KEY, { api_host: 'https://app.posthog.com' })

import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Catch any React crash and show a reload button instead of blank screen
class ErrorBoundary extends Component {
  state = { hasError: false, error: null }
  static getDerivedStateFromError(error) { return { hasError: true, error } }
  componentDidCatch(error, info) { console.error('App crash:', error, info) }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'#f8faff', padding:'24px', textAlign:'center', fontFamily:'sans-serif' }}>
          <p style={{ fontSize:'18px', color:'#0f172a', marginBottom:'8px' }}>Something went wrong. Please reload the page.</p>
          <pre style={{ fontSize:'12px', color:'#64748b', marginBottom:'20px', maxWidth:'600px', whiteSpace:'pre-wrap', wordBreak:'break-all' }}>{this.state.error?.message}</pre>
          <button onClick={() => window.location.reload()} style={{ background:'#2563eb', color:'#fff', border:'none', borderRadius:'8px', padding:'13px 28px', fontSize:'16px', fontWeight:'700', cursor:'pointer' }}>
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      const attachHandlers = (newSW) => {
        const hadActiveSW = !!reg.active
        newSW.addEventListener('statechange', () => {
          // Only skip waiting after page has fully loaded (safe moment)
          if (newSW.state === 'installed') {
            newSW.postMessage({ type: 'SKIP_WAITING' })
          }
          // Reload only on updates, not on first install
          if (newSW.state === 'activated' && hadActiveSW) {
            window.location.reload()
          }
        })
      }
      // Handle SW already waiting (e.g. user had multiple tabs open)
      if (reg.waiting) attachHandlers(reg.waiting)
      reg.addEventListener('updatefound', () => attachHandlers(reg.installing))
    })
  })
}
