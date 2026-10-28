import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  budgetText,
  ENHANCEMENTS,
  metaApi,
  money,
  type AdAccount,
  type AdPath,
  type AdRow,
  type Launch,
  type Level,
  type MetricValues,
  type Period,
  type RunningRows,
  type Template,
} from '../ads'
import { cx, useStoredState } from '../util'
import { errorText } from './Ads'
import { AdsComposer } from './AdsComposer'
import * as Icon from './Icons'
import { Menu, Popover, type MenuItem } from './Popover'
import { Segmented } from './Segmented'
import { Switch } from './Switch'

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: 'hoy', label: 'Hoy' },
  { value: 'ayer', label: 'Ayer' },
  { value: '7d', label: '7 días' },
  { value: '30d', label: '30 días' },
]

/** `number`: un número que puede tener decimales (las conversiones de Google Ads). */
type Format = 'money' | 'count' | 'number' | 'ratio' | 'percent'
export interface MetricDef {
  key: string
  label: string
  format: Format
  hint?: string
}

/** Cómo se dice cada nivel en un sitio de anuncios. */
export interface LevelWords {
  nombre: string
  /** El botón de la barra: «Campañas», «Conjuntos», «Grupos»… */
  pestana: string
  /** En plural y en minúscula: «conjuntos», «grupos de anuncios». */
  plural: string
  el: string
  activo: string
  activado: string
  vacio: string
  ninguno: string
  abrir?: string
}

/**
 * De dónde salen las campañas de «En marcha» (Meta o Google Ads): sus métricas, cómo se llaman sus niveles, cómo se
 * piden y cómo se pausan o activan.
 */
export interface RunningSource {
  /** Prefijo de lo que se recuerda en este navegador (periodo y métricas elegidas). */
  storage: string
  metrics: MetricDef[]
  defaultMetrics: string[]
  levels: Record<Level, LevelWords>
  /** Los niveles que tienen presupuesto (columna «Presupuesto»). */
  budgets: Level[]
  /** Los anuncios llevan miniatura. */
  thumbnails: boolean
  /** Dónde lleva el enlace de cada fila: «el Administrador de anuncios». */
  where: string
  rows: (account: string, period: Period, path: AdPath, fresh: boolean) => Promise<RunningRows>
  setStatus: (account: string, level: Level, id: string, estado: AdRow['estado']) => Promise<{ id: string; lanzamiento?: Launch | null }>
  /** Editar una fila: el formulario, en lugar de la tabla. */
  editor?: (props: EditorProps) => ReactNode
  /** Un anuncio nuevo en el conjunto que se está viendo. */
  adder?: (props: AdderProps) => ReactNode
  /** Una copia en pausa. */
  duplicate?: (account: string, level: Level, id: string) => Promise<unknown>
  archive?: (account: string, level: Level, id: string) => Promise<unknown>
  /** Borrar (Meta) o quitar (Google Ads): no se puede deshacer. */
  remove?: { label: string; run: (account: string, level: Level, id: string) => Promise<unknown> }
}

export interface EditorProps {
  account: AdAccount
  level: Level
  row: AdRow
  onCancel: () => void
  /** Guardado: lo que se dice arriba de la tabla. */
  onSaved: (message: string) => void
}

export interface AdderProps {
  account: AdAccount
  adSet: { id: string; nombre: string }
  /** Un anuncio del conjunto, del que se copian los textos para empezar. */
  template: AdRow | null
  onCancel: () => void
  onSaved: (message: string) => void
}

/** Lo que se confirma antes de hacerlo (duplicar, archivar, borrar). */
type Confirm = { kind: 'duplicate' | 'archive' | 'remove'; row: AdRow; anchor: HTMLElement }

/** Las métricas que se pueden ver, en el orden de las columnas (y de los totales). */
const METRICS: MetricDef[] = [
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

/** Cómo se dice cada nivel en Meta. */
const LEVELS: Record<Level, LevelWords> = {
  campana: {
    nombre: 'Campaña',
    pestana: 'Campañas',
    plural: 'campañas',
    el: 'la campaña',
    activo: 'Activa',
    activado: 'activada',
    vacio: 'No hay campañas activas ni en pausa en esta cuenta.',
    ninguno: 'Ninguna campaña en marcha.',
    abrir: 'ver sus conjuntos',
  },
  conjunto: {
    nombre: 'Conjunto',
    pestana: 'Conjuntos',
    plural: 'conjuntos',
    el: 'el conjunto',
    activo: 'Activo',
    activado: 'activado',
    vacio: 'No hay conjuntos activos ni en pausa aquí.',
    ninguno: 'Ningún conjunto en marcha.',
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
}

export const META_SOURCE: RunningSource = {
  storage: 'tablero.anuncios',
  metrics: METRICS,
  defaultMetrics: ['gasto', 'conversaciones', 'coste', 'alcance', 'cpm', 'ctr'],
  levels: LEVELS,
  budgets: ['campana', 'conjunto'],
  thumbnails: true,
  where: 'el Administrador de anuncios',
  rows: metaApi.rows,
  setStatus: metaApi.setStatus,
}

const count = (n: number) => new Intl.NumberFormat('es-ES').format(n)
const upToTwoDecimals = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 })
const twoDecimals = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const clock = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
function formatMetric(value: number | null, format: Format, currency: string) {
  if (value === null) return '—'
  if (format === 'money') return money(value, currency)
  if (format === 'count') return count(value)
  if (format === 'number') return upToTwoDecimals.format(value)
  return format === 'percent' ? `${twoDecimals.format(value)} %` : twoDecimals.format(value)
}

/** En las filas, un recuento a cero no dice nada: mejor la raya. */
const cellText = (value: number | null, format: Format, currency: string) =>
  (format === 'count' || format === 'number') && !value ? '—' : formatMetric(value, format, currency)

/** Columnas de los totales: filas iguales de como mucho `max` (con 4: 6 → 3 + 3, no 4 + 2). */
const statColumns = (n: number, max: number) => Math.ceil(n / Math.ceil(n / max))

/** ¿Está parado lo de arriba? (Entonces, encender una fila no basta para que gaste.) */
const stopped = (parent: AdRow | null) => parent !== null && parent.entrega.tono === 'off' && /en pausa$/i.test(parent.entrega.texto)

/** Lo que solo hay en Meta: crear campañas y conjuntos con las plantillas. */
interface MetaExtras {
  templates: Template[]
  onTemplates: (templates: Template[]) => Promise<Template[]>
  onLaunch: (launch: Launch) => void
  onCreate: () => void
}

/**
 * Las campañas de la cuenta que están en marcha, con sus métricas del periodo; desde una campaña, sus conjuntos
 * (o grupos de anuncios), y desde ahí, sus anuncios. El interruptor los pausa enseguida o los activa (con
 * confirmación: desde ese momento gastan). Lo que está en pausa y no ha gastado en el periodo, plegado.
 */
export function RunningCampaigns({ account, source, meta }: { account: AdAccount; source: RunningSource; meta?: MetaExtras }) {
  const [storedPeriod, setPeriod] = useStoredState<Period>(`${source.storage}.periodo`, '7d')
  const period = PERIODS.some((p) => p.value === storedPeriod) ? storedPeriod : '7d'
  // Las de arriba, en grande, y las de las columnas de la tabla: cada una la suya (al principio, las que se
  // elegían para las dos).
  const [legacyMetrics] = useStoredState<string[]>(`${source.storage}.metricas`, source.defaultMetrics)
  const [storedBig, setBig] = useStoredState<string[]>(`${source.storage}.metricas.grandes`, legacyMetrics)
  const [storedColumns, setColumns] = useStoredState<string[]>(`${source.storage}.metricas.columnas`, legacyMetrics)
  const pickMetrics = (stored: unknown) => {
    const chosen = source.metrics.filter((m) => Array.isArray(stored) && stored.includes(m.key))
    return chosen.length ? chosen : source.metrics.filter((m) => source.defaultMetrics.includes(m.key))
  }
  const bigMetrics = pickMetrics(storedBig)
  const metrics = pickMetrics(storedColumns)
  const [path, setPath] = useState<AdPath>({})
  const level: Level = path.nivel ?? (path.conjunto ? 'anuncio' : path.campana ? 'conjunto' : 'campana')
  const route = `${level}/${path.campana?.id ?? ''}/${path.conjunto?.id ?? ''}`
  const [data, setData] = useState<(RunningRows & { ruta: string }) | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showPaused, setShowPaused] = useState(false)
  /** Las que se han tocado aquí se quedan a la vista aunque pasen a estar en pausa. */
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  /** Lo que se anuncia al lector de pantalla tras pausar o activar. */
  const [notice, setNotice] = useState('')
  /** Creando un conjunto en la campaña (o un anuncio en el conjunto), o editando una fila. */
  const [adding, setAdding] = useState(false)
  const [addingAd, setAddingAd] = useState(false)
  const [editing, setEditing] = useState<AdRow | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  /** Lo último que ha salido bien (creado, guardado, duplicado…), para decirlo arriba. */
  const [banner, setBanner] = useState<string | null>(null)
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
      source
        .rows(account.id, period, path, fresh)
        .then(
          (list) => {
            if (n !== latest.current) return
            setData({ ...list, ruta: `${path.nivel ?? (path.conjunto ? 'anuncio' : path.campana ? 'conjunto' : 'campana')}/${path.campana?.id ?? ''}/${path.conjunto?.id ?? ''}` })
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
    [account.id, period, path, source],
  )

  useEffect(() => {
    load()
    // Al volver a la ventana (p. ej. tras tocar algo en el Administrador de anuncios).
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  /** Baja a los conjuntos de una campaña o a los anuncios de un conjunto, sube, o cambia de nivel. */
  const go = (next: AdPath) => {
    setPath(next)
    setShowPaused(false)
    setError(null)
    setNotice('')
    setAdding(false)
    setAddingAd(false)
    setEditing(null)
    setBanner(null)
    // El botón pulsado desaparece: el foco, a donde se está ahora.
    requestAnimationFrame(() => here.current?.focus())
  }

  const change = async (row: AdRow, estado: AdRow['estado']) => {
    setBusy(row.id)
    setError(null)
    try {
      const result = await source.setStatus(account.id, level, row.id, estado)
      setTouched((ids) => new Set(ids).add(row.id))
      const words = source.levels[level]
      const entrega: AdRow['entrega'] = estado === 'activa' ? { texto: words.activo, tono: 'ok' } : { texto: 'En pausa', tono: 'off' }
      setData((d) => d && { ...d, filas: d.filas.map((f) => (f.id === row.id ? { ...f, estado, entrega } : f)) })
      if (result.lanzamiento) meta?.onLaunch(result.lanzamiento)
      setNotice(`${words.nombre} «${row.nombre}» ${estado === 'activa' ? words.activado : 'en pausa'}`)
      load(true)
    } catch (err) {
      setError(`No se ha podido ${estado === 'activa' ? 'activar' : 'pausar'} «${row.nombre}»: ${errorText(err)}`)
    } finally {
      setBusy(null)
    }
  }

  /** Cambiar de nivel con los botones de la barra: con el filtro que haya (la campaña, el conjunto). */
  const toLevel = (nivel: Level) =>
    go(nivel === 'campana' ? {} : nivel === 'conjunto' ? { campana: path.campana, nivel } : { campana: path.campana, conjunto: path.conjunto, nivel })

  /** Duplicar, archivar o borrar, ya confirmado. */
  const act = async ({ kind, row }: Confirm) => {
    setBusy(row.id)
    setError(null)
    try {
      const words = source.levels[level]
      if (kind === 'duplicate') {
        await source.duplicate?.(account.id, level, row.id)
        setBanner(`Copia de «${row.nombre}» creada en pausa. Enciéndela con su interruptor cuando quieras.`)
      } else if (kind === 'archive') {
        await source.archive?.(account.id, level, row.id)
        setBanner(`${words.nombre} «${row.nombre}» archivad${words.activado.endsWith('a') ? 'a' : 'o'}.`)
      } else {
        await source.remove?.run(account.id, level, row.id)
        setBanner(`${words.nombre} «${row.nombre}» ${source.remove?.label === 'Quitar' ? 'quitad' : 'borrad'}${words.activado.endsWith('a') ? 'a' : 'o'}.`)
      }
      setConfirm(null)
      setShowPaused(kind === 'duplicate' || showPaused)
      load(true)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  /** El menú «…» de una fila: editar, duplicar, archivar, borrar (lo que admita el sitio). */
  const rowActions = (row: AdRow) => (anchor: HTMLElement): MenuItem[] => {
    const ask = (kind: Confirm['kind']) => () => setConfirm({ kind, row, anchor })
    const items: MenuItem[] = []
    if (source.editor) {
      items.push({
        label: 'Editar…',
        run: () => {
          setBanner(null)
          setEditing(row)
        },
      })
    }
    if (source.duplicate) items.push({ label: 'Duplicar…', run: ask('duplicate') })
    if (source.archive) items.push({ label: 'Archivar…', run: ask('archive') })
    if (source.remove) items.push('separator', { label: `${source.remove.label}…`, danger: true, run: ask('remove') })
    return items
  }

  const words = source.levels[level]
  const currency = current?.moneda ?? account.moneda
  const rows = current?.filas ?? []
  const shown = rows.filter((r) => r.estado === 'activa' || (r.metricas.gasto ?? 0) > 0 || touched.has(r.id))
  const folded = rows.length - shown.length
  const visible = showPaused ? rows : shown

  if (editing && source.editor) {
    return source.editor({
      account,
      level,
      row: editing,
      onCancel: () => setEditing(null),
      onSaved: (message) => {
        setTouched((ids) => new Set(ids).add(editing.id))
        setEditing(null)
        setBanner(message)
        load(true)
      },
    })
  }

  if (addingAd && path.conjunto && source.adder) {
    return source.adder({
      account,
      adSet: path.conjunto,
      template: rows[0] ?? null,
      onCancel: () => setAddingAd(false),
      onSaved: (message) => {
        setAddingAd(false)
        setShowPaused(true)
        setBanner(message)
        load(true)
      },
    })
  }

  if (adding && path.campana && meta) {
    return (
      <AdsComposer
        account={account}
        templates={meta.templates}
        launches={[]}
        onTemplates={meta.onTemplates}
        onLaunch={meta.onLaunch}
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
          setBanner(`Conjunto «${adSet.nombre}» creado en pausa. Enciéndelo con su interruptor cuando quieras que empiece.`)
          load(true)
          requestAnimationFrame(() => here.current?.focus())
        }}
      />
    )
  }

  return (
    <div className={cx('ads-running', loading && 'is-loading')} aria-busy={loading}>
      <div className="ads-running-bar">
        {meta && (
          <button type="button" className="ads-create-btn" onClick={meta.onCreate}>
            <Icon.Plus />
            Crear
          </button>
        )}
        <Segmented value={period} options={PERIODS} label="Periodo" onChange={setPeriod} />
        <MetricsPicker
          options={source.metrics}
          defaults={source.defaultMetrics}
          big={bigMetrics.map((m) => m.key)}
          columns={metrics.map((m) => m.key)}
          onBig={setBig}
          onColumns={setColumns}
        />
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

      {banner && (
        <p className="ads-created" role="status">
          <Icon.Check />
          {banner}
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

      {current && (
        <div className="ads-stats-box">
          <dl
            className="ads-stats"
            style={
              {
                '--cols-6': statColumns(bigMetrics.length, 6),
                '--cols-4': statColumns(bigMetrics.length, 4),
                '--cols-2': statColumns(bigMetrics.length, 2),
              } as CSSProperties
            }
          >
            {bigMetrics.map((m) => (
              <div key={m.key} className="ads-stat">
                <dt title={m.hint}>{m.label}</dt>
                <dd>{formatMetric(current.totales[m.key], m.format, currency)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="ads-folder">
        <LevelTabs source={source} level={level} path={path} onLevel={toLevel} onClear={go} />
        <section className="ads-card ads-campaigns" role="tabpanel" aria-label={words.plural.charAt(0).toUpperCase() + words.plural.slice(1)}>
          {(path.campana || path.conjunto) && (
            <div className="ads-panel-head">
              <span ref={here} tabIndex={-1} className="ads-panel-name">
                {(path.conjunto ?? path.campana)!.nombre}
              </span>
              {current?.padre && (
                <span className="ads-crumbs-info">
                  <span className={cx('ads-delivery', `is-${current.padre.entrega.tono}`)}>{current.padre.entrega.texto}</span>
                  {current.padre.presupuesto && <span>{budgetText(current.padre.presupuesto, currency)}</span>}
                  {current.padre.enlace && (
                    <a
                      className="ads-row-link"
                      href={current.padre.enlace}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Abrir «${current.padre.nombre}» en ${source.where}`}
                      title={`Abrir en ${source.where}`}
                    >
                      <Icon.External />
                    </a>
                  )}
                </span>
              )}
              {level === 'conjunto' && path.campana && meta && (
                <button
                  ref={newAdSet}
                  type="button"
                  className="btn ads-new-adset"
                  onClick={() => {
                    setBanner(null)
                    setAdding(true)
                  }}
                >
                  <Icon.Plus />
                  Nuevo conjunto
                </button>
              )}
              {level === 'anuncio' && path.conjunto && source.adder && (
                <button
                  type="button"
                  className="btn ads-new-adset"
                  onClick={() => {
                    setBanner(null)
                    setAddingAd(true)
                  }}
                >
                  <Icon.Plus />
                  Nuevo anuncio
                </button>
              )}
            </div>
          )}
          {!current ? (
            error ? (
              <div className="ads-panel-message" role="alert">
                <p>{error}</p>
                <button type="button" className="btn" onClick={() => load(true)}>
                  Reintentar
                </button>
              </div>
            ) : (
              <p className="ads-panel-message ads-loading" aria-busy="true">
                Cargando {words.plural}…
              </p>
            )
          ) : rows.length === 0 ? (
            <div className="ads-panel-message">
              <p>{words.vacio}</p>
              {level === 'campana' && meta && (
                <button type="button" className="btn is-accent" onClick={meta.onCreate}>
                  Crear una campaña
                </button>
              )}
            </div>
          ) : (
            <>
              {visible.length > 0 ? (
                <div className="ads-table-wrap">
                  <table className="ads-table">
                    <thead>
                      <tr>
                        <th scope="col">{words.nombre}</th>
                        {source.budgets.includes(level) && <th scope="col">Presupuesto</th>}
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
                          source={source}
                          metrics={metrics}
                          currency={currency}
                          parentStopped={stopped(current.padre)}
                          busy={busy === r.id}
                          onOpen={
                            r.sinHijos
                              ? undefined
                              : level === 'campana'
                                ? () => go({ campana: { id: r.id, nombre: r.nombre }, nivel: 'conjunto' })
                                : level === 'conjunto'
                                  ? () => go({ campana: path.campana ?? r.padres?.campana ?? undefined, conjunto: { id: r.id, nombre: r.nombre }, nivel: 'anuncio' })
                                  : undefined
                          }
                          context={
                            level === 'conjunto' && !path.campana
                              ? (r.padres?.campana?.nombre ?? null)
                              : level === 'anuncio' && !path.conjunto
                                ? (r.padres?.conjunto?.nombre ?? null)
                                : null
                          }
                          actions={rowActions(r)}
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
            </>
          )}
        </section>
      </div>
      {confirm && (
        <Popover anchor={confirm.anchor} placement="below-end" width={300} label={confirmLabel(confirm.kind, source)} onClose={() => setConfirm(null)}>
          <div className="ads-confirm">
            <p>{confirmText(confirm, level, source)}</p>
            <div className="ads-form-foot">
              <button type="button" className="link-btn" onClick={() => setConfirm(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className={confirm.kind === 'remove' ? 'danger-btn' : 'btn is-accent'}
                disabled={busy === confirm.row.id}
                onClick={() => void act(confirm)}
              >
                {busy === confirm.row.id ? 'Un momento…' : confirmLabel(confirm.kind, source)}
              </button>
            </div>
          </div>
        </Popover>
      )}
    </div>
  )
}

const confirmLabel = (kind: Confirm['kind'], source: RunningSource) =>
  kind === 'duplicate' ? 'Duplicar' : kind === 'archive' ? 'Archivar' : (source.remove?.label ?? 'Borrar')

/** Lo que pasa al confirmar, dicho antes. */
function confirmText({ kind, row }: Confirm, level: Level, source: RunningSource) {
  const children = level === 'campana' ? ` con sus ${source.levels.conjunto.plural} y anuncios` : level === 'conjunto' ? ' con sus anuncios' : ''
  if (kind === 'duplicate') return `Se crea una copia de «${row.nombre}»${children}, en pausa.`
  if (kind === 'archive') return `«${row.nombre}» deja de entregarse y sale de «En marcha». Se puede recuperar en ${source.where}.`
  return `«${row.nombre}»${children} se ${source.remove?.label === 'Quitar' ? 'quita' : 'borra'} de ${source.where === 'Google Ads' ? 'Google Ads' : 'Meta'}. No se puede deshacer.`
}

/**
 * Qué métricas se ven: arriba, en grande (los totales), y en las columnas de la tabla; cada sitio las suyas.
 * Siempre al menos una en cada uno.
 */
function MetricsPicker({
  options,
  defaults,
  big,
  columns,
  onBig,
  onColumns,
}: {
  options: MetricDef[]
  defaults: string[]
  big: string[]
  columns: string[]
  onBig: (keys: string[]) => void
  onColumns: (keys: string[]) => void
}) {
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const isDefault = big.join() === defaults.join() && columns.join() === defaults.join()
  const toggle = (chosen: string[], set: (keys: string[]) => void, key: string, on: boolean) =>
    set(options.map((m) => m.key).filter((k) => (k === key ? on : chosen.includes(k))))
  return (
    <>
      <button ref={button} type="button" className="btn ads-metrics-btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        <Icon.Columns />
        Métricas
      </button>
      {open && button.current && (
        <Popover anchor={button.current} placement="below-start" width={420} label="Métricas" onClose={() => setOpen(false)}>
          <table className="ads-metrics-table">
            <thead>
              <tr>
                <th scope="col">Métrica</th>
                <th scope="col">En grande</th>
                <th scope="col">En la tabla</th>
              </tr>
            </thead>
            <tbody>
              {options.map((m) => (
                <tr key={m.key}>
                  <th scope="row">
                    {m.label}
                    {m.hint && <small>{m.hint}</small>}
                  </th>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${m.label}, en grande`}
                      checked={big.includes(m.key)}
                      disabled={big.includes(m.key) && big.length === 1}
                      onChange={(e) => toggle(big, onBig, m.key, e.target.checked)}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${m.label}, en la tabla`}
                      checked={columns.includes(m.key)}
                      disabled={columns.includes(m.key) && columns.length === 1}
                      onChange={(e) => toggle(columns, onColumns, m.key, e.target.checked)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ads-metrics-foot">
            <button
              type="button"
              className="link-btn"
              disabled={isDefault}
              onClick={() => {
                onBig(defaults)
                onColumns(defaults)
              }}
            >
              Volver a las de siempre
            </button>
          </div>
        </Popover>
      )}
    </>
  )
}

/** Un icono para cada nivel, como en el Administrador de anuncios. */
const LEVEL_ICONS: Record<Level, () => ReactNode> = { campana: Icon.Folder, conjunto: Icon.Grid, anuncio: Icon.Window }

/**
 * Las pestañas de nivel, como las del Administrador de anuncios: carpetas sobre la tabla. Con una campaña (o un
 * conjunto) elegida, su pestaña lo dice («1 seleccionada ×», que quita el filtro) y las de debajo, de qué son.
 */
function LevelTabs({
  source,
  level,
  path,
  onLevel,
  onClear,
}: {
  source: RunningSource
  level: Level
  path: AdPath
  onLevel: (level: Level) => void
  onClear: (path: AdPath) => void
}) {
  const words = source.levels
  const female = (l: Level) => words[l].activado.endsWith('a')
  const of = (l: Level) => `de 1 ${words[l].nombre.toLowerCase()}`
  const label = (l: Level) =>
    l === 'conjunto' && path.campana ? `${words.conjunto.pestana} ${of('campana')}` : l === 'anuncio' && (path.conjunto || path.campana) ? `${words.anuncio.pestana} ${of(path.conjunto ? 'conjunto' : 'campana')}` : words[l].pestana
  const selected = (l: Level) => (l === 'campana' ? path.campana : l === 'conjunto' ? path.conjunto : undefined)
  const clear = (l: Level) => onClear(l === 'campana' ? { nivel: level } : { campana: path.campana, nivel: level })
  return (
    <div className="ads-tabs" role="tablist" aria-label="Nivel">
      {(['campana', 'conjunto', 'anuncio'] as const).map((l) => {
        const LevelIcon = LEVEL_ICONS[l]
        return (
          <div key={l} className={cx('ads-tab', l === level && 'is-active')}>
            <button type="button" role="tab" aria-selected={l === level} className="ads-tab-button" onClick={() => onLevel(l)}>
              <LevelIcon />
              <span>{label(l)}</span>
            </button>
            {selected(l) && (
              <span className="ads-tab-chip" title={selected(l)!.nombre}>
                1 seleccionad{female(l) ? 'a' : 'o'}
                <button type="button" aria-label={`Quitar el filtro de «${selected(l)!.nombre}»`} title="Quitar el filtro" onClick={() => clear(l)}>
                  <Icon.Close />
                </button>
              </span>
            )}
          </div>
        )
      })}
    </div>
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
  source,
  metrics,
  currency,
  parentStopped,
  busy,
  onOpen,
  onChange,
  context,
  actions,
}: {
  row: AdRow & { metricas: MetricValues }
  level: Level
  source: RunningSource
  metrics: MetricDef[]
  currency: string
  parentStopped: boolean
  busy: boolean
  onOpen?: () => void
  onChange: (estado: AdRow['estado']) => Promise<void>
  /** De qué campaña o conjunto es (en las listas de toda la cuenta). */
  context: string | null
  actions: (anchor: HTMLElement) => MenuItem[]
}) {
  const cell = useRef<HTMLTableCellElement>(null)
  const more = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const words = source.levels[level]
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
            source.thumbnails &&
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
              {r.tipo && <span className="ads-row-type">{r.tipo}</span>}
              {context && (
                <span className="ads-row-type" title={context}>
                  {context}
                </span>
              )}
              {r.automaticas && <AutomaticBadge automaticas={r.automaticas} name={r.nombre} />}
              {r.enlace && (
                <a
                  className="ads-row-link"
                  href={r.enlace}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Abrir «${r.nombre}» en ${source.where}`}
                  title={`Abrir en ${source.where}`}
                >
                  <Icon.External />
                </a>
              )}
              {Boolean(source.editor || source.duplicate || source.archive || source.remove) && (
                <button
                  ref={more}
                  type="button"
                  className="ads-row-more"
                  aria-label={`Más opciones de «${r.nombre}»`}
                  title="Editar, duplicar…"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen(true)}
                >
                  <Icon.Ellipsis />
                </button>
              )}
            </span>
          </div>
        </div>
        {menuOpen && more.current && <Menu anchor={more.current} items={actions(more.current)} label={`Opciones de «${r.nombre}»`} onClose={() => setMenuOpen(false)} />}
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
                    : `Mientras ${source.levels.conjunto.el} o la campaña sigan en pausa, no se mostrará.`}
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
      {source.budgets.includes(level) && (
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
