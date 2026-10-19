import process from 'node:process'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolveApiBase, resolveContentSource } from './config/api-config.js'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBase = resolveApiBase(
    process.env.VITE_API_BASE_URL || env.VITE_API_BASE_URL,
    process.env.VERCEL === '1'
  )
  const content = resolveContentSource(
    process.env.VITE_CONTENT_PROVIDER || env.VITE_CONTENT_PROVIDER,
    process.env.VITE_CONTENT_API_BASE_URL || env.VITE_CONTENT_API_BASE_URL,
    process.env.VERCEL === '1'
  )

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(apiBase),
      'import.meta.env.VITE_CONTENT_PROVIDER': JSON.stringify(content.provider),
      'import.meta.env.VITE_CONTENT_API_BASE_URL': JSON.stringify(content.base),
    },
    build: {
      // El paquete principal superaba 500 kB: React y el router van a un chunk propio (se cachea aparte y no cambia con cada despliegue de la app).
      rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'vendor-react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|@remix-run)[\\/]/ }] } } },
    },
    server: {
      allowedHosts: [
        'lingo-scrubbed-alienable.ngrok-free.dev',
      ],
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3000',
          changeOrigin: true,
        },
      },
    },
  }
})