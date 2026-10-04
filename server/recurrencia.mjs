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
  return next
}

/** La tarea siguiente de una que se repite (la original deja de repetirse). */
export function nextOccurrence(task, { id, doneOn, now = new Date().toISOString() }) {
  const { firstOn: _first, completedAt: _completed, ...rest } = task
  return {
    ...rest,
    id,
    done: false,
    completedAt: null,
    createdAt: now,
    due: nextDue(task.repeat, { due: task.due, doneOn }),
    // Una checklist en las notas vuelve a empezar.
    notes: typeof task.notes === 'string' ? task.notes.replace(/^(\s*[-*] )\[[xX]\]/gm, '$1[ ]') : '',
  }
}
