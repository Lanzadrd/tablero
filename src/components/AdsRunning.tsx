import { useCallback, useEffect, useRef, useState } from 'react'
import { metaApi, money, type AdAccount, type Campaign, type CampaignList, type Launch, type Period } from '../ads'
import { cx, useStoredState } from '../util'
import { errorText } from './Ads'
import * as Icon from './Icons'
import { Popover } from './Popover'
import { Segmented } from './Segmented'
import { Switch } from './Switch'

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: 'hoy', label: 'Hoy' },
  { value: '7d', label: '7 días' },
  { value: '30d', label: '30 días' },
]

const count = (n: number) => new Intl.NumberFormat('es-ES').format(n)
const clock = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
const budgetText = (b: NonNullable<Campaign['presupuesto']>, currency: string) =>
  `${money(b.cantidad, currency)} ${b.tipo === 'dia' ? 'al día' : 'en total'}`

/**
 * Las campañas de la cuenta que están en marcha, con lo que han gastado en el periodo, las conversaciones de
 * WhatsApp que han traído y lo que ha costado cada una. El interruptor las pausa enseguida o las activa (con
 * confirmación: desde ese momento gastan). Las que están en pausa y no han gastado en el periodo, plegadas.
 */
export function RunningCampaigns({
  account,
  onLaunch,
  onCreate,
}: {
  account: AdAccount
  onLaunch: (launch: Launch) => void
  onCreate: () => void
}) {
  const [stored, setPeriod] = useStoredState<Period>('tablero.anuncios.periodo', '7d')
  const period = PERIODS.some((p) => p.value === stored) ? stored : '7d'
  const [data, setData] = useState<CampaignList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showPaused, setShowPaused] = useState(false)
  /** Las que se han tocado aquí se quedan a la vista aunque pasen a estar en pausa. */
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  /** Lo que se anuncia al lector de pantalla tras pausar o activar. */
  const [notice, setNotice] = useState('')
  const latest = useRef(0)

  const load = useCallback(
    (fresh = false) => {
      // Si se cambia de periodo antes de que llegue la respuesta anterior, esa se descarta.
      const n = ++latest.current
      setLoading(true)
      metaApi
        .campaigns(account.id, period, fresh)
        .then(
          (list) => {
            if (n !== latest.current) return
            setData(list)
            setError(null)
          },
          (err) => {
            if (n === latest.current) setError(errorText(err))
          },
        )
        .finally(() => {
          if (n === latest.current) setLoading(false)
        })
    },
    [account.id, period],
  )

  useEffect(() => {
    load()
    // Al volver a la ventana (p. ej. tras tocar algo en el Administrador de anuncios).
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  const change = async (campaign: Campaign, estado: Campaign['estado']) => {
    setBusy(campaign.id)
    setError(null)
    try {
      const result = await metaApi.setCampaignStatus(account.id, campaign.id, estado)
      setTouched((ids) => new Set(ids).add(campaign.id))
      const entrega: Campaign['entrega'] = estado === 'activa' ? { texto: 'Activa', tono: 'ok' } : { texto: 'En pausa', tono: 'off' }
      setData((d) => d && { ...d, campanas: d.campanas.map((c) => (c.id === campaign.id ? { ...c, estado, entrega } : c)) })
      if (result.lanzamiento) onLaunch(result.lanzamiento)
      setNotice(`«${campaign.nombre}» ${estado === 'activa' ? 'activada' : 'en pausa'}`)
      load(true)
    } catch (err) {
      setError(`No se ha podido ${estado === 'activa' ? 'activar' : 'pausar'} «${campaign.nombre}»: ${errorText(err)}`)
    } finally {
      setBusy(null)
    }
  }

  if (!data) {
    return error ? (
      <div className="ads-error-box" role="alert">
        <p>{error}</p>
        <button type="button" className="btn" onClick={() => load(true)}>
          Reintentar
        </button>
      </div>
    ) : (
      <p className="ads-loading" aria-busy="true">
        Cargando campañas…
      </p>
    )
  }

  const rows = data.campanas
  const shown = rows.filter((c) => c.estado === 'activa' || c.gasto > 0 || touched.has(c.id))
  const folded = rows.length - shown.length
  const visible = showPaused ? rows : shown
  const spend = rows.reduce((sum, c) => sum + c.gasto, 0)
  const conversations = rows.reduce((sum, c) => sum + c.conversaciones, 0)
  const currency = data.moneda

  return (
    <div className={cx('ads-running', loading && 'is-loading')} aria-busy={loading}>
      <div className="ads-running-bar">
        <Segmented value={period} options={PERIODS} label="Periodo" onChange={setPeriod} />
        <span className="ads-updated">Actualizado a las {clock(data.actualizado)}</span>
        <button type="button" className="icon-btn" aria-label="Actualizar" title="Actualizar" disabled={loading} onClick={() => load(true)}>
          <Icon.Reload />
        </button>
      </div>

      <dl className="ads-stats">
        <div className="ads-stat">
          <dt>Gasto</dt>
          <dd>{money(spend, currency)}</dd>
        </div>
        <div className="ads-stat">
          <dt>Conversaciones</dt>
          <dd>{count(conversations)}</dd>
        </div>
        <div className="ads-stat">
          <dt>Coste por conversación</dt>
          <dd>{conversations ? money(spend / conversations, currency) : '—'}</dd>
        </div>
      </dl>

      {error && (
        <p className="ads-error" role="alert">
          {error}
        </p>
      )}
      <p className="sr-only" aria-live="polite">
        {notice}
      </p>

      {rows.length === 0 ? (
        <div className="ads-card ads-running-empty">
          <p>No hay campañas activas ni en pausa en esta cuenta.</p>
          <button type="button" className="btn is-accent" onClick={onCreate}>
            Crear una campaña
          </button>
        </div>
      ) : (
        <section className="ads-card ads-campaigns" aria-label="Campañas">
          {visible.length > 0 ? (
            <div className="ads-table-wrap">
              <table className="ads-table">
                <thead>
                  <tr>
                    <th scope="col">Campaña</th>
                    <th scope="col">Presupuesto</th>
                    <th scope="col">Gasto</th>
                    <th scope="col">Conversaciones</th>
                    <th scope="col">Coste por conversación</th>
                    <th scope="col">
                      <span className="sr-only">Activa</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c) => (
                    <CampaignRow key={c.id} campaign={c} currency={currency} busy={busy === c.id} onChange={(estado) => change(c, estado)} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ads-campaigns-none">Ninguna campaña en marcha.</p>
          )}
          {folded > 0 && (
            <button type="button" className="link-btn ads-show-paused" aria-expanded={showPaused} onClick={() => setShowPaused(!showPaused)}>
              {showPaused ? 'Ocultar las que están en pausa' : folded === 1 ? 'Mostrar 1 en pausa' : `Mostrar ${folded} en pausa`}
            </button>
          )}
        </section>
      )}
    </div>
  )
}

function CampaignRow({
  campaign: c,
  currency,
  busy,
  onChange,
}: {
  campaign: Campaign
  currency: string
  busy: boolean
  onChange: (estado: Campaign['estado']) => Promise<void>
}) {
  const cell = useRef<HTMLTableCellElement>(null)
  const [confirming, setConfirming] = useState(false)
  const active = c.estado === 'activa'
  return (
    <tr className={cx(!active && 'is-paused')}>
      <th scope="row">
        <a className="ads-campaign-name" href={c.enlace} target="_blank" rel="noreferrer" title="Abrir en el Administrador de anuncios">
          {c.nombre}
        </a>
        <span className={cx('ads-delivery', `is-${c.entrega.tono}`)}>{c.entrega.texto}</span>
      </th>
      <td>{c.presupuesto ? budgetText(c.presupuesto, currency) : '—'}</td>
      <td>{money(c.gasto, currency)}</td>
      <td>{c.conversaciones ? count(c.conversaciones) : '—'}</td>
      <td>{c.coste === null ? '—' : money(c.coste, currency)}</td>
      <td ref={cell} className="ads-toggle">
        <Switch
          checked={active}
          label={c.nombre}
          title={active ? 'Pausar' : 'Activar'}
          disabled={busy}
          onChange={(on) => (on ? setConfirming(true) : void onChange('pausada'))}
        />
        {confirming && cell.current && (
          <Popover anchor={cell.current} placement="below-end" width={280} label="Activar la campaña" onClose={() => setConfirming(false)}>
            <div className="ads-confirm">
              <p>
                <b>{c.nombre}</b> volverá a gastar{c.presupuesto ? ` hasta ${budgetText(c.presupuesto, currency)}` : ''}.
              </p>
              <div className="ads-form-foot">
                <button type="button" className="link-btn" onClick={() => setConfirming(false)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn is-accent"
                  disabled={busy}
                  onClick={() => {
                    void onChange('activa').then(() => setConfirming(false))
                  }}
                >
                  {busy ? 'Activando…' : 'Activar'}
                </button>
              </div>
            </div>
          </Popover>
        )}
      </td>
    </tr>
  )
}
