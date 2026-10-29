// Conexión con Google Ads (la API de Google Ads, por REST) para la vista Google Ads: las cuentas (también las de
// una cuenta de administrador), las campañas, grupos de anuncios y anuncios en marcha con sus métricas, y
// pausarlos o activarlos.
//
// El cliente OAuth del proyecto de Google Cloud (identificador y clave secreta) y el token de refresco se guardan
// en datos/google.json, solo en este Mac (permisos 600; fuera de board.json, de sus copias y del repositorio).
// Nunca salen hacia la web: la app solo ve si hay conexión y con qué correo. Desde septiembre de 2026 no hace falta
// token de desarrollador: el nivel de acceso (de prueba, Explorer…) es el del proyecto de Google Cloud.
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DATA_DIR, HttpError } from './almacen.mjs'

/** Versión de la API de Google Ads. Cada una dura un año; TABLERO_GOOGLE_VERSION la cambia sin tocar el código. */
export const GOOGLE_VERSION = process.env.TABLERO_GOOGLE_VERSION || 'v26'
const API = 'https://googleads.googleapis.com'
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN = 'https://oauth2.googleapis.com/token'
const GOOGLE_FILE = path.join(DATA_DIR, 'google.json')

/** Gestionar Google Ads y, para decir con qué cuenta se conectó, el correo. */
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/adwords', 'openid', 'email']

/** Un enlace de conexión vale 10 minutos. */
const STATE_TTL = 10 * 60_000
/** Las cuentas cambian poco: se guardan un rato (el botón «Actualizar» las vuelve a pedir). */
const CACHE_TTL = 10 * 60_000
/** Las campañas y sus números, un minuto (con el acceso Explorer hay 2.880 operaciones al día). */
const METRICS_TTL = 60_000

/** Los periodos de «En marcha», con su nombre en Google Ads (en la zona horaria de la cuenta). */
export const GOOGLE_PERIODS = { hoy: 'TODAY', ayer: 'YESTERDAY', '7d': 'LAST_7_DAYS', '30d': 'LAST_30_DAYS' }

const EXPIRED =
  'La conexión con Google Ads ha caducado o se ha retirado. Vuelve a conectar. (Si la pantalla de consentimiento de tu proyecto sigue en «Prueba», Google la corta cada 7 días: pásala a «En producción».)'

const CUSTOMER_STATUS = { ENABLED: 'activa', CANCELED: 'cancelada', SUSPENDED: 'suspendida', CLOSED: 'cerrada' }

async function readStore() {
  try {
    return JSON.parse(await readFile(GOOGLE_FILE, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    if (err instanceof SyntaxError) throw new HttpError(500, `${GOOGLE_FILE} no es un JSON válido; no se ha modificado.`)
    throw err
  }
}

async function writeStore(data) {
  await mkdir(DATA_DIR, { recursive: true })
  const tmp = `${GOOGLE_FILE}.tmp`
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await chmod(tmp, 0o600)
  await rename(tmp, GOOGLE_FILE)
}

/**
 * Los errores de Google, en algo que se pueda enseñar: los del inicio de sesión (`{error: 'invalid_grant'}`) y los
 * de la API (`{error: {status, details: [GoogleAdsFailure]}}`), con lo que hay que hacer en los que se conocen.
 */
export function googleError(body, status) {
  if (typeof body?.error === 'string') {
    if (body.error === 'invalid_grant') return new HttpError(401, EXPIRED, 'google-caducada')
    if (['invalid_client', 'unauthorized_client'].includes(body.error)) {
      return new HttpError(400, 'Google no reconoce el cliente OAuth: revisa su identificador y su clave secreta.', 'google-cliente')
    }
    return new HttpError(502, body.error_description || body.error, 'google')
  }
  const error = body?.error
  const details = Array.isArray(error?.details) ? error.details : []
  const failure = details.find((d) => String(d?.['@type'] ?? '').endsWith('.GoogleAdsFailure'))
  const first = failure?.errors?.[0]
  const code = first?.errorCode ?? {}
  const auth = code.authorizationError
  if (status === 401 || error?.status === 'UNAUTHENTICATED') return new HttpError(401, EXPIRED, 'google-caducada')
  if (auth === 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION') {
    return new HttpError(
      403,
      'Tu proyecto de Google Cloud solo tiene acceso de prueba, que solo vale para cuentas de prueba. Solicita el acceso Explorer en Cloud Console › APIs y servicios › Google Ads API.',
      'google-solo-prueba',
    )
  }
  if (auth === 'PROJECT_DISABLED' || details.some((d) => d?.reason === 'SERVICE_DISABLED')) {
    return new HttpError(
      403,
      'La Google Ads API no está activada en tu proyecto de Google Cloud: actívala en Cloud Console › APIs y servicios › Biblioteca.',
      'google-api-desactivada',
    )
  }
  if (['USER_PERMISSION_DENIED', 'INVALID_LOGIN_CUSTOMER_ID_SERVING_CUSTOMER_ID_COMBINATION'].includes(auth)) {
    return new HttpError(403, 'Tu usuario de Google no tiene acceso a esta cuenta de Google Ads.', 'google-sin-acceso')
  }
  if (auth === 'CUSTOMER_NOT_ENABLED') {
    return new HttpError(400, 'Esta cuenta de Google Ads no está activa (cancelada o sin terminar de configurar).', 'google-cuenta-inactiva')
  }
  if (code.quotaError || error?.status === 'RESOURCE_EXHAUSTED' || status === 429) {
    return new HttpError(429, 'Google pide esperar un poco: demasiadas peticiones seguidas. Prueba en unos minutos.', 'google-limite')
  }
  return new HttpError(502, first?.message || error?.message || `Google Ads ha respondido con un error (${status})`, 'google')
}

// ── Lo que llega de Google: campañas, grupos de anuncios y anuncios ──

/** Lo que se pide de cada fila para sacar las métricas de `googleMetrics`. */
const METRIC_FIELDS = 'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value'
/** Los campos de métricas que se suman (para el total). */
const SUMMED = ['costMicros', 'impressions', 'clicks', 'conversions', 'conversionsValue']

/**
 * Las métricas de una fila (o de la suma de varias). Los cocientes se calculan aquí, igual en las filas que en el
 * total, y son null cuando no hay de qué. Google da el gasto en millonésimas.
 */
export function googleMetrics(m) {
  const n = (value) => Number(value) || 0
  const per = (a, b, scale = 1) => (b ? (a / b) * scale : null)
  const gasto = n(m?.costMicros) / 1_000_000
  const impresiones = n(m?.impressions)
  const clics = n(m?.clicks)
  const conversiones = n(m?.conversions)
  const valor = n(m?.conversionsValue)
  return {
    gasto,
    conversiones,
    coste: per(gasto, conversiones),
    tasa: per(conversiones, clics, 100),
    valor,
    roas: per(valor, gasto),
    impresiones,
    clics,
    ctr: per(clics, impresiones, 100),
    cpc: per(gasto, clics),
    cpm: per(gasto, impresiones, 1000),
  }
}

/** Cómo se dice en cada nivel (la campaña; el grupo y el anuncio). */
const WORDS = {
  campana: { activo: 'Activa', terminado: 'Terminada', programado: 'Programada', limitado: 'Limitada', noApto: 'No apta' },
  conjunto: { activo: 'Activo', terminado: 'Terminado', programado: 'Programado', limitado: 'Limitado', noApto: 'No apto' },
  anuncio: { activo: 'Activo', terminado: 'Terminado', programado: 'Programado', limitado: 'Limitado', noApto: 'No apto' },
}

/** Los motivos que da Google de por qué algo no se entrega del todo, del más importante al menos. */
const REASONS = [
  ['CAMPAIGN_PAUSED', { texto: 'Campaña en pausa', tono: 'off' }],
  ['AD_GROUP_PAUSED', { texto: 'Grupo en pausa', tono: 'off' }],
  ['CAMPAIGN_ENDED', { texto: 'Campaña terminada', tono: 'off' }],
  ['AD_GROUP_AD_DISAPPROVED', { texto: 'Rechazado', tono: 'warning' }],
  ['HAS_ADS_DISAPPROVED', { texto: 'Anuncios rechazados', tono: 'warning' }],
  ['HAS_ASSET_GROUPS_DISAPPROVED', { texto: 'Grupos de recursos rechazados', tono: 'warning' }],
  ['AD_GROUPS_PAUSED', { texto: 'Grupos en pausa', tono: 'warning' }],
  ['ASSET_GROUPS_PAUSED', { texto: 'Grupos de recursos en pausa', tono: 'warning' }],
  ['AD_GROUP_ADS_PAUSED', { texto: 'Anuncios en pausa', tono: 'warning' }],
  ['NO_AD_GROUPS', { texto: 'Sin grupos de anuncios', tono: 'warning' }],
  ['NO_ASSET_GROUPS', { texto: 'Sin grupos de recursos', tono: 'warning' }],
  ['NO_AD_GROUP_ADS', { texto: 'Sin anuncios', tono: 'warning' }],
  ['AD_GROUP_AD_NO_ADS', { texto: 'Sin anuncios', tono: 'warning' }],
  ['KEYWORDS_PAUSED', { texto: 'Palabras clave en pausa', tono: 'warning' }],
  ['NO_KEYWORDS', { texto: 'Sin palabras clave', tono: 'warning' }],
  ['MISSING_LOCATION_TARGETING', { texto: 'Sin ubicaciones', tono: 'warning' }],
  ['BUDGET_MISCONFIGURED', { texto: 'Presupuesto mal configurado', tono: 'warning' }],
  ['BIDDING_STRATEGY_MISCONFIGURED', { texto: 'Puja mal configurada', tono: 'warning' }],
  ['BUDGET_CONSTRAINED', { texto: 'Limitada por presupuesto', tono: 'warning' }],
  ['HAS_ADS_LIMITED_BY_POLICY', { texto: 'Limitada por políticas', tono: 'warning' }],
  ['AD_GROUP_AD_POOR_QUALITY', { texto: 'Baja calidad', tono: 'warning' }],
  ['MOST_ADS_UNDER_REVIEW', { texto: 'En revisión', tono: 'off' }],
  ['AD_GROUP_AD_UNDER_REVIEW', { texto: 'En revisión', tono: 'off' }],
  ['AD_GROUP_AD_UNDER_APPEAL', { texto: 'En apelación', tono: 'off' }],
  ['BIDDING_STRATEGY_LEARNING', { texto: 'Aprendiendo', tono: 'ok' }],
]

/**
 * Lo que pasa de verdad con la campaña, el grupo o el anuncio (aunque esté activo, puede no estar gastando), en
 * pocas palabras: de su estado principal y sus motivos, como en Google Ads.
 */
export function googleDelivery(entity, level = 'campana') {
  const words = WORDS[level]
  const reasons = new Set(entity?.primaryStatusReasons ?? [])
  if (entity?.status === 'PAUSED') return { texto: 'En pausa', tono: 'off' }
  for (const [reason, state] of REASONS) {
    // De la propia campaña (en pausa, terminada…) lo dice mejor su estado principal.
    if (!reasons.has(reason) || (level === 'campana' && reason.startsWith('CAMPAIGN_'))) continue
    // «Limitada por…» es de las campañas; en un grupo o un anuncio, en masculino.
    if (level !== 'campana' && state.texto.startsWith('Limitada')) return { ...state, texto: state.texto.replace('Limitada', 'Limitado') }
    return state
  }
  if (entity?.policySummary?.approvalStatus === 'DISAPPROVED') return { texto: 'Rechazado', tono: 'warning' }
  switch (entity?.primaryStatus) {
    case 'PAUSED':
      return { texto: 'En pausa', tono: 'off' }
    case 'ENDED':
      return { texto: words.terminado, tono: 'off' }
    case 'PENDING':
      return { texto: words.programado, tono: 'off' }
    case 'LEARNING':
      return { texto: 'Aprendiendo', tono: 'ok' }
    case 'LIMITED':
      return { texto: words.limitado, tono: 'warning' }
    case 'MISCONFIGURED':
      return { texto: 'Mal configurada', tono: 'warning' }
    case 'NOT_ELIGIBLE':
      return { texto: words.noApto, tono: 'warning' }
    default:
      return { texto: words.activo, tono: 'ok' }
  }
}

/** El tipo de campaña, como lo llama Google Ads. */
const CHANNELS = {
  SEARCH: 'Búsqueda',
  DISPLAY: 'Display',
  SHOPPING: 'Shopping',
  VIDEO: 'Vídeo',
  PERFORMANCE_MAX: 'Máximo rendimiento',
  DEMAND_GEN: 'Demand Gen',
  MULTI_CHANNEL: 'App',
  LOCAL: 'Local',
  SMART: 'Inteligente',
  HOTEL: 'Hoteles',
  LOCAL_SERVICES: 'Servicios locales',
  TRAVEL: 'Viajes',
}

/**
 * Las campañas que no se abren: las de Máximo rendimiento no tienen grupos de anuncios (tienen grupos de recursos), y
 * las inteligentes tienen uno que gestiona Google, sin métricas propias (Google Ads tampoco las abre).
 */
const CLOSED_CHANNELS = ['PERFORMANCE_MAX', 'SMART']

/** Los anuncios sin nombre (casi todos), por su primer título o su tipo. */
const AD_TYPES = {
  RESPONSIVE_SEARCH_AD: 'Anuncio de búsqueda adaptable',
  RESPONSIVE_DISPLAY_AD: 'Anuncio de display adaptable',
  EXPANDED_TEXT_AD: 'Anuncio de texto expandido',
  VIDEO_RESPONSIVE_AD: 'Anuncio de vídeo adaptable',
  CALL_AD: 'Anuncio de llamada',
  IMAGE_AD: 'Anuncio de imagen',
}

function adName(ad) {
  const headline = ad?.responsiveSearchAd?.headlines?.[0]?.text ?? ad?.responsiveDisplayAd?.headlines?.[0]?.text ?? ad?.responsiveDisplayAd?.longHeadline?.text
  return ad?.name || headline || `${AD_TYPES[ad?.type] ?? 'Anuncio'} ${ad?.id ?? ''}`.trim()
}

/** El presupuesto de la campaña: diario o, si es de un periodo, el total. Los grupos y los anuncios no tienen. */
function budgetOf(budget) {
  const amount = (value) => Number(value) || 0
  if (amount(budget?.amountMicros)) return { cantidad: amount(budget.amountMicros) / 1_000_000, tipo: 'dia' }
  if (amount(budget?.totalAmountMicros)) return { cantidad: amount(budget.totalAmountMicros) / 1_000_000, tipo: 'total' }
  return null
}

/** Una campaña, un grupo o un anuncio como lo enseña «En marcha» (sin métricas: van aparte). */
export function googleRowOf(result, level = 'campana') {
  const entity = level === 'campana' ? result.campaign : level === 'conjunto' ? result.adGroup : result.adGroupAd
  const ad = entity?.ad
  // Un anuncio se identifica por su grupo y su número (así lo pide Google para cambiarlo).
  const id = level === 'anuncio' ? `${result.adGroup?.id}~${ad?.id}` : String(entity?.id)
  const channel = level === 'campana' ? entity?.advertisingChannelType : null
  return {
    id,
    nombre: (level === 'anuncio' ? adName(ad) : entity?.name) || id,
    estado: entity?.status === 'ENABLED' ? 'activa' : 'pausada',
    entrega: googleDelivery(entity, level),
    presupuesto: level === 'campana' ? budgetOf(result.campaignBudget) : null,
    enlace: null,
    miniatura: null,
    automaticas: null,
    pagina: null,
    actualizada: null,
    tipo: channel ? (CHANNELS[channel] ?? null) : null,
    // De qué campaña (y grupo) es: para bajar a él desde la lista de toda la cuenta.
    padres:
      level === 'conjunto'
        ? { campana: refOf(result.campaign) }
        : level === 'anuncio'
          ? { campana: refOf(result.campaign), conjunto: refOf(result.adGroup) }
          : null,
    ...(CLOSED_CHANNELS.includes(channel) ? { sinHijos: true } : {}),
  }
}

const refOf = (entity) => (entity?.id ? { id: String(entity.id), nombre: entity.name ?? String(entity.id) } : null)

/** La clave de una fila de métricas: la misma que la de su campaña, grupo o anuncio. */
const metricKey = (result, level) =>
  level === 'anuncio' ? `${result.adGroup?.id}~${result.adGroupAd?.ad?.id}` : String(level === 'campana' ? result.campaign?.id : result.adGroup?.id)

/**
 * Cada fila con sus métricas del periodo y el total (la suma de las filas). Primero las activas, de más a menos
 * gasto; luego las que están en pausa, también por gasto y después por nombre.
 */
export function googleRowsOf(entities, metricRows, level) {
  const stats = new Map(metricRows.map((r) => [metricKey(r, level), r.metrics]))
  const sum = Object.fromEntries(SUMMED.map((field) => [field, 0]))
  const rows = entities.map((result) => {
    const row = googleRowOf(result, level)
    const raw = stats.get(row.id)
    for (const field of SUMMED) sum[field] += Number(raw?.[field]) || 0
    return { ...row, metricas: googleMetrics(raw) }
  })
  rows.sort(
    (a, b) =>
      (a.estado === 'pausada') - (b.estado === 'pausada') ||
      b.metricas.gasto - a.metricas.gasto ||
      a.nombre.localeCompare(b.nombre, 'es'),
  )
  return { filas: rows, totales: googleMetrics(sum) }
}

// ── Las consultas (GAQL) ──

const ACTIVE = "IN ('ENABLED', 'PAUSED')"
/** Cuántas campañas o grupos se pueden elegir a la vez para ver lo de debajo. */
const MAX_FILTER = 50
const LEVEL_QUERIES = {
  campana: {
    entities:
      'SELECT campaign.id, campaign.name, campaign.status, campaign.primary_status, campaign.primary_status_reasons, ' +
      'campaign.advertising_channel_type, campaign_budget.amount_micros, campaign_budget.total_amount_micros FROM campaign',
    status: `campaign.status ${ACTIVE}`,
    metrics: `SELECT campaign.id, ${METRIC_FIELDS} FROM campaign`,
  },
  conjunto: {
    entities:
      'SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.primary_status, ad_group.primary_status_reasons, campaign.id, campaign.name FROM ad_group',
    status: `ad_group.status ${ACTIVE}`,
    metrics: `SELECT ad_group.id, ${METRIC_FIELDS} FROM ad_group`,
  },
  anuncio: {
    entities:
      'SELECT ad_group.id, ad_group.name, campaign.id, campaign.name, ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.ad.responsive_search_ad.headlines, ' +
      'ad_group_ad.ad.responsive_display_ad.headlines, ad_group_ad.ad.responsive_display_ad.long_headline, ad_group_ad.status, ' +
      'ad_group_ad.primary_status, ad_group_ad.primary_status_reasons, ad_group_ad.policy_summary.approval_status FROM ad_group_ad',
    status: `ad_group_ad.status ${ACTIVE}`,
    metrics: `SELECT ad_group.id, ad_group_ad.ad.id, ${METRIC_FIELDS} FROM ad_group_ad`,
  },
}

const where = (...conditions) => ` WHERE ${conditions.filter(Boolean).join(' AND ')}`

/** Cada nivel, para pausar o activar: su servicio y el nombre del recurso. */
const MUTATIONS = {
  campana: { service: 'campaigns', id: /^\d{1,20}$/, invalid: 'Campaña no válida' },
  conjunto: { service: 'adGroups', id: /^\d{1,20}$/, invalid: 'Grupo de anuncios no válido' },
  anuncio: { service: 'adGroupAds', id: /^\d{1,20}~\d{1,20}$/, invalid: 'Anuncio no válido' },
}

/** Monedas sin decimales: Google pide sus importes en unidades enteras (en millonésimas). */
const WHOLE_UNITS = new Set(['CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'JPY', 'KRW', 'PYG', 'TWD', 'VND'])

/** Un importe en millonésimas, redondeado a lo que admite la moneda (céntimos o unidades). */
export function micros(value, currency, what) {
  const amount = Number(value)
  if (!(amount > 0)) throw new HttpError(400, `${what} tiene que ser mayor que 0.`)
  return String(WHOLE_UNITS.has(currency) ? Math.round(amount) * 1_000_000 : Math.round(amount * 100) * 10_000)
}

/** Los textos de un anuncio de búsqueda adaptable, comprobados como los pide Google (los fijados, en su sitio). */
export function cleanSearchAd(raw) {
  const pinned = (value) => (typeof value === 'string' && /^(HEADLINE|DESCRIPTION)_\d$/.test(value) ? value : null)
  const assets = (list, max, what) => {
    const items = (Array.isArray(list) ? list : []).map((a) => ({ text: String(a?.texto ?? '').trim(), pinnedField: pinned(a?.fijado) })).filter((a) => a.text)
    const long = items.find((a) => a.text.length > max)
    if (long) throw new HttpError(400, `«${long.text}» es demasiado largo: los ${what} pueden tener hasta ${max} caracteres.`)
    return items.map((a) => (a.pinnedField ? a : { text: a.text }))
  }
  const headlines = assets(raw?.titulos, 30, 'títulos')
  const descriptions = assets(raw?.descripciones, 90, 'descripciones')
  if (headlines.length < 3 || headlines.length > 15) throw new HttpError(400, 'Hacen falta entre 3 y 15 títulos.')
  if (descriptions.length < 2 || descriptions.length > 4) throw new HttpError(400, 'Hacen falta entre 2 y 4 descripciones.')
  const url = String(raw?.url ?? '').trim()
  if (!/^https?:\/\/[^\s]+\.[^\s]+/.test(url)) throw new HttpError(400, 'La URL final tiene que empezar por https://')
  const path = (value) => String(value ?? '').trim().slice(0, 15)
  return { titulos: headlines, descripciones: descriptions, url, ruta1: path(raw?.ruta1), ruta2: path(raw?.ruta2) }
}

const CUSTOMER_ID = /^\d{6,12}$/
/** «1234567890» como lo escribe Google Ads: «123-456-7890». */
const formatCustomer = (id) => String(id).replace(/^(\d{3})(\d{3})(\d+)$/, '$1-$2-$3')

/** El correo de quien conecta, del id_token (viene de Google por HTTPS en la misma respuesta: no hace falta verificarlo). */
function emailOf(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8'))
    return typeof payload.email === 'string' ? payload.email : null
  } catch {
    return null
  }
}

/**
 * `fetch` y `now` se cambian en las pruebas. Devuelve las operaciones que usa la API (api.mjs).
 */
export function createGoogle({ fetch: fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  /** Enlaces de conexión pendientes: state → {redirect, expires}. */
  const states = new Map()
  const cache = new Map()
  /** El token de acceso (dura una hora) se pide con el de refresco y se guarda solo en memoria. */
  let access = null

  async function request(url, init) {
    let res
    try {
      res = await fetchImpl(url, init)
    } catch {
      throw new HttpError(502, 'No se ha podido hablar con Google. ¿Hay conexión a internet?', 'google-red')
    }
    const data = await res.json().catch(() => null)
    if (!res.ok || data?.error) throw googleError(data, res.status)
    return data
  }

  /** Las llamadas a oauth2.googleapis.com/token: con el cliente OAuth, en un formulario. */
  const token = (params) =>
    request(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() })

  async function requireClient() {
    const store = await readStore()
    if (!store.cliente?.id || !store.cliente?.secreto) {
      throw new HttpError(400, 'Primero indica el cliente OAuth de Google (identificador y clave secreta).', 'google-sin-cliente')
    }
    return store
  }

  async function accessToken() {
    if (access && access.expires - 60_000 > now()) return access.value
    const store = await readStore()
    if (!store.refresco || !store.cliente?.id) throw new HttpError(401, 'Conecta Tablero con Google Ads primero.', 'google-sin-conexion')
    const fresh = await token({
      grant_type: 'refresh_token',
      client_id: store.cliente.id,
      client_secret: store.cliente.secreto,
      refresh_token: store.refresco,
    })
    access = { value: fresh.access_token, expires: now() + (Number(fresh.expires_in) || 3600) * 1000 }
    return access.value
  }

  /**
   * Una llamada a la API de Google Ads. `login`: la cuenta de administrador por la que se entra (si la cuenta no es
   * accesible directamente). Si Google dice que el token de acceso ya no vale, se pide otro una vez.
   */
  async function api(pathname, { method = 'GET', body, login = null } = {}, retried = false) {
    const headers = { authorization: `Bearer ${await accessToken()}` }
    if (login) headers['login-customer-id'] = login
    if (body !== undefined) headers['content-type'] = 'application/json'
    try {
      return await request(`${API}/${GOOGLE_VERSION}/${pathname}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
    } catch (err) {
      if (err?.code !== 'google-caducada' || retried) throw err
      access = null
      return api(pathname, { method, body, login }, true)
    }
  }

  /** Todas las filas de una consulta GAQL (Google las da de 10.000 en 10.000). */
  async function search(customer, query, login = null) {
    const rows = []
    let pageToken
    for (let page = 0; page < 10; page++) {
      const data = await api(`customers/${customer}/googleAds:search`, { method: 'POST', body: { query, ...(pageToken ? { pageToken } : {}) }, login })
      rows.push(...(data.results ?? []))
      pageToken = data.nextPageToken
      if (!pageToken) break
    }
    return rows
  }

  async function cached(key, fresh, load, ttl = CACHE_TTL) {
    const hit = cache.get(key)
    if (!fresh && hit && hit.expires > now()) return hit.value
    const value = await load()
    cache.set(key, { value, expires: now() + ttl })
    return value
  }

  async function status() {
    const store = await readStore()
    const connected = Boolean(store.refresco && store.cliente?.id)
    return {
      cliente: Boolean(store.cliente?.id && store.cliente?.secreto),
      clienteId: store.cliente?.id ?? null,
      conectada: connected,
      usuario: connected ? (store.usuario ?? null) : null,
      conectadaEn: connected ? (store.conectadaEn ?? null) : null,
      version: GOOGLE_VERSION,
    }
  }

  /** Guarda el cliente OAuth. Cambiar de cliente olvida la conexión (el token es del anterior). */
  async function saveClient({ id, secreto } = {}) {
    const clientId = String(id ?? '').trim()
    const secret = String(secreto ?? '').trim()
    if (!/^[\w-]{5,100}\.apps\.googleusercontent\.com$/.test(clientId)) {
      throw new HttpError(400, 'El identificador del cliente termina en «.apps.googleusercontent.com» (Cloud Console › Credenciales).', 'google-cliente-id')
    }
    if (!/^[\w-]{10,100}$/.test(secret)) throw new HttpError(400, 'La clave secreta del cliente suele empezar por «GOCSPX-».', 'google-cliente-secreto')
    const store = await readStore()
    const cliente = { id: clientId, secreto: secret }
    await writeStore(store.cliente?.id === clientId ? { ...store, cliente } : { cliente })
    access = null
    cache.clear()
    return status()
  }

  /**
   * Dónde empieza la conexión: la pantalla de Google, que vuelve a /api/google/volver en este mismo puerto (esa
   * dirección tiene que estar en las «URI de redireccionamiento autorizadas» del cliente OAuth). Con
   * access_type=offline y prompt=consent, Google da siempre un token de refresco.
   */
  async function connectUrl(host) {
    const store = await requireClient()
    const port = /:(\d+)$/.exec(host ?? '')?.[1]
    const redirect = `http://localhost${port ? `:${port}` : ''}/api/google/volver`
    const state = randomBytes(16).toString('hex')
    for (const [key, value] of states) if (value.expires < now()) states.delete(key)
    states.set(state, { redirect, expires: now() + STATE_TTL })
    const url = new URL(AUTH)
    url.search = new URLSearchParams({
      client_id: store.cliente.id,
      redirect_uri: redirect,
      response_type: 'code',
      scope: GOOGLE_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    }).toString()
    return url.href
  }

  /** La vuelta de la pantalla de Google: comprueba que la empezó Tablero y guarda el token de refresco. */
  async function finishConnect({ code, state, error }) {
    const pending = state ? states.get(state) : undefined
    if (state) states.delete(state)
    if (!pending || pending.expires < now()) {
      throw new HttpError(400, 'Este enlace de conexión ya no vale. Vuelve a pulsar «Conectar con Google» en Tablero.', 'google-enlace')
    }
    if (error || !code) throw new HttpError(400, 'No se ha completado la conexión con Google.', 'google-cancelada')
    const store = await requireClient()
    const granted = await token({
      grant_type: 'authorization_code',
      code,
      client_id: store.cliente.id,
      client_secret: store.cliente.secreto,
      redirect_uri: pending.redirect,
    })
    // Google deja desmarcar permisos en su pantalla: sin el de Google Ads no sirve de nada.
    if (!String(granted.scope ?? '').split(' ').includes(GOOGLE_SCOPES[0])) {
      throw new HttpError(400, 'Hay que dejar marcada la casilla de Google Ads al conectar. Vuelve a probar.', 'google-permiso')
    }
    if (!granted.refresh_token) throw new HttpError(502, 'Google no ha dado un token de refresco. Vuelve a conectar.', 'google')
    await writeStore({
      cliente: store.cliente,
      refresco: granted.refresh_token,
      usuario: { email: emailOf(granted.id_token) },
      conectadaEn: new Date(now()).toISOString(),
    })
    access = { value: granted.access_token, expires: now() + (Number(granted.expires_in) || 3600) * 1000 }
    cache.clear()
    return status()
  }

  /** Olvida el token de refresco (el cliente OAuth se queda). */
  async function disconnect() {
    const { cliente } = await readStore()
    await writeStore(cliente ? { cliente } : {})
    access = null
    cache.clear()
    return status()
  }

  // ── Lo que hay en la cuenta ──

  /**
   * Las cuentas, agrupadas por su cuenta de administrador (MCC), y aparte las que no tienen. Google da las cuentas
   * a las que se entra directamente; las de un administrador salen de su lista de clientes (y se entra por él).
   * También devuelve, de cada cuenta, por qué administrador se entra (`acceso`).
   */
  function directory(fresh = false) {
    return cached('cuentas', fresh, async () => {
      const listed = await api('customers:listAccessibleCustomers')
      const ids = (listed.resourceNames ?? []).map((name) => String(name).split('/')[1]).filter((id) => CUSTOMER_ID.test(id))
      const query =
        'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.status, ' +
        'customer.test_account FROM customer'
      // Una cuenta cancelada o sin terminar no se puede leer: se salta. Si no se puede leer ninguna, se dice por qué.
      let firstError = null
      const customers = (
        await Promise.all(
          ids.map((id) =>
            search(id, query).then(
              (rows) => rows[0]?.customer ?? null,
              (err) => {
                if (err?.status === 401) throw err
                firstError ??= err
                return null
              },
            ),
          ),
        )
      ).filter(Boolean)
      if (!customers.length && firstError) throw firstError

      const groups = new Map()
      const acceso = new Map()
      const add = (group, customer, login) => {
        const id = String(customer.id)
        if (acceso.has(id) || customer.hidden) return
        acceso.set(id, login)
        group.cuentas.push({
          id,
          nombre: customer.descriptiveName || formatCustomer(id),
          moneda: customer.currencyCode ?? 'EUR',
          estado: CUSTOMER_STATUS[customer.status] ?? 'no disponible',
          activa: customer.status === 'ENABLED',
          zona: customer.timeZone ?? null,
          prueba: Boolean(customer.testAccount),
        })
      }
      const group = (id, nombre) => {
        if (!groups.has(id)) groups.set(id, { id, nombre, foto: null, cuentas: [] })
        return groups.get(id)
      }
      const clientQuery =
        'SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, ' +
        'customer_client.status, customer_client.test_account, customer_client.hidden FROM customer_client ' +
        'WHERE customer_client.level > 0 AND customer_client.manager = FALSE'
      for (const manager of customers.filter((c) => c.manager)) {
        const managerId = String(manager.id)
        const clients = await search(managerId, clientQuery, managerId).catch((err) => (err?.status === 401 ? Promise.reject(err) : []))
        const g = group(`mcc-${managerId}`, manager.descriptiveName || formatCustomer(managerId))
        for (const { customerClient } of clients) add(g, customerClient, managerId)
      }
      for (const customer of customers.filter((c) => !c.manager)) add(group('sin-administrador', 'Sin administrador'), customer, null)

      const byName = (a, b) => a.nombre.localeCompare(b.nombre, 'es')
      const lista = [...groups.values()]
        .map((g) => ({ ...g, cuentas: g.cuentas.sort(byName) }))
        .filter((g) => g.cuentas.length)
        .sort((a, b) => (a.id === 'sin-administrador') - (b.id === 'sin-administrador') || byName(a, b))
      return { lista, acceso }
    })
  }

  const accounts = async (fresh = false) => (await directory(fresh)).lista

  /** La cuenta, si es una de las que se ven (y por qué administrador se entra). */
  async function accountOf(customer) {
    if (!CUSTOMER_ID.test(customer ?? '')) throw new HttpError(400, 'Cuenta de Google Ads no válida')
    const { lista, acceso } = await directory()
    const account = lista.flatMap((g) => g.cuentas).find((c) => c.id === customer)
    if (!account) throw new HttpError(404, 'Esa cuenta de Google Ads no está entre las tuyas. Actualiza la lista de cuentas.', 'google-cuenta')
    return { account, login: acceso.get(customer) ?? null }
  }

  /**
   * «En marcha»: las campañas, los grupos de anuncios o los anuncios (`level`; sin él, el que toca bajo `campaign` o
   * `adGroup`), activos y en pausa, con sus métricas del periodo, y el total. Los grupos, de toda la cuenta o de
   * `campaign`; los anuncios, de la cuenta, de `campaign` o de `adGroup`. Con campaña o grupo, también ese de arriba
   * (`padre`), para saber si está entregando.
   */
  async function performance(
    customer,
    { period = '7d', campaign = null, adGroup = null, campaigns = null, adGroups = null, level: wanted = null, fresh = false } = {},
  ) {
    if (!Object.hasOwn(GOOGLE_PERIODS, period)) throw new HttpError(400, 'Periodo no válido')
    const campaignIds = campaigns ?? (campaign === null ? [] : [campaign])
    const adGroupIds = adGroups ?? (adGroup === null ? [] : [adGroup])
    for (const objectId of [...campaignIds, ...adGroupIds]) {
      if (!/^\d{1,20}$/.test(objectId ?? '')) throw new HttpError(400, 'Campaña o grupo no válido')
    }
    if (campaignIds.length > MAX_FILTER || adGroupIds.length > MAX_FILTER) throw new HttpError(400, `Como mucho ${MAX_FILTER} a la vez`)
    const { account, login } = await accountOf(customer)
    const level = wanted ?? (adGroupIds.length ? 'anuncio' : campaignIds.length ? 'conjunto' : 'campana')
    if (!Object.hasOwn(LEVEL_QUERIES, level)) throw new HttpError(400, 'Nivel no válido')
    // Lo que filtra: los grupos (solo en los anuncios) o las campañas (en grupos y anuncios); si no, toda la cuenta.
    const [field, ids] =
      level === 'anuncio' && adGroupIds.length ? ['ad_group.id', adGroupIds] : level !== 'campana' && campaignIds.length ? ['campaign.id', campaignIds] : [null, []]
    // Con uno solo, también él (el padre), para saber si está entregando.
    const parentLevel = ids.length === 1 ? (field === 'ad_group.id' ? 'conjunto' : 'campana') : null
    const parent = parentLevel ? ids[0] : null
    const q = LEVEL_QUERIES[level]
    const within = ids.length ? (ids.length === 1 ? `${field} = ${ids[0]}` : `${field} IN (${ids.join(', ')})`) : null
    const during = `segments.date DURING ${GOOGLE_PERIODS[period]}`
    return cached(
      `campanas:${customer}:${period}:${level}:${ids.length ? [...ids].sort().join(',') : 'cuenta'}`,
      fresh,
      async () => {
        const [entities, metrics, parentRows] = await Promise.all([
          search(customer, q.entities + where(within, q.status), login),
          // Solo salen las filas con algo en el periodo; las demás, a cero.
          search(customer, q.metrics + where(within, q.status, during), login),
          parentLevel ? search(customer, LEVEL_QUERIES[parentLevel].entities + where(`${parentLevel === 'campana' ? 'campaign' : 'ad_group'}.id = ${parent}`), login) : [],
        ])
        const { filas, totales } = googleRowsOf(entities, metrics, level)
        return {
          moneda: account.moneda,
          periodo: period,
          nivel: level,
          actualizado: new Date(now()).toISOString(),
          padre: parentRows[0] ? googleRowOf(parentRows[0], parentLevel) : null,
          totales,
          filas,
        }
      },
      METRICS_TTL,
    )
  }

  /** Pausa o activa una campaña, un grupo de anuncios o un anuncio (enseguida: no hay confirmación aquí). */
  async function setStatus(raw) {
    const level = raw?.nivel ?? 'campana'
    const mutation = MUTATIONS[level]
    if (!mutation) throw new HttpError(400, 'Nivel no válido')
    const objectId = typeof raw?.id === 'string' && mutation.id.test(raw.id) ? raw.id : null
    if (!objectId) throw new HttpError(400, mutation.invalid)
    if (!['activa', 'pausada'].includes(raw?.estado)) throw new HttpError(400, 'Estado no válido')
    const { login } = await accountOf(raw?.cuenta)
    const customer = raw.cuenta
    await api(`customers/${customer}/${mutation.service}:mutate`, {
      method: 'POST',
      login,
      body: {
        operations: [
          {
            updateMask: 'status',
            update: { resourceName: `customers/${customer}/${mutation.service}/${objectId}`, status: raw.estado === 'activa' ? 'ENABLED' : 'PAUSED' },
          },
        ],
      },
    })
    forget(customer)
    return { id: objectId, estado: raw.estado }
  }

  /** Olvida lo guardado de «En marcha» de una cuenta (tras activar o pausar algo en ella). */
  function forget(customer) {
    for (const key of cache.keys()) if (key.startsWith(`campanas:${customer}:`)) cache.delete(key)
  }

  // ── Editar ──

  /** La cuenta, el nivel y el objeto de una petición de editar o quitar, comprobados. */
  async function editTarget(raw) {
    const level = raw?.nivel
    const mutation = MUTATIONS[level]
    if (!mutation) throw new HttpError(400, 'Nivel no válido')
    const objectId = typeof raw?.id === 'string' && mutation.id.test(raw.id) ? raw.id : null
    if (!objectId) throw new HttpError(400, mutation.invalid)
    const { account, login } = await accountOf(raw?.cuenta)
    return { customer: raw.cuenta, account, login, level, id: objectId, mutation }
  }

  const one = async (customer, query, login, what) => {
    const [row] = await search(customer, query, login)
    if (!row) throw new HttpError(404, `${what} ya no existe en la cuenta.`)
    return row
  }

  /**
   * Cómo está una campaña (nombre y presupuesto), un grupo (nombre y CPC máximo) o un anuncio de búsqueda adaptable
   * (títulos, descripciones, URL final y rutas), para el formulario de editar.
   */
  async function details(raw) {
    const { customer, account, login, level, id } = await editTarget(raw)
    const base = { nivel: level, id, moneda: account.moneda }
    if (level === 'campana') {
      const row = await one(
        customer,
        `SELECT campaign.id, campaign.name, campaign_budget.amount_micros, campaign_budget.explicitly_shared FROM campaign WHERE campaign.id = ${id}`,
        login,
        'La campaña',
      )
      const amount = Number(row.campaignBudget?.amountMicros) || 0
      return { ...base, nombre: row.campaign.name ?? '', campana: { presupuesto: amount ? amount / 1_000_000 : null, compartido: Boolean(row.campaignBudget?.explicitlyShared) } }
    }
    if (level === 'conjunto') {
      const row = await one(customer, `SELECT ad_group.id, ad_group.name, ad_group.cpc_bid_micros FROM ad_group WHERE ad_group.id = ${id}`, login, 'El grupo de anuncios')
      const cpc = Number(row.adGroup?.cpcBidMicros) || 0
      return { ...base, nombre: row.adGroup.name ?? '', conjunto: { cpc: cpc ? cpc / 1_000_000 : null } }
    }
    const [adGroupId, adId] = id.split('~')
    const row = await one(
      customer,
      'SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ' +
        'ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.responsive_search_ad.path1, ad_group_ad.ad.responsive_search_ad.path2 ' +
        `FROM ad_group_ad WHERE ad_group.id = ${adGroupId} AND ad_group_ad.ad.id = ${adId}`,
      login,
      'El anuncio',
    )
    const ad = row.adGroupAd?.ad ?? {}
    const rsa = ad.responsiveSearchAd
    const assets = (list) => (list ?? []).map((a) => ({ texto: a.text ?? '', fijado: a.pinnedField ?? null }))
    return {
      ...base,
      nombre: adName(ad),
      anuncio:
        ad.type === 'RESPONSIVE_SEARCH_AD' && rsa
          ? { editable: true, motivo: null, titulos: assets(rsa.headlines), descripciones: assets(rsa.descriptions), url: ad.finalUrls?.[0] ?? '', ruta1: rsa.path1 ?? '', ruta2: rsa.path2 ?? '' }
          : { editable: false, motivo: 'De momento, Tablero solo edita los textos de los anuncios de búsqueda adaptables.', titulos: [], descripciones: [], url: '', ruta1: '', ruta2: '' },
    }
  }

  /** Guarda lo cambiado (`cambios` lleva solo eso) y devuelve cómo ha quedado. */
  async function update(raw) {
    const { customer, account, login, level, id, mutation } = await editTarget(raw)
    const cambios = raw?.cambios ?? {}
    const name = cambios.nombre !== undefined ? String(cambios.nombre ?? '').trim().slice(0, 255) : undefined
    if (name === '') throw new HttpError(400, 'El nombre no puede quedar vacío.')
    const mutate = (service, update, mask) =>
      api(`customers/${customer}/${service}:mutate`, { method: 'POST', login, body: { operations: [{ updateMask: mask.join(','), update }] } })

    if (level === 'campana') {
      if (name !== undefined) await mutate(mutation.service, { resourceName: `customers/${customer}/campaigns/${id}`, name }, ['name'])
      if (cambios.presupuesto !== undefined) {
        const row = await one(customer, `SELECT campaign_budget.resource_name FROM campaign WHERE campaign.id = ${id}`, login, 'La campaña')
        const budget = row.campaignBudget?.resourceName
        if (!budget) throw new HttpError(400, 'Esta campaña no tiene presupuesto propio.')
        await mutate('campaignBudgets', { resourceName: budget, amountMicros: micros(cambios.presupuesto, account.moneda, 'El presupuesto') }, ['amount_micros'])
      }
    } else if (level === 'conjunto') {
      const update = { resourceName: `customers/${customer}/adGroups/${id}` }
      const mask = []
      if (name !== undefined) {
        update.name = name
        mask.push('name')
      }
      if (cambios.cpc !== undefined) {
        update.cpcBidMicros = micros(cambios.cpc, account.moneda, 'El CPC máximo')
        mask.push('cpc_bid_micros')
      }
      if (mask.length) await mutate(mutation.service, update, mask)
    } else if (cambios.anuncio !== undefined) {
      const ad = cleanSearchAd(cambios.anuncio)
      const adId = id.split('~')[1]
      await mutate(
        'ads',
        {
          resourceName: `customers/${customer}/ads/${adId}`,
          finalUrls: [ad.url],
          responsiveSearchAd: { headlines: ad.titulos, descriptions: ad.descripciones, path1: ad.ruta1, path2: ad.ruta2 },
        },
        ['final_urls', 'responsive_search_ad.headlines', 'responsive_search_ad.descriptions', 'responsive_search_ad.path1', 'responsive_search_ad.path2'],
      )
    }
    forget(customer)
    return details(raw)
  }

  /** Quita una campaña, un grupo o un anuncio (en Google Ads queda como «quitado»: no se puede deshacer). */
  async function removeObject(raw) {
    const { customer, login, level, id, mutation } = await editTarget(raw)
    await api(`customers/${customer}/${mutation.service}:mutate`, {
      method: 'POST',
      login,
      body: { operations: [{ remove: `customers/${customer}/${mutation.service}/${id}` }] },
    })
    forget(customer)
    return { id, nivel: level }
  }

  return { status, saveClient, connectUrl, finishConnect, disconnect, accounts, performance, setStatus, forget, details, update, remove: removeObject }
}
