import { useEffect, useState } from 'react'
import type { RepeatEvery } from '../../server/recurrencia.mjs'
import { useActions } from '../context'
import type { Repeat, Task } from '../model'
import { REPEAT_OPTIONS, repeatLabel, repeatUnit } from '../repeat'
import * as Icon from './Icons'
import '../styles/escribir.css'

/** Fila «Repetir» del detalle: Nunca, o «Cada [n] [semanas]» y desde cuándo se cuenta. */
export function RepeatField({ task, today }: { task: Task; today: string }) {
  const actions = useActions()
  const repeat = task.repeat
  const n = repeat?.interval ?? 1

  const set = (next: Repeat | undefined, coalesce?: string) => {
    if (!next) return actions.updateTask(task.id, { repeat: undefined })
    const clean: Repeat = { every: next.every }
    if (next.interval && next.interval > 1) clean.interval = next.interval
    if (next.from === 'done') clean.from = 'done'
    const patch: Partial<Task> = { repeat: clean }
    // Repetir necesita un día: si no hay, desde hoy (y deja de ser «algún día»).
    if (!task.due) patch.due = today
    if (task.someday) patch.someday = undefined
    actions.updateTask(task.id, patch, coalesce)
  }

  return (
    <div className="field">
      <span className="field-label">
        <Icon.Repeat />
        Repetir
      </span>
      <div className="field-controls">
        {repeat && (
          <>
            <span className="repeat-every" aria-hidden="true">
              Cada
            </span>
            <IntervalInput value={n} onChange={(interval) => set({ ...repeat, interval }, `repeat:${task.id}`)} />
          </>
        )}
        <select
          className="input"
          value={repeat?.every ?? ''}
          aria-label={repeat ? `Repetir: ${repeatLabel(repeat)}` : 'Repetir'}
          onChange={(e) => set(e.target.value ? { ...repeat, every: e.target.value as RepeatEvery } : undefined)}
        >
          <option value="">Nunca</option>
          {REPEAT_OPTIONS.map((every) => (
            <option key={every} value={every}>
              {repeat ? repeatUnit(every, n) : repeatLabel({ every })}
            </option>
          ))}
        </select>
        {repeat && (
          <label className="repeat-from">
            <input
              type="checkbox"
              checked={repeat.from === 'done'}
              onChange={(e) => set({ ...repeat, from: e.target.checked ? 'done' : undefined })}
            />
            Contar desde que la completo
          </label>
        )}
      </div>
    </div>
  )
}

/** Cada cuántos (1–365). Mientras se escribe puede quedar vacío; al salir vuelve al valor bueno. */
function IntervalInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  return (
    <input
      type="number"
      className="input repeat-n"
      min={1}
      max={365}
      inputMode="numeric"
      value={draft}
      aria-label="Cada cuántos"
      onChange={(e) => {
        setDraft(e.target.value)
        const n = Number(e.target.value)
        if (Number.isInteger(n) && n >= 1 && n <= 365 && n !== value) onChange(n)
      }}
      onBlur={() => setDraft(String(value))}
    />
  )
}
