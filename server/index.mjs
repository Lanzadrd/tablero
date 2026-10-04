// Servidor local de Tablero: sirve la app compilada (dist/) y la API.
// Solo escucha en 127.0.0.1, así que no es accesible desde la red.
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startUpdates, installedVersion } from './actualizador.mjs'
import { createApi, DATA_DIR } from './api.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const HOST = '127.0.0.1'
const PORT = Number(process.env.PORT ?? 4747)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

async function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end()

  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
  } catch {
    return res.writeHead(400).end()
  }
  let file = path.join(DIST, pathname)
  if (file !== DIST && !file.startsWith(DIST + path.sep)) return res.writeHead(403).end()

  let info = await stat(file).catch(() => null)
  if (!info?.isFile()) {
    file = path.join(DIST, 'index.html')
    info = await stat(file).catch(() => null)
  }
  if (!info) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
    return res.end('Falta compilar la app: ejecuta «npm run build».')
  }

  const hashed = file.startsWith(path.join(DIST, 'assets') + path.sep)
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    'content-length': info.size,
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  if (req.method === 'HEAD') return res.end()
  createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res)
}

// La web compilada cambia de nombre de archivos en cada versión: su index.html sirve de huella.
let version = 'sin-compilar'
try {
  version = createHash('sha1').update(readFileSync(path.join(DIST, 'index.html'))).digest('hex').slice(0, 10)
} catch {}

const api = createApi({ version, appVersion: (await installedVersion(ROOT)) ?? 'dev' })
const server = http.createServer((req, res) => {
  api(req, res, () =>
    serveStatic(req, res).catch((err) => {
      console.error('[tablero]', err)
      if (!res.headersSent) res.writeHead(500)
      res.end()
    }),
  )
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`El puerto ${PORT} ya está en uso (¿Tablero ya está en marcha?).`)
    process.exit(1)
  }
  throw err
})

server.listen(PORT, HOST, () => {
  console.log(`Tablero en http://${HOST}:${PORT}  ·  datos en ${DATA_DIR}`)
  // Solo en una instalación (hay version.json): en desarrollo no se actualiza solo.
  if (existsSync(path.join(ROOT, 'version.json'))) {
    startUpdates({ root: ROOT, dataDir: DATA_DIR, log: (msg) => console.log(`${new Date().toISOString()}  ${msg}`) })
  }
})
