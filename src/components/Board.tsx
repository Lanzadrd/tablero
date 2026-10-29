import {
  DragDropContext,
  Draggable,
  Droppable,
  type DraggableProvidedDragHandleProps,
  type DragStart,
  type DropResult,
} from '@hello-pangea/dnd'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type RefObject } from 'react'
import { collapsed, useCollapsed } from '../collapsed'
import { useActions, useBoard, useUI } from '../context'
import { COLORS, colorName, doneTasks, openTasks, type Column, type ColorKey, type Task } from '../model'
import { archiveDone } from '../projectApi'
import { useRevealed } from '../selection'
import { activeColumns, isSomeday, openIndexFor } from '../today'
import { cx, splitLines, tint } from '../util'
import { ArchivedColumns, CollapsedStrip, focusColumn, InboxHint } from './Columns'
import { DonePanel } from './DonePanel'
import * as Icon from './Icons'
import { draftFrom, ParsePreview, useAddDrafts, useParser, type Draft } from './NaturalAdd'
import { Menu, Popover, type MenuItem } from './Popover'
import { ProjectBar, useProjectActions } from './ProjectBar'
import { ProjectSheet } from './ProjectSheet'
import { SomedayGroup } from './Someday'
import { DraggableTask, TaskRow } from './TaskRow'

export function BoardView() {
  const board = useBoard()
  const actions = useActions()
  const ui = useUI()
  const [dragging, setDragging] = useState<string | null>(null)
  // Las archivadas no se ven: los índices del arrastre son los de las visibles.
  const columns = useMemo(() => activeColumns(board), [board])
  const archived = useMemo(() => board.columns.filter((c) => c.archived), [board])

  const onDragStart = (start: DragStart) => setDragging(start.type)
  const onDragEnd = ({ type, source, destination, draggableId }: DropResult) => {
    setDragging(null)
    if (!destination) return
    if (source.droppableId === destination.droppableId && source.index === destination.index) return
    if (type === 'COLUMN') {
      const target = columns[destination.index]
      if (target) actions.moveColumnTo(draggableId, target.id)
    }
    // La lista arrastrable no incluye las de «algún día»: su puesto se traduce al de todas las pendientes.
    else
      actions.moveTask(
        draggableId,
        destination.droppableId,
        openIndexFor(board, draggableId, destination.droppableId, destination.index),
      )
  }

  return (
    <DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <Droppable droppableId="board" type="COLUMN" direction="horizontal">
        {(provided) => (
          <main
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cx('board', dragging && `is-dragging-${dragging.toLowerCase()}`)}
          >
            {columns.map((column, index) => (
              <ColumnView
                key={column.id}
                column={column}
                index={index}
                leftId={columns[index - 1]?.id}
                rightId={columns[index + 1]?.id}
              />
            ))}
            {provided.placeholder}
            <div className="board-end">
              <button type="button" className="new-column" onClick={ui.newColumn} title="Nueva columna (⇧N)">
                <Icon.Plus />
                Nueva columna
              </button>
              {archived.length > 0 && <ArchivedColumns columns={archived} />}
            </div>
          </main>
        )}
      </Droppable>
    </DragDropContext>
  )
}

type Sheet = { kind: 'project' | 'done'; anchor: HTMLElement }

interface ColumnProps {
  column: Column
  index: number
  /** Las columnas visibles de al lado (para «Mover a la izquierda/derecha»). */
  leftId?: string
  rightId?: string
}

const ColumnView = memo(function ColumnView({ column, index, leftId, rightId }: ColumnProps) {
  const ui = useUI()
  const isCollapsed = useCollapsed(column.id)
  // Las de «algún día» salen de la lista (y del arrastre) y van a su grupo al pie.
  const open = useMemo(() => openTasks(column).filter((t) => !isSomeday(t)), [column])
  const someday = useMemo(() => openTasks(column).filter(isSomeday), [column])
  const done = useMemo(() => doneTasks(column), [column])
  // Ficha del proyecto y «Lo hecho», anclados al botón de opciones.
  const menuButton = useRef<HTMLButtonElement>(null)
  const sectionRef = useRef<HTMLElement | null>(null)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const openSheet = useCallback((kind: Sheet['kind']) => {
    const anchor = menuButton.current ?? sectionRef.current
    if (anchor) setSheet({ kind, anchor })
  }, [])
  const openProject = useCallback(() => openSheet('project'), [openSheet])

  // Si se busca una tarea de una columna contraída (búsqueda, enlace), se expande.
  const revealed = useRevealed()
  const wanted = isCollapsed && revealed !== null && column.tasks.some((t) => t.id === revealed)
  useEffect(() => {
    if (wanted) collapsed.set(column.id, false)
  }, [wanted, column.id])

  return (
    <Draggable draggableId={column.id} index={index}>
      {(provided, snapshot) => (
        <section
          ref={(el) => {
            provided.innerRef(el)
            sectionRef.current = el
          }}
          {...provided.draggableProps}
          className={cx(
            'column',
            isCollapsed && 'is-collapsed',
            column.inbox && 'is-inbox',
            snapshot.isDragging && !snapshot.isDropAnimating && 'is-lifted',
          )}
          style={{ ...provided.draggableProps.style, ...tint(column.color) }}
          data-column-id={column.id}
          data-task-list={isCollapsed ? undefined : true}
          aria-label={column.name}
        >
          {isCollapsed ? (
            <CollapsedStrip column={column} count={open.length} handle={provided.dragHandleProps} />
          ) : (
            <>
              <ColumnHeader
                column={column}
                count={open.length}
                index={index}
                leftId={leftId}
                rightId={rightId}
                handle={provided.dragHandleProps}
                menuButton={menuButton}
                onSheet={openSheet}
              />
              <ProjectBar column={column} onMissingFolder={openProject} />
              <Droppable droppableId={column.id} type="TASK">
                {(drop, dropSnapshot) => (
                  <div
                    ref={drop.innerRef}
                    {...drop.droppableProps}
                    className={cx('column-body', dropSnapshot.isDraggingOver && 'is-over')}
                    onClick={(e) => {
                      // Un clic en el hueco libre de la columna lleva a «Nueva tarea».
                      if (e.target === e.currentTarget) ui.focusQuickAdd(column.id)
                    }}
                  >
                    {open.map((task, i) => (
                      <DraggableTask key={task.id} task={task} index={i} />
                    ))}
                    {drop.placeholder}
                    <QuickAdd columnId={column.id} />
                    {column.inbox && open.length === 0 && someday.length === 0 && <InboxHint />}
                    {someday.length > 0 && <SomedayGroup column={column} tasks={someday} />}
                    {done.length > 0 && <Completed column={column} tasks={done} />}
                  </div>
                )}
              </Droppable>
            </>
          )}
          {sheet?.kind === 'project' && <ProjectSheet column={column} anchor={sheet.anchor} onClose={() => setSheet(null)} />}
          {sheet?.kind === 'done' && <DonePanel column={column} anchor={sheet.anchor} onClose={() => setSheet(null)} />}
        </section>
      )}
    </Draggable>
  )
})

function ColumnHeader({
  column,
  count,
  index,
  leftId,
  rightId,
  handle,
  menuButton,
  onSheet,
}: {
  column: Column
  count: number
  index: number
  leftId?: string
  rightId?: string
  handle: DraggableProvidedDragHandleProps | null | undefined
  menuButton: RefObject<HTMLButtonElement | null>
  onSheet: (kind: Sheet['kind']) => void
}) {
  const actions = useActions()
  const ui = useUI()
  const dotRef = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const [palette, setPalette] = useState<HTMLElement | null>(null)
  // «Archivar completadas» no se puede deshacer: se confirma antes.
  const [confirmArchive, setConfirmArchive] = useState<HTMLElement | null>(null)
  const openProject = useCallback(() => onSheet('project'), [onSheet])
  const project = useProjectActions(column, openProject)
  const renaming = ui.renamingColumnId === column.id
  const doneCount = column.tasks.filter((t) => t.done).length

  const archiveCompleted = async () => {
    // El servidor archiva lo que tiene guardado: primero se guarda lo pendiente.
    await ui.saveNow()
    const result = await archiveDone(column.id)
    if (!result.ok) return ui.toast(result.message)
    const n = result.data.archivadas
    ui.toast(
      n === 0
        ? 'No hay completadas que archivar'
        : `${n === 1 ? '1 archivada' : `${n} archivadas`} · No se puede deshacer; siguen en «Lo hecho»`,
    )
    ui.refresh()
  }

  const items: MenuItem[] = [
    { label: 'Nueva tarea', hint: index < 9 ? String(index + 1) : undefined, run: () => ui.focusQuickAdd(column.id) },
    { label: 'Renombrar', run: () => ui.setRenaming(column.id) },
    { label: 'Cambiar color…', run: () => setPalette(dotRef.current) },
    'separator',
    ...(column.inbox
      ? []
      : ([
          { label: 'Ficha del proyecto…', run: () => onSheet('project') },
          { label: 'Nueva sesión de Claude Code', run: () => void project.claude() },
        ] satisfies MenuItem[])),
    { label: 'Lo hecho…', run: () => onSheet('done') },
    'separator',
    { label: 'Mover a la izquierda', disabled: !leftId, run: () => leftId && actions.moveColumnTo(column.id, leftId) },
    { label: 'Mover a la derecha', disabled: !rightId, run: () => rightId && actions.moveColumnTo(column.id, rightId) },
    {
      label: 'Contraer',
      run: () => {
        collapsed.set(column.id, true)
        focusColumn(column.id, '.column-strip')
      },
    },
    'separator',
    {
      label: column.showCompleted ? 'Ocultar completadas' : 'Mostrar completadas',
      disabled: doneCount === 0,
      run: () => actions.toggleCompleted(column.id),
    },
    { label: 'Archivar completadas…', disabled: doneCount === 0, run: () => setConfirmArchive(menuButton.current) },
    ...(column.inbox
      ? []
      : ([
          'separator',
          {
            label: 'Archivar columna',
            run: () => {
              actions.setColumnArchived(column.id, true)
              ui.toast(`Columna «${column.name}» archivada`, { undo: true })
            },
          },
          {
            label: 'Eliminar columna',
            danger: true,
            run: () => {
              actions.deleteColumn(column.id)
              ui.toast(`Columna «${column.name}» eliminada`, { undo: true })
            },
          },
        ] satisfies MenuItem[])),
  ]

  return (
    <header className="column-header">
      <button
        ref={dotRef}
        type="button"
        className="dot"
        aria-label={`Color: ${colorName(column.color)}. Cambiar`}
        title="Cambiar color"
        onClick={(e) => setPalette(palette ? null : e.currentTarget)}
      />
      <div
        {...handle}
        className="column-handle"
        aria-label={`${column.name}, ${count} pendientes. Intro para renombrar, espacio para mover`}
        onClick={() => !renaming && ui.setRenaming(column.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target === e.currentTarget) {
            e.preventDefault()
            ui.setRenaming(column.id)
          }
        }}
      >
        {renaming ? <RenameInput column={column} /> : <h2 className="column-title">{column.name}</h2>}
        {!renaming && count > 0 && <span className="column-count">{count}</span>}
      </div>
      <button
        ref={menuButton}
        type="button"
        className="icon-btn"
        aria-label="Opciones de la columna"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        onClick={(e) => setMenu(menu ? null : e.currentTarget)}
      >
        <Icon.Ellipsis />
      </button>

      {menu && <Menu anchor={menu} label={`Opciones de ${column.name}`} onClose={() => setMenu(null)} items={items} />}
      {confirmArchive && (
        <Popover
          anchor={confirmArchive}
          placement="below-end"
          width={300}
          label="Archivar completadas"
          className="confirm-pop"
          onClose={() => setConfirmArchive(null)}
        >
          <p className="confirm-title">
            ¿Archivar {doneCount === 1 ? 'la completada' : `las ${doneCount} completadas`} de «{column.name}»?
          </p>
          <p className="confirm-note">
            {doneCount === 1
              ? 'Sale del tablero y no se puede deshacer. Sigue en «Lo hecho» y en la búsqueda.'
              : 'Salen del tablero y no se puede deshacer. Siguen en «Lo hecho» y en la búsqueda.'}
          </p>
          <div className="confirm-actions">
            <button type="button" className="btn" data-autofocus onClick={() => setConfirmArchive(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn is-accent"
              onClick={() => {
                setConfirmArchive(null)
                void archiveCompleted()
              }}
            >
              Archivar
            </button>
          </div>
        </Popover>
      )}
      {palette && (
        <ColorPicker
          anchor={palette}
          value={column.color}
          onChange={(color) => actions.setColumnColor(column.id, color)}
          onClose={() => setPalette(null)}
        />
      )}
    </header>
  )
}

function RenameInput({ column }: { column: Column }) {
  const actions = useActions()
  const ui = useUI()
  const [value, setValue] = useState(column.name)
  const finished = useRef(false)

  const finish = (save: boolean, thenAddTask = false) => {
    if (finished.current) return
    finished.current = true
    const name = value.trim()
    if (save && name && name !== column.name) actions.renameColumn(column.id, name)
    ui.setRenaming(null)
    if (thenAddTask) ui.focusQuickAdd(column.id)
  }

  return (
    <input
      className="column-title-input"
      value={value}
      autoFocus
      maxLength={60}
      aria-label="Nombre de la columna"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault()
          finish(true, true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finish(false)
        }
      }}
    />
  )
}

/** «Nueva tarea» de una columna. Entiende lenguaje natural (NaturalAdd.tsx); ⌥↩ añade el texto tal cual. */
function QuickAdd({ columnId }: { columnId: string }) {
  const { registerQuickAdd, setLastColumn } = useUI()
  const parse = useParser()
  const addDrafts = useAddDrafts()
  const previewId = useId()
  const [value, setValue] = useState('')
  const parsed = useMemo(() => (value.trim() ? parse(value) : null), [parse, value])
  const ref = useRef<HTMLInputElement>(null)
  const added = useRef(false)

  useEffect(() => {
    registerQuickAdd(columnId, ref.current)
    return () => registerQuickAdd(columnId, null)
  }, [columnId, registerQuickAdd])

  // Tras añadir, mantiene el campo a la vista para seguir escribiendo.
  useEffect(() => {
    if (!added.current) return
    added.current = false
    ref.current?.scrollIntoView({ block: 'nearest' })
  })

  const add = (drafts: Array<Draft | null>) => {
    const list = drafts.filter((d): d is Draft => d !== null)
    if (list.length === 0) return
    addDrafts(list, columnId)
    added.current = true
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\n')) return
    // Varias líneas pegadas = varias tareas, cada una interpretada.
    e.preventDefault()
    add(splitLines(text).map((line) => draftFrom(line, { parsed: parse(line), columnId })))
  }

  return (
    <div className="quick-add" onClick={() => ref.current?.focus()}>
      <span className="quick-add-icon">
        <Icon.Plus />
      </span>
      <input
        ref={ref}
        value={value}
        placeholder="Nueva tarea"
        aria-label="Nueva tarea"
        aria-describedby={parsed ? previewId : undefined}
        enterKeyHint="done"
        onFocus={() => setLastColumn(columnId)}
        onChange={(e) => setValue(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            // ⌥↩: tal cual, sin interpretar fechas, horas ni #columna.
            const draft = draftFrom(value, { parsed: e.altKey ? null : parsed, columnId })
            if (draft) {
              add([draft])
              setValue('')
            }
          } else if (e.key === 'Escape') {
            setValue('')
            e.currentTarget.blur()
          }
        }}
      />
      {value.trim() && <kbd className="quick-add-hint">↩</kbd>}
      {parsed && <ParsePreview id={previewId} parsed={parsed} />}
    </div>
  )
}

function Completed({ column, tasks }: { column: Column; tasks: Task[] }) {
  const actions = useActions()
  return (
    <div className="completed">
      <button
        type="button"
        className="completed-toggle"
        aria-expanded={column.showCompleted}
        onClick={() => actions.toggleCompleted(column.id)}
      >
        <Icon.Chevron />
        Completadas
        <span className="completed-count">{tasks.length}</span>
      </button>
      {column.showCompleted && tasks.map((task) => <TaskRow key={task.id} task={task} focusable />)}
    </div>
  )
}

function ColorPicker({
  anchor,
  value,
  onChange,
  onClose,
}: {
  anchor: HTMLElement
  value: ColorKey
  onChange: (color: ColorKey) => void
  onClose: () => void
}) {
  return (
    <Popover anchor={anchor} placement="below-start" label="Color de la columna" className="palette" onClose={onClose}>
      <div className="swatches" role="radiogroup" aria-label="Color">
        {COLORS.map((c) => (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={c.key === value}
            aria-label={c.name}
            title={c.name}
            className="swatch"
            style={tint(c.key)}
            onClick={() => {
              onChange(c.key)
              onClose()
            }}
          />
        ))}
      </div>
    </Popover>
  )
}
