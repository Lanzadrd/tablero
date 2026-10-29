import { useEffect } from 'react'
import type { Column, Task } from '../model'
import { useRevealed } from '../selection'
import { useStoredState } from '../util'
import * as Icon from './Icons'
import { TaskRow } from './TaskRow'
import '../styles/vistas.css'

/** «Algún día» al pie de una columna, plegado por defecto (se recuerda en este navegador). */
export function SomedayGroup({ column, tasks }: { column: Column; tasks: Task[] }) {
  const [open, setOpen] = useStoredState(`tablero.algun-dia.${column.id}`, false)
  // Una recién escrita («… algún día») se abre para que no parezca que ha desaparecido.
  const fresh = tasks.some((t) => Date.now() - Date.parse(t.createdAt) < 1500)
  // También si se busca una de aquí (búsqueda, enlace a la tarea).
  const revealed = useRevealed()
  const wanted = revealed !== null && tasks.some((t) => t.id === revealed)
  useEffect(() => {
    if (fresh || wanted) setOpen(true)
  }, [fresh, wanted, setOpen])

  return (
    <div className="completed someday">
      <button type="button" className="completed-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon.Chevron />
        Algún día
        <span className="completed-count">{tasks.length}</span>
      </button>
      {open && tasks.map((task) => <TaskRow key={task.id} task={task} focusable />)}
    </div>
  )
}
