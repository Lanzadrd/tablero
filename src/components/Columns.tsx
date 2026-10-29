// Piezas de columna del tablero: la franja de una columna contraída, la ayuda de la Bandeja vacía y
// el enlace «N archivadas» del final, con su panel para restaurarlas.
import type { DraggableProvidedDragHandleProps } from '@hello-pangea/dnd'
import { useState } from 'react'
import { collapsed } from '../collapsed'
import { useActions, useUI } from '../context'
import { openTasks, type Column } from '../model'
import { isSomeday } from '../today'
import { tint } from '../util'
import * as Icon from './Icons'
import { Popover } from './Popover'
import '../styles/proyectos.css'

/**
 * Pone el foco en algo de la columna en cuanto está en pantalla (al contraerla o expandirla). Espera
 * también a que el menú cerrado devuelva el foco a donde estaba, para no quedarse con él.
 */
export function focusColumn(columnId: string, selector: string) {
  requestAnimationFrame(() =>
    setTimeout(() =>
      document.querySelector<HTMLElement>(`[data-column-id="${CSS.escape(columnId)}"] ${selector}`)?.focus({ preventScroll: true }),
    ),
  )
}

/** Columna contraída: una franja con su color, el nombre en vertical y las pendientes. Clic: expandir. */
export function CollapsedStrip({
  column,
  count,
  handle,
}: {
  column: Column
  count: number
  handle: DraggableProvidedDragHandleProps | null | undefined
}) {
  const expand = () => {
    collapsed.set(column.id, false)
    focusColumn(column.id, '.column-handle')
  }
  return (
    <div
      {...handle}
      className="column-strip"
      title={`Expandir «${column.name}»`}
      aria-label={`${column.name}, ${count === 1 ? '1 pendiente' : `${count} pendientes`}. Contraída: Intro para expandir, espacio para mover`}
      onClick={expand}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) {
          e.preventDefault()
          expand()
        }
      }}
    >
      <span className="column-strip-dot" aria-hidden="true" />
      <span className="column-strip-name" aria-hidden="true">
        {column.name}
      </span>
      {count > 0 && (
        <span className="column-strip-count" aria-hidden="true">
          {count}
        </span>
      )}
    </div>
  )
}

/** La Bandeja vacía explica para qué sirve. */
export function InboxHint() {
  return (
    <p className="inbox-hint">
      Lo que dictes a Siri o captures con <kbd>⌥Espacio</kbd> llega aquí. Termina con <b>#columna</b> para enviarlo a su
      sitio.
    </p>
  )
}

const archivedLabel = (n: number) => (n === 1 ? '1 archivada' : `${n} archivadas`)

/** «N archivadas» al final del tablero: abre la lista para restaurarlas. */
export function ArchivedColumns({ columns }: { columns: Column[] }) {
  const actions = useActions()
  const ui = useUI()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  return (
    <>
      <button
        type="button"
        className="archived-link"
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        title="Columnas archivadas"
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        <Icon.Archive />
        {archivedLabel(columns.length)}
      </button>
      {anchor && (
        <Popover anchor={anchor} placement="below-start" width={320} label="Columnas archivadas" className="archived-pop" onClose={() => setAnchor(null)}>
          <h3>Columnas archivadas</h3>
          <ul className="archived-list">
            {columns.map((column) => {
              const open = openTasks(column).filter((t) => !isSomeday(t)).length
              return (
                <li key={column.id} className="archived-row" style={tint(column.color)}>
                  <span className="project-dot" aria-hidden="true" />
                  <span className="archived-text">
                    <span className="archived-name">{column.name}</span>
                    <span className="archived-count">{open === 0 ? 'Sin pendientes' : open === 1 ? '1 pendiente' : `${open} pendientes`}</span>
                  </span>
                  <button
                    type="button"
                    className="btn archived-restore"
                    aria-label={`Restaurar ${column.name}`}
                    onClick={() => {
                      actions.setColumnArchived(column.id, false)
                      ui.toast(`Columna «${column.name}» restaurada`, { undo: true })
                      if (columns.length === 1) setAnchor(null)
                    }}
                  >
                    Restaurar
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="archived-note">No salen en el tablero, en Hoy ni en el calendario. En Recordatorios su lista sigue.</p>
        </Popover>
      )}
    </>
  )
}
