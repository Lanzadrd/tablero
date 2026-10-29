// Cambios sueltos sobre el tablero guardado: los usa el ayudante de Recordatorios para
// traer lo que se hace en el iPhone. Se aplican sobre la última versión (no hay conflictos)
// y son idempotentes: reenviar la misma operación no la duplica.
import { randomUUID } from 'node:crypto'
import { localDay } from './almacen.mjs'
import { findColumn } from './lenguaje.mjs'
import { isRepeat, isUntouchedNext, nextOccurrence, nextTaskId } from './recurrencia.mjs'

const str = (value, max = 10_000) => (typeof value === 'string' ? value.slice(0, max) : '')
const isDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const isTime = (value) => typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)
const isAlerts = (value) => Array.isArray(value) && value.length <= 10 && value.every(Number.isInteger)

const TAG = /(?:^|\s)#([\p{L}\p{N}_-]+)$/u

/** Detrás de la última tarea pendiente, como al añadir una tarea en Tablero. */
export function insertOpen(column, task) {
  let last = -1
  column.tasks.forEach((t, i) => {
    if (!t.done) last = i
  })
  column.tasks.splice(last + 1, 0, task)
}

/**
 * «Comprar pan #casa» (p. ej. dictado a Siri en la Bandeja): si la etiqueta final es una
 * columna no archivada, devuelve esa columna y el título sin la etiqueta; si no, null. Aquí no
 * hay vista previa que avise: la etiqueta tiene que ser el nombre entero o su principio (3 letras
 * o más), para que «Ver capítulo #a» no se vaya a ninguna parte.
 */
export function taggedColumn(title, columns) {
  const text = title.trimEnd()
  const m = TAG.exec(text)
  if (!m) return null
  const rest = text.slice(0, m.index).trim()
  const column = findColumn(m[1], columns.filter((c) => !c.archived), { strict: true })
  return column && rest ? { column, title: rest } : null
}

/** Lo que entra en una columna archivada (su lista sigue en Recordatorios) la saca del archivo: si no, no se vería. */
function unarchive(column) {
  if (!column.archived) return false
  delete column.archived
  return true
}

/** Aplica los campos que vengan (y sean válidos). */
function patchTask(task, changes) {
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
}

/** Día local en que se completó (o hoy, si no se sabe). */
function doneDay(task) {
  const at = new Date(task.completedAt ?? Date.now())
  return localDay(Number.isNaN(at.getTime()) ? new Date() : at)
}

/** Aplica las operaciones sobre `board` (lo modifica). Devuelve cuántas cambiaron algo. */
export function applyOperations(board, ops) {
  const columns = Array.isArray(board?.columns) ? board.columns : []
  for (const column of columns) if (!Array.isArray(column.tasks)) column.tasks = []
  const findTask = (id) => {
    for (const column of columns) {
      const index = column.tasks.findIndex((t) => t.id === id)
      if (index >= 0) return { column, index, task: column.tasks[index] }
    }
    return null
  }
  const moveTo = (found, target) => {
    found.column.tasks.splice(found.column.tasks.indexOf(found.task), 1)
    insertOpen(target, found.task)
    found.column = target
  }
  /** Quita la etiqueta #columna del título y devuelve esa columna (o null). */
  const retag = (task) => {
    const tagged = taggedColumn(task.title, columns)
    if (!tagged) return null
    task.title = tagged.title
    return tagged.column
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
        const target = retag(task) ?? column
        insertOpen(target, task)
        unarchive(target)
        applied++
        break
      }
      case 'actualizarTarea': {
        const found = findTask(op.id)
        if (!found) break
        const { task } = found
        const changes = op.cambios ?? {}
        const before = JSON.stringify(task)
        const fromColumn = found.column
        const wasDone = task.done
        patchTask(task, changes)
        if (typeof changes.title === 'string') {
          const target = retag(task)
          if (target && target !== found.column) moveTo(found, target)
        }
        // Completada una que se repite: justo detrás va la siguiente, y esta deja de repetirse. El id
        // de la siguiente es el mismo que pondría la app (nextTaskId): si se completa a la vez en los
        // dos sitios, la fusión ve una sola.
        let created = false
        if (!wasDone && task.done && isRepeat(task.repeat)) {
          const id = nextTaskId(task.id)
          const next = nextOccurrence(task, { id: findTask(id) ? randomUUID() : id, doneOn: doneDay(task) })
          delete task.repeat
          found.column.tasks.splice(found.column.tasks.indexOf(task) + 1, 0, next)
          created = true
        }
        // Desmarcada (p. ej. en el iPhone): si su siguiente sigue tal cual, se quita y la regla vuelve.
        if (wasDone && !task.done && !isRepeat(task.repeat)) {
          const next = found.column.tasks.find((t) => isUntouchedNext(task, t))
          if (next) {
            task.repeat = next.repeat
            found.column.tasks.splice(found.column.tasks.indexOf(next), 1)
          }
        }
        if (created || found.column !== fromColumn || JSON.stringify(task) !== before) applied++
        break
      }
      case 'moverTarea': {
        const found = findTask(op.id)
        const target = columns.find((c) => c.id === op.columna)
        if (!found || !target || found.column === target) break
        moveTo(found, target)
        unarchive(target)
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
