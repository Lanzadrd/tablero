// Cambios sueltos sobre el tablero guardado: los usa el ayudante de Recordatorios para
// traer lo que se hace en el iPhone. Se aplican sobre la última versión (no hay conflictos)
// y son idempotentes: reenviar la misma operación no la duplica.

const str = (value, max = 10_000) => (typeof value === 'string' ? value.slice(0, max) : '')
const isDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const isTime = (value) => typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)
const isAlerts = (value) => Array.isArray(value) && value.length <= 10 && value.every(Number.isInteger)

/** Detrás de la última tarea pendiente, como al añadir una tarea en Tablero. */
function insertOpen(column, task) {
  let last = -1
  column.tasks.forEach((t, i) => {
    if (!t.done) last = i
  })
  column.tasks.splice(last + 1, 0, task)
}

/** Aplica los campos que vengan (y sean válidos). Devuelve true si algo cambia. */
function patchTask(task, changes) {
  const before = JSON.stringify(task)
  if (typeof changes.title === 'string') task.title = str(changes.title, 1000)
  if (typeof changes.notes === 'string') task.notes = str(changes.notes)
  if (typeof changes.done === 'boolean' && changes.done !== task.done) {
    task.done = changes.done
    task.completedAt = changes.done ? (typeof changes.completedAt === 'string' ? changes.completedAt : new Date().toISOString()) : null
  }
  if ('due' in changes) {
    task.due = isDay(changes.due) ? changes.due : null
    if (!task.due) task.time = null
  }
  if ('time' in changes) task.time = task.due && isTime(changes.time) ? changes.time : null
  if ('alerts' in changes) {
    if (isAlerts(changes.alerts)) task.alerts = changes.alerts
    else delete task.alerts // null: los avisos por defecto
  }
  return JSON.stringify(task) !== before
}

/** Aplica las operaciones sobre `board` (lo modifica). Devuelve cuántas cambiaron algo. */
export function applyOperations(board, ops) {
  const columns = Array.isArray(board?.columns) ? board.columns : []
  const findTask = (id) => {
    for (const column of columns) {
      const index = column.tasks.findIndex((t) => t.id === id)
      if (index >= 0) return { column, index, task: column.tasks[index] }
    }
    return null
  }
  let applied = 0

  for (const op of Array.isArray(ops) ? ops : []) {
    switch (op?.op) {
      case 'crearTarea': {
        const column = columns.find((c) => c.id === op.columna)
        if (typeof op.id !== 'string' || !op.id || findTask(op.id) || !column) break
        const task = {
          id: op.id,
          title: '',
          notes: '',
          done: false,
          createdAt: new Date().toISOString(),
          completedAt: null,
          due: null,
          time: null,
        }
        patchTask(task, op.tarea ?? {})
        insertOpen(column, task)
        applied++
        break
      }
      case 'actualizarTarea': {
        const found = findTask(op.id)
        if (found && patchTask(found.task, op.cambios ?? {})) applied++
        break
      }
      case 'moverTarea': {
        const found = findTask(op.id)
        const target = columns.find((c) => c.id === op.columna)
        if (!found || !target || found.column === target) break
        found.column.tasks.splice(found.index, 1)
        insertOpen(target, found.task)
        applied++
        break
      }
      case 'borrarTarea': {
        const found = findTask(op.id)
        if (!found) break
        found.column.tasks.splice(found.index, 1)
        applied++
        break
      }
      case 'renombrarColumna': {
        const column = columns.find((c) => c.id === op.id)
        const name = str(op.name, 60).trim()
        if (!column || !name || column.name === name) break
        column.name = name
        applied++
        break
      }
    }
  }
  return applied
}
