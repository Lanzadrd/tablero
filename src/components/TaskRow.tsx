import { Draggable } from '@hello-pangea/dnd'
import { memo, useEffect, useRef, useState, type MouseEvent } from 'react'
import { useActions, useNow, useUI } from '../context'
import { dueState, formatDue } from '../dates'
import { firstNoteLine, progress } from '../checklist'
import { onlyLink } from '../links'
import type { Task } from '../model'
import { repeatLabel } from '../repeat'
import { useSelected } from '../selection'
import { cx } from '../util'
import { StepsPill } from './Checklist'
import * as Icon from './Icons'
import { Linkified } from './Links'

/** Pausa entre marcar una tarea y que pase a «Completadas», para ver el gesto. */
const COMPLETE_DELAY = 650
const COLLAPSE_TIME = 260

/**
 * Lo que anuncia el lector de pantalla al llegar a una fila de tarea con el foco: «Comprar pan,
 * tarea». Grupo (y no botón): dentro van el círculo y otros botones.
 */
export const taskRowA11y = (title: string) =>
  ({ role: 'group', 'aria-roledescription': 'tarea', 'aria-label': title || 'Sin título' }) as const

/** ¿Las dos son solo el mismo enlace? (p. ej. título y notas iguales al llegar de Recordatorios) */
function sameLink(a: string, b: string) {
  const link = onlyLink(a)
  return link !== null && onlyLink(b)?.url === link.url
}

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
      <RepeatMark task={task} />
    </div>
  )
}

/** ↻ de una tarea que se repite. */
export function RepeatMark({ task, className = 'repeat-mark' }: { task: Task; className?: string }) {
  if (!task.repeat) return null
  const label = repeatLabel(task.repeat)
  return (
    <span className={className} title={`Se repite: ${label.toLowerCase()}`}>
      <Icon.Repeat />
      <span className="sr-only">, se repite: {label.toLowerCase()}</span>
    </span>
  )
}

/** Fecha (con ↻ si se repite) y pasos «2/5», en una línea. */
function TaskMeta({ task }: { task: Task }) {
  const steps = progress(task.notes)
  if (!task.due && !task.repeat && !steps) return null
  return (
    <div className="task-meta">
      <DueLabel task={task} />
      {!task.due && <RepeatMark task={task} />}
      {steps && <StepsPill {...steps} />}
    </div>
  )
}

/**
 * Completar con pausa (el círculo se marca, la fila se pliega y entonces se completa), en el
 * tablero y en Hoy. Si la fila desaparece antes (cambio de vista, pasa a otra sección…), la
 * tarea se completa igual, sin animación: el gesto nunca se pierde.
 */
export function useCompletion(taskId: string, done: boolean) {
  const actions = useActions()
  const [pending, setPending] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  // La completada en espera, para aplicarla ya si la fila se desmonta durante la pausa.
  const waiting = useRef<(() => void) | null>(null)

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout)
      waiting.current?.()
    },
    [],
  )

  const toggle = () => {
    if (done) return actions.setDone(taskId, false)
    timers.current.forEach(clearTimeout)
    timers.current = []
    if (pending) {
      // Segundo clic durante la pausa: se arrepiente.
      waiting.current = null
      setPending(false)
      setLeaving(false)
      return
    }
    const finish = () => {
      waiting.current = null
      actions.setDone(taskId, true)
    }
    waiting.current = finish
    setPending(true)
    timers.current.push(setTimeout(() => setLeaving(true), COMPLETE_DELAY), setTimeout(finish, COMPLETE_DELAY + COLLAPSE_TIME))
  }
  return { checked: done || pending, leaving, toggle }
}

// ↩, ⌫ y el resto de teclas sobre la tarea con el foco las atiende src/keys.ts (data-task-id).

export function TaskRow({ task, lifted = false, focusable = false }: { task: Task; lifted?: boolean; focusable?: boolean }) {
  const ui = useUI()
  const selected = useSelected(task.id)
  const { checked, leaving, toggle } = useCompletion(task.id, task.done)
  const [isNew] = useState(() => Date.now() - Date.parse(task.createdAt) < 1500)

  // Vista previa de las notas: la primera línea que no es un paso (los pasos van en «2/5»). Si es
  // el mismo enlace que ya es el título, no se repite.
  const firstLine = firstNoteLine(task.notes)
  const notesLine = sameLink(task.title, firstLine) ? '' : firstLine

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
            selected && 'is-selected',
          )}
          data-task-id={focusable ? task.id : undefined}
          tabIndex={focusable ? 0 : undefined}
          {...(focusable ? taskRowA11y(task.title) : {})}
          onClick={(e) => ui.openTask(task.id, e.currentTarget)}
        >
          <CheckButton checked={checked} title={task.title} onToggle={toggle} />
          <div className="task-main">
            <div className="task-title">{task.title ? <Linkified text={task.title} /> : 'Sin título'}</div>
            {notesLine && (
              <div className="task-notes">
                <Linkified text={notesLine} />
              </div>
            )}
            <TaskMeta task={task} />
          </div>
        </div>
      </div>
    </div>
  )
}

export const DraggableTask = memo(function DraggableTask({ task, index }: { task: Task; index: number }) {
  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className="task-wrap"
          aria-label={task.title}
          data-task-id={task.id}
        >
          <TaskRow task={task} lifted={snapshot.isDragging && !snapshot.isDropAnimating} />
        </div>
      )}
    </Draggable>
  )
})
