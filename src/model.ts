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
}

export interface Column {
  id: string
  name: string
  color: ColorKey
  tasks: Task[]
  showCompleted: boolean
}

export interface Board {
  columns: Column[]
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

export function starterBoard(today: string): Board {
  const personal = newColumn('Personal', 'blue')
  personal.tasks = [
    newTask('Escribe una tarea abajo y pulsa ↩'),
    newTask('Haz clic en el círculo para completarla'),
    newTask('Arrastra las tareas entre columnas'),
    newTask('Haz clic en una tarea para añadir notas o una fecha', { due: today }),
  ]
  return { columns: [personal, newColumn('Trabajo', 'orange'), newColumn('Casa', 'green')] }
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

export function normalizeBoard(raw: unknown): Board {
  const columns = isRaw(raw) && Array.isArray(raw.columns) ? raw.columns.filter(isRaw) : []
  return {
    columns: columns.map((c) => ({
      ...c,
      id: str(c.id) || uid(),
      name: str(c.name) || 'Sin título',
      color: isColor(c.color) ? c.color : 'blue',
      showCompleted: c.showCompleted === true,
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
      })),
    })),
  }
}
