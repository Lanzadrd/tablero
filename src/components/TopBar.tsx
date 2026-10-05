import { Fragment, useEffect, useRef, useState } from 'react'
import { useBoard, useNow, useUI } from '../context'
import { formatToday } from '../dates'
import { SHORTCUTS } from '../keys'
import type { AvisosStatus } from '../sync'
import { cx } from '../util'
import * as Icon from './Icons'
import { Popover } from './Popover'
import { Segmented } from './Segmented'
import '../styles/teclado.css'

/** Evento de Chrome cuando la web se puede instalar como app. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** Botón «Instalar» mientras Tablero no esté instalado como app de Chrome. */
function useInstallPrompt() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setPrompt(e as InstallPromptEvent)
    }
    const onInstalled = () => setPrompt(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])
  if (!prompt) return null
  return async () => {
    const { outcome } = await prompt.prompt()
    if (outcome === 'accepted') setPrompt(null)
  }
}

type AvisosState = 'activo' | 'sin-permiso' | 'iniciando' | 'error' | 'desconectado'

const avisosState = (avisos: AvisosStatus): AvisosState =>
  avisos.conectado ? (avisos.estado ?? 'iniciando') : 'desconectado'

const PRIVACIDAD = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders'
const NOTIFICACIONES = 'x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=com.apple.reminders'

function AvisosPanel({ avisos, inbox }: { avisos: AvisosStatus; inbox: string }) {
  const state = avisosState(avisos)
  const count = avisos.programados ?? 0
  return (
    <div className="avisos">
      <h3>En el iPhone</h3>
      {state === 'activo' && (
        <>
          <p className="avisos-state is-ok">
            <Icon.Check />
            Sincronizado · {count === 1 ? '1 aviso programado' : `${count} avisos programados`}
          </p>
          <p>
            Cada columna es una lista de Recordatorios («Tablero · {'…'}»). Lo que añadas, completes, cambies o borres en
            el iPhone aparece aquí, y al revés. Las tareas con hora avisan a esa hora; las de todo el día, a las 9:00.
          </p>
          <p className="avisos-hint">Las columnas se crean y se borran desde aquí; en el iPhone, solo las tareas.</p>
          {avisos.icloud === false && (
            <p className="avisos-warning">
              La lista está en «{avisos.cuenta}», no en iCloud, así que no llegará al iPhone. Activa Recordatorios en
              Ajustes del Sistema › tu nombre › iCloud.
            </p>
          )}
        </>
      )}
      {state === 'sin-permiso' && (
        <>
          <p className="avisos-state is-warning">
            <Icon.Alert />
            Falta permiso para usar Recordatorios
          </p>
          <p>Activa «Tablero Avisos» en Ajustes del Sistema › Privacidad › Recordatorios. Empezará a funcionar solo.</p>
          <a className="btn" href={PRIVACIDAD}>
            Abrir Ajustes
          </a>
        </>
      )}
      {state === 'iniciando' && <p>Conectando con Recordatorios… Si macOS te pregunta, pulsa «Permitir».</p>}
      {state === 'error' && (
        <p className="avisos-state is-warning">
          <Icon.Alert />
          {avisos.mensaje ?? 'Algo ha fallado al crear los recordatorios.'}
        </p>
      )}
      {state === 'desconectado' && (
        <p className="avisos-state is-warning">
          <Icon.Alert />
          El ayudante de avisos no está en marcha. Vuelve a instalar Tablero para activarlo.
        </p>
      )}
      <div className="avisos-style">
        <h4>Siri</h4>
        <p>
          Para que lo que le dictes a Siri llegue a la Bandeja. En el iPhone: Ajustes › Recordatorios › Lista por omisión ›
          Tablero · {inbox}.
        </p>
      </div>
      <div className="avisos-style">
        <h4>Globos y sonido</h4>
        <p>
          Cómo se muestran los avisos lo decide cada dispositivo. En el iPhone: Ajustes › Notificaciones › Recordatorios ›
          activa «Globos» y «Sonidos». En el Mac:
        </p>
        <a className="btn" href={NOTIFICACIONES}>
          Ajustes de notificaciones de Recordatorios
        </a>
      </div>
    </div>
  )
}

export function TopBar() {
  const now = useNow()
  const ui = useUI()
  const inbox = useBoard().columns.find((c) => c.inbox)?.name ?? 'Bandeja'
  const install = useInstallPrompt()
  const helpButton = useRef<HTMLButtonElement>(null)
  // La ayuda se abre también con «?» y desde la búsqueda (src/keys.ts).
  const helpOpen = ui.shortcutsOpen
  const setHelpOpen = ui.setShortcutsOpen
  const avisosButton = useRef<HTMLButtonElement>(null)
  const [avisosOpen, setAvisosOpen] = useState(false)
  const avisos = ui.avisos ? avisosState(ui.avisos) : null
  const [appVersion, setAppVersion] = useState<string | null>(null)

  useEffect(() => {
    if (!helpOpen) return
    fetch('/api/health')
      .then((res) => res.json())
      .then((health: { appVersion?: string }) => setAppVersion(health.appVersion ?? null))
      .catch(() => {})
  }, [helpOpen])

  return (
    <header className="topbar">
      <div className="topbar-title">
        <h1>Tablero</h1>
        <span className="topbar-date">{formatToday(now)}</span>
      </div>
      <Segmented
        label="Vista"
        value={ui.view}
        onChange={ui.setView}
        options={[
          { value: 'today', label: 'Hoy', hint: 'D' },
          { value: 'board', label: 'Tablero', hint: 'T' },
          { value: 'calendar', label: 'Calendario', hint: 'C' },
        ]}
      />
      <div className="topbar-actions">
        {install && (
          <button type="button" className="btn is-accent" onClick={install} title="Instalar Tablero como app, con su icono en el Dock">
            <Icon.Download />
            Instalar
          </button>
        )}
        {ui.avisos && (
          <button
            ref={avisosButton}
            type="button"
            className={cx('icon-btn', 'avisos-btn', avisos && `is-${avisos}`)}
            aria-label="Avisos en el iPhone"
            title="Avisos en el iPhone"
            aria-expanded={avisosOpen}
            onClick={() => setAvisosOpen((open) => !open)}
          >
            <Icon.Bell />
          </button>
        )}
        <button
          ref={helpButton}
          type="button"
          className="icon-btn"
          aria-label="Atajos de teclado"
          title="Atajos de teclado (?)"
          aria-expanded={helpOpen}
          onClick={() => setHelpOpen(!helpOpen)}
        >
          <Icon.Keyboard />
        </button>
        <button type="button" className="icon-btn" aria-label="Buscar" title="Buscar (⌘K)" onClick={ui.openSearch}>
          <Icon.Search />
        </button>
        <button type="button" className="btn" onClick={ui.newColumn} title="Nueva columna (⇧N)">
          <Icon.Plus />
          Columna
        </button>
      </div>

      {avisosOpen && ui.avisos && avisosButton.current && (
        <Popover anchor={avisosButton.current} placement="below-end" width={320} label="Avisos en el iPhone" onClose={() => setAvisosOpen(false)}>
          <AvisosPanel avisos={ui.avisos} inbox={inbox} />
        </Popover>
      )}
      {helpOpen && helpButton.current && (
        <Popover
          anchor={helpButton.current}
          placement="below-end"
          width={600}
          label="Atajos de teclado"
          className="shortcuts"
          onClose={() => setHelpOpen(false)}
        >
          <div className="shortcuts-grid">
            {SHORTCUTS.map((section) => (
              <section key={section.title}>
                <h3>{section.title}</h3>
                {section.note && <p className="shortcuts-note">{section.note}</p>}
                <dl>
                  {section.items.map((item) => (
                    <div key={item.label}>
                      <dt>
                        {item.keys.map((combo, i) => (
                          <Fragment key={combo.join('')}>
                            {i > 0 && <span className="shortcuts-or">o</span>}
                            {combo.map((key, j) =>
                              key === '…' ? (
                                <span key={j}>–</span>
                              ) : key === 'clic' ? (
                                <span key={j} className="shortcuts-click">
                                  clic
                                </span>
                              ) : (
                                <kbd key={j}>{key}</kbd>
                              ),
                            )}
                          </Fragment>
                        ))}
                      </dt>
                      <dd>{item.label}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
          {appVersion && <p className="shortcuts-version">Tablero {appVersion === 'dev' ? '(desarrollo)' : appVersion}</p>}
        </Popover>
      )}
    </header>
  )
}
