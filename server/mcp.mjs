// Servidor MCP de Tablero para Claude Code: JSON-RPC 2.0 por stdin/stdout (una línea por
// mensaje), sin dependencias. Habla con el servidor local de Tablero, que tiene que estar en
// marcha. Para registrarlo en Claude Code, «npm run mcp» imprime la configuración.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { describe, findColumn, fold } from './lenguaje.mjs'
import { isRepeat } from './recurrencia.mjs'
import { chargeAfter, chargeDayText, daysBetween, formatMoney, isCurrency, isDay, periodUnit, totals } from './suscripciones.mjs'

// Variable propia (no PORT: suele venir heredada de otros proyectos y mandaría las tareas a otro servidor).
const BASE = `http://127.0.0.1:${process.env.TABLERO_PORT || 4747}`
const PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']
const DEFAULT_PROTOCOL = '2025-06-18'
const MAX_RESULTS = 40

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VERSION = (() => {
  for (const file of ['version.json', 'package.json']) {
    try {
      return JSON.parse(readFileSync(path.join(ROOT, file), 'utf8')).version ?? 'dev'
    } catch {}
  }
  return 'dev'
})()

/** Error de una herramienta: se devuelve como resultado con isError, no como error JSON-RPC. */
class ToolError extends Error {}

class RpcError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const pad = (n) => String(n).padStart(2, '0')
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// ── Hablar con Tablero ──

/** ¿Es Tablero lo que responde en BASE? Se comprueba una vez antes de mandarle o leerle tareas. */
let verified = null
function checkTablero() {
  verified ??= fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(5000) })
    .then((res) => res.json())
    .catch(() => null)
    .then((health) => {
      if (health?.app === 'tablero') return
      verified = null // Se vuelve a probar en la siguiente llamada (quizá aún no estaba en marcha).
      throw new ToolError(health ? `En ${BASE} no responde Tablero.` : `Tablero no responde en ${BASE}. ¿Está en marcha? (npm run abrir)`)
    })
  return verified
}

async function api(pathname, body) {
  await checkTablero()
  let res
  try {
    res = await fetch(`${BASE}${pathname}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    throw new ToolError(`Tablero no responde en ${BASE}. ¿Está en marcha? (npm run abrir)`)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ToolError(`Tablero: ${data.mensaje ?? data.error ?? `HTTP ${res.status}`}`)
  return data
}

async function loadBoard() {
  const { board } = await api('/api/board')
  if (!Array.isArray(board?.columns)) throw new ToolError('Tablero aún no tiene ninguna tarea guardada.')
  return board
}

// ── Texto legible ──

/** «Mañana, 10:30 · cada semana · atrasada» */
function details(task, today) {
  const parts = [describe({ due: task.due, time: task.time, someday: task.someday, repeat: isRepeat(task.repeat) ? task.repeat : null, columnId: null }, { today })]
  if (task.due && task.due < today && !task.done) parts.push('atrasada')
  if (task.firstOn === today && !task.done) parts.push('lo primero')
  return parts.filter(Boolean).join(' · ')
}

function line(task, today) {
  const info = details(task, today)
  const out = [`- [${task.done ? 'x' : ' '}] ${task.title || '(sin título)'}${info ? ` — ${info}` : ''} · id: ${task.id}`]
  const notes = typeof task.notes === 'string' ? task.notes.replace(/\s+/g, ' ').trim() : ''
  if (notes) out.push(`  Notas: ${notes.length > 160 ? `${notes.slice(0, 159)}…` : notes}`)
  return out.join('\n')
}

const str = (value) => (typeof value === 'string' ? value.trim() : '')
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// ── Herramientas ──

const TOOLS = [
  {
    name: 'tablero_listar',
    title: 'Listar tareas de Tablero',
    description:
      'Lista las tareas de Tablero (el gestor de tareas del usuario), agrupadas por columna (proyectos o áreas), con su id. Por defecto, las pendientes.',
    inputSchema: {
      type: 'object',
      properties: {
        filtro: {
          type: 'string',
          enum: ['hoy', 'pendientes', 'todo'],
          description: '«hoy»: para hoy y atrasadas; «pendientes» (por defecto): todas las no completadas; «todo»: también las completadas.',
        },
        columna: { type: 'string', description: 'Nombre (o parte del nombre) de una columna, para ver solo esa.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'tablero_anadir',
    title: 'Añadir una tarea a Tablero',
    description:
      'Añade una tarea a Tablero. El texto se entiende en español: fechas y horas al principio o al final («mañana 10:30», «el viernes», «15/10», «cada lunes», «algún día») y «#columna» al final para elegir la columna (si no, va a la Bandeja). Devuelve el id.',
    inputSchema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'La tarea, p. ej. «Revisar PR de login mañana 10:00 #Trabajo».' },
        notas: { type: 'string', description: 'Notas opcionales (enlaces, detalles…).' },
      },
      required: ['texto'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'tablero_completar',
    title: 'Completar una tarea de Tablero',
    description: 'Marca como completada una tarea por su id (vale el principio del id si no es ambiguo). Si la tarea se repite, Tablero crea la siguiente.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'El id que muestran tablero_listar o tablero_buscar.' } },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'tablero_buscar',
    title: 'Buscar en Tablero',
    description:
      'Busca tareas por texto en el título y las notas, sin distinguir mayúsculas ni acentos. Incluye las completadas y las del archivo.',
    inputSchema: {
      type: 'object',
      properties: { consulta: { type: 'string', description: 'Palabras a buscar (deben aparecer todas).' } },
      required: ['consulta'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'tablero_suscripciones',
    title: 'Suscripciones en Tablero',
    description:
      'Lista las suscripciones del usuario apuntadas en Tablero (Netflix, iCloud…), con su importe, periodicidad, próximo cobro, tarjeta y aviso, y lo que suman al mes y al año por moneda. Las tarjetas son solo un nombre («BBVA»), nunca números. Solo lectura.',
    inputSchema: {
      type: 'object',
      properties: {
        tarjeta: { type: 'string', description: 'Nombre (o principio del nombre) de una tarjeta, para ver solo las suyas; «sin tarjeta» para las que no tienen.' },
        incluirBajas: { type: 'boolean', description: 'También las dadas de baja (por defecto, no).' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
]

async function listar(args) {
  const filtro = args.filtro ?? 'pendientes'
  if (!['hoy', 'pendientes', 'todo'].includes(filtro)) throw new ToolError('filtro debe ser «hoy», «pendientes» o «todo».')
  const board = await loadBoard()
  const today = localDay()
  let columns = board.columns.filter((c) => !c.archived)
  const wanted = str(args.columna)
  if (wanted) {
    const column = columns.find((c) => c.id === wanted) ?? findColumn(wanted, columns)
    if (!column) throw new ToolError(`No hay ninguna columna «${wanted}». Columnas: ${columns.map((c) => c.name).join(', ')}.`)
    columns = [column]
  }
  const keep =
    filtro === 'todo'
      ? () => true
      : filtro === 'hoy'
        ? (t) => !t.done && ((t.due && t.due <= today) || t.firstOn === today)
        : (t) => !t.done
  const sections = []
  let total = 0
  for (const column of columns) {
    const tasks = (column.tasks ?? []).filter(keep)
    if (filtro === 'hoy') tasks.sort((a, b) => `${a.due}${a.time ?? ''}`.localeCompare(`${b.due}${b.time ?? ''}`))
    // Las columnas sin nada que enseñar no salen, salvo la que se ha pedido.
    if (!tasks.length && !wanted) continue
    total += tasks.length
    const inbox = column.inbox && column.name !== 'Bandeja' ? ' (Bandeja)' : ''
    const name = `## ${column.name}${inbox} · ${plural(tasks.length, 'tarea', 'tareas')}`
    sections.push([name, ...tasks.map((t) => line(t, today))].join('\n'))
  }
  if (!total) return filtro === 'hoy' ? 'No hay nada para hoy ni atrasado.' : 'No hay tareas pendientes.'
  const heading = { hoy: 'Para hoy (y atrasadas)', pendientes: 'Pendientes', todo: 'Todas las tareas' }[filtro]
  return `${heading} — hoy es ${today}\n\n${sections.join('\n\n')}`
}

async function anadir(args) {
  const texto = str(args.texto)
  if (!texto) throw new ToolError('Falta el texto de la tarea.')
  const r = await api('/api/capturar', { texto, notas: str(args.notas) || undefined })
  return `Añadida «${r.titulo}» en ${r.columna}${r.resumen ? ` (${r.resumen})` : ''}. id: ${r.id}`
}

async function completar(args) {
  const id = str(args.id)
  if (!id) throw new ToolError('Falta el id de la tarea.')
  const board = await loadBoard()
  const all = board.columns.flatMap((column) => (column.tasks ?? []).map((task) => ({ column, task })))
  let found = all.filter(({ task }) => task.id === id)
  if (!found.length && id.length >= 4) found = all.filter(({ task }) => task.id.startsWith(id))
  if (!found.length) throw new ToolError(`No hay ninguna tarea con id «${id}».`)
  if (found.length > 1) throw new ToolError(`«${id}» es el principio de ${found.length} ids; escribe el id completo.`)
  const { column, task } = found[0]
  if (task.done) return `«${task.title}» ya estaba completada.`
  await api('/api/operaciones', { ops: [{ op: 'actualizarTarea', id: task.id, cambios: { done: true } }] })
  let message = `Completada «${task.title}» (${column.name}).`
  if (task.repeat) {
    // La siguiente se crea justo detrás.
    const after = await loadBoard().catch(() => null)
    const tasks = after?.columns?.flatMap((c) => c.tasks ?? []) ?? []
    const next = tasks[tasks.findIndex((t) => t.id === task.id) + 1]
    if (next && !next.done && next.title === task.title) {
      message += ` Se repite: la siguiente es para ${details(next, localDay()) || 'sin fecha'} (id: ${next.id}).`
    }
  }
  return message
}

async function buscar(args) {
  const words = fold(str(args.consulta)).split(/\s+/).filter(Boolean)
  if (!words.length) throw new ToolError('Falta qué buscar.')
  const matches = (task) => {
    const text = fold(`${task.title ?? ''} ${task.notes ?? ''}`)
    return words.every((w) => text.includes(w))
  }
  const [board, archive] = await Promise.all([loadBoard(), api('/api/archivo').then((r) => r.tareas ?? []).catch(() => [])])
  const today = localDay()
  const found = board.columns
    .flatMap((column) => (column.tasks ?? []).filter(matches).map((task) => ({ column, task })))
    .sort((a, b) => Number(a.task.done) - Number(b.task.done))
  const archived = archive.filter(matches)
  if (!found.length && !archived.length) return `No hay tareas que contengan «${str(args.consulta)}».`
  const out = [`${plural(found.length + archived.length, 'resultado', 'resultados')} para «${str(args.consulta)}»`]
  for (const { column, task } of found.slice(0, MAX_RESULTS)) {
    out.push(`${line(task, today)}\n  Columna: ${column.name}${column.archived ? ' (archivada)' : ''}`)
  }
  if (found.length > MAX_RESULTS) out.push(`… y ${found.length - MAX_RESULTS} más en el tablero.`)
  if (archived.length) {
    out.push('\nEn el archivo de completadas:')
    for (const task of archived.slice(0, 10)) out.push(`${line(task, today)}\n  Columna: ${task.columnName ?? '?'}`)
    if (archived.length > 10) out.push(`… y ${archived.length - 10} más en el archivo.`)
  }
  return out.join('\n')
}

/** «12,99 € / mes» (y, si no es mensual, cuánto sale al mes). */
function price(sub) {
  const text = `${formatMoney(sub.amount, sub.currency)} / ${periodUnit(sub.period)}`
  if (sub.period === 'month') return text
  const factor = { week: 52 / 12, quarter: 1 / 3, half: 1 / 6, year: 1 / 12 }[sub.period] ?? 1
  return `${text} (≈ ${formatMoney(sub.amount * factor, sub.currency)} / mes)`
}

async function suscripciones(args) {
  const board = await loadBoard()
  const today = localDay()
  const cards = (Array.isArray(board.cards) ? board.cards : []).filter((c) => typeof c?.id === 'string' && typeof c.name === 'string')
  const subs = (Array.isArray(board.subscriptions) ? board.subscriptions : [])
    .filter((s) => typeof s?.id === 'string' && isDay(s.billingDate))
    .map((s) => ({ ...s, currency: isCurrency(s.currency) ? s.currency : 'EUR', amount: Number.isFinite(s.amount) ? s.amount : 0 }))
  const cardName = (sub) => cards.find((c) => c.id === sub.cardId)?.name ?? null

  // undefined = todas; null = las que no tienen tarjeta.
  let cardId
  let scope = ''
  const wanted = str(args.tarjeta)
  if (wanted) {
    if (['sin tarjeta', 'sin', 'ninguna'].includes(fold(wanted))) {
      cardId = null
      scope = ' sin tarjeta'
    } else {
      const card = cards.find((c) => c.id === wanted) ?? findColumn(wanted, cards)
      if (!card) {
        throw new ToolError(cards.length ? `No hay ninguna tarjeta «${wanted}». Tarjetas: ${cards.map((c) => c.name).join(', ')}.` : 'Aún no hay ninguna tarjeta.')
      }
      cardId = card.id
      scope = ` con ${card.name}`
    }
  }
  const mine = subs.filter((s) => cardId === undefined || (cardName(s) ? s.cardId : null) === cardId)
  const active = mine
    .filter((s) => !s.cancelledOn)
    .map((sub) => ({ sub, charge: chargeAfter(sub, today) }))
    .sort((a, b) => a.charge.localeCompare(b.charge) || String(a.sub.name).localeCompare(String(b.sub.name), 'es'))
  const cancelled = args.incluirBajas === true ? mine.filter((s) => s.cancelledOn) : []
  if (!subs.length) return 'No hay suscripciones apuntadas en Tablero.'
  if (!active.length && !cancelled.length) return `No hay suscripciones activas${scope}.`

  const out = [`Suscripciones activas${scope} — hoy es ${today}`, '']
  for (const { sub, charge } of active) {
    const days = daysBetween(today, charge)
    const when = describe({ due: charge, time: null, someday: false, repeat: null, columnId: null }, { today })
    const parts = [
      `- ${sub.name || '(sin nombre)'}: ${price(sub)}`,
      `próximo cobro ${when}${days > 1 ? ` (en ${plural(days, 'día', 'días')})` : ''}`,
      cardName(sub) ?? 'sin tarjeta',
    ]
    if (Number.isInteger(sub.remind)) parts.push(sub.remind === 0 ? 'aviso el mismo día' : `aviso ${plural(sub.remind, 'día', 'días')} antes`)
    out.push(`${parts.join(' · ')} · id: ${sub.id}`)
    if (typeof sub.url === 'string' && sub.url) out.push(`  Enlace: ${sub.url}`)
    const notes = typeof sub.notes === 'string' ? sub.notes.replace(/\s+/g, ' ').trim() : ''
    if (notes) out.push(`  Notas: ${notes.length > 160 ? `${notes.slice(0, 159)}…` : notes}`)
  }
  if (!active.length) out.push('(ninguna)')

  // Nunca se suman monedas distintas: una línea por moneda.
  const sums = totals(mine.map((s) => (cardName(s) ? s : { ...s, cardId: null })), { cardId })
  if (active.length) out.push('')
  for (const [currency, total] of Object.entries(sums)) {
    out.push(
      `Total: ${formatMoney(total.monthly, currency)} al mes · ${formatMoney(total.yearly, currency)} al año (${plural(total.count, 'activa', 'activas')})`,
    )
  }

  if (cancelled.length) {
    out.push('', 'Dadas de baja:')
    for (const sub of cancelled) {
      const since = isDay(sub.cancelledOn) ? ` · baja desde el ${chargeDayText(sub.cancelledOn, today)}` : ''
      out.push(`- ${sub.name || '(sin nombre)'}: ${price(sub)}${since} · id: ${sub.id}`)
    }
  }
  return out.join('\n')
}

const HANDLERS = {
  tablero_listar: listar,
  tablero_anadir: anadir,
  tablero_completar: completar,
  tablero_buscar: buscar,
  tablero_suscripciones: suscripciones,
}

async function callTool(params) {
  const handler = HANDLERS[params?.name]
  if (!handler) throw new RpcError(-32602, `Herramienta desconocida: ${params?.name}`)
  const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {}
  try {
    return { content: [{ type: 'text', text: await handler(args) }] }
  } catch (err) {
    const text = err instanceof ToolError ? err.message : `Error inesperado: ${err?.message ?? err}`
    return { content: [{ type: 'text', text }], isError: true }
  }
}

// ── JSON-RPC ──

async function dispatch(method, params) {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : DEFAULT_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'tablero', title: 'Tablero', version: VERSION },
        instructions:
          'Tablero es el gestor de tareas del usuario (columnas por proyecto o área, fechas, una Bandeja de entrada). ' +
          'tablero_listar para ver qué hay, tablero_anadir para crear tareas en lenguaje natural, ' +
          'tablero_completar con el id y tablero_buscar para encontrarlas. ' +
          'tablero_suscripciones enseña las suscripciones (importe, próximo cobro, tarjeta) y lo que suman al mes y al año.',
      }
    case 'ping':
      return {}
    case 'tools/list':
      return { tools: TOOLS }
    case 'tools/call':
      return callTool(params)
    default:
      throw new RpcError(-32601, `Método no encontrado: ${method}`)
  }
}

async function handle(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Petición no válida' } }
  }
  if (typeof msg.method !== 'string') {
    // Respuestas del cliente (no le pedimos nada): se ignoran.
    if ('result' in msg || 'error' in msg) return null
    return { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32600, message: 'Petición no válida' } }
  }
  const notification = !('id' in msg)
  if (notification) return null // notifications/initialized, cancelled…: sin respuesta.
  try {
    return { jsonrpc: '2.0', id: msg.id, result: await dispatch(msg.method, msg.params) }
  } catch (err) {
    const code = err instanceof RpcError ? err.code : -32603
    return { jsonrpc: '2.0', id: msg.id, error: { code, message: err?.message ?? String(err) } }
  }
}

const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)

async function onLine(raw) {
  if (!raw.trim()) return
  let msg
  try {
    msg = JSON.parse(raw)
  } catch {
    return write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON no válido' } })
  }
  if (Array.isArray(msg)) {
    const out = (await Promise.all(msg.map(handle))).filter(Boolean)
    if (out.length) write(out)
    return
  }
  const out = await handle(msg)
  if (out) write(out)
}

// Los mensajes se atienden de uno en uno, en orden: una búsqueda mandada justo detrás de un alta
// ya ve la tarea nueva.
let queue = Promise.resolve()
createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (raw) => {
  queue = queue.then(() => onLine(raw)).catch((err) => console.error('[tablero-mcp]', err))
})
