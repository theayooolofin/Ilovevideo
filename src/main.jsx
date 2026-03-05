import posthog from 'posthog-js'
posthog.init(import.meta.env.VITE_POSTHOG_KEY, { api_host: 'https://app.posthog.com' })

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        // hadActiveSW: true = this is an UPDATE to an existing SW
        // false = first install (no reload needed, page is already loading fresh)
        const hadActiveSW = !!reg.active;
        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'activated' && hadActiveSW) {
            window.location.reload();
          }
        });
      });
    });
  });
}
