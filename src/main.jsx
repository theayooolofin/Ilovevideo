import posthog from 'posthog-js'
posthog.init('phc_3QEpSIC6Xfx6NPX2JlKJhqRGFjP0yRK0VM9VnMSvY7q', { api_host: 'https://app.posthog.com' })

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
    navigator.serviceWorker.register('/sw.js');
  });
}
