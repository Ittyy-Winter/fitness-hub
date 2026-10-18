import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the hub API runs in compose; the proxy addresses it as localhost so its
// Cloudflare Access check treats the request as local.
const hub = process.env.HUB_URL ?? 'http://localhost:8081'
const proxy = { target: hub, headers: { host: 'localhost:8081' } }

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173, proxy: { '/api': proxy, '/photos': proxy } },
  build: { target: 'es2023', chunkSizeWarningLimit: 700 },
})
