import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  budgetText,
  ENHANCEMENTS,
  metaApi,
  money,
  type AdAccount,
  type AdPath,
  type AdRow,
  type AdRows,
  type AdRowWithMetrics,
  type Launch,
  type Level,
  type MetricKey,
  type Period,
  type Template,
} from '../ads'
import { cx, useStoredState } from '../util'
import { errorText } from './Ads'
import { AdsComposer } from './AdsComposer'
import * as Icon from './Icons'
import { Popover } from './Popover'
import { Segmented } from './Segmented'
import { Switch } from './Switch'

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: 'hoy', label: 'Hoy' },
  { value: 'ayer', label: 'Ayer' },
  { value: '7d', label: '7 días' },
  { value: '30d', label: '30 días' },
]

type Format = 'money' | 'count' | 'ratio' | 'percent'

/** Las métricas que se pueden ver, en el orden de las columnas (y de los totales). */
const METRICS: Array<{ key: MetricKey; label: string; format: Format; hint?: string }> = [
  { key: 'gasto', label: 'Gasto', format: 'money' },
  { key: 'conversaciones', label: 'Conversaciones', format: 'count', hint: 'Conversaciones de WhatsApp empezadas desde el anuncio' },
  { key: 'coste', label: 'Coste por conversación', format: 'money' },
  { key: 'contactos', label: 'Contactos nuevos', format: 'count', hint: 'Personas que escriben por primera vez' },
  { key: 'alcance', label: 'Alcance', format: 'count', hint: 'Personas que lo han visto' },
  { key: 'impresiones', label: 'Impresiones', format: 'count', hint: 'Veces que se ha visto' },
  { key: 'frecuencia', label: 'Frecuencia', format: 'ratio', hint: 'Veces que lo ha visto cada persona, de media' },
  { key: 'cpm', label: 'CPM', format: 'money', hint: 'Coste por mil impresiones' },
  { key: 'clics', label: 'Clics en el enlace', format: 'count' },
  { key: 'ctr', label: 'CTR', format: 'percent', hint: 'Clics en el enlace por cada 100 impresiones' },
  { key: 'cpc', label: 'CPC', format: 'money', hint: 'Coste por clic en el enlace' },
  { key: 'bloqueos', label: 'Bloqueos', format: 'count', hint: 'Personas que han bloqueado la conversación' },
]

const DEFAULT_METRICS: MetricKey[] = ['gasto', 'conversaciones', 'coste', 'alcance', 'cpm', 'ctr']

/** Cómo se dice cada nivel. */
const LEVELS: Record<
  Level,
  { nombre: string; el: string; activo: string; activado: string; vacio: string; ninguno: string; abrir?: string }
> = {
  campana: {
    nombre: 'Campaña',
    el: 'la campaña',
    activo: 'Activa',
    activado: 'activada',
    vacio: 'No hay campañas activas ni en pausa en esta cuenta.',
    ninguno: 'Ninguna campaña en marcha.',
    abrir: 'ver sus conjuntos',
  },
  conjunto: {
    nombre: 'Conjunto',
    el: 'el conjunto',
    activo: 'Activo',
    activado: 'activado',
    vacio: 'Esta campaña no tiene conjuntos activos ni en pausa.',
    ninguno: 'Ningún conjunto en marcha.',
    abrir: 'ver sus anuncios',
  },
  anuncio: {
    nombre: 'Anuncio',
    el: 'el anuncio',
    activo: 'Activo',
    activado: 'activado',
    vacio: 'Este conjunto no tiene anuncios activos ni en pausa.',
    ninguno: 'Ningún anuncio en marcha.',
  },
}

const count = (n: number) => new Intl.NumberFormat('es-ES').format(n)
const twoDecimals = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const clock = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
function formatMetric(value: number | null, format: Format, currency: string) {
  if (value === null) return '—'
  if (format === 'money') return money(value, currency)
  if (format === 'count') return count(value)
  return format === 'percent' ? `${twoDecimals.format(value)} %` : twoDecimals.format(value)
}

/** En las filas, un recuento a cero no dice nada: mejor la raya. */
const cellText = (value: number | null, format: Format, currency: string) =>
  format === 'count' && !value ? '—' : formatMetric(value, format, currency)

/** Columnas de los totales: filas iguales de como mucho `max` (con 4: 6 → 3 + 3, no 4 + 2). */
const statColumns = (n: number, max: number) => Math.ceil(n / Math.ceil(n / max))

/** ¿Está parado lo de arriba? (Entonces, encender una fila no basta para que gaste.) */
const stopped = (parent: AdRow | null) => parent !== null && parent.entrega.tono === 'off' && /en pausa$/i.test(parent.entrega.texto)

/**
 * Las campañas de la cuenta que están en marcha, con sus métricas del periodo; desde una campaña, sus conjuntos,
 * y desde un conjunto, sus anuncios. El interruptor los pausa enseguida o los activa (con confirmación: desde
 * ese momento gastan). Lo que está en pausa y no ha gastado en el periodo, plegado.
 */
export function RunningCampaigns({
  account,
  templates,
  onTemplates,
  onLaunch,
  onCreate,
}: {
  account: AdAccount
  templates: Template[]
  onTemplates: (templates: Template[]) => Promise<Template[]>
  onLaunch: (launch: Launch) => void
  onCreate: () => void
}) {
  const [storedPeriod, setPeriod] = useStoredState<Period>('tablero.anuncios.periodo', '7d')
  const period = PERIODS.some((p) => p.value === storedPeriod) ? storedPeriod : '7d'
  const [storedMetrics, setMetrics] = useStoredState<MetricKey[]>('tablero.anuncios.metricas', DEFAULT_METRICS)
  const chosen = METRICS.filter((m) => Array.isArray(storedMetrics) && storedMetrics.includes(m.key))
  const metrics = chosen.length ? chosen : METRICS.filter((m) => DEFAULT_METRICS.includes(m.key))
  const [path, setPath] = useState<AdPath>({})
  const level: Level = path.conjunto ? 'anuncio' : path.campana ? 'conjunto' : 'campana'
  const route = `${path.campana?.id ?? ''}/${path.conjunto?.id ?? ''}`
  const [data, setData] = useState<(AdRows & { ruta: string }) | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showPaused, setShowPaused] = useState(false)
  /** Las que se han tocado aquí se quedan a la vista aunque pasen a estar en pausa. */
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  /** Lo que se anuncia al lector de pantalla tras pausar o activar. */
  const [notice, setNotice] = useState('')
  /** Creando un conjunto en la campaña; y el último creado, para decirlo. */
  const [adding, setAdding] = useState(false)
  const [created, setCreated] = useState<string | null>(null)
  const latest = useRef(0)
  const here = useRef<HTMLSpanElement>(null)
  const newAdSet = useRef<HTMLButtonElement>(null)
  /** Lo que se enseña: solo si es de este nivel (al cambiar de periodo, lo anterior sigue, atenuado). */
  const current = data?.ruta === route ? data : null

  const load = useCallback(
    (fresh = false) => {
      // Si se cambia de periodo o de nivel antes de que llegue la respuesta anterior, esa se descarta.
      const n = ++latest.current
      setLoading(true)
      metaApi
        .rows(account.id, period, path, fresh)
        .then(
          (list) => {
            if (n !== latest.current) return
            setData({ ...list, ruta: `${path.campana?.id ?? ''}/${path.conjunto?.id ?? ''}` })
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
    [account.id, period, path],
  )

  useEffect(() => {
    load()
    // Al volver a la ventana (p. ej. tras tocar algo en el Administrador de anuncios).
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  /** Baja a los conjuntos de una campaña o a los anuncios de un conjunto, o sube. */
  const go = (next: AdPath) => {
    setPath(next)
    setShowPaused(false)
    setError(null)
    setNotice('')
    setAdding(false)
    setCreated(null)
    // El botón pulsado desaparece: el foco, a donde se está ahora.
    requestAnimationFrame(() => here.current?.focus())
  }

  const change = async (row: AdRow, estado: AdRow['estado']) => {
    setBusy(row.id)
    setError(null)
    try {
      const result = await metaApi.setStatus(account.id, level, row.id, estado)
      setTouched((ids) => new Set(ids).add(row.id))
      const words = LEVELS[level]
      const entrega: AdRow['entrega'] = estado === 'activa' ? { texto: words.activo, tono: 'ok' } : { texto: 'En pausa', tono: 'off' }
      setData((d) => d && { ...d, filas: d.filas.map((f) => (f.id === row.id ? { ...f, estado, entrega } : f)) })
      if (result.lanzamiento) onLaunch(result.lanzamiento)
      setNotice(`${words.nombre} «${row.nombre}» ${estado === 'activa' ? words.activado : 'en pausa'}`)
      load(true)
    } catch (err) {
      setError(`No se ha podido ${estado === 'activa' ? 'activar' : 'pausar'} «${row.nombre}»: ${errorText(err)}`)
    } finally {
      setBusy(null)
    }
  }

  const words = LEVELS[level]
  const currency = current?.moneda ?? account.moneda
  const rows = current?.filas ?? []
  const shown = rows.filter((r) => r.estado === 'activa' || r.metricas.gasto > 0 || touched.has(r.id))
  const folded = rows.length - shown.length
  const visible = showPaused ? rows : shown

  if (adding && path.campana) {
    return (
      <AdsComposer
        account={account}
        templates={templates}
        launches={[]}
        onTemplates={onTemplates}
        onLaunch={onLaunch}
        adSetIn={{
          ...path.campana,
          presupuesto: current?.padre?.presupuesto ?? null,
          pagina: rows.find((r) => r.pagina)?.pagina ?? null,
        }}
        onCancel={() => {
          setAdding(false)
          requestAnimationFrame(() => newAdSet.current?.focus())
        }}
        onAdSet={(adSet) => {
          setAdding(false)
          setTouched((ids) => new Set(ids).add(adSet.id))
          setCreated(adSet.nombre)
          load(true)
          requestAnimationFrame(() => here.current?.focus())
        }}
      />
    )
  }

  return (
    <div className={cx('ads-running', loading && 'is-loading')} aria-busy={loading}>
      <div className="ads-running-bar">
        <Segmented value={period} options={PERIODS} label="Periodo" onChange={setPeriod} />
        <MetricsPicker chosen={metrics.map((m) => m.key)} onChange={setMetrics} />
        {current && <span className="ads-updated">Actualizado a las {clock(current.actualizado)}</span>}
        <button
          type="button"
          className={cx('icon-btn', !current && 'ads-reload-alone')}
          aria-label="Actualizar"
          title="Actualizar"
          disabled={loading}
          onClick={() => load(true)}
        >
          <Icon.Reload />
        </button>
      </div>

      {path.campana && (
        <nav className="ads-crumbs" aria-label="Nivel">
          <ol>
            <li>
              <button type="button" className="link-btn" onClick={() => go({})}>
                Campañas
              </button>
            </li>
            <li>
              {path.conjunto ? (
                <button type="button" className="link-btn" onClick={() => go({ campana: path.campana })}>
                  {path.campana.nombre}
                </button>
              ) : (
                <span ref={here} tabIndex={-1} aria-current="location">
                  {path.campana.nombre}
                </span>
              )}
            </li>
            {path.conjunto && (
              <li>
                <span ref={here} tabIndex={-1} aria-current="location">
                  {path.conjunto.nombre}
                </span>
              </li>
            )}
          </ol>
          {current?.padre && (
            <span className="ads-crumbs-info">
              <span className={cx('ads-delivery', `is-${current.padre.entrega.tono}`)}>{current.padre.entrega.texto}</span>
              {current.padre.presupuesto && <span>{budgetText(current.padre.presupuesto, currency)}</span>}
              <a
                className="ads-row-link"
                href={current.padre.enlace}
                target="_blank"
                rel="noreferrer"
                aria-label={`Abrir «${current.padre.nombre}» en el Administrador de anuncios`}
                title="Abrir en el Administrador de anuncios"
              >
                <Icon.External />
              </a>
            </span>
          )}
          {level === 'conjunto' && (
            <button
              ref={newAdSet}
              type="button"
              className="btn ads-new-adset"
              onClick={() => {
                setCreated(null)
                setAdding(true)
              }}
            >
              <Icon.Plus />
              Nuevo conjunto
            </button>
          )}
        </nav>
      )}
      {created && (
        <p className="ads-created" role="status">
          <Icon.Check />
          Conjunto «{created}» creado en pausa. Enciéndelo con su interruptor cuando quieras que empiece.
        </p>
      )}

      {error && current && (
        <p className="ads-error" role="alert">
          {error}
        </p>
      )}
      <p className="sr-only" aria-live="polite">
        {notice}
      </p>

      {!current ? (
        error ? (
          <div className="ads-error-box" role="alert">
            <p>{error}</p>
            <button type="button" className="btn" onClick={() => load(true)}>
              Reintentar
            </button>
          </div>
        ) : (
          <p className="ads-loading" aria-busy="true">
            {level === 'campana' ? 'Cargando campañas…' : level === 'conjunto' ? 'Cargando conjuntos…' : 'Cargando anuncios…'}
          </p>
        )
      ) : (
        <>
          <div className="ads-stats-box">
            <dl
              className="ads-stats"
              style={
                {
                  '--cols-6': statColumns(metrics.length, 6),
                  '--cols-4': statColumns(metrics.length, 4),
                  '--cols-2': statColumns(metrics.length, 2),
                } as CSSProperties
              }
            >
              {metrics.map((m) => (
                <div key={m.key} className="ads-stat">
                  <dt title={m.hint}>{m.label}</dt>
                  <dd>{formatMetric(current.totales[m.key], m.format, currency)}</dd>
                </div>
              ))}
            </dl>
          </div>

          {rows.length === 0 ? (
            <div className="ads-card ads-running-empty">
              <p>{words.vacio}</p>
              {level === 'campana' && (
                <button type="button" className="btn is-accent" onClick={onCreate}>
                  Crear una campaña
                </button>
              )}
            </div>
          ) : (
            <section className="ads-card ads-campaigns" aria-label={level === 'campana' ? 'Campañas' : level === 'conjunto' ? 'Conjuntos' : 'Anuncios'}>
              {visible.length > 0 ? (
                <div className="ads-table-wrap">
                  <table className="ads-table">
                    <thead>
                      <tr>
                        <th scope="col">{words.nombre}</th>
                        {level !== 'anuncio' && <th scope="col">Presupuesto</th>}
                        {metrics.map((m) => (
                          <th key={m.key} scope="col" title={m.hint}>
                            {m.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((r) => (
                        <Row
                          key={r.id}
                          row={r}
                          level={level}
                          metrics={metrics}
                          currency={currency}
                          parentStopped={stopped(current.padre)}
                          busy={busy === r.id}
                          onOpen={
                            level === 'campana'
                              ? () => go({ campana: { id: r.id, nombre: r.nombre } })
                              : level === 'conjunto'
                                ? () => go({ campana: path.campana, conjunto: { id: r.id, nombre: r.nombre } })
                                : undefined
                          }
                          onChange={(estado) => change(r, estado)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="ads-campaigns-none">{words.ninguno}</p>
              )}
              {folded > 0 && (
                <button type="button" className="link-btn ads-show-paused" aria-expanded={showPaused} onClick={() => setShowPaused(!showPaused)}>
                  {showPaused ? 'Ocultar lo que está en pausa' : `Mostrar ${folded} en pausa`}
                </button>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}

/** Qué métricas se ven (en los totales y en la tabla). Siempre al menos una. */
function MetricsPicker({ chosen, onChange }: { chosen: MetricKey[]; onChange: (keys: MetricKey[]) => void }) {
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const isDefault = chosen.join() === DEFAULT_METRICS.join()
  const toggle = (key: MetricKey, on: boolean) =>
    onChange(METRICS.map((m) => m.key).filter((k) => (k === key ? on : chosen.includes(k))))
  return (
    <>
      <button
        ref={button}
        type="button"
        className="btn ads-metrics-btn"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        <Icon.Columns />
        Métricas
      </button>
      {open && button.current && (
        <Popover anchor={button.current} placement="below-start" width={300} label="Métricas" onClose={() => setOpen(false)}>
          <fieldset className="ads-metrics-picker">
            <legend>Métricas que se ven</legend>
            {METRICS.map((m) => {
              const on = chosen.includes(m.key)
              return (
                <label key={m.key} className="ads-metric-option">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={on && chosen.length === 1}
                    onChange={(e) => toggle(m.key, e.target.checked)}
                  />
                  <span>
                    {m.label}
                    {m.hint && <small>{m.hint}</small>}
                  </span>
                </label>
              )
            })}
          </fieldset>
          <div className="ads-metrics-foot">
            <button type="button" className="link-btn" disabled={isDefault} onClick={() => onChange(DEFAULT_METRICS)}>
              Volver a las de siempre
            </button>
          </div>
        </Popover>
      )}
    </>
  )
}

/** Lo que Meta hace por su cuenta en un anuncio (mejoras automáticas, multianunciante), si hace algo. */
function AutomaticBadge({ automaticas, name }: { automaticas: NonNullable<AdRow['automaticas']>; name: string }) {
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const { mejoras, multianunciante } = automaticas
  if (!mejoras.length && !multianunciante) return null
  const count = mejoras.length + (multianunciante ? 1 : 0)
  return (
    <>
      <button
        ref={button}
        type="button"
        className="ads-auto-badge"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        {count === 1 ? '1 automática' : `${count} automáticas`}
      </button>
      {open && button.current && (
        <Popover anchor={button.current} placement="below-start" width={300} label={`Lo automático de «${name}»`} onClose={() => setOpen(false)}>
          <div className="ads-auto-list">
            <p>Activado en Meta para este anuncio:</p>
            <ul>
              {ENHANCEMENTS.filter((e) => mejoras.includes(e.key)).map((e) => (
                <li key={e.key}>
                  {e.label}
                  <small>{e.note}</small>
                </li>
              ))}
              {multianunciante && (
                <li>
                  Multianunciante
                  <small>Puede salir junto a anuncios de otras empresas.</small>
                </li>
              )}
            </ul>
            <p className="ads-note">Para cambiarlo, edita el anuncio en el Administrador de anuncios (Meta lo vuelve a revisar).</p>
          </div>
        </Popover>
      )}
    </>
  )
}

function Row({
  row: r,
  level,
  metrics,
  currency,
  parentStopped,
  busy,
  onOpen,
  onChange,
}: {
  row: AdRowWithMetrics
  level: Level
  metrics: typeof METRICS
  currency: string
  parentStopped: boolean
  busy: boolean
  onOpen?: () => void
  onChange: (estado: AdRow['estado']) => Promise<void>
}) {
  const cell = useRef<HTMLTableCellElement>(null)
  const [confirming, setConfirming] = useState(false)
  const words = LEVELS[level]
  const active = r.estado === 'activa'
  const spends = level === 'anuncio' ? 'volverá a mostrarse' : `volverá a gastar${r.presupuesto ? ` hasta ${budgetText(r.presupuesto, currency)}` : ''}`
  // La última palabra va pegada a la flecha: que no quede sola en otra línea.
  const cut = r.nombre.lastIndexOf(' ') + 1
  return (
    <tr className={cx(!active && 'is-paused')}>
      <th ref={cell} scope="row">
        <div className="ads-row-name">
          <Switch
            checked={active}
            label={r.nombre}
            title={active ? 'Pausar' : 'Activar'}
            disabled={busy}
            onChange={(on) => (on ? setConfirming(true) : void onChange('pausada'))}
          />
          {level === 'anuncio' &&
            (r.miniatura ? (
              <img className="ads-thumb" src={r.miniatura} alt="" width={36} height={36} loading="lazy" referrerPolicy="no-referrer" />
            ) : (
              <span className="ads-thumb" aria-hidden="true" />
            ))}
          <div className="ads-row-text">
            {onOpen ? (
              <button type="button" className="ads-campaign-name is-button" onClick={onOpen}>
                {r.nombre.slice(0, cut)}
                <span className="ads-nowrap">
                  {r.nombre.slice(cut)}
                  <Icon.Chevron />
                </span>
                <span className="sr-only">: {words.abrir}</span>
              </button>
            ) : (
              <span className="ads-campaign-name">{r.nombre}</span>
            )}
            <span className="ads-row-meta">
              <span className={cx('ads-delivery', `is-${r.entrega.tono}`)}>{r.entrega.texto}</span>
              {r.automaticas && <AutomaticBadge automaticas={r.automaticas} name={r.nombre} />}
              <a
                className="ads-row-link"
                href={r.enlace}
                target="_blank"
                rel="noreferrer"
                aria-label={`Abrir «${r.nombre}» en el Administrador de anuncios`}
                title="Abrir en el Administrador de anuncios"
              >
                <Icon.External />
              </a>
            </span>
          </div>
        </div>
        {confirming && cell.current && (
          <Popover anchor={cell.current} placement="below-start" width={280} label={`Activar ${words.el}`} onClose={() => setConfirming(false)}>
            <div className="ads-confirm">
              <p>
                <b>{r.nombre}</b> {spends}.
              </p>
              {parentStopped && (
                <p className="ads-confirm-note">
                  {level === 'conjunto'
                    ? 'Mientras la campaña siga en pausa, no gastará.'
                    : 'Mientras el conjunto o la campaña sigan en pausa, no se mostrará.'}
                </p>
              )}
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
      </th>
      {level !== 'anuncio' && (
        <td>
          {r.presupuesto ? (
            budgetText(r.presupuesto, currency)
          ) : level === 'conjunto' ? (
            <span title="El presupuesto va en la campaña">—</span>
          ) : (
            '—'
          )}
        </td>
      )}
      {metrics.map((m) => (
        <td key={m.key}>{cellText(r.metricas[m.key], m.format, currency)}</td>
      ))}
    </tr>
  )
}
