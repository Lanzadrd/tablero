import type { MouseEvent } from 'react'
import { linkText, splitLinks, type Link } from '../links'
import { cx } from '../util'
import * as Icon from './Icons'
import '../styles/escribir.css'

/** El clic abre el enlace, no el detalle de la tarea. */
const stop = (e: MouseEvent) => e.stopPropagation()

/** Píldora con icono y dominio que abre el enlace en una pestaña nueva. `long`: con la ruta. */
export function LinkPill({ link, long = false }: { link: Link; long?: boolean }) {
  return (
    <a
      className={cx('link-pill', long && 'is-long')}
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      draggable={false}
      title={link.url}
      aria-label={`${linkText(link, 60)} (se abre en una pestaña nueva)`}
      onClick={stop}
    >
      <Icon.Link />
      <span className="link-pill-text">{long ? linkText(link, 44) : link.domain}</span>
    </a>
  )
}

/** Texto con sus enlaces convertidos en píldoras. */
export function Linkified({ text }: { text: string }) {
  const segments = splitLinks(text)
  if (!segments.some((s) => s.link)) return text
  return segments.map((s, i) => (s.link ? <LinkPill key={i} link={s.link} /> : <span key={i}>{s.text}</span>))
}

/** Fila de enlaces bajo las notas, en el detalle de la tarea. */
export function LinkRow({ links }: { links: Link[] }) {
  if (links.length === 0) return null
  return (
    <div className="sheet-links" role="group" aria-label="Enlaces">
      {links.map((link) => (
        <LinkPill key={link.url} link={link} long />
      ))}
    </div>
  )
}

/**
 * Dentro de un botón (las tareas del mes) no puede ir un enlace: esta marca lo abre con el
 * ratón; con el teclado, el enlace está en el detalle de la tarea. Solo el icono: en el mes no
 * hay sitio para el dominio y el título lo necesita más.
 */
export function ChipLink({ link }: { link: Link }) {
  return (
    <span
      className="link-pill is-mini"
      title={`${link.domain} · ${link.url}`}
      onClick={(e) => {
        e.stopPropagation()
        window.open(link.url, '_blank', 'noopener,noreferrer')
      }}
    >
      <Icon.Link />
    </span>
  )
}
