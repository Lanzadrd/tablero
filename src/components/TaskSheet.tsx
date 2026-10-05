import { useEffect, useRef, useState } from 'react'
import { alertLabel, alertsOf, DAY_ALERT_OPTIONS, TIMED_ALERT_OPTIONS } from '../alerts'
import { progress, withBody, withoutSteps } from '../checklist'
import { useActions, useBoard, useNow, useUI } from '../context'
import { addDays, formatWhen, nextMonday, todayISO } from '../dates'
import { findLinks } from '../links'
import { findTask, type Task } from '../model'
import { openClaude } from '../projectApi'
import { isSomeday } from '../today'
import { cx, tint } from '../util'
import { Checklist } from './Checklist'
import * as Icon from './Icons'
import { LinkRow } from './Links'
import { Menu, Popover } from './Popover'
import { RepeatField } from './RepeatField'
import { Switch } from './Switch'
import { CheckButton } from './TaskRow'
import '../styles/proyectos.css'

/** Panel de detalle de una tarea. Todo se guarda al momento. */
export function TaskSheet({ taskId, anchor, onClose }: { taskId: string; anchor: DOMRect; onClose: () => void }) {
  const board = useBoard()
  const actions = useActions()
  const ui = useUI()
  const now = useNow()
  const found = findTask(board, taskId)
  const originalTitle = useRef(found?.task.title ?? '')
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const [alertMenu, setAlertMenu] = useState<HTMLElement | null>(null)
  const [rawNotes, setRawNotes] = useState(false)

  // Si la tarea desaparece (deshacer, otra ventana…), se cierra.
  useEffect(() => {
    if (!found) onClose()
  }, [found, onClose])

  useEffect(() => {
    const el = titleRef.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  if (!found) return null
  const { task, column } = found
  const hasSteps = progress(task.notes) !== null
  const asSteps = hasSteps && !rawNotes

  const today = todayISO(now)
  // En domingo, «Próx. semana» sería mañana: se queda solo «Mañana».
  const quickDates = [
    { label: 'Hoy', value: today },
    { label: 'Mañana', value: addDays(today, 1) },
    { label: 'Próx. semana', value: nextMonday(now) },
  ].filter((d, i, all) => all.findIndex((other) => other.value === d.value) === i)

  const update = (patch: Partial<Task>) => actions.updateTask(task.id, patch)
  // Sin día no hay repetición (como en Recordatorios). Con día deja de ser «algún día».
  const setDue = (due: string | null) =>
    update(
      due
        ? { due, ...(task.someday ? { someday: undefined } : {}) }
        : { due: null, time: null, alerts: undefined, ...(task.repeat ? { repeat: undefined } : {}) },
    )
  const someday = isSomeday(task)
  // Los avisos de una tarea con hora y los de una de día se miden distinto: al cambiar de una a otra, vuelven a los de por defecto.
  const setTime = (time: string | null) =>
    update(Boolean(time) !== Boolean(task.time) ? { time, alerts: undefined } : { time })

  const timed = Boolean(task.time)
  const alerts = alertsOf(task)
  const moreAlerts = (timed ? TIMED_ALERT_OPTIONS : DAY_ALERT_OPTIONS).filter((a) => !alerts.includes(a))
  const setAlerts = (list: number[]) => update({ alerts: [...list].sort((a, b) => b - a) })
  const avisosOn = ui.avisos?.conectado && ui.avisos.estado === 'activo'
  const close = () => {
    if (!task.title.trim()) actions.updateTask(task.id, { title: originalTitle.current.trim() || 'Sin título' })
    onClose()
  }
  // Sesión nueva de Claude Code en la carpeta del proyecto, con la tarea escrita (título, notas, proyecto).
  const folder = column.project?.folder
  const claude = async () => {
    ui.toast('Abriendo Claude Code…')
    await ui.saveNow()
    const result = await openClaude({ taskId: task.id })
    if (!result.ok) ui.toast(result.message)
  }
  // Las archivadas no son destino; la suya sí sale, para que se vea dónde está.
  const columns = board.columns.filter((c) => !c.archived || c.id === column.id)
  // Enlace a la tarea: abre Tablero con ella a la vista y su detalle abierto (src/dock.ts).
  const copyLink = async () => {
    const ok = await copyText(`${location.origin}/t/${encodeURIComponent(task.id)}`)
    ui.toast(ok ? 'Enlace copiado' : 'No se ha podido copiar el enlace')
  }

  return (
    <Popover anchor={anchor} placement="side" width={340} label="Detalles de la tarea" className="sheet" style={tint(column.color)} onClose={close}>
      <div className="sheet-head">
        <CheckButton checked={task.done} title={task.title} onToggle={() => actions.setDone(task.id, !task.done)} />
        <textarea
          ref={titleRef}
          className="sheet-title"
          rows={1}
          value={task.title}
          aria-label="Título"
          placeholder="Título"
          onChange={(e) => actions.updateTask(task.id, { title: e.target.value.replace(/\s*\n\s*/g, ' ') }, `title:${task.id}`)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              close()
            }
          }}
        />
      </div>

      {/* Con pasos, las notas no los repiten: se ven solo como casillas (o todo como texto, a elegir). */}
      <textarea
        className="sheet-notes"
        value={asSteps ? withoutSteps(task.notes) : task.notes}
        aria-label="Notas"
        placeholder="Notas"
        onChange={(e) =>
          actions.updateTask(task.id, { notes: asSteps ? withBody(task.notes, e.target.value) : e.target.value }, `notes:${task.id}`)
        }
      />
      {!rawNotes && <Checklist task={task} />}
      {hasSteps && (
        <button type="button" className="link-btn notes-mode" aria-pressed={rawNotes} onClick={() => setRawNotes(!rawNotes)}>
          {rawNotes ? 'Ver los pasos como casillas' : 'Editar los pasos como texto'}
        </button>
      )}
      <LinkRow links={findLinks(task.title, task.notes)} />

      <div className="sheet-fields">
        <div className="field">
          <span className="field-label">
            <Icon.Calendar />
            Fecha
          </span>
          <div className="field-controls">
            {quickDates.map((d) => (
              <button
                key={d.label}
                type="button"
                className={cx('chip', task.due === d.value && 'is-active')}
                aria-pressed={task.due === d.value}
                onClick={() => setDue(task.due === d.value ? null : d.value)}
              >
                {d.label}
              </button>
            ))}
            <input
              type="date"
              className="input"
              value={task.due ?? ''}
              aria-label="Elegir fecha"
              onChange={(e) => setDue(e.target.value || null)}
            />
            {task.due && (
              <button type="button" className="link-btn" onClick={() => setDue(null)}>
                Quitar
              </button>
            )}
          </div>
        </div>

        <div className="field">
          <span className="field-label">
            <Icon.Later />
            Algún día
          </span>
          <div className="field-controls">
            <Switch checked={someday} label="Algún día" onChange={(on) => actions.setSomeday(task.id, on)} />
            {someday && <span className="field-note">Sin fecha, al pie de su columna</span>}
          </div>
        </div>

        {task.due && (
          <div className="field">
            <span className="field-label">
              <Icon.Clock />
              Hora
            </span>
            <div className="field-controls">
              <input
                type="time"
                className="input"
                value={task.time ?? ''}
                aria-label="Hora de inicio"
                onChange={(e) => setTime(e.target.value || null)}
              />
              {task.time ? (
                <button type="button" className="link-btn" onClick={() => setTime(null)}>
                  Todo el día
                </button>
              ) : (
                <span className="field-note">Todo el día</span>
              )}
            </div>
          </div>
        )}

        {task.due && (
          <div className="field">
            <span className="field-label">
              <Icon.Bell />
              Aviso
            </span>
            <div className="field-controls">
              {alerts.length === 0 && <span className="field-note">Sin aviso</span>}
              {alerts.map((offset) => (
                <span key={offset} className="chip is-removable">
                  {alertLabel(offset, timed)}
                  <button
                    type="button"
                    aria-label={`Quitar aviso: ${alertLabel(offset, timed)}`}
                    onClick={() => setAlerts(alerts.filter((a) => a !== offset))}
                  >
                    <Icon.Close />
                  </button>
                </span>
              ))}
              {moreAlerts.length > 0 && (
                <button
                  type="button"
                  className="chip is-add"
                  aria-label="Añadir aviso"
                  title="Añadir aviso"
                  aria-haspopup="menu"
                  onClick={(e) => setAlertMenu(alertMenu ? null : e.currentTarget)}
                >
                  <Icon.Plus />
                </button>
              )}
              {alerts.length > 0 && !task.done && avisosOn && <span className="field-note">En el iPhone y el Mac</span>}
            </div>
          </div>
        )}
        {alertMenu && (
          <Menu
            anchor={alertMenu}
            label="Añadir aviso"
            onClose={() => setAlertMenu(null)}
            items={moreAlerts.map((offset) => ({ label: alertLabel(offset, timed), run: () => setAlerts([...alerts, offset]) }))}
          />
        )}

        <RepeatField task={task} today={today} />

        <div className="field">
          <span className="field-label">
            <Icon.Columns />
            Columna
          </span>
          <div className="field-controls">
            <select
              className="input"
              value={column.id}
              aria-label="Columna"
              onChange={(e) => actions.moveTask(task.id, e.target.value)}
            >
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.archived ? `${c.name} (archivada)` : c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {folder && (
        <button type="button" className="btn sheet-claude" title={`Sesión nueva en ${folder}`} onClick={() => void claude()}>
          <Icon.Terminal />
          Abrir en Claude Code
        </button>
      )}

      <footer className="sheet-foot">
        <span className="sheet-meta">
          {task.done && task.completedAt
            ? `Completada ${formatWhen(task.completedAt, now)}`
            : `Creada ${formatWhen(task.createdAt, now)}`}
        </span>
        <div className="sheet-foot-actions">
          <button type="button" className="icon-btn" aria-label="Copiar enlace" title="Copiar enlace" onClick={() => void copyLink()}>
            <Icon.Link />
          </button>
          <button
            type="button"
            className="danger-btn"
            onClick={() => {
              actions.deleteTask(task.id)
              ui.toast('Tarea eliminada', { undo: true })
              onClose()
            }}
          >
            <Icon.Trash />
            Eliminar
          </button>
        </div>
      </footer>
    </Popover>
  )
}

/** Al portapapeles; si el navegador no deja (sin permiso), a la antigua. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
    document.body.append(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    active?.focus({ preventScroll: true })
    return ok
  }
}
