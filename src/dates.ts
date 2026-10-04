const LOCALE = 'es-ES'
const DAY_MS = 86_400_000

const pad = (n: number) => String(n).padStart(2, '0')
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export const toISODate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const todayISO = (now = new Date()) => toISODate(now)

export function fromISODate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(iso: string, days: number) {
  const d = fromISODate(iso)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

/** El próximo lunes (nunca hoy). */
export const nextMonday = (now = new Date()) => addDays(toISODate(now), (8 - now.getDay()) % 7 || 7)

function dayDiff(iso: string, now: Date) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((fromISODate(iso).getTime() - today.getTime()) / DAY_MS)
}

const weekday = new Intl.DateTimeFormat(LOCALE, { weekday: 'long' })
const short = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' })
const shortWithYear = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })
const long = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' })

/** «Hoy», «Mañana», «Ayer», «Jueves» (esta semana) o «6 oct». */
export function formatDay(iso: string, now = new Date()) {
  const diff = dayDiff(iso, now)
  if (diff === 0) return 'Hoy'
  if (diff === 1) return 'Mañana'
  if (diff === -1) return 'Ayer'
  const date = fromISODate(iso)
  if (diff > 1 && diff < 7) return capitalize(weekday.format(date))
  return (date.getFullYear() === now.getFullYear() ? short : shortWithYear).format(date)
}

export const formatDue = (due: string, time: string | null, now = new Date()) =>
  time ? `${formatDay(due, now)}, ${time}` : formatDay(due, now)

/** «Domingo, 4 de octubre» */
export const formatToday = (now = new Date()) => capitalize(long.format(now))

/** «hoy», «ayer», «el 6 oct»… para frases como «Creada hoy». */
export function formatWhen(isoDateTime: string, now = new Date()) {
  const day = formatDay(toISODate(new Date(isoDateTime)), now)
  return ['Hoy', 'Ayer', 'Mañana'].includes(day) ? day.toLowerCase() : `el ${day.toLowerCase()}`
}

// ── Calendario (semanas de lunes a domingo) ──

/** Lunes de la semana de `iso`. */
export function startOfWeek(iso: string) {
  const d = fromISODate(iso)
  return addDays(iso, -((d.getDay() + 6) % 7))
}

export const startOfMonth = (iso: string) => `${iso.slice(0, 7)}-01`

export function addMonths(iso: string, months: number) {
  const d = fromISODate(startOfMonth(iso))
  d.setMonth(d.getMonth() + months)
  return toISODate(d)
}

/** Semanas (de 7 días) que cubren el mes de `iso`. */
export function monthGrid(iso: string): string[][] {
  const first = startOfMonth(iso)
  const month = first.slice(0, 7)
  const weeks: string[][] = []
  let day = startOfWeek(first)
  while (weeks.length === 0 || day.startsWith(month)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)))
    day = addDays(day, 7)
  }
  return weeks
}

const monthName = new Intl.DateTimeFormat(LOCALE, { month: 'long' })
const monthShort = new Intl.DateTimeFormat(LOCALE, { month: 'short' })
const weekdayShort = new Intl.DateTimeFormat(LOCALE, { weekday: 'short' })
const longDate = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' })

/** «Octubre 2026» */
export function formatMonth(iso: string) {
  const d = fromISODate(iso)
  return `${capitalize(monthName.format(d))} ${d.getFullYear()}`
}

/** «5 – 11 oct 2026», «28 sept – 4 oct 2026», «29 dic 2025 – 4 ene 2026» */
export function formatWeek(startIso: string) {
  const a = fromISODate(startIso)
  const b = fromISODate(addDays(startIso, 6))
  if (a.getFullYear() !== b.getFullYear()) return `${shortWithYear.format(a)} – ${shortWithYear.format(b)}`
  if (a.getMonth() !== b.getMonth()) return `${short.format(a)} – ${short.format(b)} ${b.getFullYear()}`
  return `${a.getDate()} – ${b.getDate()} ${monthShort.format(b)} ${b.getFullYear()}`
}

/** «lun», «mar»… */
export const formatWeekday = (iso: string) => weekdayShort.format(fromISODate(iso)).replace('.', '')

export const formatMonthShort = (iso: string) => monthShort.format(fromISODate(iso)).replace('.', '')

/** «Domingo, 4 de octubre» */
export const formatLongDate = (iso: string) => capitalize(longDate.format(fromISODate(iso)))

export const isWeekend = (iso: string) => [0, 6].includes(fromISODate(iso).getDay())

/**
 * Saca una hora del texto de una tarea: «10:30 Dentista», «Dentista a las 10:30»,
 * «Dentista 18h», «Cena a las 9». Si no hay hora clara, devuelve el texto tal cual.
 */
export function parseTime(text: string): { title: string; time: string | null } {
  // «Estudiar 2h» es una duración, no una hora: al final solo vale «HH:MM» o «a las…».
  const patterns: Array<[RegExp, 'start' | 'end']> = [
    [/^(?:a\s+las\s+)?(\d{1,2}):(\d{2})\s*h?\s+(.+)$/i, 'start'],
    [/^(?:a\s+las\s+)?(\d{1,2})\s*h\s+(.+)$/i, 'start'],
    [/^(.+?)\s+(?:a\s+las\s+)?(\d{1,2}):(\d{2})\s*h?$/i, 'end'],
    [/^(.+?)\s+a\s+las\s+(\d{1,2})\s*h?$/i, 'end'],
  ]
  for (const [re, where] of patterns) {
    const m = text.trim().match(re)
    if (!m) continue
    const groups = m.slice(1)
    const title = (where === 'start' ? groups.at(-1) : groups[0])?.trim() ?? ''
    const [h, min = '0'] = where === 'start' ? groups.slice(0, -1) : groups.slice(1)
    const hour = Number(h)
    const minute = Number(min ?? 0)
    if (!title || hour > 23 || minute > 59) continue
    return { title, time: `${pad(hour)}:${pad(minute)}` }
  }
  return { title: text.trim(), time: null }
}

export type DueState = 'overdue' | 'today' | 'upcoming'

export function dueState(due: string, time: string | null, now = new Date()): DueState {
  const diff = dayDiff(due, now)
  if (diff < 0) return 'overdue'
  if (diff > 0) return 'upcoming'
  return time && time < `${pad(now.getHours())}:${pad(now.getMinutes())}` ? 'overdue' : 'today'
}
