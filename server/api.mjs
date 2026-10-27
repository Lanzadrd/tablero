// API local de Tablero: el tablero (almacen.mjs), sus eventos en vivo y las acciones de
// la app, del ayudante de Recordatorios y del MCP de Claude Code.
// La usan tanto el servidor de producción (server/index.mjs) como Vite en desarrollo.
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { activate, addAdSet, launch, readAds, saveTemplates, setStatus, uploadFile } from './anuncios.mjs'
import { claudeStatus, saveClaudeKey, writeCopy } from './textos.mjs'
import { capture, interpret } from './captura.mjs'
import { DATA_DIR, exclusive, HttpError, localDay, localTime, readArchive, readStore, writeArchive, writeStore } from './almacen.mjs'
import { createMeta } from './meta.mjs'
import { applyOperations } from './operaciones.mjs'
import { claudeUrl, openOnMac, projectFolder, taskPrompt } from './proyectos.mjs'
import { applyReminders } from './suscripciones.mjs'
import { pageTitle, TitleError } from './titulo.mjs'

export { DATA_DIR }

const MAX_BODY = 10 * 1024 * 1024
/** Lo que admite Meta: imágenes de hasta 30 MB y vídeos de hasta 1 GB (subida simple). */
const MAX_UPLOAD = { image: 30 * 1024 * 1024, video: 1024 * 1024 * 1024 }
/** Única ruta que acepta algo que no es JSON: la subida de imágenes y vídeos, con su cabecera propia. */
const UPLOAD_PATH = '/api/meta/medios'
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])
const TITLE_STATUS = {
  'url-no-valida': 400,
  'direccion-no-permitida': 403,
  'demasiadas-redirecciones': 502,
  'no-se-pudo-leer': 502,
  'tiempo-agotado': 504,
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Demasiado grande'))
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new HttpError(400, 'JSON no válido'))
      }
    })
    req.on('error', reject)
  })
}

// ── Eventos en vivo (Server-Sent Events) para las ventanas abiertas y el ayudante de avisos ──

const clients = new Set()
let avisos = null

function broadcast(event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of clients) client.res.write(message)
}

const avisosState = () => ({
  ...(avisos ?? {}),
  conectado: [...clients].some((c) => c.kind === 'avisos'),
})

async function openEvents(req, res, kind, version) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })
  const { rev } = await readStore().catch(() => ({ rev: 0 }))
  res.write(`retry: 2000\nevent: hola\ndata: ${JSON.stringify({ rev, version })}\n\n`)
  const client = { res, kind }
  clients.add(client)
  if (kind === 'avisos') broadcast('avisos', avisosState())
  // Mantiene viva la conexión (y avisa pronto si se corta).
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000)
  req.on('close', () => {
    clearInterval(ping)
    clients.delete(client)
    if (kind === 'avisos') broadcast('avisos', avisosState())
  })
}

/** Cambia el tablero guardado con `change(board)`; si devuelve algo, se guarda con rev+1. */
function updateBoard(change) {
  return exclusive(async () => {
    const current = await readStore()
    if (!Array.isArray(current.board?.columns)) throw new HttpError(409, 'Aún no hay tablero')
    const result = await change(current.board)
    if (!result) return { rev: current.rev }
    const rev = current.rev + 1
    await writeStore(rev, current.board)
    broadcast('rev', { rev })
    return { rev, ...result }
  })
}

/** Aplica operaciones (ver operaciones.mjs) sobre la versión guardada. */
async function operate(ops) {
  let applied = 0
  const { rev } = await updateBoard((board) => {
    applied = applyOperations(board, ops)
    return applied > 0 && {}
  })
  return { rev, aplicadas: applied }
}

/** Cambia campos sueltos de una tarea (como el ayudante con /api/operaciones). */
async function patchTask(taskId, body) {
  if (typeof body?.done !== 'boolean') throw new HttpError(400, 'Nada que cambiar')
  const { board } = await readStore()
  if (!board?.columns?.some((c) => c.tasks?.some((t) => t.id === taskId))) throw new HttpError(404, 'Esa tarea ya no existe')
  const { rev } = await operate([{ op: 'actualizarTarea', id: taskId, cambios: { done: body.done, completedAt: body.completedAt } }])
  return { rev }
}

/**
 * Avisos de las suscripciones (suscripciones.mjs): crea la tarea de los cobros que se acercan en la columna
 * de cada suscripción (o en la Bandeja si no tiene o está archivada), sobre la versión guardada. Solo guarda
 * (rev+1 y aviso a las ventanas) si ha creado alguna.
 * Sin tablero todavía, no hace nada. Lo llama server/index.mjs al arrancar y cada 15 minutos.
 */
export async function subscriptionReminders({ today = localDay(), newId = randomUUID } = {}) {
  try {
    const result = await updateBoard((board) => {
      const created = applyReminders(board, today, { newId })
      return created > 0 && { creadas: created }
    })
    return { creadas: 0, ...result }
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) return { rev: 0, creadas: 0 }
    throw err
  }
}

/**
 * Una ventana con la web de antes (abierta desde antes de actualizar, sin recargar) no conoce las
 * tarjetas ni las suscripciones: guarda el tablero sin ellas. Si no las manda, se quedan las guardadas.
 * La web de ahora siempre las manda (aunque estén vacías).
 */
function keepNewLists(board, current) {
  const kept = { ...board }
  for (const key of ['cards', 'subscriptions']) {
    if (!Object.hasOwn(kept, key) && current && Object.hasOwn(current, key)) kept[key] = current[key]
  }
  return kept
}

/** Mueve las completadas de una columna a archivo.json. */
async function archiveCompleted(columnId) {
  const result = await updateBoard(async (board) => {
    const column = findColumn(board, columnId)
    const done = (column.tasks ?? []).filter((t) => t.done)
    if (!done.length) return null
    const archivedAt = new Date().toISOString()
    const ids = new Set(done.map((t) => t.id))
    // Primero el archivo: si luego fallara el tablero, sobra una copia, pero no se pierde nada.
    const archive = (await readArchive()).filter((entry) => !ids.has(entry.id))
    archive.push(...done.map((t) => ({ ...t, columnId: column.id, columnName: column.name, archivedAt })))
    await writeArchive(archive)
    column.tasks = column.tasks.filter((t) => !t.done)
    return { archivadas: done.length }
  })
  return { archivadas: 0, ...result }
}

function findColumn(board, columnId) {
  if (typeof columnId !== 'string') throw new HttpError(400, 'Falta columnId')
  const column = board?.columns?.find((c) => c.id === columnId)
  if (!column) throw new HttpError(404, 'Esa columna no existe', 'columna-no-existe')
  return column
}

function findTaskWithColumn(board, taskId) {
  for (const column of board?.columns ?? []) {
    const task = column.tasks?.find((t) => t.id === taskId)
    if (task) return { column, task }
  }
  throw new HttpError(404, 'Esa tarea no existe', 'tarea-no-existe')
}

/** Anuncios en Meta (meta.mjs, anuncios.mjs). */
async function metaRoute(req, res, url, meta, options) {
  const { pathname } = url
  switch (pathname) {
    case '/api/meta/estado':
      only(req, 'GET')
      return send(res, 200, await meta.status())
    case '/api/meta/app':
      only(req, 'PUT')
      return send(res, 200, await meta.saveApp(await readJson(req)))
    case '/api/meta/conectar': {
      only(req, 'GET')
      res.writeHead(302, { location: await meta.connectUrl(req.headers.host), 'cache-control': 'no-store' })
      return res.end()
    }
    case '/api/meta/token': {
      only(req, 'POST')
      const token = (await readJson(req))?.token
      if (typeof token !== 'string' || token.trim().length < 20) throw new HttpError(400, 'Ese token no parece válido')
      return send(res, 200, await meta.saveToken(token.trim()))
    }
    case '/api/meta/desconectar':
      only(req, 'POST')
      return send(res, 200, await meta.disconnect())
    case '/api/meta/cuentas':
      only(req, 'GET')
      return send(res, 200, { portfolios: await meta.portfolios(url.searchParams.has('actualizar')) })
    case '/api/meta/paginas':
      only(req, 'GET')
      return send(res, 200, { paginas: await meta.pages(url.searchParams.get('cuenta'), url.searchParams.has('actualizar')) })
    case '/api/meta/lugares':
      only(req, 'GET')
      return send(res, 200, { lugares: await meta.places(url.searchParams.get('q')) })
    case UPLOAD_PATH:
      only(req, 'POST')
      return send(res, 200, { medio: await uploadToMeta(req, url, meta) })
    case '/api/meta/campanas': {
      only(req, 'GET')
      const query = url.searchParams
      return send(
        res,
        200,
        await meta.performance(query.get('cuenta'), {
          period: query.get('periodo') ?? '7d',
          campaign: query.get('campana'),
          adSet: query.get('conjunto'),
          fresh: query.has('actualizar'),
        }),
      )
    }
    case '/api/meta/campanas/estado': {
      only(req, 'POST')
      const body = await readJson(req)
      const result = await setStatus(meta, body)
      meta.forget(result.lanzamiento?.cuenta ?? body?.cuenta)
      return send(res, 200, result)
    }
    case '/api/meta/lanzar': {
      only(req, 'POST')
      const lanzamiento = await launch(meta, await readJson(req), options)
      meta.forget(lanzamiento.cuenta)
      return send(res, 200, { lanzamiento })
    }
    case '/api/meta/conjuntos': {
      only(req, 'POST')
      const body = await readJson(req)
      const conjunto = await addAdSet(meta, body, options)
      meta.forget(body.cuenta)
      return send(res, 200, { conjunto })
    }
    case '/api/meta/activar': {
      only(req, 'POST')
      const id = (await readJson(req))?.id
      if (typeof id !== 'string') throw new HttpError(400, 'Falta id')
      const lanzamiento = await activate(meta, id)
      meta.forget(lanzamiento.cuenta)
      return send(res, 200, { lanzamiento })
    }
    case '/api/anuncios':
      only(req, 'GET')
      return send(res, 200, await readAds())
    case '/api/anuncios/plantillas':
      only(req, 'PUT')
      return send(res, 200, { plantillas: await saveTemplates((await readJson(req))?.plantillas) })
    // Los textos del anuncio, escritos por Claude; y su clave (que nunca vuelve a la web).
    case '/api/anuncios/textos':
      only(req, 'POST')
      return send(res, 200, { textos: await writeCopy(await readJson(req), options) })
    case '/api/anuncios/claude':
      if (req.method === 'GET') return send(res, 200, await claudeStatus())
      only(req, 'PUT')
      return send(res, 200, await saveClaudeKey((await readJson(req))?.clave))
    default:
      throw new HttpError(404, 'No encontrado')
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

const only = (req, method) => {
  if (req.method !== method) throw new HttpError(405, 'Método no permitido')
}

/** Evita que otra web abierta en el navegador hable con la API (DNS rebinding). */
const isLocalHost = (req) => LOCAL_HOSTS.has((req.headers.host ?? '').replace(/:\d+$/, ''))

/**
 * Solo la propia app (o programas locales: el ayudante, el MCP) pueden usar la API.
 * Un navegador marca de dónde viene cada petición (Sec-Fetch-Site, Origin): se rechaza
 * cualquier otra web. Y los cambios deben ir en JSON, que otra web no puede mandar sin
 * permiso explícito (preflight) que aquí nunca se concede.
 */
function checkCaller(req) {
  if (!isLocalHost(req)) throw new HttpError(403, 'Solo accesible desde este ordenador')
  const site = req.headers['sec-fetch-site']
  if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'Solo desde Tablero')
  const origin = req.headers.origin
  if (origin !== undefined) {
    let host = null
    try {
      host = new URL(origin).host
    } catch {}
    if (host !== req.headers.host) throw new HttpError(403, 'Solo desde Tablero')
  }
  // Una subida va tal cual, con la cabecera x-tablero-subida: otra web tampoco puede mandarla sin el permiso
  // previo (preflight) que aquí nunca se concede.
  const upload = new URL(req.url ?? '/', 'http://localhost').pathname === UPLOAD_PATH && req.headers['x-tablero-subida'] === '1'
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !upload && !/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
    throw new HttpError(415, 'Se espera JSON')
  }
}

/** Guarda el cuerpo de una subida en un archivo temporal (sin pasar de `max`). */
async function receiveFile(req, max) {
  const declared = Number(req.headers['content-length'])
  if (declared > max) throw new HttpError(413, 'Demasiado grande')
  const dir = path.join(os.tmpdir(), 'tablero-subidas')
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, randomUUID())
  let size = 0
  try {
    await pipeline(
      req,
      async function* (source) {
        for await (const chunk of source) {
          size += chunk.length
          if (size > max) throw new HttpError(413, 'Demasiado grande')
          yield chunk
        }
      },
      createWriteStream(file),
    )
  } catch (err) {
    await rm(file, { force: true })
    throw err
  }
  return file
}

/** Sube a Meta lo que llega (una imagen o un vídeo) y devuelve su referencia para el anuncio. */
async function uploadToMeta(req, url, meta) {
  const account = url.searchParams.get('cuenta') ?? ''
  if (!/^act_\d+$/.test(account)) throw new HttpError(400, 'Cuenta publicitaria no válida')
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  const kind = type.startsWith('image/') ? 'image' : type.startsWith('video/') ? 'video' : null
  if (!kind) throw new HttpError(415, 'Solo imágenes o vídeos')
  const name = (url.searchParams.get('nombre') ?? '').replace(/[\\/\0]/g, '').slice(0, 200) || (kind === 'image' ? 'imagen' : 'video')
  let file
  try {
    file = await receiveFile(req, MAX_UPLOAD[kind])
  } catch (err) {
    if (err instanceof HttpError && err.status === 413) {
      throw new HttpError(413, kind === 'image' ? 'Las imágenes, de hasta 30 MB.' : 'Los vídeos, de hasta 1 GB.')
    }
    throw err
  }
  try {
    return await uploadFile(meta, account, { file, type, name })
  } finally {
    await rm(file, { force: true })
  }
}

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/**
 * La página a la que vuelve el diálogo de Meta (en la ventana que se abrió para conectar): dice cómo ha ido y
 * se cierra; si se conectó en la ventana de Tablero, vuelve a Anuncios.
 */
function connectPage(res, port, { ok, message }) {
  const back = `http://127.0.0.1${port ? `:${port}` : ''}/?vista=anuncios`
  res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>Tablero · Meta</title>
<style>body{margin:0;display:grid;place-items:center;min-height:100vh;font:15px/1.45 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:#f5f5f7;color:#1d1d1f}
@media (prefers-color-scheme:dark){body{background:#111113;color:#f5f5f7}}main{max-width:360px;padding:24px;text-align:center}
h1{font-size:19px;margin:0 0 6px}p{margin:0 0 16px;color:#6e6e73}a{color:#0066cc}</style></head>
<body><main><h1>${ok ? 'Tablero ya está conectado con Meta' : 'No se ha podido conectar'}</h1><p>${escapeHtml(message)}</p>
<a href="${back}">Volver a Tablero</a></main>
<script>${ok ? `if (window.opener) setTimeout(() => window.close(), 900); else location.replace(${JSON.stringify(back)})` : ''}</script>
</body></html>`)
}

/**
 * `version` identifica la compilación de la web: si cambia, las ventanas abiertas proponen recargar.
 * `abrir(destino)` abre una carpeta o un enlace (por defecto, «open» de macOS; en pruebas, otra cosa).
 * `titulo` son opciones para pageTitle (solo en pruebas).
 * `guardado()` se llama cada vez que una ventana guarda el tablero (p. ej. para crear ya el aviso de
 * una suscripción recién configurada).
 */
export function createApi({
  version = 'dev',
  appVersion = 'dev',
  abrir = openOnMac,
  titulo = {},
  guardado = () => {},
  meta = createMeta(),
  anuncios = {},
} = {}) {
  return async function tableroApi(req, res, next) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const { pathname } = url
    if (!pathname.startsWith('/api/')) return next()
    const port = /:(\d+)$/.exec(req.headers.host ?? '')?.[1] ?? null
    try {
      // La vuelta del diálogo de Meta llega desde facebook.com (otra web): solo vale con el «state» que generó
      // Tablero al empezar (meta.mjs), de un solo uso.
      if (pathname === '/api/meta/volver') {
        if (!isLocalHost(req)) throw new HttpError(403, 'Solo accesible desde este ordenador')
        only(req, 'GET')
        try {
          const status = await meta.finishConnect(Object.fromEntries(url.searchParams))
          return connectPage(res, port, { ok: true, message: `Como ${status.usuario?.nombre ?? 'tu cuenta'}. Puedes cerrar esta ventana.` })
        } catch (err) {
          return connectPage(res, port, { ok: false, message: err?.message ?? String(err) })
        }
      }
      checkCaller(req)
      if (pathname === '/api/health') return send(res, 200, { app: 'tablero', ok: true, version, appVersion })
      if (pathname === '/api/eventos') return await openEvents(req, res, url.searchParams.get('cliente'), version)

      if (pathname === '/api/avisos') {
        if (req.method === 'GET') return send(res, 200, avisosState())
        only(req, 'PUT')
        avisos = { ...(await readJson(req)), vistoEn: new Date().toISOString() }
        broadcast('avisos', avisosState())
        return send(res, 200, { ok: true })
      }

      if (pathname === '/api/operaciones') {
        only(req, 'POST')
        const ops = (await readJson(req))?.ops
        if (!Array.isArray(ops) || ops.length > 5000) throw new HttpError(400, 'Operaciones no válidas')
        return send(res, 200, await operate(ops))
      }

      const taskMatch = pathname.match(/^\/api\/tareas\/([\w-]+)$/)
      if (taskMatch) {
        only(req, 'PATCH')
        return send(res, 200, await patchTask(taskMatch[1], await readJson(req)))
      }

      if (pathname === '/api/titulo') {
        only(req, 'GET')
        try {
          return send(res, 200, { title: await pageTitle(url.searchParams.get('url'), titulo) })
        } catch (err) {
          if (err instanceof TitleError) throw new HttpError(TITLE_STATUS[err.code] ?? 502, err.message, err.code)
          throw err
        }
      }

      if (pathname === '/api/archivar') {
        only(req, 'POST')
        return send(res, 200, await archiveCompleted((await readJson(req))?.columnId))
      }

      if (pathname === '/api/archivo') {
        only(req, 'GET')
        const columnId = url.searchParams.get('columna')
        const tareas = (await readArchive())
          .filter((entry) => !columnId || entry.columnId === columnId)
          .sort((a, b) => String(b.archivedAt ?? '').localeCompare(String(a.archivedAt ?? '')))
        return send(res, 200, { tareas })
      }

      if (pathname === '/api/abrir') {
        only(req, 'POST')
        const columnId = (await readJson(req))?.columnId
        const folder = await projectFolder(findColumn((await readStore()).board, columnId))
        return send(res, 200, { ok: true, ...(await abrir(folder)) })
      }

      if (pathname === '/api/claude') {
        only(req, 'POST')
        const body = await readJson(req)
        const { board } = await readStore()
        let target
        if (typeof body?.taskId === 'string') target = findTaskWithColumn(board, body.taskId)
        else if (typeof body?.columnId === 'string') target = { column: findColumn(board, body.columnId), task: null }
        else throw new HttpError(400, 'Falta taskId o columnId')
        const folder = await projectFolder(target.column)
        const link = claudeUrl(folder, target.task ? taskPrompt(target.task, target.column) : '')
        return send(res, 200, { ok: true, ...(await abrir(link)) })
      }

      if (pathname === '/api/capturar') {
        only(req, 'POST')
        const body = await readJson(req)
        if (body?.vistaPrevia === true) {
          const { parsed, columnName, resumen } = interpret((await readStore()).board, body, { today: localDay(), time: localTime() })
          return send(res, 200, { titulo: parsed.title, resumen, columna: columnName })
        }
        return send(res, 200, await updateBoard((board) => capture(board, body, { today: localDay(), time: localTime() })))
      }

      if (pathname.startsWith('/api/meta/') || pathname === '/api/anuncios' || pathname.startsWith('/api/anuncios/')) {
        return await metaRoute(req, res, url, meta, anuncios)
      }

      if (pathname !== '/api/board') throw new HttpError(404, 'No encontrado')

      if (req.method === 'GET') return send(res, 200, await readStore())
      only(req, 'PUT')

      const body = await readJson(req)
      if (!Number.isInteger(body?.baseRev) || !Array.isArray(body?.board?.columns)) {
        throw new HttpError(400, 'Tablero no válido')
      }
      await exclusive(async () => {
        const current = await readStore()
        // Otra ventana guardó antes: se devuelve lo que hay para que el cliente lo cargue.
        if (body.baseRev !== current.rev) return send(res, 409, current)
        const rev = current.rev + 1
        await writeStore(rev, keepNewLists(body.board, current.board))
        send(res, 200, { rev })
        broadcast('rev', { rev })
        guardado()
      })
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500
      if (status >= 500) console.error('[tablero]', err)
      const message = err?.message ?? String(err)
      send(res, status, err?.code && err instanceof HttpError ? { error: err.code, mensaje: message } : { error: message })
    }
  }
}
