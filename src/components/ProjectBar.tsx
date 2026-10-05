// Bajo el nombre de la columna: el «pulso» del proyecto (entrega, sin próxima acción, parada) y
// sus accesos directos (carpeta, Claude Code, repositorio, producción, staging, otros enlaces).
import { useMemo, useState, type ReactNode } from 'react'
import { useNow, useUI } from '../context'
import { todayISO } from '../dates'
import type { Column } from '../model'
import { openClaude, openFolder } from '../projectApi'
import { projectLinks, projectPulse, pulseText, shortUrl, type UrlField } from '../projects'
import { cx } from '../util'
import * as Icon from './Icons'
import { Menu } from './Popover'
import '../styles/proyectos.css'

/** Abrir la carpeta y Claude Code. Antes se guarda lo pendiente: el servidor lee la carpeta del tablero guardado. */
export function useProjectActions(column: Column, onMissingFolder?: () => void) {
  const ui = useUI()
  return useMemo(
    () => ({
      async folder() {
        await ui.saveNow()
        const result = await openFolder(column.id)
        if (!result.ok) ui.toast(result.message)
      },
      /** Sesión nueva en la carpeta del proyecto; con `taskId`, con la tarea ya escrita. */
      async claude(taskId?: string) {
        if (!column.project?.folder) {
          ui.toast('Pon la carpeta del proyecto para abrir Claude Code')
          onMissingFolder?.()
          return
        }
        ui.toast('Abriendo Claude Code…')
        await ui.saveNow()
        const result = await openClaude(taskId ? { taskId } : { columnId: column.id })
        if (result.ok) return
        ui.toast(result.message)
        if (result.code === 'sin-carpeta') onMissingFolder?.()
      },
    }),
    [ui, column.id, column.project?.folder, onMissingFolder],
  )
}

const LINK_ICONS: Record<UrlField, () => ReactNode> = {
  repo: Icon.Branch,
  production: Icon.Globe,
  staging: Icon.Flask,
}

const openTab = (url: string) => window.open(url, '_blank', 'noopener,noreferrer')

export function ProjectBar({ column, onMissingFolder }: { column: Column; onMissingFolder: () => void }) {
  const now = useNow()
  const run = useProjectActions(column, onMissingFolder)
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const pulse = projectPulse(column, todayISO(now))
  const project = column.project
  const folder = project?.folder
  const links = projectLinks(project)
  const extra = project?.links ?? []
  if (!pulse && !folder && links.length === 0 && extra.length === 0) return null

  return (
    <div className="project-bar">
      <p className="project-pulse" title={pulse ? pulseText(pulse) : undefined}>
        {pulse?.deadline && <span className={cx(pulse.deadline.urgent && 'is-urgent')}>{pulse.deadline.text}</span>}
        {pulse?.alert && <span>{pulse.alert}</span>}
      </p>
      <div className="project-actions" role="group" aria-label={`Proyecto ${column.name}`}>
        {folder && (
          <>
            <button
              type="button"
              className="project-btn"
              aria-label="Abrir la carpeta en el Finder"
              title={`Abrir en el Finder · ${folder}`}
              onClick={() => void run.folder()}
            >
              <Icon.Folder />
            </button>
            <button
              type="button"
              className="project-btn"
              aria-label="Nueva sesión de Claude Code"
              title="Nueva sesión de Claude Code"
              onClick={() => void run.claude()}
            >
              <Icon.Terminal />
            </button>
          </>
        )}
        {links.map(({ field, label, url }) => {
          const Glyph = LINK_ICONS[field]
          return (
            <a
              key={field}
              className="project-btn"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title={`${label} · ${shortUrl(url)}`}
              aria-label={`${label}: ${shortUrl(url)} (se abre en una pestaña nueva)`}
            >
              <Glyph />
            </a>
          )
        })}
        {extra.length === 1 && (
          <a
            className="project-btn"
            href={extra[0].url}
            target="_blank"
            rel="noopener noreferrer"
            title={extra[0].label || shortUrl(extra[0].url)}
            aria-label={`${extra[0].label || shortUrl(extra[0].url)} (se abre en una pestaña nueva)`}
          >
            <Icon.Link />
          </a>
        )}
        {extra.length > 1 && (
          <button
            type="button"
            className="project-btn"
            aria-label="Otros enlaces"
            title="Otros enlaces"
            aria-haspopup="menu"
            aria-expanded={menu !== null}
            onClick={(e) => setMenu(menu ? null : e.currentTarget)}
          >
            <Icon.Link />
          </button>
        )}
      </div>
      {menu && (
        <Menu
          anchor={menu}
          label="Otros enlaces"
          onClose={() => setMenu(null)}
          items={extra.map((link, i) => {
            const name = link.label || shortUrl(link.url)
            // El menú usa el texto como clave: dos iguales se distinguen.
            const label = extra.findIndex((l) => (l.label || shortUrl(l.url)) === name) === i ? name : `${name} (${i + 1})`
            return { label, run: () => openTab(link.url) }
          })}
        />
      )}
    </div>
  )
}
