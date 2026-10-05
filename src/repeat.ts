// Tareas que se repiten, del lado de la app: completar una que se repite la marca como
// hecha, le quita la regla e inserta justo detrás la siguiente (igual que el servidor en
// server/operaciones.mjs). Solo importa tipos de './model', así se prueba con Node tal cual.
import { isUntouchedNext, nextDue, nextOccurrence, nextTaskId, type RepeatEvery } from '../server/recurrencia.mjs'
import type { Board, Repeat, Task } from './model'

const ONE: Record<RepeatEvery, string> = {
  day: 'Cada día',
  weekday: 'Laborables',
  week: 'Cada semana',
  month: 'Cada mes',
  year: 'Cada año',
}

const UNITS: Record<RepeatEvery, [string, string]> = {
  day: ['día', 'días'],
  weekday: ['día laborable', 'días laborables'],
  week: ['semana', 'semanas'],
  month: ['mes', 'meses'],
  year: ['año', 'años'],
}

export const REPEAT_OPTIONS: RepeatEvery[] = ['day', 'weekday', 'week', 'month', 'year']

/** «Cada semana», «Laborables», «Cada 2 meses»… */
export function repeatLabel(repeat: Repeat) {
  const n = repeat.interval ?? 1
  return n === 1 ? ONE[repeat.every] : `Cada ${n} ${UNITS[repeat.every][1]}`
}

/** «semana» / «semanas» según el número. */
export const repeatUnit = (every: RepeatEvery, n: number) => UNITS[every][n === 1 ? 0 : 1]

/** El día de la siguiente vez si se completara hoy (`doneOn`), o null si no se repite. */
export function upcomingDue(board: Board | null, taskId: string, doneOn: string): string | null {
  for (const column of board?.columns ?? []) {
    const task = column.tasks.find((t) => t.id === taskId)
    if (task) return !task.done && task.repeat ? nextDue(task.repeat, { due: task.due, doneOn }) : null
  }
  return null
}

const hasTask = (board: Board, id: string) => board.columns.some((c) => c.tasks.some((t) => t.id === id))

/**
 * Marca una tarea como hecha o pendiente. Si se completa y se repite, en el mismo cambio deja de
 * repetirse y detrás va la siguiente, con un id que sale siempre igual de la misma tarea (igual
 * que en el servidor: así, completada a la vez aquí y en el iPhone, no salen dos). `spareId`
 * solo se usa si ese id ya está cogido. Al desmarcarla, si su siguiente sigue tal cual, se quita
 * y la regla vuelve a la original. Devuelve el mismo tablero si no cambia nada.
 */
export function completeTask(
  board: Board,
  taskId: string,
  done: boolean,
  { completedAt, doneOn, spareId }: { completedAt: string | null; doneOn: string; spareId?: string },
): Board {
  let changed = false
  const columns = board.columns.map((column) => {
    const index = column.tasks.findIndex((t) => t.id === taskId)
    const task = column.tasks[index]
    if (!task || task.done === done) return column
    changed = true
    const updated: Task = { ...task, done, completedAt }
    const tasks = [...column.tasks]
    if (done && task.repeat) {
      delete updated.repeat
      const id = nextTaskId(task.id)
      const next = nextOccurrence(task, { id: hasTask(board, id) && spareId ? spareId : id, doneOn, now: completedAt ?? undefined })
      tasks.splice(index, 1, updated, next)
    } else if (!done && !task.repeat) {
      const nextIndex = tasks.findIndex((t) => isUntouchedNext(task, t))
      const next = tasks[nextIndex]
      if (next?.repeat) {
        updated.repeat = next.repeat
        tasks.splice(nextIndex, 1)
      }
      tasks.splice(tasks.indexOf(task), 1, updated)
    } else tasks.splice(index, 1, updated)
    return { ...column, tasks }
  })
  return changed ? { ...board, columns } : board
}
