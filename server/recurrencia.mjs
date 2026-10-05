// Tareas que se repiten: al completar una, se crea la siguiente con su nueva fecha.
// La regla vive solo en Tablero; al iPhone (Recordatorios) llega cada tarea suelta.

const pad = (n) => String(n).padStart(2, '0')
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const fromISO = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const EVERY = ['day', 'weekday', 'week', 'month', 'year']

export function isRepeat(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    EVERY.includes(value.every) &&
    (value.interval === undefined || (Number.isInteger(value.interval) && value.interval >= 1 && value.interval <= 365)) &&
    (value.from === undefined || value.from === 'due' || value.from === 'done')
  )
}

function step(iso, every, n) {
  const d = fromISO(iso)
  if (every === 'day') d.setDate(d.getDate() + n)
  else if (every === 'week') d.setDate(d.getDate() + 7 * n)
  else if (every === 'weekday') {
    for (let left = n; left > 0; ) {
      d.setDate(d.getDate() + 1)
      if (d.getDay() !== 0 && d.getDay() !== 6) left--
    }
  } else {
    // Meses y años: el 31 pasa al último día de los meses cortos.
    const day = d.getDate()
    d.setDate(1)
    d.setMonth(d.getMonth() + (every === 'year' ? 12 * n : n))
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
  }
  return toISO(d)
}

/**
 * Fecha de la siguiente vez. Por defecto cuenta desde la fecha que tenía la tarea, pero
 * nunca queda en el pasado; con `from: 'done'`, desde el día en que se completó.
 */
export function nextDue(repeat, { due, doneOn }) {
  const n = repeat.interval ?? 1
  if (repeat.from === 'done' || !due) return step(doneOn, repeat.every, n)
  let next = step(due, repeat.every, n)
  for (let guard = 0; next <= doneOn && guard < 2000; guard++) next = step(next, repeat.every, n)
  // Muy atrasada (años): se cuenta desde el día en que se completó.
  return next <= doneOn ? step(doneOn, repeat.every, n) : next
}

/** Una checklist en las notas vuelve a empezar. */
const resetSteps = (notes) => (typeof notes === 'string' ? notes.replace(/^(\s*[-*] )\[[xX]\]/gm, '$1[ ]') : '')

/** 128 bits de un texto (cyrb128), sin dependencias: igual en el navegador y en Node. */
function hash128(text) {
  let h1 = 1779033703
  let h2 = 3144134277
  let h3 = 1013904242
  let h4 = 2773480762
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4
  h2 ^= h1
  h3 ^= h1
  h4 ^= h1
  return [h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('')
}

/**
 * Id de la siguiente de una tarea que se repite. Sale siempre el mismo de la misma tarea, en la
 * app y en el servidor: si se completa a la vez en los dos sitios (Tablero y el iPhone), la fusión
 * ve una sola siguiente y no dos. Con forma de UUID, como los demás ids.
 */
export function nextTaskId(id) {
  const h = hash128(`${id}~siguiente`)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

/** La tarea siguiente de una que se repite (la original deja de repetirse). */
export function nextOccurrence(task, { id = nextTaskId(task.id), doneOn, now = new Date().toISOString() }) {
  const { firstOn: _first, completedAt: _completed, ...rest } = task
  return {
    ...rest,
    id,
    done: false,
    completedAt: null,
    createdAt: now,
    due: nextDue(task.repeat, { due: task.due, doneOn }),
    notes: resetSteps(task.notes),
  }
}

/**
 * ¿`next` es la siguiente que creó `task` al completarse, y sigue tal cual (pendiente, con su
 * regla, mismo título, notas y hora)? Entonces, al desmarcar `task`, se quita y la regla vuelve.
 */
export function isUntouchedNext(task, next) {
  return (
    !!next &&
    next.id === nextTaskId(task.id) &&
    !next.done &&
    isRepeat(next.repeat) &&
    next.title === task.title &&
    next.notes === resetSteps(task.notes) &&
    (next.time ?? null) === (task.time ?? null)
  )
}
