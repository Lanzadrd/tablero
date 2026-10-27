// Conexión con Meta (Marketing API) para la vista Anuncios: la cuenta, las cuentas publicitarias de cada
// portfolio, las páginas, las campañas en marcha con sus números, la subida de imágenes y vídeos, y crear o
// activar campañas (anuncios.mjs arma lo que se manda y lee lo que llega).
//
// La app de Meta (identificador y clave secreta) y el token del usuario se guardan en datos/meta.json, solo
// en este Mac (permisos 600; fuera de board.json, de sus copias y del repositorio). Nunca salen hacia la web:
// la app solo ve si hay conexión, a nombre de quién, hasta cuándo y qué permisos faltan.
import { createHmac, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DATA_DIR, HttpError } from './almacen.mjs'
import { campaignRows } from './anuncios.mjs'

/** Versión de la API de Meta. Cada una dura unos dos años; TABLERO_META_VERSION la cambia sin tocar el código. */
export const META_VERSION = process.env.TABLERO_META_VERSION || 'v26.0'
const GRAPH = 'https://graph.facebook.com'
const META_FILE = path.join(DATA_DIR, 'meta.json')

/**
 * Lo que Tablero pide al conectar: gestionar anuncios y leer los portfolios y sus páginas. Con una
 * configuración de «Inicio de sesión con Facebook para empresas» (config_id), los permisos son los de ella.
 */
export const SCOPES = ['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement', 'pages_manage_ads']
/** Sin estos no se puede crear nada. */
const REQUIRED = ['ads_management', 'business_management', 'pages_show_list', 'pages_manage_ads']

/** Un enlace de conexión vale 10 minutos. */
const STATE_TTL = 10 * 60_000
/** Las cuentas y páginas cambian poco: se guardan un rato (el botón «Actualizar» las vuelve a pedir). */
const CACHE_TTL = 10 * 60_000
/** Las campañas y sus números, un minuto: lo justo para no pedirlos otra vez al cambiar de cuenta y volver. */
const METRICS_TTL = 60_000

/** Los periodos de «En marcha», con su nombre en Meta (en la zona horaria de la cuenta). */
export const PERIODS = { hoy: 'today', '7d': 'last_7d', '30d': 'last_30d' }
/** Las campañas que se enseñan: activas o en pausa (las archivadas y borradas, no). */
const CAMPAIGN_STATES = ['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES']
const CAMPAIGN_FIELDS =
  'id,name,status,effective_status,daily_budget,lifetime_budget,stop_time,updated_time,' +
  'adsets.limit(100){status,effective_status,daily_budget,lifetime_budget,start_time,end_time}'

const ACCOUNT_STATUS = {
  1: 'activa',
  2: 'desactivada',
  3: 'pago pendiente',
  7: 'en revisión',
  8: 'pago pendiente',
  9: 'periodo de gracia',
  100: 'cerrándose',
  101: 'cerrada',
}

async function readStore() {
  try {
    return JSON.parse(await readFile(META_FILE, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    if (err instanceof SyntaxError) throw new HttpError(500, `${META_FILE} no es un JSON válido; no se ha modificado.`)
    throw err
  }
}

async function writeStore(data) {
  await mkdir(DATA_DIR, { recursive: true })
  const tmp = `${META_FILE}.tmp`
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await chmod(tmp, 0o600)
  await rename(tmp, META_FILE)
}

/** Los errores de Meta, en algo que se pueda enseñar (con locale=es_ES, error_user_msg ya viene en español). */
export function metaError(error, status) {
  // El 190 también sale cuando una llamada pide el token de una página en vez del de la persona: eso no es
  // que la conexión haya caducado.
  if (error?.code === 190 && !/page access token/i.test(error.message ?? '')) {
    return new HttpError(401, 'La conexión con Meta ha caducado o se ha retirado. Vuelve a conectar.', 'meta-caducada')
  }
  if ([4, 17, 32, 613, 80000, 80004].includes(error?.code)) {
    return new HttpError(429, 'Meta pide esperar un poco: demasiadas peticiones seguidas. Prueba en unos minutos.', 'meta-limite')
  }
  const title = error?.error_user_title
  const message = error?.error_user_msg || error?.message || `Meta ha respondido con un error (${status})`
  return new HttpError(502, title && !message.startsWith(title) ? `${title}: ${message}` : message, 'meta')
}

/**
 * `fetch` y `now` se cambian en las pruebas. Devuelve las operaciones que usa la API (api.mjs).
 */
export function createMeta({ fetch: fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  /** Enlaces de conexión pendientes: state → {redirect, expires}. */
  const states = new Map()
  const cache = new Map()

  async function request(url, init) {
    let res
    try {
      res = await fetchImpl(url, init)
    } catch {
      throw new HttpError(502, 'No se ha podido hablar con Meta. ¿Hay conexión a internet?', 'meta-red')
    }
    const data = await res.json().catch(() => null)
    if (!res.ok || data?.error) throw metaError(data?.error, res.status)
    return data
  }

  /**
   * Una llamada a la Graph API con el token guardado (o `token`). Los objetos de `params` y `body` van como
   * JSON (targeting, object_story_spec…). La prueba de la clave secreta (appsecret_proof) va siempre.
   */
  async function graph(pathname, { method = 'GET', params = {}, body, token } = {}) {
    const store = await readStore()
    const accessToken = token ?? store.token
    if (!accessToken) throw new HttpError(401, 'Conecta Tablero con Meta primero.', 'meta-sin-conexion')
    const url = new URL(`${GRAPH}/${META_VERSION}/${pathname.replace(/^\//, '')}`)
    const query = { ...params, access_token: accessToken, locale: 'es_ES' }
    if (store.app?.secreto) query.appsecret_proof = createHmac('sha256', store.app.secreto).update(accessToken).digest('hex')
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value))
    }
    const init = { method }
    if (body instanceof FormData) init.body = body
    else if (body !== undefined) {
      init.headers = { 'content-type': 'application/json' }
      init.body = JSON.stringify(body)
    }
    return request(url, init)
  }

  /** Todas las páginas de una lista (como mucho `max` elementos). */
  async function all(pathname, params, max = 500) {
    const items = []
    let page = await graph(pathname, { params: { limit: 100, ...params } })
    for (;;) {
      items.push(...(page.data ?? []))
      const next = page.paging?.next
      if (!next || items.length >= max) return items
      page = await request(next)
    }
  }

  async function cached(key, fresh, load, ttl = CACHE_TTL) {
    const hit = cache.get(key)
    if (!fresh && hit && hit.expires > now()) return hit.value
    const value = await load()
    cache.set(key, { value, expires: now() + ttl })
    return value
  }

  /** Las llamadas a /oauth/access_token: sin token, con la clave secreta de la app. */
  async function oauth(params) {
    const url = new URL(`${GRAPH}/${META_VERSION}/oauth/access_token`)
    url.search = new URLSearchParams(params).toString()
    return request(url)
  }

  async function requireApp() {
    const store = await readStore()
    if (!store.app?.id || !store.app?.secreto) throw new HttpError(400, 'Primero indica la app de Meta (identificador y clave secreta).', 'meta-sin-app')
    return store
  }

  async function status() {
    const store = await readStore()
    const permisos = Array.isArray(store.permisos) ? store.permisos : []
    // Caducada, es como no tenerla: la vista vuelve a «Conectar con Meta».
    const connected = Boolean(store.token) && !(store.caduca && Date.parse(store.caduca) <= now())
    return {
      app: Boolean(store.app?.id && store.app?.secreto),
      appId: store.app?.id ?? null,
      configuracion: store.app?.configuracion ?? null,
      conectada: connected,
      usuario: connected ? (store.usuario ?? null) : null,
      caduca: connected ? (store.caduca ?? null) : null,
      faltan: connected ? REQUIRED.filter((p) => !permisos.includes(p)) : [],
      version: META_VERSION,
    }
  }

  /**
   * Guarda la app de Meta (y, si se usa, el identificador de su configuración de inicio de sesión). Cambiar de
   * app olvida la conexión (el token es de la app anterior).
   */
  async function saveApp({ id, secreto, configuracion } = {}) {
    const appId = String(id ?? '').trim()
    const secret = String(secreto ?? '').trim()
    const config = String(configuracion ?? '').trim()
    if (!/^\d{5,20}$/.test(appId)) throw new HttpError(400, 'El identificador de la app son solo números (lo pone en developers.facebook.com, arriba).', 'meta-app-id')
    if (!/^[a-f0-9]{32}$/i.test(secret)) throw new HttpError(400, 'La clave secreta son 32 letras y números (Configuración › Básica › Clave secreta de la app).', 'meta-app-secreto')
    if (config && !/^\d{5,20}$/.test(config)) throw new HttpError(400, 'El identificador de la configuración son solo números.', 'meta-app-config')
    const store = await readStore()
    const app = { id: appId, secreto: secret, ...(config ? { configuracion: config } : {}) }
    await writeStore(store.app?.id === appId ? { ...store, app } : { app })
    cache.clear()
    return status()
  }

  /**
   * Cambia un token (de la conexión o pegado a mano) por uno de larga duración (unos 60 días) y lo guarda
   * con el nombre de la cuenta y los permisos concedidos.
   */
  async function saveToken(token) {
    const store = await requireApp()
    const long = await oauth({
      grant_type: 'fb_exchange_token',
      client_id: store.app.id,
      client_secret: store.app.secreto,
      fb_exchange_token: token,
    })
    const accessToken = long.access_token
    const me = await graph('me', { params: { fields: 'id,name' }, token: accessToken })
    const granted = await graph('me/permissions', { token: accessToken })
    const permisos = (granted.data ?? []).filter((p) => p.status === 'granted').map((p) => p.permission)
    const caduca = Number(long.expires_in) > 0 ? new Date(now() + Number(long.expires_in) * 1000).toISOString() : null
    await writeStore({ ...store, token: accessToken, caduca, usuario: { id: me.id, nombre: me.name }, permisos, conectadaEn: new Date(now()).toISOString() })
    cache.clear()
    return status()
  }

  /**
   * Dónde empieza la conexión: el diálogo de Meta, que vuelve a /api/meta/volver en este mismo puerto. Meta
   * acepta «localhost» sin darlo de alta mientras la app está en modo desarrollo.
   */
  async function connectUrl(host) {
    const store = await requireApp()
    const port = /:(\d+)$/.exec(host ?? '')?.[1]
    const redirect = `http://localhost${port ? `:${port}` : ''}/api/meta/volver`
    const state = randomBytes(16).toString('hex')
    for (const [key, value] of states) if (value.expires < now()) states.delete(key)
    states.set(state, { redirect, expires: now() + STATE_TTL })
    const url = new URL(`https://www.facebook.com/${META_VERSION}/dialog/oauth`)
    url.search = new URLSearchParams({
      client_id: store.app.id,
      redirect_uri: redirect,
      state,
      response_type: 'code',
      ...(store.app.configuracion ? { config_id: store.app.configuracion } : { scope: SCOPES.join(',') }),
    }).toString()
    return url.href
  }

  /** La vuelta del diálogo de Meta: comprueba que la empezó Tablero y guarda el token. */
  async function finishConnect({ code, state, error }) {
    const pending = state ? states.get(state) : undefined
    if (state) states.delete(state)
    if (!pending || pending.expires < now()) {
      throw new HttpError(400, 'Este enlace de conexión ya no vale. Vuelve a pulsar «Conectar con Meta» en Tablero.', 'meta-enlace')
    }
    if (error || !code) throw new HttpError(400, 'No se ha completado la conexión con Meta.', 'meta-cancelada')
    const store = await requireApp()
    const short = await oauth({ client_id: store.app.id, client_secret: store.app.secreto, redirect_uri: pending.redirect, code })
    return saveToken(short.access_token)
  }

  /** Olvida el token (la app de Meta se queda). */
  async function disconnect() {
    const { app } = await readStore()
    await writeStore(app ? { app } : {})
    cache.clear()
    return status()
  }

  // ── Lo que hay en la cuenta ──

  /** Lo que no se puede leer (p. ej. por un permiso que no se dio) se queda en `fallback`. */
  const maybe = (promise, fallback) => promise.catch((err) => (err?.status === 401 ? Promise.reject(err) : fallback))

  /**
   * Los portfolios con sus cuentas publicitarias (propias y de clientes) y, aparte, las cuentas que no son de
   * ningún portfolio. Se juntan las de cada portfolio con las de la persona, sin repetir.
   */
  function portfolios(fresh = false) {
    return cached('portfolios', fresh, async () => {
      const fields = 'id,account_id,name,account_status,currency,timezone_name,business{id,name,picture{url}}'
      const mine = await all('me/adaccounts', { fields })
      const businesses = await maybe(all('me/businesses', { fields: 'id,name,picture{url}' }), [])
      const groups = new Map()
      const group = (business) => {
        const key = business?.id ?? 'sin-portfolio'
        if (!groups.has(key)) {
          groups.set(key, {
            id: key,
            nombre: business?.name ?? 'Sin portfolio',
            foto: business?.picture?.data?.url ?? null,
            cuentas: new Map(),
          })
        }
        return groups.get(key)
      }
      const add = (business, account) => {
        const g = group(business)
        if (g.cuentas.has(account.id)) return
        g.cuentas.set(account.id, {
          id: account.id,
          nombre: account.name || account.account_id,
          moneda: account.currency,
          estado: ACCOUNT_STATUS[account.account_status] ?? 'no disponible',
          activa: account.account_status === 1,
          zona: account.timezone_name ?? null,
        })
      }
      for (const business of businesses) {
        group(business)
        const lists = await Promise.all(
          ['owned_ad_accounts', 'client_ad_accounts'].map((edge) => maybe(all(`${business.id}/${edge}`, { fields }), [])),
        )
        for (const account of lists.flat()) add(business, account)
      }
      // Las de la persona: en su portfolio si se conoce (aunque no salga en la lista de portfolios).
      for (const account of mine) {
        const owner = [...groups.values()].find((g) => g.cuentas.has(account.id))
        if (!owner) add(account.business, account)
      }
      const byName = (a, b) => a.nombre.localeCompare(b.nombre, 'es')
      return [...groups.values()]
        .map((g) => ({ ...g, cuentas: [...g.cuentas.values()].sort(byName) }))
        .filter((g) => g.cuentas.length)
        .sort((a, b) => (a.id === 'sin-portfolio') - (b.id === 'sin-portfolio') || byName(a, b))
    })
  }

  /**
   * Las páginas con las que se puede anunciar la cuenta, con su Instagram y su número de WhatsApp si Meta los
   * enseña (cada uno se pide aparte: si falta un permiso, la página sale igual, sin ese dato).
   */
  function pages(account, fresh = false) {
    if (!/^act_\d+$/.test(account ?? '')) throw new HttpError(400, 'Cuenta publicitaria no válida')
    return cached(`pages:${account}`, fresh, async () => {
      const list = await all(`${account}/promote_pages`, { fields: 'id,name,picture{url}' }, 100)
      return Promise.all(
        list.map(async (page) => {
          const [ig, wa] = await Promise.all([
            maybe(graph(page.id, { params: { fields: 'instagram_business_account{id,username}' } }), {}),
            maybe(graph(page.id, { params: { fields: 'whatsapp_number' } }), {}),
          ])
          let instagram = ig.instagram_business_account ?? null
          if (!instagram) {
            // Las cuentas de Instagram de la página solo se leen con el token de la propia página.
            const { access_token: token } = await maybe(graph(page.id, { params: { fields: 'access_token' } }), {})
            const backed = token ? await maybe(graph(`${page.id}/instagram_accounts`, { params: { fields: 'id,username' }, token }), {}) : {}
            instagram = backed.data?.[0] ?? null
          }
          return {
            id: page.id,
            nombre: page.name,
            foto: page.picture?.data?.url ?? null,
            instagram: instagram ? { id: String(instagram.id), usuario: instagram.username ?? String(instagram.id) } : null,
            whatsapp: wa.whatsapp_number ?? null,
          }
        }),
      )
    })
  }

  /**
   * Las campañas de la cuenta, activas y en pausa, con lo que han gastado y las conversaciones que han traído
   * en el periodo (hoy, 7 o 30 días).
   */
  function campaigns(account, period = '7d', fresh = false) {
    if (!/^act_\d+$/.test(account ?? '')) throw new HttpError(400, 'Cuenta publicitaria no válida')
    if (!Object.hasOwn(PERIODS, period)) throw new HttpError(400, 'Periodo no válido')
    return cached(
      `campanas:${account}:${period}`,
      fresh,
      async () => {
        const [info, list, insights] = await Promise.all([
          graph(account, { params: { fields: 'currency,business{id}' } }),
          all(`${account}/campaigns`, { fields: CAMPAIGN_FIELDS, effective_status: CAMPAIGN_STATES, limit: 50 }, 300),
          all(`${account}/insights`, { level: 'campaign', date_preset: PERIODS[period], fields: 'campaign_id,spend,actions' }, 1000),
        ])
        return {
          moneda: info.currency,
          periodo: period,
          actualizado: new Date(now()).toISOString(),
          campanas: campaignRows(list, insights, { account, currency: info.currency, businessId: info.business?.id, now: now() }),
        }
      },
      METRICS_TTL,
    )
  }

  /** Olvida las campañas guardadas de una cuenta (tras crear, activar o pausar algo en ella). */
  function forget(account) {
    for (const key of cache.keys()) if (key.startsWith(`campanas:${account}:`)) cache.delete(key)
  }

  /** Países, regiones y ciudades que contienen `query` (el buscador de lugares de Meta). */
  async function places(query) {
    const q = String(query ?? '').trim().slice(0, 80)
    if (q.length < 2) return []
    const { data } = await graph('search', {
      params: { type: 'adgeolocation', q, location_types: ['country', 'region', 'city'], limit: 12 },
    })
    const kinds = { country: 'País', region: 'Región', city: 'Ciudad' }
    return (data ?? [])
      .filter((p) => kinds[p.type])
      .map((p) => ({
        key: String(p.key),
        tipo: p.type,
        nombre: p.name,
        detalle: p.type === 'country' ? kinds.country : [p.type === 'city' ? p.region : kinds.region, p.country_name].filter(Boolean).join(', '),
      }))
  }

  return { graph, status, saveApp, saveToken, connectUrl, finishConnect, disconnect, portfolios, pages, places, campaigns, forget }
}
