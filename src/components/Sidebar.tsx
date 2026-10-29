import { useEffect, type ReactNode } from 'react'
import { googleAccounts, metaAccounts, type AccountStore } from '../adAccounts'
import { useBoard, useNow, useUI, type View } from '../context'
import { todayISO } from '../dates'
import { nextTheme, setTheme, THEME_LABELS, useTheme, type Theme } from '../theme'
import { dueCount } from '../today'
import { cx, useStoredState } from '../util'
import { Avatar } from './Ads'
import * as Icon from './Icons'
import '../styles/lateral.css'

interface Item {
  view: View
  label: string
  hint: string
  icon: () => ReactNode
  /** Las cuentas publicitarias que van debajo (y dónde se recuerda si están plegadas). */
  accounts?: { store: AccountStore; openKey: string }
}

/** Las vistas, en grupos: las tareas y lo que se gestiona fuera (Meta, Google Ads y sus resúmenes por WhatsApp). */
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
    items: [
      { view: 'ads', label: 'Meta Ads', hint: 'P', icon: Icon.MetaLogo, accounts: { store: metaAccounts, openKey: 'tablero.lateral.cuentas' } },
      { view: 'google', label: 'Google Ads', hint: 'G', icon: Icon.GoogleAdsLogo, accounts: { store: googleAccounts, openKey: 'tablero.lateral.google' } },
      { view: 'summaries', label: 'Resúmenes', hint: 'R', icon: Icon.WhatsAppLogo },
    ],
  },
]

/**
 * Menú lateral con las vistas y, bajo «Meta Ads» y «Google Ads», sus cuentas publicitarias. Con poco ancho queda en
 * una franja de iconos (sin las cuentas: cada vista tiene su propio selector).
 */
export function Sidebar() {
  const ui = useUI()
  const board = useBoard()
  const now = useNow()
  const due = dueCount(board, todayISO(now))

  return (
    <nav className="sidebar" aria-label="Vistas">
      <div className="sidebar-head">
        <div className="sidebar-brand">
          <Icon.TableroLogo />
          <span>Tablero</span>
        </div>
        <button type="button" className="icon-btn" aria-label="Ocultar el menú lateral" title="Ocultar el menú lateral (⌃⌘S)" onClick={ui.toggleSidebar}>
          <Icon.SidebarLeft />
        </button>
      </div>
      {SECTIONS.map((section) => (
        <div key={section.title ?? 'vistas'} className="sidebar-group">
          {section.title && <h2 className="sidebar-section">{section.title}</h2>}
          {section.items.map((item) =>
            item.accounts ? (
              <AccountsItem key={item.view} item={item} store={item.accounts.store} openKey={item.accounts.openKey} />
            ) : (
              <div key={item.view} className="sidebar-row">
                <ViewButton item={item} current={ui.view === item.view}>
                  {item.view === 'today' && due > 0 && (
                    <span className="sidebar-count" aria-label={due === 1 ? '1 pendiente' : `${due} pendientes`}>
                      {due}
                    </span>
                  )}
                </ViewButton>
              </div>
            ),
          )}
        </div>
      ))}
      <ThemeButton />
    </nav>
  )
}

const THEME_ICONS: Record<Theme, () => ReactNode> = { system: Icon.Contrast, light: Icon.Sun, dark: Icon.Moon }

/** Abajo del todo: la apariencia (como el sistema, clara u oscura); cada clic pasa a la siguiente. */
function ThemeButton() {
  const theme = useTheme()
  const next = nextTheme(theme)
  const ThemeIcon = THEME_ICONS[theme]
  return (
    <div className="sidebar-foot">
      <button
        type="button"
        className="sidebar-item sidebar-theme"
        aria-label={`Apariencia: ${THEME_LABELS[theme]}. Cambiar a ${THEME_LABELS[next].toLowerCase()}`}
        title={`Apariencia: ${THEME_LABELS[theme]} (pulsa para ${THEME_LABELS[next].toLowerCase()})`}
        onClick={() => setTheme(next)}
      >
        <ThemeIcon />
        <span className="sidebar-label">{THEME_LABELS[theme]}</span>
      </button>
    </div>
  )
}

function ViewButton({ item, current, within = false, children }: { item: Item; current: boolean; within?: boolean; children?: ReactNode }) {
  const ui = useUI()
  return (
    <button
      type="button"
      className={cx('sidebar-item', within && 'is-within')}
      aria-current={current && !within ? 'page' : undefined}
      title={`${item.label} (${item.hint})`}
      aria-keyshortcuts={item.hint}
      onClick={() => ui.setView(item.view)}
    >
      <item.icon />
      <span className="sidebar-label">{item.label}</span>
      {children}
    </button>
  )
}

/** Una vista de anuncios con sus portfolios (o cuentas de administrador) y sus cuentas debajo, plegables. */
function AccountsItem({ item, store, openKey }: { item: Item; store: AccountStore; openKey: string }) {
  const ui = useUI()
  const ads = store.useAccounts()
  const [open, setOpen] = useStoredState(openKey, true)
  const hasAccounts = (ads.portfolios?.length ?? 0) > 0
  const shown = open && hasAccounts
  const listId = `lateral-cuentas-${item.view}`
  const current = ui.view === item.view

  // Sin conexión, el servidor responde que no y no se enseña nada.
  useEffect(() => {
    void store.load()
  }, [store])

  return (
    <>
      <div className="sidebar-row">
        {/* Con las cuentas a la vista, la marcada es la cuenta, no la vista. */}
        <ViewButton item={item} current={current} within={current && shown} />
        {hasAccounts && (
          <span className="sidebar-row-actions">
            {open && (
              <button
                type="button"
                className="icon-btn sidebar-mini-btn"
                aria-label={`Actualizar las cuentas de ${item.label}`}
                title="Actualizar las cuentas"
                disabled={ads.loading}
                onClick={() => void store.load(true)}
              >
                <Icon.Reload />
              </button>
            )}
            <button
              type="button"
              className="icon-btn sidebar-mini-btn sidebar-disclosure"
              aria-expanded={open}
              aria-controls={open ? listId : undefined}
              aria-label={`Cuentas de ${item.label}`}
              title={open ? 'Ocultar las cuentas' : 'Mostrar las cuentas'}
              onClick={() => setOpen(!open)}
            >
              <Icon.Chevron />
            </button>
          </span>
        )}
      </div>
      {shown && (
        <div id={listId} className="sidebar-accounts" role="group" aria-label={`Cuentas de ${item.label}`}>
          {ads.portfolios?.map((portfolio) => (
            <div key={portfolio.id} className="sidebar-portfolio">
              <div className="sidebar-portfolio-name" title={portfolio.nombre}>
                <Avatar name={portfolio.nombre} src={portfolio.foto} />
                <span>{portfolio.nombre}</span>
              </div>
              {portfolio.cuentas.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  className={cx('sidebar-item sidebar-account', !account.activa && 'is-inactive')}
                  aria-current={current && account.id === ads.selected ? 'page' : undefined}
                  title={account.activa ? `${account.nombre} · ${account.moneda}` : `${account.nombre} · cuenta ${account.estado}`}
                  onClick={() => {
                    store.select(account.id)
                    ui.setView(item.view)
                  }}
                >
                  <span className="sidebar-label">{account.nombre}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
