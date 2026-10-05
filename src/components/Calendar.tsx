import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties } from 'react'
import { useActions, useBoard, useNow, useUI } from '../context'
import {
  addDays,
  addMonths,
  dueState,
  formatLongDate,
  formatMonth,
  formatMonthShort,
  formatWeek,
  formatWeekday,
  fromISODate,
  isWeekend,
  monthGrid,
  startOfWeek,
  todayISO,
} from '../dates'
import { hasTaskTarget } from '../keys'
import { findLinks, withoutLinks } from '../links'
import { tasksByDay, type Column, type DayItem, type Task } from '../model'
import { useSelected } from '../selection'
import { activeColumns } from '../today'
import { cx, isTyping, splitLines, tint, useStoredState } from '../util'
import * as Icon from './Icons'
import { startDrag, useDropTarget } from './drag'
import { ChipLink, Linkified } from './Links'
import { draftFrom, ParsePreview, useAddDrafts, useParser, type Draft } from './NaturalAdd'
import { Menu, Popover } from './Popover'
import { Segmented } from './Segmented'
import { CheckButton, RepeatMark, taskRowA11y } from './TaskRow'
import { UndatedPanel } from './Undated'

type Mode = 'month' | 'week'

/** Pendiente de un día pasado, o de hoy con la hora ya pasada (como en el tablero). */
const isOverdue = (task: Task, now: Date) => !task.done && task.due !== null && dueState(task.due, task.time, now) === 'overdue'

export function CalendarView() {
  const board = useBoard()
  const actions = useActions()
  const ui = useUI()
  const now = useNow()
  const today = todayISO(now)
  const [mode, setMode] = useStoredState<Mode>('tablero.calendario.modo', 'month')
  const [storedColumn, setStoredColumn] = useStoredState<string | null>('tablero.calendario.columna', null)
  const [undatedOpen, setUndatedOpen] = useStoredState('tablero.calendario.sin-fecha', false)
  const [cursor, setCursor] = useState(today)
  const [dayPopover, setDayPopover] = useState<{ day: string; anchor: HTMLElement } | null>(null)
  const [pendingAdd, setPendingAdd] = useState<string | null>(null)
  // Sube con cada «Hoy» (H, el botón, N): en la semana, hoy vuelve a la vista aunque ya fuera esta semana.
  const [todayTick, setTodayTick] = useState(0)
  // Las columnas archivadas no salen en el calendario.
  const columns = useMemo(() => activeColumns(board), [board])
  const days = useMemo(() => tasksByDay({ ...board, columns }), [board, columns])

  // Las tareas nuevas del calendario van a la última columna elegida.
  const column = columns.find((c) => c.id === storedColumn) ?? columns[0] ?? null
  const target = column && { column, columns, onColumn: setStoredColumn }

  const move = (direction: -1 | 1) =>
    setCursor((c) => (mode === 'month' ? addMonths(c, direction) : addDays(c, 7 * direction)))
  const reschedule = (taskId: string, day: string) => actions.updateTask(taskId, { due: day })
  const openDay = (day: string, anchor: HTMLElement) => setDayPopover({ day, anchor })
  const goToday = () => {
    setCursor(today)
    setTodayTick((n) => n + 1)
  }

  // «N»: nueva tarea para hoy, cuando hoy ya está en pantalla.
  useEffect(() => {
    if (!pendingAdd) return
    setPendingAdd(null)
    const el = document.querySelector<HTMLElement>(`[data-day="${pendingAdd}"]`)
    if (!el) return
    if (mode === 'month') openDay(pendingAdd, el)
    else el.querySelector<HTMLInputElement>('.quick-add input')?.focus()
  }, [pendingAdd, mode])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
      if (document.querySelector('.popover')) return
      // Con una tarea con el foco o seleccionada, H, S, M y ←→ son suyas (src/keys.ts).
      if (e.key !== 'n' && hasTaskTarget()) return
      const handlers: Record<string, () => void> = {
        ArrowLeft: () => move(-1),
        ArrowRight: () => move(1),
        h: goToday,
        s: () => setMode('week'),
        m: () => setMode('month'),
        n: () => {
          goToday()
          setPendingAdd(today)
        },
      }
      const handler = handlers[e.key]
      if (!handler) return
      e.preventDefault()
      handler()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <main className="calendar">
      <header className="cal-header">
        <h2 className="cal-title">{mode === 'month' ? formatMonth(cursor) : formatWeek(startOfWeek(cursor))}</h2>
        <div className="cal-nav">
          <button
            type="button"
            className="icon-btn"
            aria-label={mode === 'month' ? 'Mes anterior' : 'Semana anterior'}
            title="Anterior (←)"
            onClick={() => move(-1)}
          >
            <Icon.ChevronLeft />
          </button>
          <button type="button" className="btn" title="Ir a hoy (H)" onClick={goToday}>
            Hoy
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={mode === 'month' ? 'Mes siguiente' : 'Semana siguiente'}
            title="Siguiente (→)"
            onClick={() => move(1)}
          >
            <Icon.Chevron />
          </button>
        </div>
        {mode === 'week' && (
          <button
            type="button"
            className="btn undated-toggle"
            aria-pressed={undatedOpen}
            aria-controls={undatedOpen ? 'sin-fecha' : undefined}
            title={undatedOpen ? 'Ocultar las tareas sin fecha' : 'Ver las tareas sin fecha para arrastrarlas a un día'}
            onClick={() => setUndatedOpen(!undatedOpen)}
          >
            <Icon.Sidebar />
            Sin fecha
          </button>
        )}
        <Segmented
          label="Vista del calendario"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'week', label: 'Semana', hint: 'S' },
            { value: 'month', label: 'Mes', hint: 'M' },
          ]}
        />
      </header>

      {columns.length === 0 ? (
        <div className="splash">
          <div>
            <h2>Aún no hay columnas</h2>
            <p>Las tareas del calendario se guardan en una columna del tablero.</p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                ui.setView('board')
                ui.newColumn()
              }}
            >
              Crear una columna
            </button>
          </div>
        </div>
      ) : mode === 'month' ? (
        <MonthView cursor={cursor} today={today} days={days} onOpenDay={openDay} onDrop={reschedule} />
      ) : (
        <div className="week-wrap">
          <WeekView
            cursor={cursor}
            today={today}
            days={days}
            target={target}
            onDrop={reschedule}
            reveal={`${todayTick}:${undatedOpen}`}
          />
          {undatedOpen && <UndatedPanel id="sin-fecha" />}
        </div>
      )}

      {dayPopover && (
        <DayPopover
          day={dayPopover.day}
          anchor={dayPopover.anchor}
          items={days.get(dayPopover.day) ?? []}
          target={target}
          onClose={() => setDayPopover(null)}
        />
      )}
    </main>
  )
}

interface Target {
  column: Column
  columns: Column[]
  onColumn: (columnId: string) => void
}

function MonthView({
  cursor,
  today,
  days,
  onOpenDay,
  onDrop,
}: {
  cursor: string
  today: string
  days: Map<string, DayItem[]>
  onOpenDay: (day: string, anchor: HTMLElement) => void
  onDrop: (taskId: string, day: string) => void
}) {
  const month = cursor.slice(0, 7)
  const weeks = useMemo(() => monthGrid(`${month}-01`), [month])
  const ref = useRef<HTMLDivElement>(null)
  const [capacity, setCapacity] = useState(3)

  // Cuántas tareas caben en cada día según el alto de la ventana.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const cell = el.querySelector<HTMLElement>('.day')
      if (cell) setCapacity(Math.max(1, Math.floor((cell.clientHeight - 32) / 21)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [weeks.length])

  return (
    <div ref={ref} className="month" style={{ '--weeks': weeks.length } as CSSProperties}>
      {weeks[0].map((day) => (
        <div key={`h-${day}`} className="month-weekday">
          {formatWeekday(day)}
        </div>
      ))}
      {weeks.flat().map((day) => (
        <DayCell
          key={day}
          day={day}
          outside={!day.startsWith(month)}
          isToday={day === today}
          items={days.get(day) ?? []}
          capacity={capacity}
          onOpen={onOpenDay}
          onDrop={onDrop}
        />
      ))}
    </div>
  )
}

function DayCell({
  day,
  outside,
  isToday,
  items,
  capacity,
  onOpen,
  onDrop,
}: {
  day: string
  outside: boolean
  isToday: boolean
  items: DayItem[]
  capacity: number
  onOpen: (day: string, anchor: HTMLElement) => void
  onDrop: (taskId: string, day: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { over, handlers } = useDropTarget((id) => onDrop(id, day))
  const visible = items.length > capacity ? items.slice(0, Math.max(0, capacity - 1)) : items
  const hidden = items.length - visible.length
  const date = fromISODate(day)
  const open = () => ref.current && onOpen(day, ref.current)

  return (
    <div
      ref={ref}
      data-day={day}
      data-task-list
      className={cx('day', outside && 'is-outside', isToday && 'is-today', isWeekend(day) && 'is-weekend', over && 'is-over')}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('.cal-chip, .day-more, .day-number')) open()
      }}
      {...handlers}
    >
      <div className="day-head">
        <button type="button" className="day-number" aria-label={formatLongDate(day)} onClick={open}>
          {date.getDate() === 1 ? `1 ${formatMonthShort(day)}` : date.getDate()}
        </button>
      </div>
      <div className="day-items">
        {visible.map((item) => (
          <CalendarChip key={item.task.id} item={item} />
        ))}
        {hidden > 0 && (
          <button type="button" className="day-more" onClick={open}>
            {hidden} más
          </button>
        )}
      </div>
    </div>
  )
}

/** Tarea en el mes: con hora, punto de color; sin hora, barra de color (como Calendario de Apple). */
function CalendarChip({ item: { task, column } }: { item: DayItem }) {
  const ui = useUI()
  const selected = useSelected(task.id)
  const overdue = isOverdue(task, useNow())
  // Un enlace del título se ve como una marca (el texto, sin la URL).
  const link = findLinks(task.title)[0]
  const text = link ? withoutLinks(task.title) : task.title
  return (
    <button
      type="button"
      draggable
      className={cx(
        'cal-chip',
        !task.time && 'is-allday',
        task.done && 'is-done',
        overdue && 'is-overdue',
        ui.openTaskId === task.id && 'is-open',
        selected && 'is-selected',
      )}
      style={tint(column.color)}
      data-task-id={task.id}
      title={`${overdue ? 'Vencida · ' : ''}${task.time ? `${task.time} · ` : ''}${task.title} — ${column.name}`}
      onDragStart={startDrag(task.id)}
      onClick={(e) => ui.openTask(task.id, e.currentTarget)}
    >
      {overdue && <span className="sr-only">Vencida:</span>}
      {task.time && <span className="cal-dot" />}
      {task.time && <span className="cal-time">{task.time}</span>}
      {overdue && !task.time && <Icon.Alert />}
      {(text || !link) && <span className="cal-chip-title">{text || 'Sin título'}</span>}
      {link && <ChipLink link={link} />}
    </button>
  )
}

function WeekView({
  cursor,
  today,
  days,
  target,
  onDrop,
  reveal,
}: {
  cursor: string
  today: string
  days: Map<string, DayItem[]>
  target: Target | null
  onDrop: (taskId: string, day: string) => void
  /** Al cambiar (ir a hoy, abrir o cerrar «Sin fecha»), hoy vuelve a la vista. */
  reveal: string
}) {
  const start = startOfWeek(cursor)
  const week = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const ref = useRef<HTMLDivElement>(null)

  // Con poco ancho (p. ej. con «Sin fecha» abierto) los días se desplazan en horizontal: hoy, a la vista.
  useLayoutEffect(() => {
    const el = ref.current
    const day = el?.querySelector<HTMLElement>('.week-day.is-today')
    if (!el || !day) return
    const box = el.getBoundingClientRect()
    const rect = day.getBoundingClientRect()
    if (rect.right > box.right) el.scrollLeft += rect.right - box.right
    else if (rect.left < box.left) el.scrollLeft -= box.left - rect.left
  }, [start, reveal])

  return (
    <div ref={ref} className="week">
      {week.map((day) => (
        <WeekDay key={day} day={day} isToday={day === today} items={days.get(day) ?? []} target={target} onDrop={onDrop} />
      ))}
    </div>
  )
}

function WeekDay({
  day,
  isToday,
  items,
  target,
  onDrop,
}: {
  day: string
  isToday: boolean
  items: DayItem[]
  target: Target | null
  onDrop: (taskId: string, day: string) => void
}) {
  const { over, handlers } = useDropTarget((id) => onDrop(id, day))
  return (
    <section
      data-day={day}
      data-task-list
      aria-label={formatLongDate(day)}
      className={cx('week-day', isToday && 'is-today', isWeekend(day) && 'is-weekend', over && 'is-over')}
      {...handlers}
    >
      <header className="week-day-head">
        <span className="week-day-name">{formatWeekday(day)}</span>
        <span className="week-day-number">{fromISODate(day).getDate()}</span>
      </header>
      <div className="week-day-body">
        {items.map((item) => (
          <AgendaRow key={item.task.id} item={item} />
        ))}
        {target && <CalendarQuickAdd day={day} {...target} />}
      </div>
    </section>
  )
}

function AgendaRow({ item: { task, column }, onOpen }: { item: DayItem; onOpen?: (anchor: HTMLElement) => void }) {
  const actions = useActions()
  const ui = useUI()
  const selected = useSelected(task.id)
  const overdue = isOverdue(task, useNow())
  const open = (anchor: HTMLElement) => (onOpen ? onOpen(anchor) : ui.openTask(task.id, anchor))
  return (
    <div
      className={cx('task', 'agenda-row', task.done && 'is-checked', ui.openTaskId === task.id && 'is-open', selected && 'is-selected')}
      style={tint(column.color)}
      data-task-id={task.id}
      {...taskRowA11y(task.title)}
      draggable
      tabIndex={0}
      onDragStart={startDrag(task.id)}
      onClick={(e) => open(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) {
          e.preventDefault()
          open(e.currentTarget)
        }
      }}
    >
      <CheckButton checked={task.done} title={task.title} onToggle={() => actions.setDone(task.id, !task.done)} />
      <div className="task-main">
        <div className="task-title">{task.title ? <Linkified text={task.title} /> : 'Sin título'}</div>
        <div className="agenda-meta">
          {/* Atrasada, como en el tablero y en Hoy: en rojo y con el icono de alerta. */}
          {(task.time || overdue) && (
            <span className={cx('agenda-time', overdue && 'is-overdue')} title={overdue ? 'Atrasada' : undefined}>
              {overdue ? <Icon.Alert /> : <Icon.Bell />}
              {overdue && <span className="sr-only">{task.time ? 'Vencida:' : 'Vencida'}</span>}
              {task.time}
            </span>
          )}
          <RepeatMark task={task} className="agenda-repeat" />
          <span className="agenda-column">
            <span className="cal-dot" />
            {column.name}
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * «Nueva tarea» para un día. Entiende lenguaje natural («Dentista 10:30 #salud cada mes»):
 * el día es siempre el de la celda; la hora, la #columna y la repetición sí se usan. ⌥↩: tal cual.
 */
function CalendarQuickAdd({ day, column, columns, onColumn, autoFocus = false }: Target & { day: string; autoFocus?: boolean }) {
  const parse = useParser()
  const addDrafts = useAddDrafts()
  const previewId = useId()
  const [value, setValue] = useState('')
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const parsed = useMemo(() => (value.trim() ? parse(value) : null), [parse, value])

  const add = (raw: boolean) => {
    const draft = draftFrom(value, { parsed: raw ? null : parsed, columnId: column.id, day })
    if (!draft) return
    addDrafts([draft], column.id)
    setValue('')
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\n')) return
    // Varias líneas pegadas = varias tareas para este día.
    e.preventDefault()
    const drafts = splitLines(text).map((line) => draftFrom(line, { parsed: parse(line), columnId: column.id, day }))
    addDrafts(
      drafts.filter((d): d is Draft => d !== null),
      column.id,
    )
  }

  return (
    <div className="quick-add cal-quick-add" style={tint(column.color)}>
      <button
        type="button"
        className="quick-add-target"
        aria-label={`Se añade a ${column.name}. Cambiar columna`}
        title={`Se añade a «${column.name}»`}
        aria-haspopup="menu"
        onClick={(e) => setMenu(menu ? null : e.currentTarget)}
      >
        <Icon.Plus />
      </button>
      <input
        value={value}
        data-autofocus={autoFocus || undefined}
        placeholder="Nueva tarea"
        aria-label={`Nueva tarea para el ${formatLongDate(day).toLowerCase()}`}
        aria-describedby={parsed ? previewId : undefined}
        onChange={(e) => setValue(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            add(e.altKey)
          } else if (e.key === 'Escape' && value) {
            e.stopPropagation()
            setValue('')
          } else if (e.key === 'Escape') {
            // Vacío: Esc sale del campo (como «Nueva tarea» del tablero) y vuelven los atajos.
            e.currentTarget.blur()
          }
        }}
      />
      {parsed && <ParsePreview id={previewId} parsed={parsed} day={day} />}
      {menu && (
        <Menu
          anchor={menu}
          label="Añadir a la columna"
          onClose={() => setMenu(null)}
          items={columns.map((c) => ({ label: c.name, hint: c.id === column.id ? '✓' : undefined, run: () => onColumn(c.id) }))}
        />
      )}
    </div>
  )
}

function DayPopover({
  day,
  anchor,
  items,
  target,
  onClose,
}: {
  day: string
  anchor: HTMLElement
  items: DayItem[]
  target: Target | null
  onClose: () => void
}) {
  const ui = useUI()
  return (
    <Popover anchor={anchor} placement="side" width={320} label={formatLongDate(day)} className="day-pop" onClose={onClose}>
      <h3>{formatLongDate(day)}</h3>
      {items.length > 0 ? (
        <div className="day-pop-list">
          {items.map((item) => (
            <AgendaRow
              key={item.task.id}
              item={item}
              onOpen={(el) => {
                ui.openTask(item.task.id, el)
                onClose()
              }}
            />
          ))}
        </div>
      ) : (
        <p className="day-pop-empty">Nada para este día.</p>
      )}
      {target && <CalendarQuickAdd day={day} {...target} autoFocus />}
    </Popover>
  )
}
