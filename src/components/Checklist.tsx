import { useState, type ClipboardEvent } from 'react'
import { addStep, steps, toggleStep } from '../checklist'
import { useActions } from '../context'
import type { Task } from '../model'
import { cx, splitLines } from '../util'
import * as Icon from './Icons'
import { Linkified } from './Links'
import '../styles/escribir.css'

/**
 * Pasos de una tarea (líneas «- [ ] paso» de las notas) como casillas, y un campo para
 * añadir más. Marcar un paso cambia esa línea de las notas, que siguen editables tal cual.
 */
export function Checklist({ task }: { task: Task }) {
  const actions = useActions()
  const [draft, setDraft] = useState('')
  const list = steps(task.notes)
  const setNotes = (notes: string) => actions.updateTask(task.id, { notes })

  const add = (texts: string[]) => {
    const notes = texts.reduce(addStep, task.notes)
    if (notes !== task.notes) setNotes(notes)
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\n')) return
    // Varias líneas pegadas = varios pasos.
    e.preventDefault()
    add(splitLines(text))
  }

  return (
    <div className="steps" role="group" aria-label="Pasos">
      {list.map((step) => (
        <label key={step.line} className={cx('step', step.done && 'is-done')}>
          <input type="checkbox" checked={step.done} onChange={() => setNotes(toggleStep(task.notes, step.line))} />
          <span className="step-text">
            <Linkified text={step.text} />
          </span>
        </label>
      ))}
      <div className="step-add">
        <Icon.Plus />
        <input
          value={draft}
          placeholder="Añadir paso"
          aria-label="Añadir paso"
          enterKeyHint="done"
          onChange={(e) => setDraft(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              add([draft])
              setDraft('')
            }
          }}
        />
      </div>
    </div>
  )
}

/** «2/5» en la fila de la tarea, si tiene pasos. */
export function StepsPill({ done, total }: { done: number; total: number }) {
  return (
    <span className="steps-pill" title={`${done} de ${total} pasos hechos`}>
      <Icon.Steps />
      <span className="sr-only">Pasos: </span>
      {done}/{total}
    </span>
  )
}
