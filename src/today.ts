// Vistas «Hoy», «Algún día», «Sin fecha» y el número del Dock: lógica pura. Solo importa
// tipos de './model', así se prueba con Node tal cual (server/pruebas/vistas.test.mjs).
import type { Board, Column, Task } from './model'

export interface TodayItem {
  task: Task
  column: Column
}

export interface ColumnGroup {
  column: Column
  items: TodayItem[]
}

export interface TodayData {
  /** La pendiente marcada como «Lo primero» hoy. */
  first: TodayItem | null
  /** Pendientes de días anteriores, de la más antigua a la más reciente. */
  overdue: TodayItem[]
  /** Las de hoy por columna (en el orden del tablero); dentro, las de hora primero y por hora. */
  groups: ColumnGroup[]
  /** Completadas hoy, la última primero. */
  done: TodayItem[]
  /** La siguiente tarea sin fecha de cada columna que no tiene nada para hoy (ni la Bandeja). */
  next: TodayItem[]
  /** Todo lo pendiente que se ve: lo primero, atrasadas y las de hoy. */
  count: number
}

/** «Algún día»: aparcada y sin fecha. Si le ponen fecha (p. ej. desde el iPhone), manda la fecha. */
export const isSomeday = (task: Task) => task.someday === true && !task.due

/** Las columnas que se ven: las archivadas no cuentan. */
export const activeColumns = (board: Board) => board.columns.filter((c) => !c.archived)

const pad = (n: number) => String(n).padStart(2, '0')

/** Día local ('AAAA-MM-DD') de una fecha con hora en ISO. */
export function localDay(isoDateTime: string | null): string | null {
  if (!isoDateTime) return null
  const d = new Date(isoDateTime)
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Las de hora primero y por hora; las de todo el día después, en su orden. */
const byTime = (a: TodayItem, b: TodayItem) =>
  a.task.time && b.task.time ? a.task.time.localeCompare(b.task.time) : a.task.time ? -1 : b.task.time ? 1 : 0

export function todayData(board: Board, today: string): TodayData {
  const columns = activeColumns(board)
  const pending = columns.flatMap((column) => column.tasks.filter((t) => !t.done).map((task) => ({ task, column })))

  const first = pending.find((i) => i.task.firstOn === today) ?? null
  const rest = pending.filter((i) => i !== first)

  const overdue = rest
    .filter((i) => i.task.due !== null && i.task.due < today)
    .sort((a, b) => (a.task.due ?? '').localeCompare(b.task.due ?? '') || byTime(a, b))

  const groups: ColumnGroup[] = []
  for (const column of columns) {
    const items = rest.filter((i) => i.column === column && i.task.due === today).sort(byTime)
    if (items.length) groups.push({ column, items })
  }

  const done = columns
    .flatMap((column) => column.tasks.filter((t) => t.done && localDay(t.completedAt) === today).map((task) => ({ task, column })))
    .sort((a, b) => (b.task.completedAt ?? '').localeCompare(a.task.completedAt ?? ''))

  const next: TodayItem[] = []
  for (const column of columns) {
    if (column.inbox) continue
    const open = column.tasks.filter((t) => !t.done)
    if (open.some((t) => (t.due !== null && t.due <= today) || t.firstOn === today)) continue
    const task = open.find((t) => !t.due && !t.someday)
    if (task) next.push({ task, column })
  }

  const count = (first ? 1 : 0) + overdue.length + groups.reduce((n, g) => n + g.items.length, 0)
  return { first, overdue, groups, done, next, count }
}

/** El número del Dock: pendientes con fecha de hoy o anterior (sin «algún día» ni columnas archivadas). */
export function dueCount(board: Board, today: string): number {
  let count = 0
  for (const column of activeColumns(board))
    for (const task of column.tasks) if (!task.done && !isSomeday(task) && task.due !== null && task.due <= today) count += 1
  return count
}

/** Pendientes sin fecha y no «algún día», por columna (panel «Sin fecha» del calendario). */
export function undatedGroups(board: Board): ColumnGroup[] {
  const groups: ColumnGroup[] = []
  for (const column of activeColumns(board)) {
    const items = column.tasks.filter((t) => !t.done && !t.due && !t.someday).map((task) => ({ task, column }))
    if (items.length) groups.push({ column, items })
  }
  return groups
}

// ── Cambios puros: devuelven el mismo tablero si no cambia nada ──

function mapTasks(board: Board, fn: (task: Task) => Task): Board {
  let changed = false
  const columns = board.columns.map((column) => {
    let touched = false
    const tasks = column.tasks.map((task) => {
      const next = fn(task)
      if (next !== task) touched = true
      return next
    })
    if (!touched) return column
    changed = true
    return { ...column, tasks }
  })
  return changed ? { ...board, columns } : board
}

function without<K extends keyof Task>(task: Task, key: K): Task {
  const copy = { ...task }
  delete copy[key]
  return copy
}

/** Marca `id` como «Lo primero» del día `day` y se lo quita a cualquier otra (una por día). `null`: ninguna. */
export function setFirstOn(board: Board, id: string | null, day: string): Board {
  return mapTasks(board, (task) => {
    if (task.id === id) return task.firstOn === day ? task : { ...task, firstOn: day }
    return task.firstOn === day ? without(task, 'firstOn') : task
  })
}

/** Pasa varias tareas al día `due` (conservan la hora); dejan de ser «algún día». */
export function rescheduleTasks(board: Board, ids: string[], due: string): Board {
  const set = new Set(ids)
  return mapTasks(board, (task) => {
    if (!set.has(task.id) || (task.due === due && !task.someday)) return task
    const next = without(task, 'someday')
    next.due = due
    return next
  })
}

/**
 * «Algún día» sí o no. Al activarlo se quedan sin fecha, hora, avisos ni repetición (sin día no
 * hay repetición, como en Recordatorios) y dejan de ser «Lo primero».
 */
export function withSomeday(task: Task, on: boolean): Task {
  if (!on) return task.someday ? without(task, 'someday') : task
  if (task.someday && !task.due && !task.time && !task.repeat && !task.firstOn && task.alerts === undefined) return task
  const next: Task = { ...task, someday: true, due: null, time: null }
  delete next.alerts
  delete next.repeat
  delete next.firstOn
  return next
}

/**
 * Lo que `moveTask` espera como destino (índice entre todas las pendientes de la columna, sin la
 * que se mueve) para el puesto `index` de la lista arrastrable, que no incluye las de «algún día».
 */
export function openIndexFor(board: Board, taskId: string, columnId: string, index: number): number {
  const column = board.columns.find((c) => c.id === columnId)
  if (!column) return index
  const open = column.tasks.filter((t) => !t.done && t.id !== taskId)
  const target = open.filter((t) => !isSomeday(t))[index]
  return target ? open.indexOf(target) : Infinity
}
