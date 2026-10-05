// Vista «Hoy»: lo primero, lo atrasado y lo de hoy por columna; debajo, lo hecho hoy y la
// siguiente tarea de cada proyecto que no tiene nada para hoy.
import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type MouseEvent } from 'react'
import { progress } from '../checklist'
import { useActions, useBoard, useNow, useUI } from '../context'
import { addDays, dueState, formatDue, formatToday, todayISO } from '../dates'
import { revealQuickAdd } from '../keys'
import { useSelected } from '../selection'
import { activeColumns, todayData, type TodayItem } from '../today'
import { cx, splitLines, tint, useStoredState } from '../util'
import { StepsPill } from './Checklist'
import * as Icon from './Icons'
import { Linkified } from './Links'
import { draftFrom, ParsePreview, useAddDrafts, useParser, type Draft } from './NaturalAdd'
import { Menu } from './Popover'
import { CheckButton, RepeatMark, taskRowA11y, useCompletion } from './TaskRow'
import '../styles/vistas.css'

/** Nombre con el que «Nueva tarea para hoy» se registra en ui.registerQuickAdd (N, atajo del Dock). */
export const TODAY_ADD = 'hoy'

/** Más que esto para un día y sale el aviso de pasar algo a mañana. */
const TOO_MUCH = 6

export function TodayView() {
  const board = useBoard()
  const actions = useActions()
  const ui = useUI()
  const now = useNow()
  const today = todayISO(now)
  const data = useMemo(() => todayData(board, today), [board, today])
  const [showDone, setShowDone] = useStoredState('tablero.hoy.hechas', false)
  const [dismissed, setDismissed] = useStoredState<string | null>('tablero.hoy.aviso', null)
  const overdueId = useId()
  const nextId = useId()

  if (activeColumns(board).length === 0) {
    return (
      <main className="today">
        <div className="splash">
          <div>
            <h2>Aún no hay columnas</h2>
            <p>Las tareas se guardan en una columna del tablero.</p>
            <button type="button" className="btn" onClick={ui.newColumn}>
              Crear una columna
            </button>
          </div>
        </div>
      </main>
    )
  }

  const moveAll = () => {
    const ids = data.overdue.map((i) => i.task.id)
    actions.rescheduleMany(ids, today)
    ui.toast(ids.length === 1 ? '1 tarea pasada a hoy' : `${ids.length} tareas pasadas a hoy`, { undo: true })
  }
  const invite = !data.first

  return (
    <main className="today">
      <div className="today-page" data-task-list>
        <header className="today-head">
          <h2>Hoy</h2>
          <p>{formatToday(now)}</p>
        </header>

        {data.count > TOO_MUCH && dismissed !== today && (
          <div className="today-notice" role="status">
            <span>Mucho para un día: ¿pasas algo a mañana?</span>
            <button type="button" className="icon-btn" aria-label="Descartar el aviso" title="Descartar" onClick={() => setDismissed(today)}>
              <Icon.Close />
            </button>
          </div>
        )}

        {data.count > 0 && (
          <section className="today-first" aria-label="Lo primero">
            <h3 className="today-label">
              <Icon.Star />
              Lo primero
            </h3>
            {data.first ? (
              <TodayRow item={data.first} today={today} showDate={data.first.task.due !== today} showColumn />
            ) : (
              <p className="today-first-empty">
                Marca con <Icon.Star /> la tarea que harás antes que nada.
              </p>
            )}
          </section>
        )}

        {data.overdue.length > 0 && (
          <section className="today-section is-overdue" aria-labelledby={overdueId}>
            <header className="today-section-head">
              <h3 id={overdueId} className="today-label">
                Atrasadas
                <span className="today-count">{data.overdue.length}</span>
              </h3>
              <button type="button" className="link-btn" onClick={moveAll}>
                Pasar todas a hoy
              </button>
            </header>
            <div className="today-card">
              {data.overdue.map((item) => (
                <TodayRow key={item.task.id} item={item} today={today} showDate showColumn invite={invite} />
              ))}
            </div>
          </section>
        )}

        <section className="today-card today-main" aria-label="Para hoy">
          {data.groups.map(({ column, items }) => (
            <div key={column.id} className="today-group" style={tint(column.color)} role="group" aria-label={column.name}>
              <h3 className="today-group-title">
                <span className="cal-dot" />
                {column.name}
              </h3>
              {items.map((item) => (
                <TodayRow key={item.task.id} item={item} today={today} invite={invite} />
              ))}
            </div>
          ))}
          {data.count === 0 && <p className="today-empty">Nada pendiente para hoy.</p>}
          <TodayAdd today={today} />
        </section>

        {data.done.length > 0 && (
          <section className="today-done" aria-label="Hechas hoy">
            <button type="button" className="completed-toggle" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
              <Icon.Chevron />
              Hechas hoy
              <span className="completed-count">{data.done.length}</span>
            </button>
            {showDone && (
              <div className="today-card">
                {data.done.map((item) => (
                  <TodayRow key={item.task.id} item={item} today={today} showColumn />
                ))}
              </div>
            )}
          </section>
        )}

        {data.next.length > 0 && (
          <section className="today-section" aria-labelledby={nextId}>
            <h3 id={nextId} className="today-label">
              Siguiente en cada proyecto
            </h3>
            <div className="today-card">
              {data.next.map((item) => (
                <NextRow key={item.task.id} item={item} today={today} />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

// ↩, ⌫ y el resto de teclas sobre la fila con el foco (o bajo el ratón) las atiende src/keys.ts.

const stop = (e: MouseEvent) => e.stopPropagation()

function TodayRow({
  item: { task, column },
  today,
  showDate = false,
  showColumn = false,
  invite = false,
}: {
  item: TodayItem
  today: string
  /** Con el día (atrasadas); si no, solo la hora. */
  showDate?: boolean
  showColumn?: boolean
  /** Aún no hay «Lo primero»: la estrella se ve siempre, para invitar a elegir. */
  invite?: boolean
}) {
  const actions = useActions()
  const ui = useUI()
  const now = useNow()
  const selected = useSelected(task.id)
  const { checked, leaving, toggle } = useCompletion(task.id, task.done)
  const first = task.firstOn === today
  const steps = progress(task.notes)
  const state = task.due && !task.done ? dueState(task.due, task.time, now) : 'upcoming'
  const when = task.due && showDate ? formatDue(task.due, task.time, now) : task.time

  const later = () => {
    actions.updateTask(task.id, first ? { due: addDays(today, 1), firstOn: undefined } : { due: addDays(today, 1) })
    ui.toast('Pasada a mañana', { undo: true })
  }

  return (
    <div className={cx('task-collapse', leaving && 'is-leaving')}>
      <div className="task-clip">
        <div
          className={cx(
            'task',
            'today-row',
            checked && 'is-checked',
            invite && 'is-inviting',
            ui.openTaskId === task.id && 'is-open',
            selected && 'is-selected',
          )}
          style={tint(column.color)}
          data-task-id={task.id}
          tabIndex={0}
          {...taskRowA11y(task.title)}
          onClick={(e) => ui.openTask(task.id, e.currentTarget)}
        >
          <CheckButton checked={checked} title={task.title} onToggle={toggle} />
          <div className="task-main">
            <div className="task-title">{task.title ? <Linkified text={task.title} /> : 'Sin título'}</div>
            {(when || task.repeat || steps || showColumn) && (
              <div className="today-meta">
                {when && (
                  <span className={cx('today-when', `is-${state}`)}>
                    {state === 'overdue' ? <Icon.Alert /> : task.time ? <Icon.Bell /> : <Icon.Calendar />}
                    {state === 'overdue' && <span className="sr-only">Vencida:</span>}
                    {when}
                  </span>
                )}
                <RepeatMark task={task} className="agenda-repeat" />
                {steps && <StepsPill {...steps} />}
                {showColumn && (
                  <span className="agenda-column">
                    <span className="cal-dot" />
                    {column.name}
                  </span>
                )}
              </div>
            )}
          </div>
          {!task.done && (
            <div className="today-actions" onClick={stop}>
              <button
                type="button"
                className="today-action is-text"
                aria-label={`Pasar «${task.title}» a mañana`}
                title="Pasar a mañana"
                onClick={later}
              >
                Mañana
              </button>
              <button
                type="button"
                className="today-action is-star"
                aria-pressed={first}
                aria-label={`Lo primero del día: ${task.title}`}
                title={first ? 'Quitar de «Lo primero»' : 'Lo primero del día'}
                onClick={() => actions.setFirst(first ? null : task.id, today)}
              >
                <Icon.Star />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** La siguiente de un proyecto sin nada para hoy, con «Para hoy». */
function NextRow({ item: { task, column }, today }: { item: TodayItem; today: string }) {
  const actions = useActions()
  const ui = useUI()
  const selected = useSelected(task.id)
  return (
    <div
      className={cx('task', 'today-row', ui.openTaskId === task.id && 'is-open', selected && 'is-selected')}
      style={tint(column.color)}
      data-task-id={task.id}
      tabIndex={0}
      {...taskRowA11y(task.title)}
      onClick={(e) => ui.openTask(task.id, e.currentTarget)}
    >
      <CheckButton checked={task.done} title={task.title} onToggle={() => actions.setDone(task.id, !task.done)} />
      <div className="task-main">
        <div className="task-title">{task.title ? <Linkified text={task.title} /> : 'Sin título'}</div>
        <div className="today-meta">
          <span className="agenda-column">
            <span className="cal-dot" />
            {column.name}
          </span>
        </div>
      </div>
      <div className="today-actions is-shown" onClick={stop}>
        <button
          type="button"
          className="today-action is-text"
          aria-label={`Pasar «${task.title}» a hoy`}
          onClick={() => actions.rescheduleMany([task.id], today)}
        >
          Para hoy
        </button>
      </div>
    </div>
  )
}

/**
 * «Nueva tarea para hoy». Entiende lenguaje natural (NaturalAdd.tsx): sin fecha escrita es para
 * hoy. Va a la columna elegida aquí la última vez, si no a la Bandeja. ⌥↩: tal cual.
 */
function TodayAdd({ today }: { today: string }) {
  const board = useBoard()
  const { registerQuickAdd } = useUI()
  const parse = useParser()
  const addDrafts = useAddDrafts()
  const previewId = useId()
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const [stored, setStored] = useStoredState<string | null>('tablero.hoy.columna', null)
  const parsed = useMemo(() => (value.trim() ? parse(value) : null), [parse, value])
  const columns = activeColumns(board)
  const column = columns.find((c) => c.id === stored) ?? columns.find((c) => c.inbox) ?? columns[0]
  // «#columna» escrita manda sobre la elegida: el selector enseña adónde irá de verdad.
  const tagged = parsed?.columnId ? columns.find((c) => c.id === parsed.columnId) : undefined
  const added = useRef(false)

  useEffect(() => {
    registerQuickAdd(TODAY_ADD, ref.current)
    return () => registerQuickAdd(TODAY_ADD, null)
  }, [registerQuickAdd])

  // La vista previa (debajo del campo) tiene que verse mientras se escribe; y tras añadir, el campo
  // sigue a la vista, por encima de la zona de los avisos (scroll-margin en vistas.css).
  const previewing = parsed !== null
  useEffect(() => {
    if (previewing && ref.current && document.activeElement === ref.current) revealQuickAdd(ref.current)
  }, [previewing])
  useEffect(() => {
    if (!added.current) return
    added.current = false
    if (ref.current) revealQuickAdd(ref.current)
  })

  if (!column) return null

  const toDraft = (text: string, raw: boolean): Draft | null => {
    const draft = draftFrom(text, { parsed: raw ? null : parse(text), columnId: column.id })
    if (draft && !draft.extra.due && !draft.extra.someday) draft.extra.due = today
    return draft
  }

  const add = (drafts: Array<Draft | null>) => {
    const list = drafts.filter((d): d is Draft => d !== null)
    if (list.length) {
      addDrafts(list, column.id)
      added.current = true
    }
    return list.length > 0
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\n')) return
    // Varias líneas pegadas = varias tareas para hoy, cada una interpretada.
    e.preventDefault()
    add(splitLines(text).map((line) => toDraft(line, false)))
  }

  return (
    <div className="quick-add today-add" style={tint(column.color)} onClick={() => ref.current?.focus()}>
      <span className="quick-add-icon">
        <Icon.Plus />
      </span>
      <input
        ref={ref}
        value={value}
        placeholder="Nueva tarea para hoy"
        aria-label="Nueva tarea para hoy"
        aria-describedby={parsed ? previewId : undefined}
        enterKeyHint="done"
        onChange={(e) => setValue(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            if (add([toDraft(value, e.altKey)])) setValue('')
          } else if (e.key === 'Escape') {
            setValue('')
            e.currentTarget.blur()
          }
        }}
      />
      <button
        type="button"
        className={cx('today-add-target', tagged && 'is-tagged')}
        style={tagged ? tint(tagged.color) : undefined}
        aria-label={
          tagged
            ? `Se añade a ${tagged.name}, por la #columna escrita. Cambiar la columna por omisión (${column.name})`
            : `Se añade a ${column.name}. Cambiar columna`
        }
        title={tagged ? `Va a «${tagged.name}» por la #columna escrita` : 'Columna de las tareas nuevas'}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        onClick={(e) => {
          e.stopPropagation()
          setMenu(menu ? null : e.currentTarget)
        }}
      >
        <span className="cal-dot" />
        <span className="today-add-name">{(tagged ?? column).name}</span>
        <Icon.Chevron />
      </button>
      {parsed && <ParsePreview id={previewId} parsed={parsed} />}
      {menu && (
        <Menu
          anchor={menu}
          label="Añadir a la columna"
          onClose={() => setMenu(null)}
          items={columns.map((c) => ({ label: c.name, hint: c.id === column.id ? '✓' : undefined, run: () => setStored(c.id) }))}
        />
      )}
    </div>
  )
}
