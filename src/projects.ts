// Columnas como proyectos: la Bandeja, archivar, la ficha, el «pulso» y «Lo hecho». Lógica pura:
// de './model' solo importa tipos (y de server/suscripciones.mjs, dónde va el aviso de una suscripción),
// así se prueba con Node tal cual (server/pruebas/proyectos.test.mjs).
import { pendingReminderOf, placeReminders } from '../server/suscripciones.mjs'
import type { Board, Column, Project, Task } from './model'

// ── Bandeja ──

/** Id de la Bandeja que crea la app: fijo, así dos ventanas que la crean a la vez acaban con la misma. */
export const INBOX_ID = 'bandeja'

export const inboxOf = (board: Board) => board.columns.find((c) => c.inbox) ?? null

/** ¿Falta la Bandeja (o está archivada)? */
export const needsInbox = (board: Board) => !board.columns.some((c) => c.inbox && !c.archived)

function without<T extends object, K extends keyof T>(value: T, key: K): T {
  const copy = { ...value }
  delete copy[key]
  return copy
}

/** ¿Se llama «Bandeja» (sin mayúsculas ni acentos)? */
export const isInboxName = (name: string) => name.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase() === 'bandeja'

/**
 * Que haya Bandeja: si ninguna columna lo es, pasa a serlo la que ya se llame «Bandeja» (así no
 * hay dos listas «Tablero · Bandeja» en Recordatorios) y, si no hay, se crea la primera. Si estaba
 * archivada, se saca. `spareId` solo se usa si el id fijo ya lo tiene otra columna. Devuelve el
 * mismo tablero si ya está.
 */
export function ensureInbox(board: Board, spareId: string): Board {
  const inbox = inboxOf(board) ?? board.columns.find((c) => !c.archived && isInboxName(c.name))
  if (inbox) {
    if (inbox.inbox && !inbox.archived) return board
    return { ...board, columns: board.columns.map((c) => (c === inbox ? { ...without(c, 'archived'), inbox: true } : c)) }
  }
  const id = board.columns.some((c) => c.id === INBOX_ID) ? spareId : INBOX_ID
  const created: Column = { id, name: 'Bandeja', color: 'gray', tasks: [], showCompleted: false, inbox: true }
  return { ...board, columns: [created, ...board.columns] }
}

// ── Archivar columnas ──

function mapColumn(board: Board, columnId: string, fn: (c: Column) => Column): Board {
  let changed = false
  const columns = board.columns.map((c) => {
    if (c.id !== columnId) return c
    const next = fn(c)
    if (next !== c) changed = true
    return next
  })
  return changed ? { ...board, columns } : board
}

/**
 * Archiva o restaura una columna. La Bandeja no se archiva. Al archivarla, sus suscripciones no cambian, pero
 * el aviso pendiente de una activa que estaba en ella pasa, en el mismo cambio, a donde va ahora su aviso (la
 * Bandeja, si era de esa columna): en una archivada no se vería ni en Hoy ni en el tablero. Al restaurarla,
 * no vuelve.
 */
export function setArchived(board: Board, columnId: string, archived: boolean): Board {
  const column = board.columns.find((c) => c.id === columnId)
  if (!column || Boolean(column.archived) === archived || (archived && column.inbox)) return board
  if (!archived) return mapColumn(board, columnId, (c) => without(c, 'archived'))
  const moving = column.tasks.filter((t) => pendingReminderOf(board, t))
  const next = mapColumn(board, columnId, (c) => ({ ...c, archived: true, tasks: moving.length ? c.tasks.filter((t) => !moving.includes(t)) : c.tasks }))
  return placeReminders(next, moving)
}

/**
 * Borra una columna, salvo la Bandeja (es única). En el mismo cambio, sus suscripciones se quedan «Sin
 * columna» y el aviso pendiente de una suscripción activa que estaba en ella no se pierde con sus
 * tareas: pasa a donde va ahora su aviso (la Bandeja, si era de esa columna).
 */
export function deleteColumn(board: Board, columnId: string): Board {
  const column = board.columns.find((c) => c.id === columnId)
  if (!column || column.inbox) return board
  const next: Board = { ...board, columns: board.columns.filter((c) => c !== column) }
  const subscriptions = board.subscriptions ?? []
  if (subscriptions.some((s) => s.columnId === columnId)) {
    next.subscriptions = subscriptions.map((s) => (s.columnId === columnId ? { ...s, columnId: null } : s))
  }
  return placeReminders(next, column.tasks)
}

/** Índice en el tablero de la columna `toId`, para mover `id` a su sitio (las archivadas no se ven). */
export function columnSlot(board: Board, id: string, toId: string): [number, number] {
  return [board.columns.findIndex((c) => c.id === id), board.columns.findIndex((c) => c.id === toId)]
}

// ── Ficha del proyecto ──

export type UrlField = 'repo' | 'production' | 'staging'

/** La ficha tal como se edita: todo texto. */
export interface ProjectDraft {
  folder: string
  repo: string
  production: string
  staging: string
  deadline: string
  links: { label: string; url: string }[]
}

export const draftOf = (project: Project | undefined): ProjectDraft => ({
  folder: project?.folder ?? '',
  repo: project?.repo ?? '',
  production: project?.production ?? '',
  staging: project?.staging ?? '',
  deadline: project?.deadline ?? '',
  links: project?.links?.map((l) => ({ ...l })) ?? [],
})

/**
 * Una dirección escrita a mano. Sin esquema se le pone https:// (http:// a localhost). Solo http y
 * https, con un dominio de verdad. '' si está vacía; null si no vale.
 */
export function normalizeUrl(text: string): string | null {
  const raw = text.trim()
  if (!raw) return ''
  if (/\s/.test(raw)) return null
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(raw)
  const full = /^https?:\/\//i.test(raw) ? raw : raw.includes('://') ? null : `${local ? 'http' : 'https'}://${raw}`
  if (!full) return null
  let url: URL
  try {
    url = new URL(full)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const host = url.hostname
  if (!host || (!host.includes('.') && host !== 'localhost' && !host.startsWith('['))) return null
  return url.href
}

/** «github.com/org/repo» para enseñar una dirección (sin esquema ni barra final). */
export const shortUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')

/**
 * La ficha que se guarda a partir de lo escrito. Una dirección que no vale no se guarda: se queda la
 * que había. `undefined` si no queda nada.
 */
export function projectFromDraft(draft: ProjectDraft, previous?: Project): Project | undefined {
  const project: Project = {}
  const folder = draft.folder.trim().slice(0, 1000)
  if (folder) project.folder = folder
  for (const key of ['repo', 'production', 'staging'] as const) {
    const url = normalizeUrl(draft[key])
    const value = url === null ? previous?.[key] : url
    if (value) project[key] = value
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(draft.deadline)) project.deadline = draft.deadline
  const links = draft.links
    .map((l) => ({ label: l.label.trim().slice(0, 60), url: normalizeUrl(l.url) }))
    .filter((l): l is { label: string; url: string } => Boolean(l.url))
    .slice(0, 20)
  if (links.length) project.links = links
  return Object.keys(project).length ? project : undefined
}

/** Cambia la ficha de una columna (mismo tablero si no cambia nada). */
export function withProject(board: Board, columnId: string, project: Project | undefined): Board {
  return mapColumn(board, columnId, (c) => {
    if (JSON.stringify(c.project) === JSON.stringify(project)) return c
    return project ? { ...c, project } : without(c, 'project')
  })
}

/** Enlaces fijos de la ficha (repositorio, producción, staging), en ese orden. */
export function projectLinks(project: Project | undefined): { field: UrlField; label: string; url: string }[] {
  const labels: Record<UrlField, string> = { repo: 'Repositorio', production: 'Producción', staging: 'Staging' }
  return (['repo', 'production', 'staging'] as const).flatMap((field) => {
    const url = project?.[field]
    return url ? [{ field, label: labels[field], url }] : []
  })
}

// ── Fechas (locales, 'AAAA-MM-DD') ──

const pad = (n: number) => String(n).padStart(2, '0')
const toDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const fromDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const shiftDays = (day: string, days: number) => {
  const d = fromDay(day)
  d.setDate(d.getDate() + days)
  return toDay(d)
}

/** Días de `from` a `to` (negativo si `to` es antes). */
export const daysBetween = (from: string, to: string) => Math.round((fromDay(to).getTime() - fromDay(from).getTime()) / 86_400_000)

/** Día local de una fecha con hora en ISO. */
export function localDay(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : toDay(d)
}

const weekdayFormat = new Intl.DateTimeFormat('es-ES', { weekday: 'short' })
const monthFormat = new Intl.DateTimeFormat('es-ES', { month: 'short' })
const clean = (s: string) => s.replace('.', '')

/** «3 oct»; con el año si no es el de `today`: «3 oct 2025». `weekday`: «vie 9 oct». */
export function shortDate(day: string, today: string, weekday = false) {
  const d = fromDay(day)
  const text = `${d.getDate()} ${clean(monthFormat.format(d))}${day.slice(0, 4) === today.slice(0, 4) ? '' : ` ${d.getFullYear()}`}`
  return weekday ? `${clean(weekdayFormat.format(d))} ${text}` : text
}

// ── Pulso del proyecto ──

export interface Pulse {
  /** «Entrega vie 9 oct»; `urgent` si ya pasó o queda poco. */
  deadline: { text: string; urgent: boolean } | null
  /** «Sin próxima acción» o «Parada · 12 d». */
  alert: string | null
}

/** Días sin actividad a partir de los que una columna está «parada». */
export const IDLE_DAYS = 7

/** Última actividad: la tarea creada o completada más tarde. */
export function lastActivity(column: Column): string | null {
  let last: string | null = null
  let lastTime = -Infinity
  for (const task of column.tasks) {
    for (const iso of [task.createdAt, task.completedAt]) {
      const time = iso ? Date.parse(iso) : NaN
      if (time > lastTime) {
        lastTime = time
        last = iso
      }
    }
  }
  return last
}

/**
 * La línea gris bajo el nombre de la columna: solo en los proyectos (con ficha), nunca en la
 * Bandeja. No está «parada» si tiene algo con fecha para los próximos días.
 */
export function projectPulse(column: Column, today: string): Pulse | null {
  if (column.inbox || !column.project) return null
  let deadline: Pulse['deadline'] = null
  const due = column.project?.deadline
  if (due) {
    const days = daysBetween(today, due)
    const when = days === 0 ? 'hoy' : days === 1 ? 'mañana' : shortDate(due, today, true)
    deadline = { text: `Entrega ${when}`, urgent: days <= 2 }
  }
  let alert: string | null = null
  if (!column.tasks.some((t) => !t.done)) alert = 'Sin próxima acción'
  else {
    const last = localDay(lastActivity(column))
    const idle = last ? daysBetween(last, today) : 0
    const scheduled = column.tasks.some((t) => !t.done && t.due && t.due >= today && daysBetween(today, t.due) <= IDLE_DAYS)
    if (idle > IDLE_DAYS && !scheduled) alert = `Parada · ${idle} d`
  }
  return deadline || alert ? { deadline, alert } : null
}

/** El pulso en una sola línea de texto (para el lector de pantalla y el título). */
export const pulseText = (pulse: Pulse) => [pulse.deadline?.text, pulse.alert].filter(Boolean).join(' · ')

// ── Lo hecho ──

export type DonePeriod = 'week' | 'lastWeek' | 'month' | 'lastMonth' | 'all'

export const DONE_PERIODS: ReadonlyArray<{ value: DonePeriod; label: string }> = [
  { value: 'week', label: 'Esta semana' },
  { value: 'lastWeek', label: 'Semana pasada' },
  { value: 'month', label: 'Este mes' },
  { value: 'lastMonth', label: 'Mes pasado' },
  { value: 'all', label: 'Todo' },
]

export const isDonePeriod = (value: unknown): value is DonePeriod => DONE_PERIODS.some((p) => p.value === value)

/** Primer y último día (incluidos) del periodo; null = todo. Las semanas van de lunes a domingo. */
export function periodRange(period: DonePeriod, today: string): [string, string] | null {
  const monday = shiftDays(today, -((fromDay(today).getDay() + 6) % 7))
  const firstOfMonth = `${today.slice(0, 7)}-01`
  const nextMonth = fromDay(firstOfMonth)
  nextMonth.setMonth(nextMonth.getMonth() + 1)
  switch (period) {
    case 'week':
      return [monday, shiftDays(monday, 6)]
    case 'lastWeek':
      return [shiftDays(monday, -7), shiftDays(monday, -1)]
    case 'month':
      return [firstOfMonth, shiftDays(toDay(nextMonth), -1)]
    case 'lastMonth': {
      const lastOfPrevious = shiftDays(firstOfMonth, -1)
      return [`${lastOfPrevious.slice(0, 7)}-01`, lastOfPrevious]
    }
    case 'all':
      return null
  }
}

/** Una tarea archivada (GET /api/archivo): lo que hace falta de ella aquí. */
export interface ArchivedLike {
  id: string
  title: string
  completedAt: string | null
  archivedAt?: string
}

export interface DoneItem {
  id: string
  title: string
  /** Día en que se completó (o, si no consta, en que se archivó). */
  day: string | null
  /** Para ordenar. */
  at: string
}

/** Las completadas de la columna y las archivadas, sin repetir, de la más antigua a la más reciente. */
export function doneItems(tasks: Task[], archived: ArchivedLike[]): DoneItem[] {
  const items = new Map<string, DoneItem>()
  for (const task of archived) {
    const at = task.completedAt || task.archivedAt || ''
    items.set(task.id, { id: task.id, title: task.title, day: localDay(at), at })
  }
  // Si una está en los dos sitios, manda el tablero.
  for (const task of tasks) {
    if (!task.done) continue
    const at = task.completedAt ?? ''
    items.set(task.id, { id: task.id, title: task.title, day: localDay(at), at })
  }
  return [...items.values()].sort((a, b) => a.at.localeCompare(b.at))
}

export function inPeriod(items: DoneItem[], period: DonePeriod, today: string): DoneItem[] {
  const range = periodRange(period, today)
  if (!range) return items
  const [from, to] = range
  return items.filter((i) => i.day !== null && i.day >= from && i.day <= to)
}

/** Texto plano para pegar en un correo o una factura: «• Tarea — 3 oct», una por línea. */
export const doneText = (items: DoneItem[], today: string) =>
  items.map((i) => `• ${i.title.trim() || 'Sin título'}${i.day ? ` — ${shortDate(i.day, today)}` : ''}`).join('\n')
