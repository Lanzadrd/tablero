import { isRepeat, type Repeat } from '../server/recurrencia.mjs'
import { hasCardNumber, isCurrency, isDay as isRealDay, isPeriod, localDay, withoutDigits, type BillingPeriod } from '../server/suscripciones.mjs'

export type { BillingPeriod, Repeat }

export type ColorKey =
  | 'blue'
  | 'indigo'
  | 'purple'
  | 'pink'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'mint'
  | 'teal'
  | 'brown'
  | 'gray'

export const COLORS: ReadonlyArray<{ key: ColorKey; name: string }> = [
  { key: 'blue', name: 'Azul' },
  { key: 'indigo', name: 'Índigo' },
  { key: 'purple', name: 'Morado' },
  { key: 'pink', name: 'Rosa' },
  { key: 'red', name: 'Rojo' },
  { key: 'orange', name: 'Naranja' },
  { key: 'yellow', name: 'Amarillo' },
  { key: 'green', name: 'Verde' },
  { key: 'mint', name: 'Menta' },
  { key: 'teal', name: 'Turquesa' },
  { key: 'brown', name: 'Marrón' },
  { key: 'gray', name: 'Gris' },
]

export interface Task {
  id: string
  title: string
  notes: string
  done: boolean
  createdAt: string
  completedAt: string | null
  /** Día de la tarea, 'AAAA-MM-DD'. */
  due: string | null
  /** Hora de inicio opcional, 'HH:MM'. */
  time: string | null
  /**
   * Avisos en minutos: respecto a la hora de inicio, o a las 0:00 del día si no hay hora
   * (ver src/alerts.ts). Sin definir = los de por defecto; [] = sin aviso.
   */
  alerts?: number[]
  /** Marcada como «Lo primero» para ese día ('AAAA-MM-DD'), en la vista Hoy. */
  firstOn?: string
  /** «Algún día»: sin fecha, aparcada al pie de su columna. */
  someday?: boolean
  /** Se repite: al completarla se crea la siguiente (src/../server/recurrencia.mjs). */
  repeat?: Repeat
  /** Es el aviso de un cobro de esta suscripción (lo crea el servidor: server/suscripciones.mjs). */
  subscriptionId?: string
  /** El cobro ('AAAA-MM-DD') del que avisa. */
  subscriptionCharge?: string
}

/** Ficha de un proyecto: lo que se abre a menudo, a un clic desde la columna. */
export interface Project {
  /** Carpeta del proyecto en este Mac (para el Finder y para Claude Code). */
  folder?: string
  repo?: string
  production?: string
  staging?: string
  /** Fecha de entrega, 'AAAA-MM-DD'. */
  deadline?: string
  links?: { label: string; url: string }[]
}

export interface Column {
  id: string
  name: string
  color: ColorKey
  tasks: Task[]
  showCompleted: boolean
  /** La Bandeja: donde entra lo que llega de Siri o de la captura rápida. Solo hay una. */
  inbox?: boolean
  /** Archivada: fuera del tablero, pero no borrada. */
  archived?: boolean
  project?: Project
}

/** Una tarjeta: solo un nombre y un color, nunca el número. */
export interface Card {
  id: string
  name: string
  color: ColorKey
}

export interface Subscription {
  id: string
  name: string
  /** Importe de cada cobro, en céntimos (entero ≥ 0). */
  amount: number
  /** Moneda ISO 4217: 'EUR' (por defecto), 'USD' o 'GBP'. */
  currency: string
  period: BillingPeriod
  /** Un día de cobro conocido ('AAAA-MM-DD'); los siguientes se calculan desde él. */
  billingDate: string
  cardId: string | null
  /** Para gestionarla o darse de baja (http/https). */
  url?: string
  notes?: string
  /** Avisar N días antes del cobro (0 = el mismo día; 0..30). Sin definir = sin aviso. */
  remind?: number
  /** Último cobro ('AAAA-MM-DD') del que ya se creó la tarea de aviso (y con él, los anteriores), para no repetirla. */
  remindedFor?: string
  /** Dada de baja ese día ('AAAA-MM-DD'): ya no suma ni avisa. */
  cancelledOn?: string
  createdAt: string
}

/** Lo que se pide al crear una suscripción: lo que falte toma su valor por defecto (newSubscription). */
export type NewSubscription = Partial<Omit<Subscription, 'id' | 'createdAt'>>

export interface Board {
  columns: Column[]
  /** Tarjetas para las suscripciones (normalizeBoard siempre las trae, aunque sea vacía). */
  cards?: Card[]
  subscriptions?: Subscription[]
}

const uid = () => crypto.randomUUID()

export function newTask(title: string, extra: Partial<Task> = {}): Task {
  return {
    id: uid(),
    title,
    notes: '',
    done: false,
    createdAt: new Date().toISOString(),
    completedAt: null,
    due: null,
    time: null,
    ...extra,
  }
}

export function newColumn(name: string, color: ColorKey): Column {
  return { id: uid(), name, color, tasks: [], showCompleted: false }
}

/** Una suscripción nueva: mensual, en euros, sin tarjeta y con cobro `today` salvo que se diga otra cosa. */
export function newSubscription(input: NewSubscription, today: string): Subscription {
  return {
    id: uid(),
    name: '',
    amount: 0,
    currency: 'EUR',
    period: 'month',
    billingDate: today,
    cardId: null,
    ...input,
    createdAt: new Date().toISOString(),
  }
}

export function starterBoard(today: string): Board {
  const personal = newColumn('Personal', 'blue')
  personal.tasks = [
    newTask('Escribe una tarea abajo y pulsa ↩'),
    newTask('Haz clic en el círculo para completarla'),
    newTask('Arrastra las tareas entre columnas'),
    newTask('Haz clic en una tarea para añadir notas o una fecha', { due: today }),
  ]
  return { columns: [personal, newColumn('Trabajo', 'orange'), newColumn('Casa', 'green')], cards: [], subscriptions: [] }
}

/** Primer color que no usa ninguna columna. */
export function nextColor(board: Board): ColorKey {
  const used = new Set(board.columns.map((c) => c.color))
  return (COLORS.find((c) => !used.has(c.key)) ?? COLORS[board.columns.length % COLORS.length]).key
}

export const colorName = (key: ColorKey) => COLORS.find((c) => c.key === key)?.name ?? key

export const openTasks = (column: Column) => column.tasks.filter((t) => !t.done)

/** Las completadas más recientes primero. */
export const doneTasks = (column: Column) =>
  column.tasks
    .filter((t) => t.done)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))

export interface DayItem {
  task: Task
  column: Column
}

/**
 * Tareas con fecha agrupadas por día. Dentro de cada día: primero las de todo el día,
 * luego por hora; las completadas al final.
 */
export function tasksByDay(board: Board) {
  const days = new Map<string, DayItem[]>()
  for (const column of board.columns) {
    for (const task of column.tasks) {
      if (!task.due) continue
      const list = days.get(task.due)
      if (list) list.push({ task, column })
      else days.set(task.due, [{ task, column }])
    }
  }
  const key = ({ task }: DayItem) => `${task.done ? 1 : 0}${task.time ?? ''}`
  for (const list of days.values()) list.sort((a, b) => key(a).localeCompare(key(b)))
  return days
}

export function findTask(board: Board, taskId: string) {
  for (const column of board.columns) {
    const task = column.tasks.find((t) => t.id === taskId)
    if (task) return { column, task }
  }
  return null
}

// ── Operaciones puras: devuelven el mismo objeto si no cambia nada ──

export function mapColumn(board: Board, columnId: string, fn: (c: Column) => Column): Board {
  let changed = false
  const columns = board.columns.map((c) => {
    if (c.id !== columnId) return c
    const next = fn(c)
    if (next !== c) changed = true
    return next
  })
  return changed ? { ...board, columns } : board
}

export function mapTask(board: Board, taskId: string, fn: (t: Task) => Task): Board {
  const found = findTask(board, taskId)
  if (!found) return board
  return mapColumn(board, found.column.id, (c) => {
    const next = fn(found.task)
    return next === found.task ? c : { ...c, tasks: c.tasks.map((t) => (t.id === taskId ? next : t)) }
  })
}

/** Inserta antes de la tarea pendiente nº `openIndex`, o detrás de la última pendiente. */
export function insertTask(column: Column, task: Task, openIndex = Infinity): Column {
  const tasks = [...column.tasks]
  const open = tasks.filter((t) => !t.done)
  const before = open[openIndex]
  const last = open.at(-1)
  tasks.splice(before ? tasks.indexOf(before) : last ? tasks.indexOf(last) + 1 : 0, 0, task)
  return { ...column, tasks }
}

export function removeTask(board: Board, taskId: string): Board {
  const found = findTask(board, taskId)
  if (!found) return board
  return mapColumn(board, found.column.id, (c) => ({ ...c, tasks: c.tasks.filter((t) => t.id !== taskId) }))
}

export function moveTask(board: Board, taskId: string, toColumnId: string, openIndex = Infinity): Board {
  const found = findTask(board, taskId)
  if (!found || !board.columns.some((c) => c.id === toColumnId)) return board
  return mapColumn(removeTask(board, taskId), toColumnId, (c) => insertTask(c, found.task, openIndex))
}

export function moveColumn(board: Board, from: number, to: number): Board {
  if (from === to || !board.columns[from] || to < 0 || to >= board.columns.length) return board
  const columns = [...board.columns]
  const [column] = columns.splice(from, 1)
  columns.splice(to, 0, column)
  return { ...board, columns }
}

// ── Lectura tolerante de lo que viene del disco ──

type Raw = Record<string, unknown>
const isRaw = (v: unknown): v is Raw => typeof v === 'object' && v !== null
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const isColor = (v: unknown): v is ColorKey => COLORS.some((c) => c.key === v)
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const isUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\/\S+$/i.test(v)

function normalizeProject(raw: unknown): Project | undefined {
  if (!isRaw(raw)) return undefined
  const project: Project = {}
  if (str(raw.folder)) project.folder = str(raw.folder).slice(0, 1000)
  for (const key of ['repo', 'production', 'staging'] as const) if (isUrl(raw[key])) project[key] = raw[key] as string
  if (isDay(raw.deadline)) project.deadline = raw.deadline
  if (Array.isArray(raw.links)) {
    const links = raw.links.filter(isRaw).filter((l) => isUrl(l.url)).map((l) => ({ label: str(l.label).slice(0, 60), url: str(l.url) }))
    if (links.length) project.links = links.slice(0, 20)
  }
  return Object.keys(project).length ? project : undefined
}

/** Quita las claves que han quedado sin valor (así el JSON y las comparaciones salen limpios). */
function compact<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) if (value[key] === undefined) delete value[key]
  return value
}

/** Nombre de una tarjeta: nunca un número de tarjeta (si lo trae, se le quitan las cifras). */
function cardName(raw: unknown) {
  const name = str(raw).slice(0, 60)
  if (hasCardNumber(name)) return withoutDigits(name) || 'Tarjeta'
  return name.trim() ? name : 'Tarjeta'
}

function normalizeCards(raw: unknown): Card[] {
  const list = Array.isArray(raw) ? raw.filter(isRaw) : []
  return list.map((c) => ({ ...c, id: str(c.id) || uid(), name: cardName(c.name), color: isColor(c.color) ? c.color : 'gray' }))
}

function normalizeSubscriptions(raw: unknown, cards: Card[]): Subscription[] {
  const list = Array.isArray(raw) ? raw.filter(isRaw) : []
  const cardIds = new Set(cards.map((c) => c.id))
  const remind = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 30 ? v : undefined)
  return list.map((s) =>
    compact({
      ...s,
      id: str(s.id) || uid(),
      name: str(s.name).slice(0, 60),
      amount: typeof s.amount === 'number' && Number.isSafeInteger(s.amount) && s.amount >= 0 ? s.amount : 0,
      currency: isCurrency(s.currency) ? s.currency : 'EUR',
      period: isPeriod(s.period) ? s.period : 'month',
      billingDate: isRealDay(s.billingDate) ? s.billingDate : localDay(),
      cardId: typeof s.cardId === 'string' && cardIds.has(s.cardId) ? s.cardId : null,
      url: isUrl(s.url) ? s.url : undefined,
      notes: str(s.notes).slice(0, 10_000) || undefined,
      remind: remind(s.remind),
      remindedFor: isRealDay(s.remindedFor) ? s.remindedFor : undefined,
      cancelledOn: isRealDay(s.cancelledOn) ? s.cancelledOn : undefined,
      createdAt: str(s.createdAt) || new Date().toISOString(),
    }),
  )
}

export function normalizeBoard(raw: unknown): Board {
  const columns = isRaw(raw) && Array.isArray(raw.columns) ? raw.columns.filter(isRaw) : []
  const cards = normalizeCards(isRaw(raw) ? raw.cards : undefined)
  return {
    columns: columns.map((c) => ({
      ...c,
      id: str(c.id) || uid(),
      name: str(c.name) || 'Sin título',
      color: isColor(c.color) ? c.color : 'blue',
      showCompleted: c.showCompleted === true,
      inbox: c.inbox === true || undefined,
      archived: c.archived === true || undefined,
      project: normalizeProject(c.project),
      tasks: (Array.isArray(c.tasks) ? c.tasks.filter(isRaw) : []).map((t) => ({
        ...t,
        id: str(t.id) || uid(),
        title: str(t.title),
        notes: str(t.notes),
        done: t.done === true,
        createdAt: str(t.createdAt) || new Date().toISOString(),
        completedAt: str(t.completedAt) || null,
        due: /^\d{4}-\d{2}-\d{2}$/.test(str(t.due)) ? str(t.due) : null,
        time: /^\d{2}:\d{2}$/.test(str(t.time)) ? str(t.time) : null,
        alerts: Array.isArray(t.alerts) ? t.alerts.filter((n): n is number => Number.isInteger(n)) : undefined,
        firstOn: isDay(t.firstOn) ? t.firstOn : undefined,
        someday: t.someday === true || undefined,
        repeat: isRepeat(t.repeat) ? t.repeat : undefined,
        subscriptionId: str(t.subscriptionId) || undefined,
        subscriptionCharge: isRealDay(t.subscriptionCharge) ? t.subscriptionCharge : undefined,
      })),
    })),
    cards,
    subscriptions: normalizeSubscriptions(isRaw(raw) ? raw.subscriptions : undefined, cards),
  }
}
