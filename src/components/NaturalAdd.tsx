// Escribir tareas en lenguaje natural («Llamar a Marta mañana 10:30 #trabajo») desde
// «Nueva tarea» del tablero y del calendario: lo entendido se ve antes de pulsar ↩.
import { useMemo, type ReactNode } from 'react'
import { parseTask, repeatWeekday, weekdayFrom, type ParsedTask } from '../../server/lenguaje.mjs'
import { useActions, useBoard, useNow, useUI } from '../context'
import { formatDue, todayISO } from '../dates'
import { linkText, onlyLink, type Link } from '../links'
import type { Task } from '../model'
import { repeatLabel } from '../repeat'
import type { NewTask } from '../state'
import { tint } from '../util'
import * as Icon from './Icons'
import '../styles/escribir.css'

/** Una tarea lista para añadir. `link`: era solo una URL y falta el título de la página. */
export interface Draft extends NewTask {
  extra: Partial<Task>
  link?: Link
}

/**
 * Interpreta lo escrito con la fecha y la hora de ahora (una hora que ya ha pasado es para mañana)
 * y las columnas no archivadas (las de «#columna»).
 */
export function useParser() {
  const board = useBoard()
  const now = useNow()
  const today = todayISO(now)
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const columns = useMemo(() => board.columns.filter((c) => !c.archived), [board.columns])
  return useMemo(() => (text: string) => parseTask(text, { today, time, columns }), [today, time, columns])
}

/**
 * El día de una tarea escrita en la celda `day` del calendario: el de la celda, salvo que se repita
 * un día de la semana («cada lunes»): entonces, el primer lunes desde la celda.
 */
export function calendarDue(parsed: ParsedTask | null, day: string) {
  const weekday = parsed ? repeatWeekday(parsed) : null
  return weekday === null ? day : weekdayFrom(day, weekday)
}

/**
 * Lo escrito → tarea. Sin `parsed` (⌥↩) va tal cual. `day`: el del calendario, que manda
 * sobre la fecha escrita (pero se usan la hora, la #columna y la repetición).
 */
export function draftFrom(
  text: string,
  { parsed, columnId, day }: { parsed: ParsedTask | null; columnId: string; day?: string },
): Draft | null {
  const title = (parsed ? parsed.title : text).trim()
  if (!title) return null
  const extra: Partial<Task> = {}
  if (parsed?.due) extra.due = parsed.due
  if (parsed?.time) extra.time = parsed.time
  if (parsed?.repeat) extra.repeat = parsed.repeat
  if (parsed?.someday && !day) extra.someday = true
  if (day) extra.due = calendarDue(parsed, day)
  const target = parsed?.columnId ?? columnId
  // Solo una URL: título provisional (dominio y ruta) hasta que llegue el de la página.
  const link = parsed ? onlyLink(title) : null
  if (link) return { columnId: target, title: linkText(link), extra: { ...extra, notes: link.url }, link }
  return { columnId: target, title, extra }
}

/** Títulos pedidos a la vez, como mucho (Chrome solo abre 6 conexiones con el servidor, y una es la de los eventos). */
const MAX_TITLES = 2
let titlesRunning = 0
const titlesWaiting: Array<() => void> = []

/** El título de una página, a través del servidor local (null si no lo hay o tarda demasiado). */
async function pageTitle(url: string): Promise<string | null> {
  if (titlesRunning >= MAX_TITLES) await new Promise<void>((resolve) => titlesWaiting.push(resolve))
  titlesRunning++
  try {
    const res = await fetch(`/api/titulo?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const { title } = (await res.json()) as { title?: unknown }
    const clean = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim().slice(0, 300) : ''
    return clean || null
  } catch {
    return null
  } finally {
    titlesRunning--
    titlesWaiting.shift()?.()
  }
}

/** Añade las tareas (un solo paso de deshacer) y avisa si alguna ha ido a otra columna. */
export function useAddDrafts() {
  const actions = useActions()
  const board = useBoard()
  const ui = useUI()
  return (drafts: Draft[], homeColumnId: string) => {
    if (drafts.length === 0) return
    const ids = actions.addTaskList(drafts)
    const elsewhere = drafts.filter((d) => d.columnId !== homeColumnId)
    if (elsewhere.length > 0) {
      const names = [...new Set(elsewhere.map((d) => board.columns.find((c) => c.id === d.columnId)?.name ?? ''))]
      const where = names.filter(Boolean).join(', ')
      ui.toast(elsewhere.length === 1 ? `Añadida a ${where}` : `${elsewhere.length} añadidas a ${where}`, { undo: true })
    }
    drafts.forEach((draft, i) => {
      if (!draft.link) return
      void pageTitle(draft.link.url).then((title) => {
        if (title) actions.replaceTitle(ids[i], draft.title, title)
      })
    })
  }
}

function Pill({ icon, children, label }: { icon: ReactNode; children: ReactNode; label?: string }) {
  return (
    <span className="nl-pill" title={label}>
      {icon}
      {children}
    </span>
  )
}

/**
 * Vista previa discreta de lo entendido: fecha, hora, columna, repetición, algún día.
 * En el calendario (`day`) la fecha es la de la celda, así que no se muestra, salvo que una
 * repetición como «cada lunes» la cambie.
 */
export function ParsePreview({ id, parsed, day }: { id: string; parsed: ParsedTask; day?: string }) {
  const board = useBoard()
  const now = useNow()
  const column = parsed.columnId ? board.columns.find((c) => c.id === parsed.columnId) : undefined
  const link = onlyLink(parsed.title)
  const pills: ReactNode[] = []
  const calendar = day !== undefined
  const due = calendar ? calendarDue(parsed, day) : parsed.due
  const shownDue = due !== day ? due : null

  if (shownDue)
    pills.push(
      <Pill key="fecha" icon={parsed.time ? <Icon.Bell /> : <Icon.Calendar />}>
        {formatDue(shownDue, parsed.time, now)}
      </Pill>,
    )
  if (calendar && !shownDue && parsed.time)
    pills.push(
      <Pill key="hora" icon={<Icon.Bell />}>
        {parsed.time}
      </Pill>,
    )
  if (!calendar && parsed.someday)
    pills.push(
      <Pill key="algun-dia" icon={<Icon.Later />}>
        Algún día
      </Pill>,
    )
  if (parsed.repeat)
    pills.push(
      <Pill key="repetir" icon={<Icon.Repeat />}>
        {repeatLabel(parsed.repeat)}
      </Pill>,
    )
  if (column)
    pills.push(
      <span key="columna" className="nl-pill is-column" style={tint(column.color)}>
        <span className="cal-dot" />
        {column.name}
      </span>,
    )
  if (link)
    pills.push(
      <Pill key="enlace" icon={<Icon.Link />} label="Se usará el título de la página">
        {link.domain}
      </Pill>,
    )
  if (pills.length === 0) return null

  return (
    <div id={id} className="nl-preview">
      {pills}
      <span className="nl-hint">
        <kbd>⌥↩</kbd> tal cual
      </span>
    </div>
  )
}
