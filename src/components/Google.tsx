import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { googleAccounts } from '../adAccounts'
import { googleApi, googleRedirectUri, type GoogleStatus } from '../ads'
import { formatWhen } from '../dates'
import { cx } from '../util'
import { AccountSwitcher, Avatar, CopyLine, errorText, useConnect, type Connection } from './Ads'
import { RunningCampaigns, type RunningSource } from './AdsRunning'
import { GoogleEditor } from './GoogleEdit'
import * as Icon from './Icons'
import { Popover } from './Popover'
import '../styles/anuncios.css'

/** La página de la API de Google Ads en Cloud Console (activarla y pedir el acceso Explorer). */
const CLOUD_API = 'https://console.cloud.google.com/apis/library/googleads.googleapis.com'
const CLOUD_CLIENTS = 'https://console.cloud.google.com/auth/clients'

const GOOGLE_CONNECTION: Connection<GoogleStatus> = {
  url: '/api/google/conectar',
  window: 'tablero-google',
  status: googleApi.status,
  stamp: (s) => s.conectadaEn,
}

/** «En marcha» con Google Ads: sus métricas y cómo llama a cada nivel. */
const GOOGLE_SOURCE: RunningSource = {
  storage: 'tablero.google',
  metrics: [
    { key: 'gasto', label: 'Coste', format: 'money' },
    { key: 'conversiones', label: 'Conversiones', format: 'number' },
    { key: 'coste', label: 'Coste por conversión', format: 'money' },
    { key: 'tasa', label: 'Tasa de conversión', format: 'percent', hint: 'Conversiones por cada 100 clics' },
    { key: 'valor', label: 'Valor de conversiones', format: 'money' },
    { key: 'roas', label: 'ROAS', format: 'ratio', hint: 'Valor de las conversiones por cada unidad gastada' },
    { key: 'impresiones', label: 'Impresiones', format: 'count', hint: 'Veces que se ha visto' },
    { key: 'clics', label: 'Clics', format: 'count' },
    { key: 'ctr', label: 'CTR', format: 'percent', hint: 'Clics por cada 100 impresiones' },
    { key: 'cpc', label: 'CPC medio', format: 'money', hint: 'Coste por clic' },
    { key: 'cpm', label: 'CPM', format: 'money', hint: 'Coste por mil impresiones' },
  ],
  defaultMetrics: ['gasto', 'clics', 'ctr', 'cpc', 'conversiones', 'coste'],
  levels: {
    campana: {
      nombre: 'Campaña',
      pestana: 'Campañas',
      plural: 'campañas',
      el: 'la campaña',
      activo: 'Activa',
      activado: 'activada',
      vacio: 'No hay campañas activas ni en pausa en esta cuenta.',
      ninguno: 'Ninguna campaña en marcha.',
      abrir: 'ver sus grupos de anuncios',
    },
    conjunto: {
      nombre: 'Grupo de anuncios',
      pestana: 'Grupos',
      plural: 'grupos de anuncios',
      el: 'el grupo de anuncios',
      activo: 'Activo',
      activado: 'activado',
      vacio: 'No hay grupos de anuncios activos ni en pausa aquí.',
      ninguno: 'Ningún grupo de anuncios en marcha.',
      abrir: 'ver sus anuncios',
    },
    anuncio: {
      nombre: 'Anuncio',
      pestana: 'Anuncios',
      plural: 'anuncios',
      el: 'el anuncio',
      activo: 'Activo',
      activado: 'activado',
      vacio: 'No hay anuncios activos ni en pausa aquí.',
      ninguno: 'Ningún anuncio en marcha.',
    },
  },
  budgets: ['campana'],
  thumbnails: false,
  where: 'Google Ads',
  rows: googleApi.rows,
  setStatus: googleApi.setStatus,
  editor: (props) => <GoogleEditor {...props} />,
  remove: { label: 'Quitar', run: googleApi.remove },
}

/** «1234567890» como lo escribe Google Ads: «123-456-7890». */
const customerId = (id: string) => id.replace(/^(\d{3})(\d{3})(\d+)$/, '$1-$2-$3')

/**
 * Google Ads: conectar la cuenta de Google (una vez, con el cliente OAuth de un proyecto de Google Cloud) y,
 * después, elegir una cuenta (también las de una cuenta de administrador) y ver cómo van sus campañas, grupos de
 * anuncios y anuncios, y pausarlos o activarlos.
 */
export function GoogleAdsView() {
  const titleId = useId()
  const [status, setStatus] = useState<GoogleStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    googleApi.status().then(
      (s) => {
        setStatus(s)
        setError(null)
      },
      (err) => setError(errorText(err)),
    )
  }, [])
  useEffect(() => {
    load()
    // Al volver a la ventana (p. ej. tras conectar en la de Google), se mira otra vez.
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])
  // Sin conexión, el menú lateral deja de enseñar las cuentas.
  useEffect(() => {
    if (status && !status.conectada) googleAccounts.forget()
  }, [status])

  return (
    <main className="ads" aria-labelledby={titleId}>
      <header className="ads-head">
        <h2 id={titleId}>Google Ads</h2>
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

function Setup({ status, onChange }: { status: GoogleStatus; onChange: (status: GoogleStatus) => void }) {
  const ids = useId()
  const [editing, setEditing] = useState(!status.cliente)
  const [clientId, setClientId] = useState(status.clienteId ?? '')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const connect = useConnect(GOOGLE_CONNECTION, onChange, setError)

  const saveClient = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onChange(await googleApi.saveClient(clientId.trim(), secret.trim()))
      setSecret('')
      setEditing(false)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="ads-setup" aria-labelledby={`${ids}-title`}>
      <span className="ads-setup-icon" aria-hidden="true">
        <Icon.Chart />
      </span>
      <div className="ads-setup-body">
        <h3 id={`${ids}-title`}>Conecta Tablero con Google Ads</h3>
        <p className="ads-setup-lead">
          Una vez conectado, verás tus cuentas de Google Ads (también las de tu cuenta de administrador) con sus campañas,
          grupos de anuncios y anuncios, sus métricas, y podrás pausarlos o activarlos.
        </p>

        <ol className="ads-steps">
          <li className={cx(status.cliente && 'is-done')}>
            <h4>Un proyecto de Google Cloud con la API de Google Ads</h4>
            <p>
              En console.cloud.google.com, crea un proyecto (o usa uno que ya tengas) y activa la <b>Google Ads API</b>. En
              su página, solicita el <b>acceso Explorer</b>: sin él solo se ven cuentas de prueba. No hace falta token de
              desarrollador ni cuenta de administrador.
            </p>
            <p>
              En Google Auth Platform › Público, pulsa <b>Publicar app</b>: mientras esté en «Prueba», Google corta la
              conexión cada 7 días. Si al conectar avisa de que la app no está verificada, es la tuya: continúa.
            </p>
            <a className="btn" href={CLOUD_API} target="_blank" rel="noreferrer">
              <Icon.External />
              Abrir la API en Google Cloud
            </a>
          </li>

          <li className={cx(status.cliente && 'is-done')}>
            <h4>Un cliente OAuth</h4>
            <p>
              En Google Auth Platform › Clientes, crea uno de tipo <b>Aplicación web</b> con esta dirección en «URI de
              redireccionamiento autorizados»:
            </p>
            <CopyLine value={googleRedirectUri()} />
            {editing ? (
              <form className="ads-app-form" onSubmit={saveClient}>
                <p>Su identificador y su clave secreta se guardan solo en este Mac.</p>
                <div className="field">
                  <label className="field-label" htmlFor={`${ids}-client`}>
                    ID de cliente
                  </label>
                  <input
                    id={`${ids}-client`}
                    className="input"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="…apps.googleusercontent.com"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor={`${ids}-secret`}>
                    Secreto del cliente
                  </label>
                  <input
                    id={`${ids}-secret`}
                    className="input"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="GOCSPX-…"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                  />
                </div>
                <div className="ads-form-foot">
                  {status.cliente && (
                    <button type="button" className="link-btn" onClick={() => setEditing(false)}>
                      Cancelar
                    </button>
                  )}
                  <button type="submit" className="btn" disabled={busy || !clientId.trim() || !secret.trim()}>
                    Guardar
                  </button>
                </div>
              </form>
            ) : (
              <p className="ads-saved-app">
                <Icon.Check />
                Cliente {status.clienteId?.split('-')[0]}
                <button type="button" className="link-btn" onClick={() => setEditing(true)}>
                  Cambiar
                </button>
              </p>
            )}
            <a className="link-btn" href={CLOUD_CLIENTS} target="_blank" rel="noreferrer">
              Abrir los clientes en Google Cloud
            </a>
          </li>

          <li>
            <h4>Tu cuenta de Google</h4>
            <p>
              Se abre una ventana de Google: entra con la cuenta que usas en Google Ads y deja marcada la casilla de Google
              Ads. Tablero guarda la conexión en este Mac hasta que la quites.
            </p>
            <div className="ads-connect-row">
              <button type="button" className="btn is-accent" disabled={!status.cliente || busy} onClick={() => connect()}>
                Conectar con Google
              </button>
            </div>
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

/** El correo de la cuenta de Google, con lo que se puede hacer con la conexión. */
function ConnectionButton({ status, onChange }: { status: GoogleStatus; onChange: (status: GoogleStatus) => void }) {
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const connect = useConnect(GOOGLE_CONNECTION, onChange, setError)
  const email = status.usuario?.email ?? 'Conectado'

  return (
    <>
      <button ref={button} type="button" className="ads-connection" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="ads-connection-dot" aria-hidden="true" />
        {email}
      </button>
      {open && button.current && (
        <Popover anchor={button.current} placement="below-end" width={300} label="Conexión con Google Ads" onClose={() => setOpen(false)}>
          <div className="ads-connection-panel">
            <h3>Conexión con Google Ads</h3>
            <p>
              Como <b>{email}</b>
              {status.conectadaEn && <>, desde {formatWhen(status.conectadaEn)}</>}.
            </p>
            <p>No caduca mientras la app de tu proyecto esté publicada y no retires el acceso en tu cuenta de Google.</p>
            {error && (
              <p className="ads-error" role="alert">
                {error}
              </p>
            )}
            <div className="ads-connection-actions">
              <button type="button" className="btn" onClick={() => connect(status.conectadaEn)}>
                Volver a conectar
              </button>
              <button
                type="button"
                className="danger-btn"
                onClick={() => {
                  googleApi.disconnect().then(onChange, (err) => setError(errorText(err)))
                }}
              >
                Desconectar
              </button>
            </div>
            <p className="ads-version">API de Google Ads {status.version}</p>
          </div>
        </Popover>
      )}
    </>
  )
}

function Workspace({ status, onStatus }: { status: GoogleStatus; onStatus: (status: GoogleStatus) => void }) {
  const { portfolios, selected: accountId, loading, error, disconnected } = googleAccounts.useAccounts()

  useEffect(() => {
    void googleAccounts.load()
  }, [status.usuario?.email])

  // La conexión caducó o se retiró: se vuelve a la pantalla de conectar.
  useEffect(() => {
    if (disconnected) googleApi.status().then(onStatus, () => {})
  }, [disconnected, onStatus])

  const accounts = portfolios?.flatMap((p) => p.cuentas.map((account) => ({ account, portfolio: p }))) ?? []
  const selected = accounts.find((a) => a.account.id === accountId) ?? null

  // Sin elegir todavía (o si la elegida ya no está), la primera activa.
  useEffect(() => {
    if (!portfolios || selected) return
    const first = accounts.find((a) => a.account.activa) ?? accounts[0]
    if (first) googleAccounts.select(first.account.id)
  }, [portfolios, selected, accounts])

  if (!portfolios) {
    return error ? (
      <div className="ads-error-box" role="alert">
        <p>{error}</p>
        <button type="button" className="btn" disabled={loading} onClick={() => void googleAccounts.load(true)}>
          Reintentar
        </button>
      </div>
    ) : (
      <p className="ads-loading" aria-busy="true">
        Cargando tus cuentas de Google Ads…
      </p>
    )
  }

  return (
    <div className="ads-main">
      {error && (
        <p className="ads-error" role="alert">
          {error}
        </p>
      )}
      {selected ? (
        <>
          <div className="ads-account-title">
            <Avatar name={selected.account.nombre} src={null} />
            <div className="ads-account-title-text">
              <h3>
                <AccountSwitcher store={googleAccounts} heading="Cuentas" portfolios={portfolios} account={selected.account} loading={loading} />
              </h3>
              <p>
                {selected.portfolio.nombre} · {customerId(selected.account.id)} · {selected.account.moneda}
                {selected.account.prueba && ' · de prueba'}
                {!selected.account.activa && <span className="ads-inactive"> · Cuenta {selected.account.estado}</span>}
              </p>
            </div>
          </div>
          <RunningCampaigns key={selected.account.id} account={selected.account} source={GOOGLE_SOURCE} />
        </>
      ) : (
        <p className="ads-empty">
          No hay cuentas de Google Ads a las que Tablero pueda acceder con esta cuenta de Google. Vuelve a conectar con la
          cuenta que usas en Google Ads.
        </p>
      )}
    </div>
  )
}
