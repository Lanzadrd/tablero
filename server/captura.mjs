// Captura rápida: una tarea escrita en lenguaje natural (desde el navegador, el MCP de
// Claude Code…) entra en la columna de su #etiqueta o, si no lleva, en la Bandeja.
import { randomUUID } from 'node:crypto'
import { HttpError } from './almacen.mjs'
import { describe, fold, parseTask } from './lenguaje.mjs'
import { insertOpen } from './operaciones.mjs'

const str = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
// Ocupa el sitio del título para entender textos que son solo indicaciones.
const PLACEHOLDER = '⁣'

/** Lo que se entiende de lo escrito, sin tocar el tablero. `time`: la hora local de ahora ('HH:MM'). */
export function interpret(board, body, { today, time = null }) {
  const columns = (board?.columns ?? []).filter((c) => !c.archived)
  const ctx = { today, time, columns }
  const texto = str(body?.texto, 2000)
  const pageTitle = str(body?.tituloPagina, 1000)
  const url = str(body?.url, 2000)

  let parsed = parseTask(texto, ctx)
  // «#trabajo mañana» al guardar una página: todo son indicaciones; el título, el de la página.
  if (texto && pageTitle && !parsed.matches.length) {
    const alone = parseTask(`${PLACEHOLDER} ${texto}`, ctx)
    if (alone.title === PLACEHOLDER) parsed = { ...alone, title: pageTitle }
  }
  const title = (texto ? parsed.title : pageTitle || url).slice(0, 1000)
  if (!title) throw new HttpError(400, 'Falta el texto de la tarea') // Sin código: la captura muestra `error` tal cual.

  const tagged = columns.find((c) => c.id === parsed.columnId)
  const inbox = columns.find((c) => c.inbox) ?? board?.columns?.find((c) => c.inbox)
  return {
    parsed: { ...parsed, title },
    column: tagged ?? null,
    columnName: tagged?.name ?? inbox?.name ?? 'Bandeja',
    resumen: describe(parsed, ctx),
    url,
  }
}

const isInboxName = (name) => typeof name === 'string' && fold(name).trim() === 'bandeja'

/**
 * La Bandeja: la columna con inbox:true; si no hay, la que ya se llame «Bandeja» (como en
 * src/projects.ts, para no tener dos); si tampoco, se crea, la primera.
 */
function inboxColumn(board) {
  const inbox =
    board.columns.find((c) => c.inbox && !c.archived) ??
    board.columns.find((c) => c.inbox) ??
    board.columns.find((c) => !c.archived && isInboxName(c.name))
  if (inbox) {
    inbox.inbox = true
    delete inbox.archived // Lo capturado tiene que verse.
    return inbox
  }
  // Mismo id fijo que la Bandeja que crea la app (src/projects.ts): si las dos la crean a la vez, se fusionan.
  const id = board.columns.some((c) => c.id === 'bandeja') ? randomUUID() : 'bandeja'
  const created = { id, name: 'Bandeja', color: 'gray', inbox: true, tasks: [], showCompleted: false }
  board.columns.unshift(created)
  return created
}

/** Añade la tarea al tablero (lo modifica) y devuelve lo que se ha hecho. */
export function capture(board, body, { today, time = null, id = randomUUID(), now = new Date().toISOString() }) {
  const { parsed, column, resumen, url } = interpret(board, body, { today, time })
  const target = column ?? inboxColumn(board)
  if (!Array.isArray(target.tasks)) target.tasks = []
  const task = {
    id,
    title: parsed.title,
    notes: [str(body?.notas, 10_000), url].filter(Boolean).join('\n\n'),
    done: false,
    createdAt: now,
    completedAt: null,
    due: parsed.due,
    time: parsed.time,
  }
  if (parsed.repeat) task.repeat = parsed.repeat
  if (parsed.someday) task.someday = true
  insertOpen(target, task)
  return { id, titulo: task.title, columna: target.name, columnId: target.id, resumen }
}
