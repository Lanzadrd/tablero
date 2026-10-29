import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { googleAccounts, metaAccounts } from '../adAccounts'
import { metaApi, phoneOf, summariesApi, templateKind, type DailySummary, type MetaStatus, type Portfolio, type SummarySend, type WhatsappBusiness, type WhatsappTemplate } from '../ads'
import { useBoard, useUI } from '../context'
import { cx } from '../util'
import { AD_PERMISSIONS, errorText, TokenForm, useConnect, type Connection } from './Ads'
import { Field } from './AdsComposer'
import * as Icon from './Icons'
import { Switch } from './Switch'
import '../styles/resumenes.css'

/** La conexión con Meta pidiendo también los permisos de WhatsApp. */
const WHATSAPP_CONNECTION: Connection<MetaStatus> = {
  url: '/api/meta/conectar?whatsapp=1',
  window: 'tablero-meta',
  status: metaApi.status,
  stamp: (s) => `${s.whatsapp}:${s.caduca}`,
}

/** Un resumen nuevo: a las 9, sin activar hasta que tenga número, destinos y plantilla. */
const newSummary = (): DailySummary => ({
  id: crypto.randomUUID(),
  nombre: 'Nuevo resumen',
  activo: false,
  hora: '09:00',
  meta: [],
  google: [],
  columna: null,
  numero: null,
  destinos: [],
  ultimoEnvio: null,
  prueba: null,
})

const SAVE_DELAY = 600

/**
 * Resúmenes por WhatsApp: cada día, a su hora, un mensaje por empresa con cómo fueron ayer sus anuncios de Meta y
 * de Google, lo que hay que revisar y sus tareas del día (server/resumenes.mjs). Sale de un número de WhatsApp de
 * la empresa con la conexión de Meta, que necesita los permisos de WhatsApp.
 */
export function SummariesView() {
  const titleId = useId()
  const [status, setStatus] = useState<MetaStatus | null>(null)
  const [list, setList] = useState<DailySummary[] | null>(null)
  const [numbers, setNumbers] = useState<WhatsappBusiness[] | null>(null)
  const [numbersError, setNumbersError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef<DailySummary[] | null>(null)

  const loadStatus = useCallback(() => {
    metaApi.status().then(setStatus, (err) => setError(errorText(err)))
  }, [])
  const loadNumbers = useCallback(() => {
    setNumbersError(null)
    summariesApi.numbers().then(setNumbers, (err) => setNumbersError(errorText(err)))
  }, [])

  useEffect(() => {
    loadStatus()
    summariesApi.list().then(setList, (err) => setError(errorText(err)))
    // Al volver a la ventana (p. ej. tras dar el permiso en la de Meta), se mira otra vez.
    window.addEventListener('focus', loadStatus)
    return () => window.removeEventListener('focus', loadStatus)
  }, [loadStatus])
  useEffect(() => {
    if (status?.whatsapp) loadNumbers()
  }, [status?.whatsapp, loadNumbers])
  useEffect(() => () => clearTimeout(saveTimer.current ?? undefined), [])

  /** Cambia la lista y la guarda al poco (lo que se escribe seguido va en un solo guardado). */
  const change = (next: DailySummary[]) => {
    setList(next)
    latest.current = next
    setSaving('saving')
    clearTimeout(saveTimer.current ?? undefined)
    saveTimer.current = setTimeout(() => {
      const sent = latest.current
      if (!sent) return
      summariesApi.save(sent).then(
        () => {
          if (latest.current !== sent) return
          setSaving('saved')
          setError(null)
        },
        (err) => {
          setSaving('error')
          setError(errorText(err))
        },
      )
    }, SAVE_DELAY)
  }
  const update = (id: string, patch: Partial<DailySummary>) => list && change(list.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  /** Lo que devuelve el servidor tras mandar uno (el último envío) entra sin volver a guardar. */
  const record = (id: string, patch: Partial<DailySummary>) => setList((current) => current?.map((s) => (s.id === id ? { ...s, ...patch } : s)) ?? current)

  return (
    <main className="ads summaries" aria-labelledby={titleId}>
      <header className="ads-head">
        <h2 id={titleId}>Resúmenes por WhatsApp</h2>
        {list && (
          <button type="button" className="ads-create-btn" onClick={() => change([...list, newSummary()])}>
            <Icon.Plus />
            Nuevo resumen
          </button>
        )}
      </header>
      <p className="summaries-intro">
        Cada día, a la hora que elijas, te llega por WhatsApp cómo fueron ayer los anuncios de una empresa en Meta y en Google, lo que hay que
        revisar (anuncios rechazados, campañas que no gastan o que terminan, costes que se disparan) y las tareas del día de su columna.
      </p>

      {error && (
        <p className="ads-error" role="alert">
          {error}
        </p>
      )}
      {status && <Permission status={status} onStatus={setStatus} />}
      {status?.whatsapp && numbersError && (
        <div className="ads-error-box">
          <p>{numbersError}</p>
          <button type="button" className="btn" onClick={loadNumbers}>
            Reintentar
          </button>
        </div>
      )}

      {!list ? (
        !error && <p className="ads-loading">Cargando…</p>
      ) : list.length === 0 ? (
        <p className="ads-empty">Aún no hay resúmenes. Crea uno por empresa con «Nuevo resumen».</p>
      ) : (
        <div className="summaries-list">
          {list.map((summary) => (
            <SummaryCard
              key={summary.id}
              summary={summary}
              numbers={numbers}
              whatsapp={Boolean(status?.whatsapp)}
              onChange={(patch) => update(summary.id, patch)}
              onRecord={(patch) => record(summary.id, patch)}
              onRemove={() => change(list.filter((s) => s.id !== summary.id))}
              onTemplate={loadNumbers}
              saved={saving !== 'saving'}
            />
          ))}
        </div>
      )}
      <p className="summaries-saving" aria-live="polite">
        {saving === 'saving' ? 'Guardando…' : saving === 'saved' ? 'Guardado' : ''}
      </p>
    </main>
  )
}

/** Sin conexión con Meta, o sin los permisos de WhatsApp: qué hacer. */
function Permission({ status, onStatus }: { status: MetaStatus; onStatus: (status: MetaStatus) => void }) {
  const ui = useUI()
  const [error, setError] = useState<string | null>(null)
  const [pasting, setPasting] = useState(false)
  const connect = useConnect(WHATSAPP_CONNECTION, onStatus, setError)
  if (!status.conectada) {
    return (
      <section className="ads-card summaries-permission">
        <h4>Conecta Tablero con Meta</h4>
        <p className="ads-note">Los resúmenes leen los anuncios y salen por WhatsApp con la conexión de Meta.</p>
        <div>
          <button type="button" className="btn" onClick={() => ui.setView('ads')}>
            Ir a Meta Ads
          </button>
        </div>
      </section>
    )
  }
  if (status.whatsapp) return null
  return (
    <section className="ads-card summaries-permission">
      <h4>Falta el permiso de WhatsApp</h4>
      <p className="ads-note">
        Para mandar los resúmenes desde tus números de WhatsApp, Meta tiene que dejar a Tablero usar la API de WhatsApp. Se abre la ventana de Meta:
        acepta los permisos de WhatsApp y elige las cuentas de WhatsApp de tus empresas. Si Meta dice que esos permisos no son válidos, añade a la
        app de Meta el caso de uso «Conectar con clientes a través de WhatsApp» (developers.facebook.com › tu app › Casos de uso). Si la ventana dice
        «Can't load URL» (con la app publicada, Meta no deja volver a Tablero), pega un token.
      </p>
      <div className="summaries-permission-actions">
        <button type="button" className="btn is-accent" onClick={() => connect(WHATSAPP_CONNECTION.stamp(status))}>
          Dar permiso de WhatsApp
        </button>
        <button type="button" className="link-btn" aria-expanded={pasting} onClick={() => setPasting(!pasting)}>
          Pegar un token
        </button>
      </div>
      {pasting && (
        <TokenForm permissions={`${AD_PERMISSIONS.replace(' y ', ', ')}, whatsapp_business_management y whatsapp_business_messaging`} onSaved={onStatus} />
      )}
      {error && (
        <p className="ads-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

const TEMPLATE_STATES: Record<string, { text: string; tone: 'ok' | 'warning' | 'off' }> = {
  APPROVED: { text: 'Plantilla aprobada', tone: 'ok' },
  PENDING: { text: 'Plantilla en revisión por Meta (suele tardar de minutos a unas horas)', tone: 'off' },
  IN_APPEAL: { text: 'Plantilla en apelación', tone: 'off' },
  REJECTED: { text: 'Meta rechazó la plantilla', tone: 'warning' },
  PAUSED: { text: 'Meta ha pausado la plantilla', tone: 'warning' },
  DISABLED: { text: 'Meta ha desactivado la plantilla', tone: 'warning' },
}

function SummaryCard({
  summary,
  numbers,
  whatsapp,
  saved,
  onChange,
  onRecord,
  onRemove,
  onTemplate,
}: {
  summary: DailySummary
  numbers: WhatsappBusiness[] | null
  whatsapp: boolean
  /** No hay cambios sin guardar (para mandar lo que se ve). */
  saved: boolean
  onChange: (patch: Partial<DailySummary>) => void
  onRecord: (patch: Partial<DailySummary>) => void
  onRemove: () => void
  onTemplate: () => void
}) {
  const ids = useId()
  const board = useBoard()
  const meta = metaAccounts.useAccounts()
  const google = googleAccounts.useAccounts()
  useEffect(() => {
    void metaAccounts.load()
    void googleAccounts.load()
  }, [])

  const account = numbers?.flatMap((b) => b.cuentas).find((c) => c.numeros.some((n) => n.id === summary.numero?.id)) ?? null
  const kind = templateKind(summary)
  const template = account?.plantillas[kind] ?? null
  const [busy, setBusy] = useState<'template' | 'send' | 'preview' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)

  const run = async (kind: 'template' | 'send' | 'preview', fn: () => Promise<void>) => {
    setBusy(kind)
    setMessage(null)
    try {
      await fn()
    } catch (err) {
      setMessage(errorText(err))
    } finally {
      setBusy(null)
    }
  }
  const showPreview = () =>
    run('preview', async () => {
      setPreview(await summariesApi.preview(summary))
    })
  const sendNow = () =>
    run('send', async () => {
      const envio = await summariesApi.send(summary.id)
      onRecord({ prueba: envio })
      if (envio.texto) setPreview(envio.texto)
    })
  const askTemplate = () =>
    run('template', async () => {
      if (!account) return
      await summariesApi.createTemplate(account.id, kind)
      onTemplate()
    })

  const columns = board.columns.filter((c) => !c.archived)
  const missing = [
    !summary.numero && 'el número desde el que sale',
    !summary.destinos.length && 'a quién se manda',
    !summary.meta.length && !summary.google.length && !summary.columna && 'qué cuentas o tareas entran',
  ].filter(Boolean)
  const ready = missing.length === 0 && template?.estado === 'APPROVED'

  return (
    <section className={cx('ads-card summary-card', !summary.activo && 'is-off')} aria-labelledby={`${ids}-name`}>
      <div className="summary-head">
        <h4 className="sr-only" id={`${ids}-name`}>
          {summary.nombre}
        </h4>
        <input
          className="input summary-name"
          aria-label="Nombre del resumen (es como sale en el mensaje)"
          value={summary.nombre}
          maxLength={80}
          onChange={(e) => onChange({ nombre: e.target.value })}
        />
        <label className="summary-active">
          <Switch checked={summary.activo} label={`Mandar «${summary.nombre}» cada día`} onChange={(activo) => onChange({ activo })} />
          <span>{summary.activo ? `Cada día a las ${summary.hora}` : 'Desactivado'}</span>
        </label>
        {removing ? (
          <span className="summary-remove">
            <button type="button" className="link-btn" onClick={() => setRemoving(false)}>
              Cancelar
            </button>
            <button type="button" className="link-btn is-danger" onClick={onRemove}>
              Quitar el resumen
            </button>
          </span>
        ) : (
          <button type="button" className="icon-btn" aria-label={`Quitar «${summary.nombre}»`} title="Quitar" onClick={() => setRemoving(true)}>
            <Icon.Trash />
          </button>
        )}
      </div>

      <div className="summary-body">
        <div className="ads-fields">
          <Field label="Sale de" htmlFor={`${ids}-from`} note={templateNote(summary, template, account, whatsapp, numbers)}>
            <select
              id={`${ids}-from`}
              className="input"
              value={summary.numero?.id ?? ''}
              disabled={!numbers}
              onChange={(e) => {
                const found = numbers?.flatMap((b) => b.cuentas.flatMap((c) => c.numeros.map((n) => ({ ...n, cuenta: c.id })))).find((n) => n.id === e.target.value)
                onChange({ numero: found ? { id: found.id, cuenta: found.cuenta, telefono: found.telefono, nombre: found.nombre } : null })
              }}
            >
              <option value="">{numbers ? 'Elige un número…' : summary.numero ? `${summary.numero.telefono} · ${summary.numero.nombre}` : 'Sin permiso de WhatsApp'}</option>
              {numbers?.map((b) => (
                <optgroup key={b.id} label={b.nombre}>
                  {b.cuentas.flatMap((c) =>
                    c.numeros.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.telefono} · {n.nombre}
                      </option>
                    )),
                  )}
                </optgroup>
              ))}
            </select>
            {account && !template?.estado && (
              <button type="button" className="btn" disabled={busy !== null} onClick={() => void askTemplate()}>
                {busy === 'template' ? 'Pidiendo…' : 'Pedir la plantilla a Meta'}
              </button>
            )}
            {account && template?.estado && template.estado !== 'APPROVED' && (
              <button type="button" className="link-btn" onClick={onTemplate}>
                Volver a mirar
              </button>
            )}
          </Field>
          <Recipients id={`${ids}-to`} value={summary.destinos} onChange={(destinos) => onChange({ destinos })} />
          <Field label="Hora" htmlFor={`${ids}-time`} note="La de este Mac. Si a esa hora está dormido, sale al despertar.">
            <input
              id={`${ids}-time`}
              className="input summary-time"
              type="time"
              step={900}
              value={summary.hora}
              onChange={(e) => e.target.value && onChange({ hora: e.target.value })}
            />
          </Field>
          <Field label="Tareas" htmlFor={`${ids}-column`}>
            <select id={`${ids}-column`} className="input" value={summary.columna ?? ''} onChange={(e) => onChange({ columna: e.target.value || null })}>
              <option value="">Sin tareas</option>
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="summary-accounts">
          <AccountPicker
            title="Meta Ads"
            icon={<Icon.MetaLogo />}
            portfolios={meta.portfolios}
            loading={meta.loading}
            empty={meta.disconnected ? 'Conecta Meta Ads para elegir sus cuentas.' : null}
            chosen={summary.meta}
            onChange={(list) => onChange({ meta: list })}
          />
          <AccountPicker
            title="Google Ads"
            icon={<Icon.GoogleAdsLogo />}
            portfolios={google.portfolios}
            loading={google.loading}
            empty={google.disconnected ? 'Conecta Google Ads para elegir sus cuentas.' : null}
            chosen={summary.google}
            onChange={(list) => onChange({ google: list })}
          />
        </div>
      </div>

      <div className="summary-foot">
        <p className={cx('summary-status', summary.activo && !ready && 'is-warning')}>
          {summary.activo && missing.length ? `Para que salga falta ${missing.join(', ')}.` : summary.activo && !ready ? 'Saldrá cuando Meta apruebe la plantilla.' : lastText(summary)}
        </p>
        <div className="summary-actions">
          <button type="button" className="btn" disabled={busy !== null} aria-expanded={preview !== null} onClick={() => (preview === null ? void showPreview() : setPreview(null))}>
            {busy === 'preview' ? 'Preparando…' : preview === null ? 'Vista previa' : 'Ocultar la vista previa'}
          </button>
          <button
            type="button"
            className="btn is-accent"
            disabled={busy !== null || missing.length > 0 || template?.estado !== 'APPROVED' || !saved}
            title={template?.estado !== 'APPROVED' ? 'Hace falta la plantilla aprobada' : undefined}
            onClick={() => void sendNow()}
          >
            {busy === 'send' ? 'Enviando…' : 'Enviar ahora'}
          </button>
        </div>
      </div>
      {message && (
        <p className="ads-error" role="alert">
          {message}
        </p>
      )}
      {summary.prueba && !summary.prueba.ok && summary.prueba.error && !message && (
        <p className="ads-error" role="alert">
          {summary.prueba.error}
        </p>
      )}
      {preview !== null && <SummaryPreview text={preview} from={summary.numero} hour={summary.hora} />}
    </section>
  )
}

/** Debajo del número: cómo está su plantilla (sin ella aprobada, WhatsApp no deja mandar el resumen). */
function templateNote(
  summary: DailySummary,
  template: WhatsappTemplate | null,
  account: WhatsappBusiness['cuentas'][number] | null,
  whatsapp: boolean,
  numbers: WhatsappBusiness[] | null,
) {
  if (!whatsapp) return 'Hace falta el permiso de WhatsApp (arriba).'
  if (!numbers) return 'Cargando tus números de WhatsApp…'
  if (!summary.numero) return 'Un número de WhatsApp de la empresa: el mensaje llega desde él.'
  if (!account) return 'Ese número ya no está entre los tuyos: elige otro.'
  if (template?.error) return template.error
  if (!template?.estado) {
    const which = { meta: 'con Meta Ads', google: 'con Google Ads', meta_google: 'con Meta y Google Ads' }[templateKind(summary)]
    return `Su cuenta de WhatsApp necesita la plantilla del resumen ${which}: pídela a Meta (una vez por cuenta).`
  }
  const state = TEMPLATE_STATES[template.estado]
  const text = state?.text ?? `Plantilla: ${template.estado}`
  return template.motivo ? `${text}: ${template.motivo}` : text
}

/** «Último: hoy a las 09:00, a 2 números» o el error. */
function lastText(summary: DailySummary) {
  const last: SummarySend | null = summary.ultimoEnvio
  if (!last) return summary.activo ? `El primero sale a las ${summary.hora}.` : 'Actívalo para que salga cada día.'
  const when = new Date(last.en).toLocaleString('es-ES', { weekday: 'long', hour: '2-digit', minute: '2-digit' })
  if (last.ok) return `Último: el ${when}, a ${last.enviados.length === 1 ? '1 número' : `${last.enviados.length} números`}.`
  return `El del ${when} no salió: ${last.error}`
}

/** Los números a los que va, separados por comas; se guardan al salir del campo (si todos son válidos). */
function Recipients({ id, value, onChange }: { id: string; value: string[]; onChange: (list: string[]) => void }) {
  const [text, setText] = useState(value.join(', '))
  const [invalid, setInvalid] = useState<string[]>([])
  useEffect(() => setText(value.join(', ')), [value])
  const commit = () => {
    const parts = text
      .split(/[,;\n]/)
      .map((p) => p.trim())
      .filter(Boolean)
    const bad = parts.filter((p) => !phoneOf(p))
    setInvalid(bad)
    if (bad.length) return
    const list = [...new Set(parts.map((p) => phoneOf(p)!))]
    if (list.join() !== value.join()) onChange(list)
    else setText(list.join(', '))
  }
  return (
    <Field
      label="A"
      htmlFor={id}
      note={invalid.length ? `Sin el prefijo del país no vale: ${invalid.join(', ')}` : 'Tu WhatsApp (o varios, separados por comas), con el prefijo del país: +34…, +595…'}
    >
      <input
        id={id}
        className={cx('input ads-wide', invalid.length > 0 && 'is-invalid')}
        aria-invalid={invalid.length > 0}
        inputMode="tel"
        placeholder="+34 600 11 22 33"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </Field>
  )
}

/** Las cuentas de Meta o de Google que entran, por portfolio (o cuenta de administrador). */
function AccountPicker({
  title,
  icon,
  portfolios,
  loading,
  empty,
  chosen,
  onChange,
}: {
  title: string
  icon: ReactNode
  portfolios: Portfolio[] | null
  loading: boolean
  empty: string | null
  chosen: string[]
  onChange: (list: string[]) => void
}) {
  const known = new Set(portfolios?.flatMap((p) => p.cuentas.map((c) => c.id)) ?? [])
  const lost = portfolios ? chosen.filter((id) => !known.has(id)) : []
  return (
    <fieldset className="summary-picker">
      <legend>
        {icon}
        {title}
        {chosen.length > 0 && <span className="ads-count"> · {chosen.length}</span>}
      </legend>
      {empty ? (
        <p className="ads-note">{empty}</p>
      ) : !portfolios ? (
        <p className="ads-note">{loading ? 'Cargando cuentas…' : 'Sin cuentas'}</p>
      ) : (
        <div className="summary-picker-list">
          {portfolios.map((p) => (
            <div key={p.id} className="summary-picker-group">
              <span className="summary-picker-portfolio">{p.nombre}</span>
              {p.cuentas.map((c) => (
                <label key={c.id} className="summary-picker-item">
                  <input
                    type="checkbox"
                    checked={chosen.includes(c.id)}
                    onChange={(e) => onChange(e.target.checked ? [...chosen, c.id] : chosen.filter((id) => id !== c.id))}
                  />
                  <span>{c.nombre}</span>
                  <small>{c.moneda}</small>
                </label>
              ))}
            </div>
          ))}
          {lost.map((id) => (
            <label key={id} className="summary-picker-item is-lost">
              <input type="checkbox" checked onChange={() => onChange(chosen.filter((x) => x !== id))} />
              <span>{id}</span>
              <small>ya no está</small>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )
}

/** El mensaje como llega: una burbuja de WhatsApp de la empresa. */
function SummaryPreview({ text, from, hour }: { text: string; from: DailySummary['numero']; hour: string }) {
  return (
    <figure className="ads-wa summary-preview" aria-label="Vista previa del mensaje de WhatsApp">
      <div className="ads-wa-head" aria-hidden="true">
        <span className="summary-preview-logo">
          <Icon.WhatsAppLogo />
        </span>
        <span>
          <strong>{from?.nombre || 'Tu empresa'}</strong>
          <small>{from?.telefono || 'Cuenta de empresa'}</small>
        </span>
      </div>
      <div className="ads-wa-body">
        <p className="ads-wa-bubble is-them">{text}</p>
      </div>
      <figcaption className="ads-wa-foot">Así llega cada día a las {hour}, con lo de ayer</figcaption>
    </figure>
  )
}
