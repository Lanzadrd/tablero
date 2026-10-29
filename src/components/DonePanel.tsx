// «Lo hecho»: las completadas de una columna por periodo, juntando las del tablero y las archivadas,
// con «Copiar» en texto plano («• Tarea — 3 oct») para mandarlo al cliente o ponerlo en la factura.
import { useEffect, useId, useMemo, useState } from 'react'
import { useNow, useUI } from '../context'
import { todayISO } from '../dates'
import type { Column } from '../model'
import { archivedOf } from '../projectApi'
import { DONE_PERIODS, doneItems, doneText, inPeriod, isDonePeriod, shortDate, type ArchivedLike, type DonePeriod } from '../projects'
import { cx, tint, useStoredState } from '../util'
import * as Icon from './Icons'
import { Popover } from './Popover'
import { copyText } from './TaskSheet'
import '../styles/proyectos.css'

const tasksLabel = (n: number) => (n === 1 ? '1 tarea' : `${n} tareas`)

export function DonePanel({ column, anchor, onClose }: { column: Column; anchor: HTMLElement; onClose: () => void }) {
  const ui = useUI()
  const today = todayISO(useNow())
  const titleId = useId()
  const [stored, setPeriod] = useStoredState<DonePeriod>('tablero.lo-hecho.periodo', 'week')
  const period = isDonePeriod(stored) ? stored : 'week'
  const [archive, setArchive] = useState<ArchivedLike[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    void archivedOf(column.id, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (result.ok) setArchive(result.data.tareas ?? [])
      else setFailed(true)
    })
    return () => controller.abort()
  }, [column.id])

  const all = useMemo(() => doneItems(column.tasks, archive ?? []), [column.tasks, archive])
  const items = useMemo(() => inPeriod(all, period, today), [all, period, today])

  const copy = async () => {
    const ok = await copyText(doneText(items, today))
    ui.toast(ok ? `Copiado: ${tasksLabel(items.length)}` : 'No se ha podido copiar')
  }

  return (
    <Popover
      anchor={anchor}
      placement="below-end"
      width={380}
      label={`Lo hecho en ${column.name}`}
      className="done-panel"
      style={tint(column.color)}
      onClose={onClose}
    >
      <header className="done-head">
        <h3 id={titleId}>
          Lo hecho <span className="done-column">· {column.name}</span>
        </h3>
      </header>

      <div className="done-periods" role="group" aria-label="Periodo">
        {DONE_PERIODS.map((p) => (
          <button
            key={p.value}
            type="button"
            className={cx('chip', p.value === period && 'is-active')}
            aria-pressed={p.value === period}
            onClick={() => setPeriod(p.value)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="done-empty">{archive === null && !failed ? 'Buscando…' : 'Nada completado en este periodo.'}</p>
      ) : (
        <ul className="done-list" aria-labelledby={titleId}>
          {items.map((item) => (
            <li key={item.id} className="done-item">
              <Icon.Check />
              <span className="done-title">{item.title.trim() || 'Sin título'}</span>
              {item.day && <span className="done-day">{shortDate(item.day, today)}</span>}
            </li>
          ))}
        </ul>
      )}

      <footer className="done-foot">
        <span className="done-status" role="status">
          {failed
            ? 'Sin las archivadas: no se ha podido leer el archivo'
            : archive === null
              ? 'Mirando también en el archivo…'
              : tasksLabel(items.length)}
        </span>
        <button type="button" className="btn" disabled={items.length === 0} onClick={() => void copy()}>
          <Icon.Copy />
          Copiar
        </button>
      </footer>
    </Popover>
  )
}
