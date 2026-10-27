import type { ReactNode } from 'react'
import { useBoard, useNow, useUI, type View } from '../context'
import { todayISO } from '../dates'
import { dueCount } from '../today'
import * as Icon from './Icons'
import '../styles/lateral.css'

interface Item {
  view: View
  label: string
  hint: string
  icon: () => ReactNode
}

/** Las vistas, en grupos: las tareas y lo que se gestiona fuera (Meta). */
const SECTIONS: Array<{ title: string | null; items: Item[] }> = [
  {
    title: null,
    items: [
      { view: 'today', label: 'Hoy', hint: 'D', icon: Icon.Star },
      { view: 'board', label: 'Tablero', hint: 'T', icon: Icon.Columns },
      { view: 'calendar', label: 'Calendario', hint: 'C', icon: Icon.Calendar },
      { view: 'subscriptions', label: 'Suscripciones', hint: 'U', icon: Icon.Card },
    ],
  },
  {
    title: 'Marketing',
    items: [{ view: 'ads', label: 'Anuncios', hint: 'P', icon: Icon.Megaphone }],
  },
]

/** Menú lateral con las vistas. Con poco ancho queda en una franja de iconos (styles.css). */
export function Sidebar() {
  const ui = useUI()
  const board = useBoard()
  const now = useNow()
  const due = dueCount(board, todayISO(now))

  return (
    <nav className="sidebar" aria-label="Vistas">
      <div className="sidebar-head">
        <button type="button" className="icon-btn" aria-label="Ocultar el menú lateral" title="Ocultar el menú lateral (⌃⌘S)" onClick={ui.toggleSidebar}>
          <Icon.SidebarLeft />
        </button>
      </div>
      {SECTIONS.map((section) => (
        <div key={section.title ?? 'vistas'} className="sidebar-group">
          {section.title && <h2 className="sidebar-section">{section.title}</h2>}
          {section.items.map((item) => (
            <button
              key={item.view}
              type="button"
              className="sidebar-item"
              aria-current={ui.view === item.view ? 'page' : undefined}
              title={`${item.label} (${item.hint})`}
              aria-keyshortcuts={item.hint}
              onClick={() => ui.setView(item.view)}
            >
              <item.icon />
              <span className="sidebar-label">{item.label}</span>
              {item.view === 'today' && due > 0 && (
                <span className="sidebar-count" aria-label={due === 1 ? '1 pendiente' : `${due} pendientes`}>
                  {due}
                </span>
              )}
            </button>
          ))}
        </div>
      ))}
    </nav>
  )
}
