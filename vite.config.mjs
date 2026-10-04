import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { createApi } from './server/api.mjs'

/** Monta la API local (/api/*) dentro del servidor de desarrollo de Vite. */
function tableroApi() {
  return {
    name: 'tablero-api',
    configureServer(server) {
      server.middlewares.use(createApi())
    },
    configurePreviewServer(server) {
      server.middlewares.use(createApi())
    },
  }
}

export default defineConfig({
  plugins: [react(), tableroApi()],
  server: { host: '127.0.0.1', port: 5173 },
})
