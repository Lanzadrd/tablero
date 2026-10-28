import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { metaAccounts, type AccountStore } from '../adAccounts'
import { daysLeft, metaApi, redirectUri, type AdAccount, type Launch, type MetaStatus, type Portfolio, type Template } from '../ads'
import { formatWhen } from '../dates'
import { cx, useStoredState } from '../util'
import { AdsComposer } from './AdsComposer'
import { MetaAdder, MetaEditor } from './AdsEdit'
import { META_SOURCE, RunningCampaigns, type RunningSource } from './AdsRunning'
import * as Icon from './Icons'
import { Popover } from './Popover'
import { Segmented } from './Segmented'
import '../styles/anuncios.css'

const DEVELOPERS = 'https://developers.facebook.com/apps/'

/** «En marcha» con Meta, con todo lo de editar: formularios, anuncio nuevo, duplicar, archivar y borrar. */
const META_RUNNING: RunningSource = {
  ...META_SOURCE,
  editor: (props) => <MetaEditor {...props} />,
  adder: (props) => <MetaAdder {...props} />,
  duplicate: metaApi.duplicate,
  archive: (account, level, id) => metaApi.remove(account, level, id, 'archivar'),
  remove: { label: 'Borrar', run: (account, level, id) => metaApi.remove(account, level, id, 'borrar') },
}
/** Con menos días que estos, la conexión avisa de que va a caducar. */
const EXPIRY_WARNING = 7

type Section = 'marcha' | 'nueva'
const SECTIONS: Array<{ value: Section; label: string }> = [
  { value: 'marcha', label: 'En marcha' },
  { value: 'nueva', label: 'Nueva campaña' },
]

export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * Anuncios en Meta: conectar la cuenta (una vez) y, después, elegir la cuenta publicitaria de cualquiera de
 * los portfolios, ver cómo van sus campañas (y pausarlas o activarlas) y lanzar campañas a WhatsApp con las
 * opciones de una plantilla.
 */
export function AdsView() {
  const titleId = useId()
  const [status, setStatus] = useState<MetaStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    metaApi.status().then(
      (s) => {
        setStatus(s)
        setError(null)
      },
      (err) => setError(errorText(err)),
    )
  }, [])
  useEffect(() => {
    load()
    // Al volver a la ventana (p. ej. tras conectar en la de Meta), se mira otra vez.
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])
  // Sin conexión, el menú lateral deja de enseñar las cuentas.
  useEffect(() => {
    if (status && !status.conectada) metaAccounts.forget()
  }, [status])

  return (
    <main className="ads" aria-labelledby={titleId}>
      <header className="ads-head">
        <h2 id={titleId}>Meta Ads</h2>
        {status?.conectada && <ConnectionButton status={status} onChange={setStatus} />}
      </header>
      {error && !status && (
        <p className="ads-error" role="alert">
          {error}
        </p>
      )}
      {status && !status.conectada && <Setup status={status} onChange={setStatus} />}
      {status?.conectada && <Workspace status={status} onStatus={setStatus} />}
    </main>
  )
}

// ── Conexión ──

/** Dónde empieza la conexión con un sitio de anuncios, cómo se mira y qué cambia al volver a conectar. */
export interface Connection<S extends { conectada: boolean }> {
  url: string
  window: string
  status: () => Promise<S>
  /** Lo que es distinto en una conexión nueva (la fecha en que caduca, en la que se conectó). */
  stamp: (status: S) => string | null
}

const META_CONNECTION: Connection<MetaStatus> = {
  url: '/api/meta/conectar',
  window: 'tablero-meta',
  status: metaApi.status,
  stamp: (s) => s.caduca,
}

/** Abre la pantalla de conexión en una ventana y avisa cuando ya hay conexión (nueva). */
export function useConnect<S extends { conectada: boolean }>(
  connection: Connection<S>,
  onChange: (status: S) => void,
  onError: (message: string) => void,
) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => () => clearInterval(timer.current ?? undefined), [])
  return useCallback(
    (previous: string | null = null) => {
      const popup = window.open(connection.url, connection.window, 'popup,width=640,height=780')
      if (!popup) {
        // Sin ventanas emergentes: en esta misma (al terminar vuelve a la vista).
        location.href = connection.url
        return
      }
      clearInterval(timer.current ?? undefined)
      timer.current = setInterval(() => {
        const closed = popup.closed
        connection.status().then(
          (s) => {
            const renewed = s.conectada && connection.stamp(s) !== previous
            if (renewed || closed) clearInterval(timer.current ?? undefined)
            if (renewed) onChange(s)
          },
          (err) => {
            if (!closed) return
            clearInterval(timer.current ?? undefined)
            onError(errorText(err))
          },
        )
      }, 1500)
    },
    [connection, onChange, onError],
  )
}

function Setup({ status, onChange }: { status: MetaStatus; onChange: (status: MetaStatus) => void }) {
  const ids = useId()
  const [editing, setEditing] = useState(!status.app)
  const [appId, setAppId] = useState(status.appId ?? '')
  const [secret, setSecret] = useState('')
  const [config, setConfig] = useState(status.configuracion ?? '')
  const [token, setToken] = useState('')
  const [pasting, setPasting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const connect = useConnect(META_CONNECTION, onChange, setError)

  const run = async (fn: () => Promise<MetaStatus>) => {
    setBusy(true)
    setError(null)
    try {
      onChange(await fn())
      return true
    } catch (err) {
      setError(errorText(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  const saveApp = async (e: FormEvent) => {
    e.preventDefault()
    if (await run(() => metaApi.saveApp(appId, secret, config))) {
      setSecret('')
      setEditing(false)
    }
  }

  const saveToken = async (e: FormEvent) => {
    e.preventDefault()
    if (await run(() => metaApi.saveToken(token.trim()))) setToken('')
  }

  return (
    <section className="ads-setup" aria-labelledby={`${ids}-title`}>
      <span className="ads-setup-icon" aria-hidden="true">
        <Icon.Megaphone />
      </span>
      <div className="ads-setup-body">
        <h3 id={`${ids}-title`}>Conecta Tablero con Meta</h3>
        <p className="ads-setup-lead">
          Una vez conectado, verás las cuentas publicitarias de todos tus portfolios y podrás lanzar campañas de mensajes a
          WhatsApp con tus opciones ya puestas. Todo se crea en pausa para que lo revises antes de gastar nada.
        </p>

        <ol className="ads-steps">
          <li className={cx(status.app && 'is-done')}>
            <h4>Una app de Meta para Tablero</h4>
            <p>
              En developers.facebook.com, <b>Crear app</b> con el caso de uso «Crear y gestionar anuncios con la API de
              marketing» (o usa una que ya tengas). Es solo para ti: no hace falta la revisión de Meta, pero sí
              publicarla (en modo desarrollo Meta no deja crear anuncios), y para eso pide una URL de política de
              privacidad.
            </p>
            <p>
              En su inicio de sesión con Facebook, añade esta dirección a las «URI de redireccionamiento de OAuth válidas»:
            </p>
            <CopyLine value={redirectUri()} />
            <a className="btn" href={DEVELOPERS} target="_blank" rel="noreferrer">
              <Icon.External />
              Abrir developers.facebook.com
            </a>
          </li>

          <li className={cx(status.app && 'is-done')}>
            <h4>Su identificador y su clave secreta</h4>
            {editing ? (
              <form className="ads-app-form" onSubmit={saveApp}>
                <p>En la app, Configuración › Básica. Se guardan solo en este Mac.</p>
                <div className="field">
                  <label className="field-label" htmlFor={`${ids}-app`}>
                    Identificador
                  </label>
                  <input
                    id={`${ids}-app`}
                    className="input"
                    inputMode="numeric"
                    autoComplete="off"
                    spellCheck={false}
                    value={appId}
                    onChange={(e) => setAppId(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor={`${ids}-secret`}>
                    Clave secreta
                  </label>
                  <input
                    id={`${ids}-secret`}
                    className="input"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor={`${ids}-config`}>
                    Configuración
                  </label>
                  <div className="field-controls">
                    <input
                      id={`${ids}-config`}
                      className="input"
                      inputMode="numeric"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="Opcional"
                      value={config}
                      onChange={(e) => setConfig(e.target.value)}
                    />
                    <span className="ads-note">
                      Si Meta pide «Inicio de sesión con Facebook para empresas»: el identificador de una configuración con
                      token de usuario y los permisos ads_management, ads_read, business_management, pages_show_list,
                      pages_read_engagement y pages_manage_ads.
                    </span>
                  </div>
                </div>
                <div className="ads-form-foot">
                  {status.app && (
                    <button type="button" className="link-btn" onClick={() => setEditing(false)}>
                      Cancelar
                    </button>
                  )}
                  <button type="submit" className="btn" disabled={busy || !appId.trim() || !secret.trim()}>
                    Guardar
                  </button>
                </div>
              </form>
            ) : (
              <p className="ads-saved-app">
                <Icon.Check />
                App {status.appId}
                <button type="button" className="link-btn" onClick={() => setEditing(true)}>
                  Cambiar
                </button>
              </p>
            )}
          </li>

          <li>
            <h4>Tu cuenta de Facebook</h4>
            <p>
              Se abre una ventana de Meta: da acceso a todos los portfolios y páginas que quieras gestionar desde aquí. La
              conexión dura unos 60 días y Tablero avisa antes de que caduque.
            </p>
            <div className="ads-connect-row">
              <button type="button" className="btn is-accent" disabled={!status.app || busy} onClick={() => connect()}>
                Conectar con Meta
              </button>
              {status.app && (
                <button type="button" className="link-btn" aria-expanded={pasting} onClick={() => setPasting(!pasting)}>
                  Pegar un token
                </button>
              )}
            </div>
            {pasting && status.app && (
              <form className="ads-token-form" onSubmit={saveToken}>
                <label className="field-note" htmlFor={`${ids}-token`}>
                  Un token de usuario de la Graph API Explorer de esta app, con ads_management, business_management,
                  pages_show_list y pages_manage_ads. Tablero lo cambia por uno de 60 días.
                </label>
                <textarea
                  id={`${ids}-token`}
                  className="input ads-token"
                  rows={3}
                  spellCheck={false}
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
                <div className="ads-form-foot">
                  <button type="submit" className="btn" disabled={busy || token.trim().length < 20}>
                    Usar este token
                  </button>
                </div>
              </form>
            )}
          </li>
        </ol>
        {error && (
          <p className="ads-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}

/** Una dirección para copiar tal cual. */
export function CopyLine({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="ads-copy">
      <code>{value}</code>
      <button
        type="button"
        className="link-btn"
        onClick={() => {
          navigator.clipboard.writeText(value).then(
            () => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            },
            () => {},
          )
        }}
      >
        {copied ? 'Copiada' : 'Copiar'}
      </button>
    </div>
  )
}

/** «Lanza · 58 días», con lo que se puede hacer con la conexión. */
function ConnectionButton({ status, onChange }: { status: MetaStatus; onChange: (status: MetaStatus) => void }) {
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const connect = useConnect(META_CONNECTION, onChange, setError)
  const days = daysLeft(status.caduca)
  const warn = (days !== null && days <= EXPIRY_WARNING) || status.faltan.length > 0

  return (
    <>
      <button
        ref={button}
        type="button"
        className={cx('ads-connection', warn && 'is-warning')}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="ads-connection-dot" aria-hidden="true" />
        {status.usuario?.nombre ?? 'Conectado'}
        {days !== null && <span className="ads-connection-days">{days === 1 ? '1 día' : `${days} días`}</span>}
      </button>
      {open && button.current && (
        <Popover anchor={button.current} placement="below-end" width={300} label="Conexión con Meta" onClose={() => setOpen(false)}>
          <div className="ads-connection-panel">
            <h3>Conexión con Meta</h3>
            <p>
              Como <b>{status.usuario?.nombre ?? '—'}</b>, con la app {status.appId}.
            </p>
            <p className={cx(days !== null && days <= EXPIRY_WARNING && 'is-warning')}>
              {status.caduca
                ? `Caduca ${formatWhen(status.caduca)}${days !== null ? ` (en ${days === 1 ? '1 día' : `${days} días`})` : ''}.`
                : 'No caduca.'}
              {' '}Al volver a conectar empiezan otros 60 días.
            </p>
            {status.faltan.length > 0 && (
              <p className="is-warning">
                Faltan permisos: {status.faltan.join(', ')}. Vuelve a conectar y acéptalos todos.
              </p>
            )}
            {error && (
              <p className="ads-error" role="alert">
                {error}
              </p>
            )}
            <div className="ads-connection-actions">
              <button type="button" className="btn" onClick={() => connect(status.caduca)}>
                Volver a conectar
              </button>
              <button
                type="button"
                className="danger-btn"
                onClick={() => {
                  metaApi.disconnect().then(onChange, (err) => setError(errorText(err)))
                }}
              >
                Desconectar
              </button>
            </div>
            <p className="ads-version">API de Meta {status.version}</p>
          </div>
        </Popover>
      )}
    </>
  )
}

// ── Cuentas, plantillas y campañas ──

function Workspace({ status, onStatus }: { status: MetaStatus; onStatus: (status: MetaStatus) => void }) {
  const { portfolios, selected: accountId, loading, error: accountsError, disconnected } = metaAccounts.useAccounts()
  const [templates, setTemplates] = useState<Template[]>([])
  const [launches, setLaunches] = useState<Launch[]>([])
  const [section, setSection] = useStoredState<Section>('tablero.anuncios.seccion', 'marcha')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void metaAccounts.load()
    metaApi.saved().then(
      (saved) => {
        setTemplates(saved.plantillas)
        setLaunches(saved.lanzamientos)
      },
      (err) => setError(errorText(err)),
    )
  }, [status.usuario?.id])

  // La conexión caducó o se retiró: se vuelve a la pantalla de conectar.
  useEffect(() => {
    if (disconnected) metaApi.status().then(onStatus, () => {})
  }, [disconnected, onStatus])

  const accounts = portfolios?.flatMap((p) => p.cuentas.map((account) => ({ account, portfolio: p }))) ?? []
  const selected = accounts.find((a) => a.account.id === accountId) ?? null

  // Sin elegir todavía (o si la elegida ya no está), la primera activa.
  useEffect(() => {
    if (!portfolios || selected) return
    const first = accounts.find((a) => a.account.activa) ?? accounts[0]
    if (first) metaAccounts.select(first.account.id)
  }, [portfolios, selected, accounts])

  const saveTemplates = useCallback(async (next: Template[]) => {
    const saved = await metaApi.saveTemplates(next)
    setTemplates(saved)
    return saved
  }, [])

  const updateLaunch = useCallback((launch: Launch) => {
    setLaunches((list) => [launch, ...list.filter((l) => l.id !== launch.id)])
  }, [])

  if (!portfolios) {
    return accountsError ? (
      <div className="ads-error-box" role="alert">
        <p>{accountsError}</p>
        <button type="button" className="btn" disabled={loading} onClick={() => void metaAccounts.load(true)}>
          Reintentar
        </button>
      </div>
    ) : (
      <p className="ads-loading" aria-busy="true">
        Cargando tus cuentas publicitarias…
      </p>
    )
  }

  const shownError = error ?? accountsError
  return (
    <div className="ads-main">
      {shownError && (
        <p className="ads-error" role="alert">
          {shownError}
        </p>
      )}
      {selected ? (
        <>
          <div className="ads-account-title">
            <Avatar name={selected.portfolio.nombre} src={selected.portfolio.foto} />
            <div className="ads-account-title-text">
              <h3>
                <AccountSwitcher store={metaAccounts} portfolios={portfolios} account={selected.account} loading={loading} />
              </h3>
              <p>
                {selected.portfolio.nombre} · {selected.account.moneda}
                {!selected.account.activa && <span className="ads-inactive"> · Cuenta {selected.account.estado}</span>}
              </p>
            </div>
            <Segmented value={section === 'nueva' ? 'nueva' : 'marcha'} options={SECTIONS} label="Sección" onChange={setSection} />
          </div>
          {section !== 'nueva' && (
            <RunningCampaigns
              key={selected.account.id}
              account={selected.account}
              source={META_RUNNING}
              meta={{ templates, onTemplates: saveTemplates, onLaunch: updateLaunch, onCreate: () => setSection('nueva') }}
            />
          )}
          {/* Oculta en vez de quitada: lo que se esté preparando sigue ahí al volver. */}
          <div hidden={section !== 'nueva'}>
            <AdsComposer
              key={selected.account.id}
              account={selected.account}
              templates={templates}
              launches={launches.filter((l) => l.cuenta === selected.account.id)}
              onTemplates={saveTemplates}
              onLaunch={updateLaunch}
            />
          </div>
        </>
      ) : (
        <p className="ads-empty">
          No hay cuentas publicitarias a las que Tablero pueda acceder. Vuelve a conectar y da acceso a los portfolios que
          quieras gestionar.
        </p>
      )}
    </div>
  )
}

/**
 * El nombre de la cuenta, que abre la lista para cambiar a otra. Las cuentas están también en el menú lateral;
 * esto sirve cuando el menú está oculto o se queda en iconos.
 */
export function AccountSwitcher({
  store,
  portfolios,
  account,
  loading,
  heading = 'Portfolios',
}: {
  store: AccountStore
  portfolios: Portfolio[]
  account: AdAccount
  loading: boolean
  /** Cómo se llaman los grupos de cuentas: los portfolios de Meta, las cuentas de Google Ads. */
  heading?: string
}) {
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        ref={button}
        type="button"
        className="ads-switcher"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Cambiar de cuenta"
        onClick={() => setOpen(!open)}
      >
        <span>{account.nombre}</span>
        <Icon.Chevron />
      </button>
      {open && button.current && (
        <Popover anchor={button.current} placement="below-start" width={300} label="Cuentas publicitarias" onClose={() => setOpen(false)}>
          <AccountList
            heading={heading}
            portfolios={portfolios}
            selected={account.id}
            loading={loading}
            onSelect={(id) => {
              store.select(id)
              setOpen(false)
            }}
            onRefresh={() => void store.load(true)}
          />
        </Popover>
      )}
    </>
  )
}

function AccountList({
  heading,
  portfolios,
  selected,
  loading,
  onSelect,
  onRefresh,
}: {
  heading: string
  portfolios: Portfolio[]
  selected: string | null
  loading: boolean
  onSelect: (id: string) => void
  onRefresh: () => void
}) {
  return (
    <nav className="ads-accounts" aria-label="Cuentas publicitarias">
      <div className="ads-accounts-head">
        <h3>{heading}</h3>
        <button type="button" className="icon-btn" aria-label="Actualizar las cuentas" title="Actualizar las cuentas" disabled={loading} onClick={onRefresh}>
          <Icon.Reload />
        </button>
      </div>
      {portfolios.map((portfolio) => (
        <section key={portfolio.id} className="ads-portfolio" aria-label={portfolio.nombre}>
          <div className="ads-portfolio-name">
            <Avatar name={portfolio.nombre} src={portfolio.foto} />
            <span>{portfolio.nombre}</span>
          </div>
          {portfolio.cuentas.map((account) => (
            <button
              key={account.id}
              type="button"
              className={cx('ads-account', !account.activa && 'is-inactive')}
              aria-current={account.id === selected ? 'true' : undefined}
              onClick={() => onSelect(account.id)}
            >
              <span className="ads-account-name">{account.nombre}</span>
              <span className="ads-account-meta">{account.activa ? account.moneda : account.estado}</span>
            </button>
          ))}
        </section>
      ))}
    </nav>
  )
}

/** Foto de un portfolio o de una página; sin foto, su inicial. */
export function Avatar({ name, src }: { name: string; src: string | null }) {
  const [broken, setBroken] = useState(false)
  if (src && !broken) return <img className="ads-avatar" src={src} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
  return (
    <span className="ads-avatar is-initial" aria-hidden="true">
      {name.trim().charAt(0).toUpperCase() || '·'}
    </span>
  )
}
