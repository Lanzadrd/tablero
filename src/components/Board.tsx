import {
  DragDropContext,
  Draggable,
  Droppable,
  type DraggableProvidedDragHandleProps,
  type DragStart,
  type DropResult,
} from '@hello-pangea/dnd'
import { memo, useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react'
import { useActions, useBoard, useUI } from '../context'
import { COLORS, colorName, doneTasks, openTasks, type Column, type ColorKey, type Task } from '../model'
import { cx, splitLines, tint } from '../util'
import * as Icon from './Icons'
import { Menu, Popover } from './Popover'
import { DraggableTask, TaskRow } from './TaskRow'

export function BoardView() {
  const board = useBoard()
  const actions = useActions()
  const ui = useUI()
  const [dragging, setDragging] = useState<string | null>(null)

  const onDragStart = (start: DragStart) => setDragging(start.type)
  const onDragEnd = ({ type, source, destination, draggableId }: DropResult) => {
    setDragging(null)
    if (!destination) return
    if (source.droppableId === destination.droppableId && source.index === destination.index) return
    if (type === 'COLUMN') actions.moveColumn(source.index, destination.index)
    else actions.moveTask(draggableId, destination.droppableId, destination.index)
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
            {board.columns.map((column, index) => (
              <ColumnView key={column.id} column={column} index={index} total={board.columns.length} />
            ))}
            {provided.placeholder}
            <button type="button" className="new-column" onClick={ui.newColumn} title="Nueva columna (⇧N)">
              <Icon.Plus />
              Nueva columna
            </button>
          </main>
        )}
      </Droppable>
    </DragDropContext>
  )
}

const ColumnView = memo(function ColumnView({ column, index, total }: { column: Column; index: number; total: number }) {
  const ui = useUI()
  const open = useMemo(() => openTasks(column), [column])
  const done = useMemo(() => doneTasks(column), [column])

  return (
    <Draggable draggableId={column.id} index={index}>
      {(provided, snapshot) => (
        <section
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={cx('column', snapshot.isDragging && !snapshot.isDropAnimating && 'is-lifted')}
          style={{ ...provided.draggableProps.style, ...tint(column.color) }}
          data-column-id={column.id}
          aria-label={column.name}
        >
          <ColumnHeader column={column} count={open.length} index={index} total={total} handle={provided.dragHandleProps} />
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
                {done.length > 0 && <Completed column={column} tasks={done} />}
              </div>
            )}
          </Droppable>
        </section>
      )}
    </Draggable>
  )
})

function ColumnHeader({
  column,
  count,
  index,
  total,
  handle,
}: {
  column: Column
  count: number
  index: number
  total: number
  handle: DraggableProvidedDragHandleProps | null | undefined
}) {
  const actions = useActions()
  const ui = useUI()
  const dotRef = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const [palette, setPalette] = useState<HTMLElement | null>(null)
  const renaming = ui.renamingColumnId === column.id
  const doneCount = column.tasks.length - count

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
        type="button"
        className="icon-btn"
        aria-label="Opciones de la columna"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        onClick={(e) => setMenu(menu ? null : e.currentTarget)}
      >
        <Icon.Ellipsis />
      </button>

      {menu && (
        <Menu
          anchor={menu}
          label={`Opciones de ${column.name}`}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Nueva tarea', hint: index < 9 ? String(index + 1) : undefined, run: () => ui.focusQuickAdd(column.id) },
            { label: 'Renombrar', run: () => ui.setRenaming(column.id) },
            { label: 'Cambiar color…', run: () => setPalette(dotRef.current) },
            'separator',
            { label: 'Mover a la izquierda', disabled: index === 0, run: () => actions.moveColumn(index, index - 1) },
            { label: 'Mover a la derecha', disabled: index === total - 1, run: () => actions.moveColumn(index, index + 1) },
            'separator',
            {
              label: column.showCompleted ? 'Ocultar completadas' : 'Mostrar completadas',
              disabled: doneCount === 0,
              run: () => actions.toggleCompleted(column.id),
            },
            {
              label: 'Borrar completadas',
              disabled: doneCount === 0,
              run: () => {
                actions.clearCompleted(column.id)
                ui.toast(doneCount === 1 ? '1 completada borrada' : `${doneCount} completadas borradas`, { undo: true })
              },
            },
            'separator',
            {
              label: 'Eliminar columna',
              danger: true,
              run: () => {
                actions.deleteColumn(column.id)
                ui.toast(`Columna «${column.name}» eliminada`, { undo: true })
              },
            },
          ]}
        />
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

function QuickAdd({ columnId }: { columnId: string }) {
  const actions = useActions()
  const { registerQuickAdd, setLastColumn } = useUI()
  const [value, setValue] = useState('')
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

  const add = (titles: string[]) => {
    if (titles.length === 0) return
    actions.addTasks(columnId, titles)
    added.current = true
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\n')) return
    // Varias líneas pegadas = varias tareas.
    e.preventDefault()
    add(splitLines(text))
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
        enterKeyHint="done"
        onFocus={() => setLastColumn(columnId)}
        onChange={(e) => setValue(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            const title = value.trim()
            if (title) {
              add([title])
              setValue('')
            }
          } else if (e.key === 'Escape') {
            setValue('')
            e.currentTarget.blur()
          }
        }}
      />
      {value.trim() && <kbd className="quick-add-hint">↩</kbd>}
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
