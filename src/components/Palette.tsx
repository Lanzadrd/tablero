// Búsqueda (⌘K o /): una paleta centrada al estilo Spotlight. Busca sin distinguir mayúsculas ni
// acentos en las tareas (pendientes y completadas), en las archivadas, en las columnas y en los
// comandos. ↑↓ eligen, ↩ abre, Esc cierra.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useBoard, useNow } from '../context'
import { formatDay, formatDue, toISODate } from '../dates'
import type { Board, Column } from '../model'
import {
  matchLabel,
  prepare,
  searchArchive,
  searchBoard,
  snippet,
  type ArchivedHit,
  type ArchivedTask,
  type Range,
  type TaskHit,
} from '../search'
import { activeColumns, isSomeday } from '../today'
import { cx, tint } from '../util'
import * as Icon from './Icons'
import '../styles/teclado.css'

export type CommandId =
  | 'new-task'
  | 'new-column'
  | 'new-subscription'
  | 'today'
  | 'board'
  | 'calendar'
  | 'subscriptions'
  | 'ads'
  | 'sidebar'
  | 'shortcuts'

interface Command {
  id: CommandId
  label: string
  keys: string[]
  icon: () => ReactNode
}

const COMMANDS: Command[] = [
  { id: 'new-task', label: 'Nueva tarea', keys: ['N'], icon: Icon.Plus },
  { id: 'new-column', label: 'Nueva columna', keys: ['⇧', 'N'], icon: Icon.Plus },
  { id: 'new-subscription', label: 'Nueva suscripción', keys: [], icon: Icon.Plus },
  { id: 'today', label: 'Hoy', keys: ['D'], icon: Icon.Star },
  { id: 'board', label: 'Tablero', keys: ['T'], icon: Icon.Columns },
  { id: 'calendar', label: 'Calendario', keys: ['C'], icon: Icon.Calendar },
  { id: 'subscriptions', label: 'Suscripciones', keys: ['U'], icon: Icon.Card },
  { id: 'ads', label: 'Anuncios', keys: ['P'], icon: Icon.Megaphone },
  { id: 'sidebar', label: 'Mostrar u ocultar el menú lateral', keys: ['⌃', '⌘', 'S'], icon: Icon.SidebarLeft },
  { id: 'shortcuts', label: 'Atajos de teclado', keys: ['?'], icon: Icon.Keyboard },
]

/** Como mucho, tantas de cada grupo (se afina escribiendo más). */
const LIMIT = { open: 30, done: 15, archived: 15 }

type Item =
  | { kind: 'task'; key: string; hit: TaskHit }
  | { kind: 'archived'; key: string; hit: ArchivedHit }
  | { kind: 'column'; key: string; column: Column; ranges: Range[] }
  | { kind: 'command'; key: string; command: Command; ranges: Range[] }

interface Group {
  title: string
  items: Item[]
}

function buildGroups(board: Board, archive: ArchivedTask[], query: string): Group[] {
  const columns = activeColumns(board)
  if (!prepare(query)) {
    return [
      { title: 'Comandos', items: COMMANDS.map((command) => ({ kind: 'command', key: `c:${command.id}`, command, ranges: [] })) },
      { title: 'Columnas', items: columns.map((column) => ({ kind: 'column', key: `k:${column.id}`, column, ranges: [] })) },
    ]
  }
  const { open, done } = searchBoard(board, query)
  const archived = searchArchive(archive, query)
  const byRank = <T extends { rank: number }>(a: T, b: T) => a.rank - b.rank
  const columnHits = columns
    .flatMap((column) => {
      const m = matchLabel(column.name, query)
      return m ? [{ column, ...m }] : []
    })
    .sort(byRank)
  const commandHits = COMMANDS.flatMap((command) => {
    const m = matchLabel(command.label, query)
    return m ? [{ command, ...m }] : []
  }).sort(byRank)

  const groups: Group[] = [
    { title: 'Tareas', items: open.slice(0, LIMIT.open).map((hit) => ({ kind: 'task', key: `t:${hit.task.id}`, hit })) },
    { title: 'Completadas', items: done.slice(0, LIMIT.done).map((hit) => ({ kind: 'task', key: `t:${hit.task.id}`, hit })) },
    {
      title: 'Archivadas',
      items: archived.slice(0, LIMIT.archived).map((hit, i) => ({ kind: 'archived', key: `a:${hit.task.id}:${i}`, hit })),
    },
    { title: 'Columnas', items: columnHits.map(({ column, ranges }) => ({ kind: 'column', key: `k:${column.id}`, column, ranges })) },
    { title: 'Comandos', items: commandHits.map(({ command, ranges }) => ({ kind: 'command', key: `c:${command.id}`, command, ranges })) },
  ]
  return groups.filter((g) => g.items.length > 0)
}

/** Las tareas archivadas (GET /api/archivo). Si falla, se busca sin ellas. */
function useArchive() {
  const [archive, setArchive] = useState<ArchivedTask[]>([])
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/archivo', { cache: 'no-store', signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<{ tareas?: unknown }>) : null))
      .then((data) => {
        if (Array.isArray(data?.tareas)) setArchive(data.tareas.filter((t): t is ArchivedTask => typeof t?.id === 'string'))
      })
      .catch(() => {})
    return () => controller.abort()
  }, [])
  return archive
}

/** Un texto con sus trozos encontrados resaltados. */
function Marked({ text, ranges }: { text: string; ranges: Range[] }) {
  const plain = text.normalize('NFC')
  if (ranges.length === 0) return <>{plain}</>
  const parts: ReactNode[] = []
  let last = 0
  ranges.forEach((r, i) => {
    if (r.start > last) parts.push(plain.slice(last, r.start))
    parts.push(<mark key={i}>{plain.slice(r.start, r.end)}</mark>)
    last = r.end
  })
  if (last < plain.length) parts.push(plain.slice(last))
  return <>{parts}</>
}

export function Palette({
  onClose,
  onTask,
  onArchived,
  onColumn,
  onCommand,
}: {
  onClose: () => void
  /** Enseñarla en el tablero, con su detalle abierto. */
  onTask: (taskId: string) => void
  onArchived: (task: ArchivedTask) => void
  onColumn: (columnId: string) => void
  onCommand: (id: CommandId) => void
}) {
  const board = useBoard()
  const archive = useArchive()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const groups = useMemo(() => buildGroups(board, archive, query), [board, archive, query])
  const items = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const current = Math.min(active, items.length - 1)

  // Foco al campo al abrir; al cerrar, vuelve a donde estaba (salvo que algo se lo haya llevado).
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    inputRef.current?.focus()
    return () => {
      const now = document.activeElement
      if ((now === document.body || now === null || !now.isConnected) && previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [current, items])

  const choose = (item: Item | undefined) => {
    if (!item) return
    onClose()
    if (item.kind === 'task') onTask(item.hit.task.id)
    else if (item.kind === 'archived') onArchived(item.hit.task)
    else if (item.kind === 'column') onColumn(item.column.id)
    else onCommand(item.command.id)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    const move = (delta: number) => {
      e.preventDefault()
      if (items.length) setActive((current + delta + items.length) % items.length)
    }
    if (e.key === 'ArrowDown') move(1)
    else if (e.key === 'ArrowUp') move(-1)
    else if (e.key === 'Enter') {
      e.preventDefault()
      choose(items[current])
    } else if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Tab') {
      e.preventDefault()
    }
  }

  const optionId = (i: number) => `${listId}-${i}`
  let index = -1

  return (
    <div className="search-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-palette" role="dialog" aria-modal="true" aria-label="Buscar">
        <div className="search-field">
          <Icon.Search />
          <input
            ref={inputRef}
            value={query}
            placeholder="Buscar tareas, columnas y comandos"
            aria-label="Buscar"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={items.length ? optionId(current) : undefined}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
          />
          <kbd className="search-esc">esc</kbd>
        </div>
        <div ref={listRef} id={listId} className="search-list" role="listbox" aria-label="Resultados">
          {items.length === 0 && (
            <p className="search-empty" role="status">
              Nada encontrado para «{query.trim()}»
            </p>
          )}
          {groups.map((group) => (
            <div key={group.title} role="group" aria-label={group.title}>
              <div className="search-group" aria-hidden="true">
                {group.title}
              </div>
              {group.items.map((item) => {
                index += 1
                const i = index
                return (
                  <div
                    key={item.key}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === current}
                    className={cx('search-item', i === current && 'is-active')}
                    onPointerMove={() => i !== current && setActive(i)}
                    onClick={() => choose(item)}
                  >
                    <ItemView item={item} />
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        <footer className="search-foot" aria-hidden="true">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> elegir
          </span>
          <span>
            <kbd>↩</kbd> abrir
          </span>
          <span>
            <kbd>esc</kbd> cerrar
          </span>
        </footer>
      </div>
    </div>
  )
}

function ItemView({ item }: { item: Item }) {
  const board = useBoard()
  const now = useNow()

  if (item.kind === 'command') {
    const Glyph = item.command.icon
    return (
      <>
        <span className="search-icon">
          <Glyph />
        </span>
        <span className="search-main">
          <span className="search-title">
            <Marked text={item.command.label} ranges={item.ranges} />
          </span>
        </span>
        <span className="search-keys">
          {item.command.keys.map((k) => (
            <kbd key={k}>{k}</kbd>
          ))}
        </span>
      </>
    )
  }

  if (item.kind === 'column') {
    // Como la cabecera de la columna: sin las de «algún día».
    const pending = item.column.tasks.filter((t) => !t.done && !isSomeday(t)).length
    return (
      <>
        <span className="search-icon" style={tint(item.column.color)}>
          <span className="cal-dot" />
        </span>
        <span className="search-main">
          <span className="search-title">
            Ir a <Marked text={item.column.name} ranges={item.ranges} />
          </span>
        </span>
        {pending > 0 && <span className="search-meta">{pending === 1 ? '1 pendiente' : `${pending} pendientes`}</span>}
      </>
    )
  }

  const { task, match } = item.hit
  const notes = match.notes.length > 0 || match.rank === 3 ? snippet(task.notes ?? '', match.notes) : null

  if (item.kind === 'archived') {
    const archivedTask = item.hit.task
    const color = board.columns.find((c) => c.id === archivedTask.columnId)?.color ?? 'gray'
    return (
      <>
        <span className="search-icon" style={tint(color)}>
          <Icon.Archive />
        </span>
        <TaskText title={task.title} ranges={match.title} notes={notes} />
        <span className="search-meta">
          {archivedDay(archivedTask.archivedAt, now)}
          {archivedTask.columnName}
        </span>
      </>
    )
  }

  const { column } = item.hit
  return (
    <>
      <span className="search-icon" style={tint(column.color)}>
        <span className={cx('search-check', task.done && 'is-done')} />
      </span>
      <TaskText title={task.title} ranges={match.title} notes={notes} />
      <span className="search-meta">
        {task.due && <span className="search-due">{formatDue(task.due, task.time, now)}</span>}
        <span className="search-column">
          <span className="cal-dot" style={tint(column.color)} />
          {column.archived ? `${column.name} (archivada)` : column.name}
        </span>
      </span>
    </>
  )
}

/** «Ayer · », «3 oct · »: cuándo se archivó (vacío si no se sabe). */
function archivedDay(archivedAt: string | undefined, now: Date) {
  const date = archivedAt ? new Date(archivedAt) : null
  return date && !Number.isNaN(date.getTime()) ? `${formatDay(toISODate(date), now)} · ` : ''
}

function TaskText({ title, ranges, notes }: { title: string; ranges: Range[]; notes: { text: string; ranges: Range[] } | null }) {
  return (
    <span className="search-main">
      <span className="search-title">{title ? <Marked text={title} ranges={ranges} /> : 'Sin título'}</span>
      {notes && notes.text && (
        <span className="search-notes">
          <Marked text={notes.text} ranges={notes.ranges} />
        </span>
      )}
    </span>
  )
}
