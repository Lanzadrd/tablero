// «Ficha del proyecto»: carpeta, repositorio, producción, staging, entrega y otros enlaces de una
// columna. Cada campo se guarda al salir de él (y todo al cerrar); la ficha entera es un solo
// paso de deshacer.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useActions } from '../context'
import type { Column } from '../model'
import { draftOf, normalizeUrl, projectFromDraft, type ProjectDraft, type UrlField } from '../projects'
import { tint } from '../util'
import * as Icon from './Icons'
import { Popover } from './Popover'
import '../styles/proyectos.css'

const URL_FIELDS: ReadonlyArray<{ field: UrlField; label: string; placeholder: string; icon: () => ReactNode }> = [
  { field: 'repo', label: 'Repositorio', placeholder: 'github.com/usuario/repo', icon: Icon.Branch },
  { field: 'production', label: 'Producción', placeholder: 'midominio.com', icon: Icon.Globe },
  { field: 'staging', label: 'Staging', placeholder: 'staging.midominio.com', icon: Icon.Flask },
]

const BAD_URL = 'Dirección no válida (solo http y https)'

export function ProjectSheet({ column, anchor, onClose }: { column: Column; anchor: HTMLElement; onClose: () => void }) {
  const actions = useActions()
  const ids = useId()
  const [draft, setDraft] = useState<ProjectDraft>(() => draftOf(column.project))
  // Los errores se enseñan al salir del campo, no mientras se escribe.
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set())
  const draftRef = useRef(draft)
  const projectRef = useRef(column.project)
  projectRef.current = column.project
  const focusLink = useRef<number | null>(null)
  const linksRef = useRef<HTMLDivElement>(null)

  // Cada vez que se abre la ficha es su propio paso de deshacer.
  const [session] = useState(() => crypto.randomUUID())

  const save = (next: ProjectDraft = draftRef.current) =>
    actions.setProject(column.id, projectFromDraft(next, projectRef.current), session)

  const change = (patch: Partial<ProjectDraft>, commit = false) => {
    const next = { ...draftRef.current, ...patch }
    draftRef.current = next
    setDraft(next)
    if (commit) save(next)
  }
  const leave = (key: string) => {
    setTouched((t) => new Set(t).add(key))
    save()
  }
  const close = () => {
    save()
    onClose()
  }
  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    close()
  }
  const setLink = (index: number, patch: Partial<{ label: string; url: string }>) =>
    change({ links: draftRef.current.links.map((l, i) => (i === index ? { ...l, ...patch } : l)) })

  // Tras «Añadir enlace», el cursor va al nombre del nuevo.
  useEffect(() => {
    if (focusLink.current === null) return
    const inputs = linksRef.current?.querySelectorAll<HTMLInputElement>('.project-link-label')
    inputs?.[focusLink.current]?.focus()
    focusLink.current = null
  })

  const urlError = (key: string, value: string) => touched.has(key) && normalizeUrl(value) === null

  return (
    <Popover
      anchor={anchor}
      placement="below-end"
      width={380}
      label={`Ficha del proyecto ${column.name}`}
      className="project-sheet"
      style={tint(column.color)}
      onClose={close}
    >
      <h3 className="project-sheet-title">
        <span className="project-dot" aria-hidden="true" />
        {column.name}
      </h3>

      <div className="project-fields">
        <div className="field">
          <label className="field-label" htmlFor={`${ids}-folder`}>
            <Icon.Folder />
            Carpeta
          </label>
          <div className="field-controls">
            <input
              id={`${ids}-folder`}
              className="input project-input"
              data-autofocus
              value={draft.folder}
              placeholder="~/Desktop/Claude Code/proyecto"
              spellCheck={false}
              autoComplete="off"
              aria-describedby={`${ids}-folder-note`}
              onChange={(e) => change({ folder: e.target.value })}
              onBlur={() => leave('folder')}
              onKeyDown={onEnter}
            />
            <span id={`${ids}-folder-note`} className="project-note">
              Ruta en este Mac. Abre el Finder y Claude Code desde la columna.
            </span>
          </div>
        </div>

        {URL_FIELDS.map(({ field, label, placeholder, icon: Glyph }) => {
          const error = urlError(field, draft[field])
          return (
            <div key={field} className="field">
              <label className="field-label" htmlFor={`${ids}-${field}`}>
                <Glyph />
                {label}
              </label>
              <div className="field-controls">
                <input
                  id={`${ids}-${field}`}
                  className="input project-input"
                  value={draft[field]}
                  placeholder={placeholder}
                  inputMode="url"
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={error || undefined}
                  aria-describedby={error ? `${ids}-${field}-error` : undefined}
                  onChange={(e) => change({ [field]: e.target.value })}
                  onBlur={() => leave(field)}
                  onKeyDown={onEnter}
                />
                {error && (
                  <span id={`${ids}-${field}-error`} className="project-error">
                    {BAD_URL}
                  </span>
                )}
              </div>
            </div>
          )
        })}

        <div className="field">
          <label className="field-label" htmlFor={`${ids}-deadline`}>
            <Icon.Calendar />
            Entrega
          </label>
          <div className="field-controls">
            <input
              id={`${ids}-deadline`}
              type="date"
              className="input"
              value={draft.deadline}
              onChange={(e) => change({ deadline: e.target.value }, true)}
            />
            {draft.deadline && (
              <button type="button" className="link-btn" onClick={() => change({ deadline: '' }, true)}>
                Quitar
              </button>
            )}
          </div>
        </div>

        <div className="field is-stacked">
          <span className="field-label" id={`${ids}-links`}>
            <Icon.Link />
            Enlaces
          </span>
          <div className="project-links" ref={linksRef} role="group" aria-labelledby={`${ids}-links`}>
            {draft.links.map((link, i) => {
              const missing = touched.has(`link-${i}`) && link.label.trim() !== '' && link.url.trim() === ''
              const error = urlError(`link-${i}`, link.url)
              return (
                <div key={i} className="project-link">
                  <input
                    className="input project-link-label"
                    value={link.label}
                    placeholder="Nombre"
                    aria-label={`Nombre del enlace ${i + 1}`}
                    autoComplete="off"
                    onChange={(e) => setLink(i, { label: e.target.value })}
                    onBlur={() => save()}
                    onKeyDown={onEnter}
                  />
                  <input
                    className="input project-input"
                    value={link.url}
                    placeholder="Dirección"
                    aria-label={`Dirección del enlace ${i + 1}`}
                    inputMode="url"
                    spellCheck={false}
                    autoComplete="off"
                    aria-invalid={error || missing || undefined}
                    aria-describedby={error || missing ? `${ids}-link-${i}-error` : undefined}
                    onChange={(e) => setLink(i, { url: e.target.value })}
                    onBlur={() => leave(`link-${i}`)}
                    onKeyDown={onEnter}
                  />
                  <button
                    type="button"
                    className="icon-btn project-link-remove"
                    aria-label={`Quitar el enlace ${link.label.trim() || i + 1}`}
                    title="Quitar"
                    onClick={() => change({ links: draftRef.current.links.filter((_, j) => j !== i) }, true)}
                  >
                    <Icon.Close />
                  </button>
                  {(error || missing) && (
                    <span id={`${ids}-link-${i}-error`} className="project-error">
                      {missing ? 'Falta la dirección' : BAD_URL}
                    </span>
                  )}
                </div>
              )
            })}
            {draft.links.length < 20 && (
              <button
                type="button"
                className="link-btn project-add-link"
                onClick={() => {
                  focusLink.current = draftRef.current.links.length
                  change({ links: [...draftRef.current.links, { label: '', url: '' }] })
                }}
              >
                <Icon.Plus />
                Añadir enlace
              </button>
            )}
          </div>
        </div>
      </div>
    </Popover>
  )
}
