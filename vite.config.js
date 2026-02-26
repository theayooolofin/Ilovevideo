import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const coopCoepHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { headers: coopCoepHeaders },
  preview: { headers: coopCoepHeaders },
})
