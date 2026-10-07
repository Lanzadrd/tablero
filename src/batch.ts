// Cambios a varias tareas a la vez (teclado y barra de selección): lógica pura. Solo importa
// tipos de './model', así se prueba con Node tal cual (server/pruebas/teclado.test.mjs).
// Todas devuelven el mismo tablero si no cambia nada (así no se crea un paso de deshacer vacío).
import type { Board, Column, Task } from './model'

/** Aplica `fn` a las tareas de `ids`, estén en la columna que estén. */
export function mapTasks(board: Board, ids: Iterable<string>, fn: (task: Task, column: Column) => Task): Board {
  const set = new Set(ids)
  let changed = false
  const columns = board.columns.map((column) => {
    let touched = false
    const tasks = column.tasks.map((task) => {
      if (!set.has(task.id)) return task
      const next = fn(task, column)
      if (next !== task) touched = true
      return next
    })
    if (!touched) return column
    changed = true
    return { ...column, tasks }
  })
  return changed ? { ...board, columns } : board
}

/**
 * Al día `due`, con la hora que tuviera. Deja de ser «algún día» y, si era «Lo primero» de hoy
 * y se va a otro día, deja de serlo (como «Mañana» en la vista Hoy).
 */
export function scheduleTask(task: Task, due: string, today: string): Task {
  const leavesFirst = task.firstOn === today && due !== today
  if (task.due === due && !task.someday && !leavesFirst) return task
  const next: Task = { ...task, due }
  delete next.someday
  if (leavesFirst) delete next.firstOn
  return next
}

/** Sin fecha: tampoco hora, avisos ni repetición (como al quitar la fecha en el detalle). */
export function undateTask(task: Task): Task {
  if (!task.due && !task.time && task.alerts === undefined && !task.repeat) return task
  const next: Task = { ...task, due: null, time: null }
  delete next.alerts
  delete next.repeat
  return next
}

/** Lleva las tareas detrás de la última pendiente de `columnId`, en el orden del tablero. */
export function moveTasksTo(board: Board, ids: Iterable<string>, columnId: string): Board {
  if (!board.columns.some((c) => c.id === columnId)) return board
  const set = new Set(ids)
  const moving = board.columns.flatMap((c) => (c.id === columnId ? [] : c.tasks.filter((t) => set.has(t.id))))
  if (moving.length === 0) return board
  const columns = board.columns.map((column) => {
    if (column.id === columnId) {
      const tasks = [...column.tasks]
      tasks.splice(tasks.findLastIndex((t) => !t.done) + 1, 0, ...moving)
      return { ...column, tasks }
    }
    return column.tasks.some((t) => set.has(t.id)) ? { ...column, tasks: column.tasks.filter((t) => !set.has(t.id)) } : column
  })
  return { ...board, columns }
}

export function removeTasks(board: Board, ids: Iterable<string>): Board {
  const set = new Set(ids)
  let changed = false
  const columns = board.columns.map((column) => {
    if (!column.tasks.some((t) => set.has(t.id))) return column
    changed = true
    return { ...column, tasks: column.tasks.filter((t) => !set.has(t.id)) }
  })
  return changed ? { ...board, columns } : board
}

/**
 * Copia cada tarea justo detrás de la original; `copyIds[i]` es el id de la copia de `ids[i]`.
 * La copia queda pendiente y sin «Lo primero» (solo hay una por día). La de un aviso de suscripción ya
 * es una tarea más: si no, se iría con el aviso al cambiar la suscripción.
 */
export function duplicateTasks(board: Board, ids: string[], copyIds: string[], createdAt: string): Board {
  const copies = new Map(ids.map((id, i) => [id, copyIds[i]]))
  let changed = false
  const columns = board.columns.map((column) => {
    if (!column.tasks.some((t) => copies.has(t.id))) return column
    changed = true
    const tasks = column.tasks.flatMap((task) => {
      const id = copies.get(task.id)
      if (!id) return [task]
      const copy: Task = { ...task, id, createdAt, done: false, completedAt: null }
      delete copy.firstOn
      delete copy.subscriptionId
      delete copy.subscriptionCharge
      return [task, copy]
    })
    return { ...column, tasks }
  })
  return changed ? { ...board, columns } : board
}
