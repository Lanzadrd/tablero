// Con dos o más tareas seleccionadas, una barra flotante abajo, al estilo de Apple:
// «3 seleccionadas · Hoy · Mañana · Mover a… · Completar · Eliminar».
import { useMemo, useState } from 'react'
import type { TaskCommands } from '../commands'
import { useBoard } from '../context'
import { findTask } from '../model'
import { selection, useSelection } from '../selection'
import { activeColumns } from '../today'
import * as Icon from './Icons'
import { Menu } from './Popover'
import '../styles/teclado.css'

export function SelectionBar({ commands }: { commands: TaskCommands }) {
  const board = useBoard()
  const selected = useSelection()
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const tasks = useMemo(() => [...selected].flatMap((id) => findTask(board, id) ?? []), [board, selected])
  if (tasks.length < 2) return null

  const ids = tasks.map((f) => f.task.id)
  const allDone = tasks.every((f) => f.task.done)

  return (
    <div className="selection-bar" role="toolbar" aria-label="Tareas seleccionadas">
      <span className="selection-count" role="status">
        {tasks.length} seleccionadas
      </span>
      <span className="selection-sep" aria-hidden="true" />
      <button type="button" title="Para hoy (H)" onClick={() => commands.schedule(ids, 'today')}>
        Hoy
      </button>
      <button type="button" title="Para mañana (M)" onClick={() => commands.schedule(ids, 'tomorrow')}>
        Mañana
      </button>
      <button
        type="button"
        title="Mover a otra columna (⌥1–9)"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        onClick={(e) => setMenu(menu ? null : e.currentTarget)}
      >
        Mover a…
      </button>
      <button
        type="button"
        title={allDone ? 'Marcar como pendientes (X)' : 'Completar (X)'}
        onClick={() => {
          commands.complete(ids)
          selection.clear()
        }}
      >
        {allDone ? 'Pendientes' : 'Completar'}
      </button>
      <button
        type="button"
        className="is-danger"
        title="Eliminar (⌫)"
        onClick={() => {
          commands.remove(ids)
          selection.clear()
        }}
      >
        Eliminar
      </button>
      <button type="button" className="selection-close" aria-label="Soltar la selección" title="Soltar la selección (Esc)" onClick={selection.clear}>
        <Icon.Close />
      </button>
      {menu && (
        <Menu
          anchor={menu}
          label="Mover a la columna"
          onClose={() => setMenu(null)}
          items={activeColumns(board).map((c, i) => ({
            label: c.name,
            hint: i < 9 ? `⌥${i + 1}` : undefined,
            run: () => commands.moveTo(ids, c.id),
          }))}
        />
      )}
    </div>
  )
}
