import { Draggable } from '@hello-pangea/dnd'
import { memo, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useActions, useNow, useUI } from '../context'
import { dueState, formatDue } from '../dates'
import type { Task } from '../model'
import { cx } from '../util'
import * as Icon from './Icons'

/** Pausa entre marcar una tarea y que pase a «Completadas», para ver el gesto. */
const COMPLETE_DELAY = 650
const COLLAPSE_TIME = 260

export function CheckButton({ checked, title, onToggle }: { checked: boolean; title: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? `Marcar «${title}» como pendiente` : `Completar «${title}»`}
      className="check"
      onClick={(e: MouseEvent) => {
        e.stopPropagation()
        onToggle()
      }}
    />
  )
}

function DueLabel({ task }: { task: Task }) {
  const now = useNow()
  if (!task.due) return null
  const state = task.done ? 'upcoming' : dueState(task.due, task.time, now)
  const Glyph = state === 'overdue' ? Icon.Alert : task.time ? Icon.Bell : Icon.Calendar
  return (
    <div className={cx('due', `is-${state}`)}>
      <Glyph />
      {state === 'overdue' && <span className="sr-only">Vencida:</span>}
      {formatDue(task.due, task.time, now)}
    </div>
  )
}

/** Enter abre la tarea; ⌫ la elimina. */
function useTaskKeys(task: Task) {
  const actions = useActions()
  const ui = useUI()
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter') {
      e.preventDefault()
      ui.openTask(task.id, e.currentTarget)
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault()
      actions.deleteTask(task.id)
      ui.toast('Tarea eliminada', { undo: true })
    }
  }
}

export function TaskRow({ task, lifted = false, focusable = false }: { task: Task; lifted?: boolean; focusable?: boolean }) {
  const actions = useActions()
  const ui = useUI()
  const onKeyDown = useTaskKeys(task)
  const [pending, setPending] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [isNew] = useState(() => Date.now() - Date.parse(task.createdAt) < 1500)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const toggle = () => {
    if (task.done) return actions.setDone(task.id, false)
    timers.current.forEach(clearTimeout)
    timers.current = []
    if (pending) {
      // Segundo clic durante la pausa: se arrepiente.
      setPending(false)
      setLeaving(false)
      return
    }
    setPending(true)
    timers.current.push(
      setTimeout(() => setLeaving(true), COMPLETE_DELAY),
      setTimeout(() => actions.setDone(task.id, true), COMPLETE_DELAY + COLLAPSE_TIME),
    )
  }

  const checked = task.done || pending

  return (
    <div className={cx('task-collapse', leaving && 'is-leaving')}>
      <div className="task-clip">
        <div
          className={cx(
            'task',
            checked && 'is-checked',
            lifted && 'is-lifted',
            isNew && 'is-new',
            ui.openTaskId === task.id && 'is-open',
          )}
          tabIndex={focusable ? 0 : undefined}
          onKeyDown={focusable ? onKeyDown : undefined}
          onClick={(e) => ui.openTask(task.id, e.currentTarget)}
        >
          <CheckButton checked={checked} title={task.title} onToggle={toggle} />
          <div className="task-main">
            <div className="task-title">{task.title || 'Sin título'}</div>
            {task.notes && <div className="task-notes">{task.notes.split('\n', 1)[0]}</div>}
            <DueLabel task={task} />
          </div>
        </div>
      </div>
    </div>
  )
}

export const DraggableTask = memo(function DraggableTask({ task, index }: { task: Task; index: number }) {
  const onKeyDown = useTaskKeys(task)
  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className="task-wrap"
          aria-label={task.title}
          onKeyDown={onKeyDown}
        >
          <TaskRow task={task} lifted={snapshot.isDragging && !snapshot.isDropAnimating} />
        </div>
      )}
    </Draggable>
  )
})
