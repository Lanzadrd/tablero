// Panel «Sin fecha» de la semana del calendario: las pendientes sin día, por columna, para
// arrastrarlas a un día. Soltar aquí una tarea con fecha se la quita.
import { useMemo } from 'react'
import { useActions, useBoard, useUI } from '../context'
import type { Task } from '../model'
import { useSelected } from '../selection'
import { undatedGroups } from '../today'
import { cx, tint } from '../util'
import { startDrag, useDropTarget } from './drag'
import { Linkified } from './Links'
import { CheckButton, taskRowA11y } from './TaskRow'
import '../styles/vistas.css'

export function UndatedPanel({ id }: { id?: string }) {
  const board = useBoard()
  const actions = useActions()
  const ui = useUI()
  const groups = useMemo(() => undatedGroups(board), [board])
  const total = groups.reduce((n, g) => n + g.items.length, 0)

  // Sin día no hay hora, avisos ni repetición (como al quitar la fecha en el detalle).
  const { over, handlers } = useDropTarget((taskId) => {
    const task = board.columns.flatMap((c) => c.tasks).find((t) => t.id === taskId)
    if (!task?.due) return
    actions.updateTask(taskId, { due: null, time: null, alerts: undefined, repeat: undefined })
    ui.toast('Fecha quitada', { undo: true })
  })

  return (
    <aside id={id} className={cx('undated', over && 'is-over')} aria-label="Tareas sin fecha" data-task-list {...handlers}>
      <header className="undated-head">
        <h3>Sin fecha</h3>
        {total > 0 && <span className="undated-count">{total}</span>}
      </header>
      <div className="undated-body">
        {groups.length === 0 ? (
          <p className="undated-empty">Todo tiene fecha.</p>
        ) : (
          <>
            <p className="undated-hint">Arrastra una tarea a un día.</p>
            {groups.map(({ column, items }) => (
              <section key={column.id} className="undated-group" style={tint(column.color)} aria-label={column.name}>
                <h4 className="undated-group-title">
                  <span className="cal-dot" />
                  {column.name}
                </h4>
                {items.map(({ task }) => (
                  <UndatedRow key={task.id} task={task} />
                ))}
              </section>
            ))}
          </>
        )}
      </div>
    </aside>
  )
}

function UndatedRow({ task }: { task: Task }) {
  const actions = useActions()
  const ui = useUI()
  const selected = useSelected(task.id)
  // ↩ y el resto de teclas sobre la fila con el foco: src/keys.ts.
  return (
    <div
      className={cx('task', 'undated-row', ui.openTaskId === task.id && 'is-open', selected && 'is-selected')}
      data-task-id={task.id}
      draggable
      tabIndex={0}
      {...taskRowA11y(task.title)}
      onDragStart={startDrag(task.id)}
      onClick={(e) => ui.openTask(task.id, e.currentTarget)}
    >
      <CheckButton checked={task.done} title={task.title} onToggle={() => actions.setDone(task.id, !task.done)} />
      <div className="task-main">
        <div className="task-title">{task.title ? <Linkified text={task.title} /> : 'Sin título'}</div>
      </div>
    </div>
  )
}
