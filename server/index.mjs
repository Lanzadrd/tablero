// Servidor local de Tablero: sirve la app compilada (dist/) y la API.
// Solo escucha en 127.0.0.1, así que no es accesible desde la red.
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startUpdates, installedVersion } from './actualizador.mjs'
import { createApi, DATA_DIR, subscriptionReminders } from './api.mjs'
import { createGoogle } from './google.mjs'
import { createMeta } from './meta.mjs'
import { createSummaries } from './resumenes.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const HOST = '127.0.0.1'
const PORT = Number(process.env.PORT ?? 4747)
// Avisos de las suscripciones: a los pocos segundos de arrancar, luego cada cuarto de hora y tras cada guardado.
const REMINDERS_FIRST = 5_000
const REMINDERS_EVERY = 15 * 60_000
const REMINDERS_AFTER_SAVE = 3_000
// Resúmenes por WhatsApp: se mira cada 5 minutos si toca mandar alguno (al minuto de arrancar, la primera vez).
const SUMMARIES_FIRST = 60_000
const SUMMARIES_EVERY = 5 * 60_000

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

// Avisos de las suscripciones: al arrancar, cada 15 minutos y poco después de que una ventana guarde
// (así el aviso de una suscripción recién configurada sale ya). TABLERO_SIN_AVISOS_SUSCRIPCIONES=1
// los desactiva (p. ej. para probar con datos de otro).
const remindersOn = !process.env.TABLERO_SIN_AVISOS_SUSCRIPCIONES
const remind = () =>
  subscriptionReminders()
    .then(({ creadas }) => creadas && console.log(`${new Date().toISOString()}  Avisos de suscripciones: ${creadas}`))
    .catch((err) => console.error('[tablero] avisos de suscripciones:', err))
let remindTimer = null
const remindSoon = () => {
  if (!remindersOn) return
  clearTimeout(remindTimer)
  remindTimer = setTimeout(remind, REMINDERS_AFTER_SAVE)
  remindTimer.unref()
}

// Resúmenes diarios por WhatsApp (resumenes.mjs), cada uno a su hora. TABLERO_SIN_RESUMENES=1 los desactiva.
const meta = createMeta()
const google = createGoogle()
const resumenes = createSummaries({ meta, google })
const summariesOn = !process.env.TABLERO_SIN_RESUMENES
let summariesRunning = false
const sendSummaries = async () => {
  if (summariesRunning) return
  summariesRunning = true
  try {
    for (const r of await resumenes.runDue()) {
      console.log(`${new Date().toISOString()}  Resumen «${r.nombre}»: ${r.ok ? `enviado a ${r.enviados.length}` : `no enviado (${r.error})`}`)
    }
  } catch (err) {
    console.error('[tablero] resúmenes por WhatsApp:', err)
  } finally {
    summariesRunning = false
  }
}

const api = createApi({ version, appVersion: (await installedVersion(ROOT)) ?? 'dev', guardado: remindSoon, meta, google, resumenes })
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
  if (remindersOn) {
    setTimeout(remind, REMINDERS_FIRST).unref()
    setInterval(remind, REMINDERS_EVERY).unref()
  }
  if (summariesOn) {
    setTimeout(sendSummaries, SUMMARIES_FIRST).unref()
    setInterval(sendSummaries, SUMMARIES_EVERY).unref()
  }
})
