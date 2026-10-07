// API local de Tablero: el tablero (almacen.mjs), sus eventos en vivo y las acciones de
// la app, del ayudante de Recordatorios y del MCP de Claude Code.
// La usan tanto el servidor de producción (server/index.mjs) como Vite en desarrollo.
import { randomUUID } from 'node:crypto'
import { capture, interpret } from './captura.mjs'
import { DATA_DIR, exclusive, HttpError, localDay, localTime, readArchive, readStore, writeArchive, writeStore } from './almacen.mjs'
import { applyOperations } from './operaciones.mjs'
import { claudeUrl, openOnMac, projectFolder, taskPrompt } from './proyectos.mjs'
import { applyReminders } from './suscripciones.mjs'
import { pageTitle, TitleError } from './titulo.mjs'

export { DATA_DIR }

const MAX_BODY = 10 * 1024 * 1024
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
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
    throw new HttpError(415, 'Se espera JSON')
  }
}

/**
 * `version` identifica la compilación de la web: si cambia, las ventanas abiertas proponen recargar.
 * `abrir(destino)` abre una carpeta o un enlace (por defecto, «open» de macOS; en pruebas, otra cosa).
 * `titulo` son opciones para pageTitle (solo en pruebas).
 * `guardado()` se llama cada vez que una ventana guarda el tablero (p. ej. para crear ya el aviso de
 * una suscripción recién configurada).
 */
export function createApi({ version = 'dev', appVersion = 'dev', abrir = openOnMac, titulo = {}, guardado = () => {} } = {}) {
  return async function tableroApi(req, res, next) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const { pathname } = url
    if (!pathname.startsWith('/api/')) return next()
    try {
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
