import { useEffect, useRef, useState, type ReactNode } from 'react'
import { googleApi, type AdPath, type AdPreview, type AdRow, type GoogleAsset, type GoogleList, type Keyword, type SearchTerm } from '../ads'
import { cx } from '../util'
import { errorText } from './Ads'
import { cellText, type ExtraTab, type ExtraTabProps, type MetricDef } from './AdsRunning'
import * as Icon from './Icons'
import '../styles/google.css'

// Lo propio de Google Ads en «En marcha»: cada anuncio dibujado como sale en Google (con su calidad y sus textos) y
// las pestañas de palabras clave, términos de búsqueda y recursos, con lo elegido arriba.

/** «www.lto.com.py» de una dirección (y, con `path`, también lo de después: «www.lto.com.py/tours»). */
const hostOf = (url: string | null, path = false) => {
  if (!url) return null
  try {
    const u = new URL(url)
    return path ? `${u.hostname}${u.pathname.replace(/\/$/, '')}` : u.hostname
  } catch {
    return null
  }
}

/** Un anuncio como sale en Google: en la búsqueda (con sus enlaces de sitio) o con su imagen. */
export function GoogleAdPreview({ row }: { row: AdRow }) {
  const v = row.vista
  if (!v) return null
  if (v.tipo === 'imagen') return <VisualPreview v={v} />
  if (v.tipo === 'busqueda') return <SearchPreview v={v} />
  return (
    <div className="g-serp">
      <p className="g-serp-title">{row.nombre}</p>
      <p className="g-serp-desc">Google no deja ver cómo queda este tipo de anuncio fuera de Google Ads.</p>
    </div>
  )
}

function SearchPreview({ v }: { v: AdPreview }) {
  const domain = hostOf(v.url)
  const name = v.empresa ?? domain ?? 'Tu empresa'
  return (
    <div className="g-serp" aria-label="Cómo sale en la búsqueda de Google">
      <span className="g-serp-sponsored">Patrocinado</span>
      <div className="g-serp-site">
        {v.logo ? <img src={v.logo} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="g-serp-initial">{name.charAt(0)}</span>}
        <span>
          <strong>{name}</strong>
          <small>{[domain, ...v.rutas].filter(Boolean).join(' › ')}</small>
        </span>
      </div>
      <p className="g-serp-title">{v.titulos.slice(0, 3).join(' | ') || 'Sin títulos'}</p>
      <p className="g-serp-desc">{[v.descripciones.slice(0, 2).join(' '), v.destacados.join(' · ')].filter(Boolean).join(' ')}</p>
      {v.enlaces.length > 0 && (
        <div className="g-serp-links">
          {v.enlaces.map((link) => (
            <span key={link}>{link}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function VisualPreview({ v }: { v: AdPreview }) {
  const [main, ...rest] = v.imagenes
  return (
    <div className="g-visual" aria-label="Cómo sale el anuncio con su imagen">
      {main ? (
        <img className="g-visual-main" src={main} alt="" loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <span className="g-visual-main is-empty">
          <Icon.Image />
        </span>
      )}
      <div className="g-visual-body">
        <div className="g-visual-brand">
          {v.logo && <img src={v.logo} alt="" loading="lazy" referrerPolicy="no-referrer" />}
          <span>
            <strong>{v.titulos[0] ?? ''}</strong>
            {v.empresa && <small>{v.empresa}</small>}
          </span>
        </div>
        {v.descripciones[0] && <p>{v.descripciones[0]}</p>}
        <span className="g-visual-cta">{v.accion ?? 'Más información'}</span>
      </div>
      {rest.length > 0 && (
        <div className="g-visual-more">
          {rest.slice(0, 6).map((url) => (
            <img key={url} src={url} alt="" loading="lazy" referrerPolicy="no-referrer" />
          ))}
        </div>
      )}
    </div>
  )
}

/** La calidad del anuncio, como la da Google (con su barra de cuatro). */
const QUALITY: Record<string, { label: string; level: number; tone: 'ok' | 'warning' | 'bad' | 'off' }> = {
  EXCELLENT: { label: 'Excelente', level: 4, tone: 'ok' },
  GOOD: { label: 'Buena', level: 3, tone: 'ok' },
  AVERAGE: { label: 'Normal', level: 2, tone: 'warning' },
  POOR: { label: 'Baja', level: 1, tone: 'bad' },
  PENDING: { label: 'Pendiente', level: 0, tone: 'off' },
}

/** Lo que se dice de un anuncio: su calidad, todos sus textos (plegados) y adónde lleva. */
export function GoogleAdDetails({ row }: { row: AdRow }) {
  const v = row.vista
  if (!v) return null
  const quality = QUALITY[v.calidad ?? '']
  return (
    <div className="g-ad-details">
      {quality && (
        <div className="g-strength">
          <span>Calidad del anuncio</span>
          <b className={`is-${quality.tone}`}>{quality.label}</b>
          <span className="g-strength-bar" aria-hidden="true">
            {[1, 2, 3, 4].map((i) => (
              <i key={i} className={cx(i <= quality.level && `is-${quality.tone}`)} />
            ))}
          </span>
        </div>
      )}
      {(v.titulos.length > 0 || v.descripciones.length > 0) && (
        <details className="g-texts">
          <summary>
            {v.titulos.length === 1 ? '1 título' : `${v.titulos.length} títulos`} ·{' '}
            {v.descripciones.length === 1 ? '1 descripción' : `${v.descripciones.length} descripciones`}
            {v.tipo === 'busqueda' && v.titulos.length > 3 && ' (Google combina los que mejor funcionan)'}
          </summary>
          <ul>
            {v.titulos.map((t, i) => (
              <li key={`t${i}`}>{t}</li>
            ))}
          </ul>
          <ul className="is-descriptions">
            {v.descripciones.map((d, i) => (
              <li key={`d${i}`}>{d}</li>
            ))}
          </ul>
        </details>
      )}
      {v.url && (
        <a className="g-final-url" href={v.url} target="_blank" rel="noreferrer">
          {hostOf(v.url, true) ?? v.url}
          <Icon.External />
        </a>
      )}
    </div>
  )
}

// ── Las pestañas de más ──

/** Pide la lista de una pestaña: al abrirla, al cambiar el periodo o lo elegido y, sin la copia, al «Actualizar». */
function useList<T>(load: (fresh: boolean) => Promise<T>, key: string, refresh: number) {
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null; loading: boolean }>({ key, data: null, error: null, loading: true })
  const seen = useRef(refresh)
  const loader = useRef(load)
  loader.current = load
  useEffect(() => {
    let stale = false
    const fresh = refresh !== seen.current
    seen.current = refresh
    setState((s) => ({ ...s, loading: true }))
    loader.current(fresh).then(
      (data) => !stale && setState({ key, data, error: null, loading: false }),
      (err) => !stale && setState((s) => ({ ...s, key, error: errorText(err), loading: false })),
    )
    return () => {
      stale = true
    }
  }, [key, refresh])
  // Lo de otra elección no se enseña (mientras llega lo nuevo, «Cargando…»).
  return state.key === key ? state : { key, data: null, error: null, loading: true }
}

const pathKey = (path: AdPath) => `${(path.campanas ?? []).map((c) => c.id).join(',')}/${(path.conjuntos ?? []).map((c) => c.id).join(',')}`

/** Las columnas de las tablas de palabras y términos, con los nombres de Google Ads. */
const LIST_METRICS: MetricDef[] = [
  { key: 'clics', label: 'Clics', format: 'count' },
  { key: 'impresiones', label: 'Impr.', format: 'count' },
  { key: 'ctr', label: 'CTR', format: 'percent' },
  { key: 'cpc', label: 'CPC medio', format: 'money' },
  { key: 'gasto', label: 'Coste', format: 'money' },
  { key: 'conversiones', label: 'Conv.', format: 'number' },
  { key: 'coste', label: 'Coste/conv.', format: 'money' },
]

function TabMessage({ error, what }: { error: string | null; what: string }) {
  return error ? (
    <p className="ads-panel-message" role="alert">
      {error}
    </p>
  ) : (
    <p className="ads-panel-message ads-loading" aria-busy="true">
      Cargando {what}…
    </p>
  )
}

/** Cómo escribe Google cada concordancia: amplia tal cual, de frase entre comillas, exacta entre corchetes. */
const MATCH: Record<string, { label: string; write: (text: string) => string }> = {
  BROAD: { label: 'Amplia', write: (t) => t },
  PHRASE: { label: 'Frase', write: (t) => `"${t}"` },
  EXACT: { label: 'Exacta', write: (t) => `[${t}]` },
}

function Quality({ score }: { score: number | null }) {
  if (score === null) return <span title="Google aún no lo calcula: hacen falta más búsquedas">—</span>
  return <span className={cx('g-quality', score >= 7 ? 'is-ok' : score >= 4 ? 'is-warning' : 'is-bad')}>{score}/10</span>
}

function MetricCells({ metrics, currency }: { metrics: Record<string, number | null>; currency: string }) {
  return (
    <>
      {LIST_METRICS.map((m) => (
        <td key={m.key}>{cellText(metrics[m.key] ?? null, m.format, currency)}</td>
      ))}
    </>
  )
}

function MetricHeads() {
  return (
    <>
      {LIST_METRICS.map((m) => (
        <th key={m.key} scope="col">
          {m.label}
        </th>
      ))}
    </>
  )
}

/** Cuántas hay y su total, debajo de la tabla. */
function Totals<T>({ list, label, span }: { list: GoogleList<T>; label: string; span: number }) {
  return (
    <tfoot>
      <tr>
        <th scope="row" colSpan={span}>
          {label}
        </th>
        <MetricCells metrics={list.totales} currency={list.moneda} />
      </tr>
    </tfoot>
  )
}

function KeywordsTab({ account, period, path, refresh }: ExtraTabProps) {
  const { data, error, loading } = useList((fresh) => googleApi.keywords(account.id, period, path, fresh), `${account.id}/${period}/${pathKey(path)}`, refresh)
  if (!data) return <TabMessage error={error} what="las palabras clave" />
  if (!data.filas.length) {
    return (
      <p className="ads-panel-message">
        No hay palabras clave aquí. Las campañas inteligentes, de Máximo rendimiento o Demand Gen no tienen: Google elige solo dónde salir.
      </p>
    )
  }
  const oneGroup = (path.conjuntos?.length ?? 0) === 1
  return (
    <div className={cx('ads-table-wrap', loading && 'is-loading')}>
      <table className="ads-table g-table">
        <thead>
          <tr>
            <th scope="col">Palabra clave</th>
            <th scope="col">Concordancia</th>
            <th scope="col" title="De 1 a 10: lo que Google cree que encajan la palabra, el anuncio y la página">
              Nivel de calidad
            </th>
            <MetricHeads />
          </tr>
        </thead>
        <tbody>
          {data.filas.map((k: Keyword) => (
            <tr key={k.id} className={cx(k.estado !== 'activa' && 'is-paused')}>
              <th scope="row">
                <span className="g-cell-main">{MATCH[k.concordancia ?? '']?.write(k.texto) ?? k.texto}</span>
                <span className="ads-row-meta">
                  <span className={cx('ads-delivery', k.estado !== 'activa' ? 'is-off' : k.aviso ? 'is-warning' : 'is-ok')}>
                    {k.estado !== 'activa' ? 'En pausa' : (k.aviso ?? 'Apta')}
                  </span>
                  {!oneGroup && k.grupo && <span className="ads-row-type">{k.grupo.nombre}</span>}
                </span>
              </th>
              <td>{MATCH[k.concordancia ?? '']?.label ?? '—'}</td>
              <td>
                <Quality score={k.calidad} />
              </td>
              <MetricCells metrics={k.metricas} currency={data.moneda} />
            </tr>
          ))}
        </tbody>
        <Totals list={data} label={data.filas.length === 1 ? '1 palabra clave' : `${data.filas.length} palabras clave`} span={3} />
      </table>
    </div>
  )
}

function SearchTermsTab({ account, period, path, refresh }: ExtraTabProps) {
  const { data, error, loading } = useList((fresh) => googleApi.searchTerms(account.id, period, path, fresh), `${account.id}/${period}/${pathKey(path)}`, refresh)
  if (!data) return <TabMessage error={error} what="los términos de búsqueda" />
  if (!data.filas.length) return <p className="ads-panel-message">En este periodo nadie ha buscado nada que la haga salir (o no es una campaña de búsqueda).</p>
  return (
    <>
      <p className="g-tab-note">Lo que la gente escribió en Google y la palabra clave que hizo salir el anuncio (los 300 con más impresiones).</p>
      <div className={cx('ads-table-wrap', loading && 'is-loading')}>
        <table className="ads-table g-table">
          <thead>
            <tr>
              <th scope="col">Término de búsqueda</th>
              <th scope="col">Palabra clave</th>
              <MetricHeads />
            </tr>
          </thead>
          <tbody>
            {data.filas.map((t: SearchTerm) => (
              <tr key={t.id}>
                <th scope="row">
                  <span className="g-cell-main">{t.termino}</span>
                  {t.estado && (
                    <span className="ads-row-meta">
                      <span className="ads-row-type">{t.estado}</span>
                    </span>
                  )}
                </th>
                <td className="g-cell-text">{t.palabra ? (MATCH[t.palabra.concordancia ?? '']?.write(t.palabra.texto) ?? t.palabra.texto) : '—'}</td>
                <MetricCells metrics={t.metricas} currency={data.moneda} />
              </tr>
            ))}
          </tbody>
          <Totals list={data} label={data.filas.length === 1 ? '1 término' : `${data.filas.length} términos`} span={2} />
        </table>
      </div>
    </>
  )
}

/** Cómo se llama cada uso de un recurso en Google Ads. */
const ASSET_KINDS: Record<string, string> = {
  BUSINESS_LOGO: 'Logo',
  LOGO: 'Logo',
  LANDSCAPE_LOGO: 'Logo horizontal',
  MARKETING_IMAGE: 'Imagen horizontal',
  SQUARE_MARKETING_IMAGE: 'Imagen cuadrada',
  PORTRAIT_MARKETING_IMAGE: 'Imagen vertical',
  TALL_PORTRAIT_MARKETING_IMAGE: 'Imagen vertical',
  AD_IMAGE: 'Imagen',
  SITELINK: 'Enlace de sitio',
  CALLOUT: 'Texto destacado',
  STRUCTURED_SNIPPET: 'Fragmento estructurado',
  BUSINESS_NAME: 'Nombre de la empresa',
  CALL: 'Llamada',
  PRICE: 'Precio',
  PROMOTION: 'Promoción',
  LEAD_FORM: 'Formulario',
}

/** Los grupos de la pestaña Recursos, en el orden de Google Ads. */
const ASSET_GROUPS: Array<{ title: string; kind: 'image' | 'link' | 'chip' | 'snippet'; test: (a: GoogleAsset) => boolean }> = [
  { title: 'Imágenes y logos', kind: 'image', test: (a) => Boolean(a.imagen) },
  { title: 'Enlaces de sitio', kind: 'link', test: (a) => a.tipo === 'SITELINK' },
  { title: 'Textos destacados', kind: 'chip', test: (a) => a.tipo === 'CALLOUT' },
  { title: 'Fragmentos estructurados', kind: 'snippet', test: (a) => a.tipo === 'STRUCTURED_SNIPPET' },
  { title: 'Nombre de la empresa y llamadas', kind: 'chip', test: (a) => a.tipo === 'BUSINESS_NAME' || a.tipo === 'CALL' },
]

const levelOf = (a: GoogleAsset) => (a.nivel === 'cuenta' ? 'Toda la cuenta' : a.nivel === 'grupo' ? (a.grupo?.nombre ?? 'Grupo') : (a.campana?.nombre ?? 'Campaña'))

function AssetsTab({ account, path, refresh }: ExtraTabProps) {
  const { data, error } = useList((fresh) => googleApi.assets(account.id, path, fresh), `${account.id}/${pathKey(path)}`, refresh)
  if (!data) return <TabMessage error={error} what="los recursos" />
  const groups = ASSET_GROUPS.map((g) => ({ ...g, items: data.filter(g.test) }))
  const known = new Set(groups.flatMap((g) => g.items))
  const others = data.filter((a) => !known.has(a) && a.texto)
  if (!data.length) return <p className="ads-panel-message">No hay recursos: ni imágenes, ni logos, ni enlaces de sitio, ni textos destacados.</p>
  const level = (a: GoogleAsset) => <span className="ads-row-type">{levelOf(a)}</span>
  return (
    <div className="g-assets">
      {groups
        .filter((g) => g.items.length)
        .map((g) => (
          <section key={g.title} className="g-asset-group" aria-label={g.title}>
            <h5>
              {g.title} <span className="ads-count">· {g.items.length}</span>
            </h5>
            {g.kind === 'image' ? (
              <ul className="g-asset-images">
                {g.items.map((a) => (
                  <li key={`${a.nivel}${a.id}${a.tipo}`}>
                    <img className={cx(a.tipo.includes('LOGO') && 'is-logo')} src={a.imagen!} alt={ASSET_KINDS[a.tipo] ?? 'Imagen'} loading="lazy" referrerPolicy="no-referrer" />
                    <span>
                      {ASSET_KINDS[a.tipo] ?? 'Imagen'}
                      {a.ancho && a.alto ? ` · ${a.ancho}×${a.alto}` : ''}
                    </span>
                    {level(a)}
                  </li>
                ))}
              </ul>
            ) : g.kind === 'link' ? (
              <ul className="g-asset-links">
                {g.items.map((a) => (
                  <li key={`${a.nivel}${a.id}`}>
                    <strong>{a.texto}</strong>
                    {a.detalle.map((d) => (
                      <span key={d}>{d}</span>
                    ))}
                    {level(a)}
                  </li>
                ))}
              </ul>
            ) : g.kind === 'snippet' ? (
              <ul className="g-asset-links">
                {g.items.map((a) => (
                  <li key={`${a.nivel}${a.id}`}>
                    <strong>{a.texto}:</strong>
                    <span>{a.detalle.join(' · ')}</span>
                    {level(a)}
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="g-asset-chips">
                {g.items.map((a) => (
                  <li key={`${a.nivel}${a.id}${a.tipo}`} title={levelOf(a)}>
                    {a.texto}
                    <small>{a.nivel === 'cuenta' ? 'Cuenta' : levelOf(a)}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      {others.length > 0 && (
        <section className="g-asset-group" aria-label="Otros">
          <h5>Otros</h5>
          <ul className="g-asset-chips">
            {others.map((a) => (
              <li key={`${a.nivel}${a.id}${a.tipo}`}>
                {a.texto}
                <small>{ASSET_KINDS[a.tipo] ?? a.tipo}</small>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** Las pestañas de más de Google Ads, después de Campañas · Grupos · Anuncios. */
export const GOOGLE_TABS: ExtraTab[] = [
  { key: 'palabras', label: 'Palabras clave', icon: Icon.Key, render: (props) => <KeywordsTab {...props} /> },
  { key: 'terminos', label: 'Términos de búsqueda', icon: Icon.Search, render: (props) => <SearchTermsTab {...props} /> },
  { key: 'recursos', label: 'Recursos', icon: Icon.Image, render: (props) => <AssetsTab {...props} /> },
]

export const googlePreview = (row: AdRow): ReactNode => <GoogleAdPreview row={row} />
export const googleDetails = (row: AdRow): ReactNode => <GoogleAdDetails row={row} />
