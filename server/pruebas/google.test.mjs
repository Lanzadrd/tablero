// Anuncios en Google Ads: lo que se lee (funciones puras) y la API de verdad con un Google de mentira, en un
// puerto y una carpeta de datos temporales. Nada sale a internet.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, test } from 'node:test'

const dir = await mkdtemp(path.join(os.tmpdir(), 'tablero-google-'))
process.env.TABLERO_DATA_DIR = path.join(dir, 'datos')
const { createApi } = await import('../api.mjs')
const {
  adPreviewOf,
  assetOf,
  createGoogle,
  explainOf,
  extensionsOf,
  googleDelivery,
  googleError,
  googleMetrics,
  googleRowOf,
  googleRowsOf,
  GOOGLE_VERSION,
  keywordRowsOf,
  pictureOf,
  searchTermRowsOf,
} = await import('../google.mjs')

const CLIENT_ID = '1234-abcd.apps.googleusercontent.com'
const SECRET = 'GOCSPX-secreto-que-nunca-sale'
const REFRESH = '1//refresco-que-nunca-sale'
const ADWORDS = 'https://www.googleapis.com/auth/adwords'
/** Un id_token con el correo (Tablero no lo verifica: solo lo enseña). */
const ID_TOKEN = `x.${Buffer.from(JSON.stringify({ email: 'lanza@example.com' })).toString('base64url')}.y`

// ── Lo que se lee ──

test('métricas: el gasto en millonésimas y los cocientes, null sin de qué', () => {
  const m = googleMetrics({ costMicros: '12500000', impressions: '1000', clicks: '50', conversions: 4, conversionsValue: 100 })
  assert.equal(m.gasto, 12.5)
  assert.equal(m.conversiones, 4)
  assert.equal(m.coste, 3.125)
  assert.equal(m.tasa, 8)
  assert.equal(m.roas, 8)
  assert.equal(m.ctr, 5)
  assert.equal(m.cpc, 0.25)
  assert.equal(m.cpm, 12.5)
  const empty = googleMetrics(undefined)
  assert.equal(empty.gasto, 0)
  assert.equal(empty.coste, null)
  assert.equal(empty.ctr, null)
  assert.equal(empty.roas, null)
})

test('entrega: en pausa, lo de arriba en pausa, limitada por presupuesto, rechazado y aprendiendo', () => {
  assert.deepEqual(googleDelivery({ status: 'PAUSED', primaryStatus: 'PAUSED' }), { texto: 'En pausa', tono: 'off' })
  assert.deepEqual(googleDelivery({ status: 'ENABLED', primaryStatus: 'ELIGIBLE' }), { texto: 'Activa', tono: 'ok' })
  assert.deepEqual(googleDelivery({ status: 'ENABLED', primaryStatus: 'ELIGIBLE' }, 'conjunto'), { texto: 'Activo', tono: 'ok' })
  assert.deepEqual(
    googleDelivery({ status: 'ENABLED', primaryStatus: 'NOT_ELIGIBLE', primaryStatusReasons: ['CAMPAIGN_PAUSED'] }, 'conjunto'),
    { texto: 'Campaña en pausa', tono: 'off' },
  )
  assert.deepEqual(
    googleDelivery({ status: 'ENABLED', primaryStatus: 'LIMITED', primaryStatusReasons: ['BIDDING_STRATEGY_LEARNING', 'BUDGET_CONSTRAINED'] }),
    { texto: 'Limitada por presupuesto', tono: 'warning' },
  )
  assert.deepEqual(googleDelivery({ status: 'ENABLED', primaryStatus: 'LIMITED', primaryStatusReasons: ['HAS_ADS_LIMITED_BY_POLICY'] }, 'conjunto'), {
    texto: 'Limitado por políticas',
    tono: 'warning',
  })
  assert.deepEqual(googleDelivery({ status: 'ENABLED', primaryStatus: 'LEARNING', primaryStatusReasons: ['BIDDING_STRATEGY_LEARNING'] }), {
    texto: 'Aprendiendo',
    tono: 'ok',
  })
  assert.deepEqual(googleDelivery({ status: 'ENABLED', policySummary: { approvalStatus: 'DISAPPROVED' } }, 'anuncio'), { texto: 'Rechazado', tono: 'warning' })
  // De la propia campaña, su estado principal (no «Campaña terminada»).
  assert.deepEqual(googleDelivery({ status: 'ENABLED', primaryStatus: 'ENDED', primaryStatusReasons: ['CAMPAIGN_ENDED'] }), { texto: 'Terminada', tono: 'off' })
})

test('filas: presupuesto diario, tipo de campaña, Máximo rendimiento sin grupos y nombre de los anuncios', () => {
  const search = googleRowOf({
    campaign: { id: '11', name: 'Marca', status: 'ENABLED', primaryStatus: 'ELIGIBLE', advertisingChannelType: 'SEARCH' },
    campaignBudget: { amountMicros: '25000000' },
  })
  assert.equal(search.id, '11')
  assert.equal(search.estado, 'activa')
  assert.deepEqual(search.presupuesto, { cantidad: 25, tipo: 'dia' })
  assert.equal(search.tipo, 'Búsqueda')
  assert.equal(search.sinHijos, undefined)
  assert.equal(search.enlace, null)
  const pmax = googleRowOf({ campaign: { id: '12', name: 'PMax', status: 'PAUSED', advertisingChannelType: 'PERFORMANCE_MAX' }, campaignBudget: {} })
  assert.equal(pmax.sinHijos, true)
  // Las inteligentes se abren: su anuncio se ve.
  assert.equal(googleRowOf({ campaign: { id: '13', name: 'Smart', status: 'ENABLED', advertisingChannelType: 'SMART' }, campaignBudget: {} }).sinHijos, undefined)
  assert.equal(pmax.estado, 'pausada')
  assert.equal(pmax.presupuesto, null)
  const ad = googleRowOf(
    { adGroup: { id: '21' }, adGroupAd: { status: 'ENABLED', ad: { id: '31', type: 'RESPONSIVE_SEARCH_AD', responsiveSearchAd: { headlines: [{ text: 'City tour' }] } } } },
    'anuncio',
  )
  assert.equal(ad.id, '21~31')
  assert.equal(ad.nombre, 'City tour')
  assert.equal(googleRowOf({ adGroup: { id: '21' }, adGroupAd: { ad: { id: '32', type: 'IMAGE_AD' } } }, 'anuncio').nombre, 'Anuncio de imagen 32')
})

test('campañas: cómo puja, la optimización y su estado explicado con la cuota de búsqueda', () => {
  const entity = {
    id: '11',
    name: 'Búsqueda',
    status: 'ENABLED',
    primaryStatus: 'LIMITED',
    primaryStatusReasons: ['BUDGET_CONSTRAINED'],
    advertisingChannelType: 'SEARCH',
    biddingStrategyType: 'TARGET_SPEND',
    optimizationScore: 0.71,
  }
  const { filas } = googleRowsOf(
    [{ campaign: entity, campaignBudget: { amountMicros: '2860000' } }],
    [{ campaign: { id: '11' }, metrics: { clicks: '39', searchImpressionShare: 0.0999, searchBudgetLostImpressionShare: 0.8512, searchRankLostImpressionShare: 0.05 } }],
    'campana',
  )
  const [row] = filas
  assert.equal(row.puja, 'Maximizar clics')
  assert.equal(row.optimizacion, 0.71)
  assert.deepEqual(row.cuota, { total: 0.0999, presupuesto: 0.8512, ranking: 0.05 })
  assert.equal(row.explicacion, 'El presupuesto se acaba antes de tiempo: pierdes el 85 % de las impresiones por presupuesto. Sales en el 10 % de las búsquedas en las que podrías aparecer.')
  // Sin cuota (no sale en la búsqueda), y sin nada que explicar.
  assert.equal(explainOf({ status: 'ENABLED', primaryStatusReasons: ['BUDGET_CONSTRAINED'] }), 'El presupuesto no llega para salir en todas las búsquedas.')
  assert.equal(explainOf({ status: 'ENABLED', primaryStatusReasons: [] }), null)
  assert.match(explainOf({ status: 'ENABLED', primaryStatusReasons: ['HAS_ADS_DISAPPROVED', 'BIDDING_STRATEGY_LEARNING'] }), /rechazados.*aprendiendo/)
})

test('anuncios: lo que hace falta para dibujarlos (búsqueda, inteligentes y con imágenes)', () => {
  const rsa = adPreviewOf({
    adGroupAd: {
      adStrength: 'EXCELLENT',
      ad: {
        type: 'RESPONSIVE_SEARCH_AD',
        finalUrls: ['https://www.lto.com.py/'],
        responsiveSearchAd: { headlines: [{ text: 'LTO | Tours' }, { text: 'Traslados' }], descriptions: [{ text: 'Consultá por WhatsApp.' }], path1: 'excursiones' },
      },
    },
  })
  assert.deepEqual(
    [rsa.tipo, rsa.titulos, rsa.descripciones, rsa.rutas, rsa.url, rsa.calidad],
    ['busqueda', ['LTO | Tours', 'Traslados'], ['Consultá por WhatsApp.'], ['excursiones'], 'https://www.lto.com.py/', 'EXCELLENT'],
  )
  const smart = adPreviewOf({ adGroupAd: { ad: { type: 'SMART_CAMPAIGN_AD', smartCampaignAd: { headlines: [{ text: 'Empresa de Viajes' }], descriptions: [{ text: 'Tours' }] } } } })
  assert.deepEqual([smart.tipo, smart.titulos], ['busqueda', ['Empresa de Viajes']])
  assert.equal(googleRowOf({ adGroup: { id: '1' }, adGroupAd: { ad: { id: '2', smartCampaignAd: { headlines: [{ text: 'Empresa de Viajes' }] } } } }, 'anuncio').nombre, 'Empresa de Viajes')
  const dg = adPreviewOf({
    adGroupAd: {
      ad: {
        type: 'DEMAND_GEN_MULTI_ASSET_AD',
        demandGenMultiAssetAd: {
          headlines: [{ text: 'City Tour' }],
          businessName: 'Lleva Tour Operator',
          marketingImages: [{ asset: 'customers/1/assets/10' }],
          squareMarketingImages: [{ asset: 'customers/1/assets/11' }],
          logoImages: [{ asset: 'customers/1/assets/12' }],
        },
      },
    },
  })
  assert.deepEqual([dg.tipo, dg.empresa, dg.imagenes, dg.logos], ['imagen', 'Lleva Tour Operator', ['customers/1/assets/10', 'customers/1/assets/11'], ['customers/1/assets/12']])
})

test('recursos: su imagen (foto, si no logo; de la campaña, si no de la cuenta) y los enlaces de los anuncios', () => {
  const asset = (nivel, fieldType, a, extra = {}) =>
    assetOf({ asset: a, [{ cuenta: 'customerAsset', campana: 'campaignAsset', grupo: 'adGroupAsset' }[nivel]]: { fieldType }, ...extra }, nivel)
  const assets = [
    asset('cuenta', 'BUSINESS_LOGO', { id: '1', imageAsset: { fullSize: { url: 'https://img/logo', widthPixels: '300', heightPixels: '300' } } }),
    asset('cuenta', 'SITELINK', { id: '2', sitelinkAsset: { linkText: 'Excursiones', description1: 'Las mejores' } }),
    asset('cuenta', 'CALLOUT', { id: '3', calloutAsset: { calloutText: 'Desde 2013' } }),
    asset('campana', 'SITELINK', { id: '4', sitelinkAsset: { linkText: 'Traslados privados' } }, { campaign: { id: '11', name: 'Búsqueda' } }),
    asset('campana', 'MARKETING_IMAGE', { id: '5', imageAsset: { fullSize: { url: 'https://img/foto' } } }, { campaign: { id: '12', name: 'Demand Gen' } }),
    asset('cuenta', 'STRUCTURED_SNIPPET', { id: '6', structuredSnippetAsset: { header: 'Servicios', values: ['Traslados', 'Excursiones'] } }),
  ]
  assert.equal(assetOf({ campaign: { id: '1' } }, 'campana'), null)
  assert.deepEqual([assets[1].texto, assets[1].detalle, assets[0].ancho], ['Excursiones', ['Las mejores'], 300])
  assert.deepEqual(assets[5].detalle, ['Traslados', 'Excursiones'])
  assert.deepEqual(pictureOf(assets, { campaign: '12' }), { url: 'https://img/foto', logo: false })
  assert.deepEqual(pictureOf(assets, { campaign: '11' }), { url: 'https://img/logo', logo: true })
  assert.equal(pictureOf([], { campaign: '11' }), null)
  // Los enlaces de la campaña tapan los de la cuenta; los destacados, de la cuenta.
  assert.deepEqual(extensionsOf(assets, '11'), { enlaces: ['Traslados privados'], destacados: ['Desde 2013'], empresa: null, logo: 'https://img/logo' })
  assert.deepEqual(extensionsOf(assets, '99').enlaces, ['Excursiones'])
})

test('palabras clave y términos de búsqueda: con sus métricas, primero lo que más clics trae', () => {
  const kw = (id, text, matchType, status, extra = {}) => ({
    campaign: { id: '11', name: 'Búsqueda' },
    adGroup: { id: '21', name: 'Grupo 1' },
    adGroupCriterion: { criterionId: id, keyword: { text, matchType }, status, ...extra },
  })
  const { filas, totales } = keywordRowsOf(
    [kw('1', 'tour cde', 'BROAD', 'ENABLED'), kw('2', 'city tour', 'PHRASE', 'ENABLED', { qualityInfo: { qualityScore: 7 } }), kw('3', 'vieja', 'EXACT', 'PAUSED', { systemServingStatus: 'RARELY_SERVED' })],
    [
      { adGroup: { id: '21' }, adGroupCriterion: { criterionId: '2' }, metrics: { clicks: '25', impressions: '137', costMicros: '11750000', conversions: 1 } },
      { adGroup: { id: '21' }, adGroupCriterion: { criterionId: '1' }, metrics: { clicks: '5', impressions: '37' } },
    ],
  )
  assert.deepEqual(
    filas.map((f) => [f.id, f.texto, f.concordancia, f.estado, f.calidad, f.aviso, f.metricas.clics]),
    [
      ['21~2', 'city tour', 'PHRASE', 'activa', 7, null, 25],
      ['21~1', 'tour cde', 'BROAD', 'activa', null, null, 5],
      ['21~3', 'vieja', 'EXACT', 'pausada', null, 'Pocas búsquedas', 0],
    ],
  )
  assert.equal(totales.clics, 30)
  assert.equal(filas[0].metricas.coste, 11.75)
  const terms = searchTermRowsOf([
    { searchTermView: { searchTerm: 'atrações', status: 'NONE' }, adGroup: { id: '21' }, metrics: { clicks: '0', impressions: '4' } },
    {
      searchTermView: { searchTerm: 'lleva tour operator', status: 'ADDED' },
      segments: { keyword: { info: { text: 'tour cde', matchType: 'BROAD' } } },
      adGroup: { id: '21', name: 'Grupo 1' },
      metrics: { clicks: '4', impressions: '9' },
    },
  ])
  assert.deepEqual(
    terms.filas.map((f) => [f.termino, f.estado, f.palabra?.texto ?? null, f.metricas.clics]),
    [
      ['lleva tour operator', 'Añadido como palabra clave', 'tour cde', 4],
      ['atrações', null, null, 0],
    ],
  )
})

test('errores de Google: qué hacer en cada caso', () => {
  const failure = (errorCode, status = 'PERMISSION_DENIED') => ({
    error: {
      code: 403,
      status,
      message: 'The caller does not have permission',
      details: [{ '@type': 'type.googleapis.com/google.ads.googleads.v26.errors.GoogleAdsFailure', errors: [{ errorCode, message: 'detalle' }] }],
    },
  })
  assert.equal(googleError(failure({ authorizationError: 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION' }), 403).code, 'google-solo-prueba')
  assert.match(googleError(failure({ authorizationError: 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION' }), 403).message, /Explorer/)
  assert.equal(googleError(failure({ authorizationError: 'USER_PERMISSION_DENIED' }), 403).code, 'google-sin-acceso')
  assert.equal(googleError(failure({ authorizationError: 'CUSTOMER_NOT_ENABLED' }), 403).code, 'google-cuenta-inactiva')
  assert.equal(googleError(failure({ quotaError: 'RESOURCE_EXHAUSTED' }, 'RESOURCE_EXHAUSTED'), 429).status, 429)
  const disabled = { error: { code: 403, status: 'PERMISSION_DENIED', message: 'Google Ads API has not been used', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED' }] } }
  assert.equal(googleError(disabled, 403).code, 'google-api-desactivada')
  assert.equal(googleError({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400).code, 'google-caducada')
  assert.equal(googleError({ error: 'invalid_grant' }, 400).status, 401)
  assert.equal(googleError({ error: 'invalid_client' }, 401).code, 'google-cliente')
  const other = googleError(failure({ queryError: 'BAD_FIELD_NAME' }, 'INVALID_ARGUMENT'), 400)
  assert.equal(other.status, 502)
  assert.equal(other.message, 'detalle')
})

// ── La API con un Google de mentira ──

const calls = []
/** Respuestas por «MÉTODO ruta» (función o valor). Lo que no está, 404 de Google. */
let routes = {}
/** Lo que pasa a partir de ahora con los tokens de acceso (`now` de mentira). */
let clock = Date.parse('2026-10-27T12:00:00Z')

function fakeFetch(input, init = {}) {
  const url = new URL(String(input))
  const method = init.method ?? 'GET'
  const route =
    url.hostname === 'googleads.googleapis.com' ? url.pathname.replace(`/${GOOGLE_VERSION}/`, '') : url.hostname === 'oauth2.googleapis.com' ? 'token' : url.href
  let body = init.body
  if (typeof body === 'string') body = route === 'token' ? Object.fromEntries(new URLSearchParams(body)) : JSON.parse(body)
  const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
  calls.push({ method, path: route, body, headers })
  const handler = routes[`${method} ${route}`]
  if (handler === undefined) {
    return Promise.resolve(new Response(JSON.stringify({ error: { code: 404, status: 'NOT_FOUND', message: `Sin ruta: ${method} ${route}` } }), { status: 404 }))
  }
  const result = typeof handler === 'function' ? handler({ url, body, headers }) : handler
  if (result instanceof Response) return Promise.resolve(result)
  if (result?.error) return Promise.resolve(new Response(JSON.stringify(result), { status: result.status ?? 400 }))
  return Promise.resolve(new Response(JSON.stringify(result), { status: 200 }))
}

let server
let port

function request(method, pathname, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const req = http.request(
      { host: '127.0.0.1', port, method, path: pathname, agent: false, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers } },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json = null
          try {
            json = JSON.parse(text)
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, text, body: json })
        })
      },
    )
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

const googleFile = () => readFile(path.join(process.env.TABLERO_DATA_DIR, 'google.json'), 'utf8')
const message = (res) => res.body?.mensaje ?? res.body?.error

/** Conecta como lo haría la pantalla de Google y devuelve la página de vuelta. */
async function connect() {
  await request('PUT', '/api/google/cliente', { body: { id: CLIENT_ID, secreto: SECRET } })
  const start = await request('GET', '/api/google/conectar')
  const state = new URL(start.headers.location).searchParams.get('state')
  return request('GET', `/api/google/volver?code=codigo&state=${state}`, { headers: { 'sec-fetch-site': 'cross-site' } })
}

/** Las búsquedas GAQL: la respuesta según la cuenta y lo que pide la consulta. */
let searches = {}
const searchRoute =
  (customer) =>
  ({ body }) => {
    for (const [pattern, reply] of Object.entries(searches[customer] ?? {})) {
      if (body.query.includes(pattern)) return typeof reply === 'function' ? reply(body.query) : reply
    }
    return { results: [] }
  }

before(async () => {
  const google = createGoogle({ fetch: fakeFetch, now: () => clock })
  const api = createApi({ google })
  server = http.createServer((req, res) => api(req, res, () => res.writeHead(404).end()))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = server.address().port
})

after(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(dir, { recursive: true, force: true })
})

beforeEach(async () => {
  await rm(process.env.TABLERO_DATA_DIR, { recursive: true, force: true })
  calls.length = 0
  clock += 24 * 3_600_000
  searches = {}
  let n = 0
  routes = {
    'POST token': ({ body }) =>
      body.grant_type === 'authorization_code'
        ? { access_token: `acceso-${++n}`, expires_in: 3599, refresh_token: REFRESH, scope: `openid ${ADWORDS} email`, id_token: ID_TOKEN }
        : { access_token: `acceso-${++n}`, expires_in: 3599 },
    'GET customers:listAccessibleCustomers': { resourceNames: ['customers/1110000000', 'customers/2220000000'] },
    'POST customers/1110000000/googleAds:search': searchRoute('1110000000'),
    'POST customers/2220000000/googleAds:search': searchRoute('2220000000'),
    'POST customers/3330000000/googleAds:search': searchRoute('3330000000'),
  }
})

test('cliente OAuth: se comprueba, se guarda solo en este Mac y nunca vuelve a la web', async () => {
  assert.match(message(await request('PUT', '/api/google/cliente', { body: { id: '123', secreto: SECRET } })), /apps\.googleusercontent\.com/)
  assert.match(message(await request('PUT', '/api/google/cliente', { body: { id: CLIENT_ID, secreto: 'x' } })), /GOCSPX/)
  const saved = await request('PUT', '/api/google/cliente', { body: { id: CLIENT_ID, secreto: SECRET } })
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.body, { cliente: true, clienteId: CLIENT_ID, conectada: false, usuario: null, conectadaEn: null, version: GOOGLE_VERSION })
  assert.ok(!saved.text.includes(SECRET))
  const info = await stat(path.join(process.env.TABLERO_DATA_DIR, 'google.json'))
  assert.equal(info.mode & 0o777, 0o600)
  // Sin cliente no se puede empezar a conectar.
  await rm(process.env.TABLERO_DATA_DIR, { recursive: true, force: true })
  assert.equal((await request('GET', '/api/google/conectar')).status, 400)
})

test('conectar: la pantalla de Google con permiso de Google Ads y token de refresco, y la vuelta guarda la conexión', async () => {
  await request('PUT', '/api/google/cliente', { body: { id: CLIENT_ID, secreto: SECRET } })
  const start = await request('GET', '/api/google/conectar', { headers: { host: `localhost:${port}` } })
  assert.equal(start.status, 302)
  const location = new URL(start.headers.location)
  assert.equal(location.origin + location.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
  assert.equal(location.searchParams.get('client_id'), CLIENT_ID)
  assert.equal(location.searchParams.get('redirect_uri'), `http://localhost:${port}/api/google/volver`)
  assert.equal(location.searchParams.get('access_type'), 'offline')
  assert.equal(location.searchParams.get('prompt'), 'consent')
  assert.ok(location.searchParams.get('scope').split(' ').includes(ADWORDS))
  const state = location.searchParams.get('state')

  // Un «state» que no es de Tablero no vale.
  const forged = await request('GET', '/api/google/volver?code=codigo&state=otro', { headers: { 'sec-fetch-site': 'cross-site' } })
  assert.equal(forged.status, 400)
  assert.match(forged.text, /ya no vale/)

  const back = await request('GET', `/api/google/volver?code=codigo&state=${state}`, { headers: { 'sec-fetch-site': 'cross-site', host: `localhost:${port}` } })
  assert.equal(back.status, 200)
  assert.match(back.text, /Tablero ya está conectado con Google Ads/)
  assert.match(back.text, /lanza@example\.com/)
  assert.match(back.text, /vista=google/)
  const exchange = calls.find((c) => c.path === 'token')
  assert.equal(exchange.body.code, 'codigo')
  assert.equal(exchange.body.redirect_uri, `http://localhost:${port}/api/google/volver`)
  assert.equal(exchange.body.client_secret, SECRET)

  const status = await request('GET', '/api/google/estado')
  assert.equal(status.body.conectada, true)
  assert.deepEqual(status.body.usuario, { email: 'lanza@example.com' })
  assert.ok(!status.text.includes(REFRESH) && !status.text.includes(SECRET))
  assert.match(await googleFile(), new RegExp(REFRESH.replace(/[/]/g, '\\/')))
  // El mismo «state» no sirve dos veces.
  assert.equal((await request('GET', `/api/google/volver?code=codigo&state=${state}`, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 400)
})

test('conectar sin la casilla de Google Ads: se explica y no queda conectado', async () => {
  routes['POST token'] = { access_token: 'a', expires_in: 3599, refresh_token: REFRESH, scope: 'openid email', id_token: ID_TOKEN }
  const back = await connect()
  assert.equal(back.status, 400)
  assert.match(back.text, /casilla de Google Ads/)
  assert.equal((await request('GET', '/api/google/estado')).body.conectada, false)
})

/** Una cuenta de administrador (1110000000) con dos clientes, y una cuenta propia (2220000000). */
function accountRoutes() {
  searches['1110000000'] = {
    'FROM customer_client': {
      results: [
        { customerClient: { id: '3330000000', descriptiveName: 'Lleva Tour', currencyCode: 'PYG', timeZone: 'America/Asuncion', status: 'ENABLED' } },
        { customerClient: { id: '4440000000', descriptiveName: 'Vieja', currencyCode: 'PYG', status: 'CANCELED' } },
        { customerClient: { id: '5550000000', descriptiveName: 'Oculta', currencyCode: 'PYG', status: 'ENABLED', hidden: true } },
      ],
    },
    'FROM customer': { results: [{ customer: { id: '1110000000', descriptiveName: 'Agencia LTO', manager: true, currencyCode: 'USD', status: 'ENABLED' } }] },
  }
  searches['2220000000'] = {
    'FROM customer': { results: [{ customer: { id: '2220000000', descriptiveName: '', currencyCode: 'EUR', status: 'ENABLED', testAccount: true } }] },
  }
}

test('cuentas: las de cada administrador (entrando por él) y aparte las propias', async () => {
  await connect()
  accountRoutes()
  const res = await request('GET', '/api/google/cuentas')
  assert.equal(res.status, 200, res.text)
  assert.deepEqual(
    res.body.portfolios.map((g) => [g.id, g.nombre, g.cuentas.map((c) => `${c.nombre}:${c.estado}`)]),
    [
      ['mcc-1110000000', 'Agencia LTO', ['Lleva Tour:activa', 'Vieja:cancelada']],
      ['sin-administrador', 'Sin administrador', ['222-000-0000:activa']],
    ],
  )
  assert.equal(res.body.portfolios[1].cuentas[0].prueba, true)
  const clients = calls.find((c) => c.path === 'customers/1110000000/googleAds:search' && c.body.query.includes('customer_client'))
  assert.equal(clients.headers['login-customer-id'], '1110000000')
  assert.equal(clients.headers.authorization, 'Bearer acceso-1')
  assert.equal(clients.headers['developer-token'], undefined, 'ya no hace falta')
})

test('cuentas con un proyecto solo de prueba: se dice que hay que pedir el acceso Explorer', async () => {
  await connect()
  const denied = {
    status: 403,
    error: {
      code: 403,
      status: 'PERMISSION_DENIED',
      message: 'The caller does not have permission',
      details: [{ '@type': 'type.googleapis.com/google.ads.googleads.v26.errors.GoogleAdsFailure', errors: [{ errorCode: { authorizationError: 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION' } }] }],
    },
  }
  routes['POST customers/1110000000/googleAds:search'] = denied
  routes['POST customers/2220000000/googleAds:search'] = denied
  const res = await request('GET', '/api/google/cuentas')
  assert.equal(res.status, 403)
  assert.equal(res.body.error, 'google-solo-prueba')
})

test('en marcha: campañas con sus métricas del periodo, el total y entrando por el administrador', async () => {
  await connect()
  accountRoutes()
  searches['3330000000'] = {
    'metrics.cost_micros': (query) => {
      assert.match(query, /segments\.date DURING LAST_30_DAYS/)
      return {
        results: [
          { campaign: { id: '11' }, metrics: { costMicros: '30000000', impressions: '2000', clicks: '100', conversions: 5 } },
          { campaign: { id: '12' }, metrics: { costMicros: '10000000', impressions: '1000', clicks: '20' } },
        ],
      }
    },
    'FROM campaign': (query) => {
      assert.match(query, /campaign\.status IN \('ENABLED', 'PAUSED'\)/)
      return {
        results: [
          { campaign: { id: '12', name: 'Display', status: 'ENABLED', primaryStatus: 'ELIGIBLE', advertisingChannelType: 'DISPLAY' }, campaignBudget: { amountMicros: '5000000' } },
          { campaign: { id: '13', name: 'Vieja', status: 'PAUSED', primaryStatus: 'PAUSED', advertisingChannelType: 'SEARCH' }, campaignBudget: {} },
          { campaign: { id: '11', name: 'Búsqueda', status: 'ENABLED', primaryStatus: 'LIMITED', primaryStatusReasons: ['BUDGET_CONSTRAINED'], advertisingChannelType: 'SEARCH' }, campaignBudget: { amountMicros: '20000000' } },
        ],
      }
    },
  }
  const res = await request('GET', '/api/google/campanas?cuenta=3330000000&periodo=30d')
  assert.equal(res.status, 200, res.text)
  assert.equal(res.body.moneda, 'PYG')
  assert.equal(res.body.nivel, 'campana')
  assert.equal(res.body.padre, null)
  assert.deepEqual(
    res.body.filas.map((f) => [f.nombre, f.estado, f.entrega.texto, f.metricas.gasto]),
    [
      ['Búsqueda', 'activa', 'Limitada por presupuesto', 30],
      ['Display', 'activa', 'Activa', 10],
      ['Vieja', 'pausada', 'En pausa', 0],
    ],
  )
  assert.equal(res.body.filas[0].metricas.coste, 6)
  assert.equal(res.body.totales.gasto, 40)
  assert.equal(res.body.totales.clics, 120)
  assert.equal(res.body.totales.ctr, 4)
  const searchesMade = calls.filter((c) => c.path === 'customers/3330000000/googleAds:search')
  // Las campañas, sus métricas y los recursos (de la cuenta, de las campañas y de los grupos).
  assert.equal(searchesMade.length, 5)
  assert.ok(searchesMade.every((c) => c.headers['login-customer-id'] === '1110000000'))

  // Un minuto guardado; «actualizar» lo vuelve a pedir.
  calls.length = 0
  await request('GET', '/api/google/campanas?cuenta=3330000000&periodo=30d')
  assert.equal(calls.length, 0)
  await request('GET', '/api/google/campanas?cuenta=3330000000&periodo=30d&actualizar=1')
  assert.equal(calls.filter((c) => c.path.endsWith('googleAds:search')).length, 5)

  // Lo que no es una cuenta de las tuyas, o no es un número, no se pide.
  assert.equal((await request('GET', '/api/google/campanas?cuenta=9990000000')).status, 404)
  assert.equal((await request('GET', '/api/google/campanas?cuenta=abc')).status, 400)
  assert.equal((await request('GET', '/api/google/campanas?cuenta=3330000000&periodo=90d')).status, 400)
  assert.equal((await request('GET', '/api/google/campanas?cuenta=3330000000&campana=1%20OR%201')).status, 400)
})

test('en marcha: los grupos de una campaña y los anuncios de un grupo, con lo de arriba', async () => {
  await connect()
  accountRoutes()
  searches['2220000000'] = {
    ...searches['2220000000'],
    'FROM ad_group_ad': (query) =>
      query.includes('metrics.')
        ? { results: [{ adGroup: { id: '21' }, adGroupAd: { ad: { id: '31' } }, metrics: { costMicros: '1000000', clicks: '4' } }] }
        : {
            results: [
              {
                adGroup: { id: '21' },
                adGroupAd: {
                  status: 'ENABLED',
                  primaryStatus: 'NOT_ELIGIBLE',
                  primaryStatusReasons: ['AD_GROUP_PAUSED'],
                  ad: { id: '31', type: 'RESPONSIVE_SEARCH_AD', responsiveSearchAd: { headlines: [{ text: 'Tour en Asunción' }] } },
                },
              },
            ],
          },
    'FROM ad_group': (query) => {
      if (query.includes('ad_group.id = 21')) return { results: [{ adGroup: { id: '21', name: 'Grupo 1', status: 'PAUSED', primaryStatus: 'PAUSED' } }] }
      assert.match(query, /campaign\.id = 11/)
      return query.includes('metrics.')
        ? { results: [] }
        : { results: [{ adGroup: { id: '21', name: 'Grupo 1', status: 'PAUSED', primaryStatus: 'PAUSED' } }] }
    },
    'FROM campaign': (query) => {
      assert.match(query, /campaign\.id = 11/)
      return { results: [{ campaign: { id: '11', name: 'Búsqueda', status: 'ENABLED', primaryStatus: 'ELIGIBLE' }, campaignBudget: { amountMicros: '20000000' } }] }
    },
  }
  const groups = await request('GET', '/api/google/campanas?cuenta=2220000000&campana=11')
  assert.equal(groups.status, 200, groups.text)
  assert.equal(groups.body.nivel, 'conjunto')
  assert.equal(groups.body.padre.nombre, 'Búsqueda')
  assert.deepEqual(groups.body.padre.presupuesto, { cantidad: 20, tipo: 'dia' })
  assert.deepEqual(groups.body.filas.map((f) => [f.id, f.nombre, f.estado, f.presupuesto]), [['21', 'Grupo 1', 'pausada', null]])
  // Una cuenta propia: sin cabecera de administrador.
  assert.ok(calls.filter((c) => c.path === 'customers/2220000000/googleAds:search').every((c) => c.headers['login-customer-id'] === undefined))

  const ads = await request('GET', '/api/google/campanas?cuenta=2220000000&campana=11&conjunto=21')
  assert.equal(ads.status, 200, ads.text)
  assert.equal(ads.body.nivel, 'anuncio')
  assert.equal(ads.body.padre.entrega.texto, 'En pausa')
  assert.deepEqual(ads.body.filas.map((f) => [f.id, f.nombre, f.entrega.texto, f.metricas.clics]), [['21~31', 'Tour en Asunción', 'Grupo en pausa', 4]])
})

test('en marcha: los grupos de varias campañas y los anuncios de varios grupos (sin padre)', async () => {
  await connect()
  accountRoutes()
  const queries = []
  searches['2220000000'] = {
    ...searches['2220000000'],
    'FROM ad_group_ad': (query) => {
      queries.push(query)
      return { results: [] }
    },
    'FROM ad_group_asset': { results: [] },
    'FROM ad_group': (query) => {
      queries.push(query)
      return { results: [] }
    },
  }
  const groups = await request('GET', '/api/google/campanas?cuenta=2220000000&nivel=conjunto&campana=11,12')
  assert.equal(groups.status, 200, groups.text)
  assert.equal(groups.body.padre, null)
  assert.ok(queries.length >= 2 && queries.every((q) => q.includes('campaign.id IN (11, 12)')))
  queries.length = 0
  const ads = await request('GET', '/api/google/campanas?cuenta=2220000000&nivel=anuncio&campana=11&conjunto=21,22')
  assert.equal(ads.status, 200, ads.text)
  assert.ok(queries.length >= 2 && queries.every((q) => q.includes('ad_group.id IN (21, 22)') && !/WHERE.*campaign\.id/.test(q)))
  assert.equal((await request('GET', '/api/google/campanas?cuenta=2220000000&nivel=conjunto&campana=11,1%3D1')).status, 400)
})

test('en marcha: cada campaña con su imagen y cada anuncio listo para dibujar (con las imágenes ya en su dirección)', async () => {
  await connect()
  accountRoutes()
  const assets = {
    'FROM customer_asset': {
      results: [
        { customerAsset: { fieldType: 'BUSINESS_LOGO' }, asset: { id: '1', imageAsset: { fullSize: { url: 'https://img/logo' } } } },
        { customerAsset: { fieldType: 'SITELINK' }, asset: { id: '2', sitelinkAsset: { linkText: 'Excursiones' } } },
        { customerAsset: { fieldType: 'CALLOUT' }, asset: { id: '3', calloutAsset: { calloutText: 'Desde 2013' } } },
      ],
    },
    'FROM campaign_asset': { results: [] },
    'FROM ad_group_asset': { results: [] },
    'FROM asset WHERE': (query) => {
      assert.match(query, /asset\.resource_name IN \('customers\/2220000000\/assets\/10', 'customers\/2220000000\/assets\/12'\)/)
      return {
        results: [
          { asset: { resourceName: 'customers/2220000000/assets/10', imageAsset: { fullSize: { url: 'https://img/foto' } } } },
          { asset: { resourceName: 'customers/2220000000/assets/12', imageAsset: { fullSize: { url: 'https://img/logo-dg' } } } },
        ],
      }
    },
  }
  searches['2220000000'] = {
    ...assets,
    ...searches['2220000000'],
    'FROM ad_group_ad': (query) =>
      query.includes('metrics.')
        ? { results: [] }
        : {
            results: [
              {
                campaign: { id: '11', name: 'Búsqueda' },
                adGroup: { id: '21', name: 'Grupo 1' },
                adGroupAd: {
                  status: 'ENABLED',
                  adStrength: 'EXCELLENT',
                  ad: { id: '31', type: 'RESPONSIVE_SEARCH_AD', finalUrls: ['https://www.lto.com.py/'], responsiveSearchAd: { headlines: [{ text: 'LTO | Tours' }], descriptions: [{ text: 'Consultá.' }] } },
                },
              },
              {
                campaign: { id: '12', name: 'Demand Gen' },
                adGroup: { id: '22', name: 'Grupo 2' },
                adGroupAd: {
                  status: 'ENABLED',
                  ad: {
                    id: '32',
                    type: 'DEMAND_GEN_MULTI_ASSET_AD',
                    demandGenMultiAssetAd: {
                      headlines: [{ text: 'City Tour' }],
                      marketingImages: [{ asset: 'customers/2220000000/assets/10' }, { asset: 'customers/9/assets/x' }],
                      logoImages: [{ asset: 'customers/2220000000/assets/12' }],
                    },
                  },
                },
              },
            ],
          },
    'FROM campaign': (query) =>
      query.includes('metrics.')
        ? { results: [{ campaign: { id: '11' }, metrics: { clicks: '39', searchImpressionShare: 0.1, searchBudgetLostImpressionShare: 0.85 } }] }
        : { results: [{ campaign: { id: '11', name: 'Búsqueda', status: 'ENABLED', primaryStatusReasons: ['BUDGET_CONSTRAINED'], biddingStrategyType: 'MAXIMIZE_CONVERSIONS' }, campaignBudget: {} }] },
  }
  const campaigns = await request('GET', '/api/google/campanas?cuenta=2220000000')
  assert.equal(campaigns.status, 200, campaigns.text)
  const [c] = campaigns.body.filas
  assert.deepEqual(c.imagen, { url: 'https://img/logo', logo: true })
  assert.equal(c.puja, 'Maximizar conversiones')
  assert.match(c.explicacion, /pierdes el 85 %.*el 10 %/)

  const ads = await request('GET', '/api/google/campanas?cuenta=2220000000&nivel=anuncio&campana=11,12')
  assert.equal(ads.status, 200, ads.text)
  const [search, visual] = ['21~31', '22~32'].map((id) => ads.body.filas.find((f) => f.id === id))
  assert.deepEqual(search.vista.enlaces, ['Excursiones'])
  assert.deepEqual(search.vista.destacados, ['Desde 2013'])
  assert.equal(search.vista.logo, 'https://img/logo')
  assert.equal(search.vista.empresa, '222-000-0000')
  assert.equal(search.vista.calidad, 'EXCELLENT')
  // Las imágenes del anuncio, en su dirección (las de otra cuenta, fuera); su miniatura, la primera.
  assert.deepEqual(visual.vista.imagenes, ['https://img/foto'])
  assert.equal(visual.vista.logo, 'https://img/logo-dg')
  assert.deepEqual(visual.imagen, { url: 'https://img/foto', logo: false })
  assert.equal(visual.vista.logos, undefined)
})

test('en marcha: los anuncios de una campaña inteligente, con las cifras de la campaña arriba (y se dice)', async () => {
  await connect()
  accountRoutes()
  searches['2220000000'] = {
    ...searches['2220000000'],
    'FROM ad_group_ad': (query) =>
      query.includes('metrics.')
        ? { results: [] }
        : { results: [{ campaign: { id: '15' }, adGroup: { id: '25' }, adGroupAd: { status: 'ENABLED', ad: { id: '35', smartCampaignAd: { headlines: [{ text: 'Viajes' }] } } } }] },
    'FROM campaign': (query) =>
      query.includes('metrics.')
        ? { results: [{ campaign: { id: '15' }, metrics: { clicks: '442', impressions: '10868', costMicros: '14030000' } }] }
        : { results: [{ campaign: { id: '15', name: 'Inteligente', status: 'ENABLED', advertisingChannelType: 'SMART' }, campaignBudget: {} }] },
  }
  const res = await request('GET', '/api/google/campanas?cuenta=2220000000&nivel=anuncio&campana=15')
  assert.equal(res.status, 200, res.text)
  assert.equal(res.body.totales.clics, 442)
  assert.match(res.body.nota, /inteligentes no dan cifras/)
  assert.equal(res.body.filas[0].metricas.clics, 0)
})

test('palabras clave, términos de búsqueda y recursos: de la cuenta o de lo elegido', async () => {
  await connect()
  accountRoutes()
  const queries = []
  searches['2220000000'] = {
    'FROM customer_asset': { results: [{ customerAsset: { fieldType: 'CALLOUT' }, asset: { id: '3', calloutAsset: { calloutText: 'Desde 2013' } } }] },
    'FROM campaign_asset': {
      results: [
        { campaign: { id: '11', name: 'Búsqueda' }, campaignAsset: { fieldType: 'SITELINK' }, asset: { id: '4', sitelinkAsset: { linkText: 'Traslados' } } },
        { campaign: { id: '12', name: 'Otra' }, campaignAsset: { fieldType: 'SITELINK' }, asset: { id: '5', sitelinkAsset: { linkText: 'Otra cosa' } } },
      ],
    },
    'FROM ad_group_asset': { results: [] },
    ...searches['2220000000'],
    'FROM ad_group_criterion': (query) => {
      queries.push(query)
      return { results: [{ campaign: { id: '11' }, adGroup: { id: '21' }, adGroupCriterion: { criterionId: '1', keyword: { text: 'tour cde', matchType: 'BROAD' }, status: 'ENABLED' } }] }
    },
    'FROM keyword_view': (query) => {
      queries.push(query)
      return { results: [{ adGroup: { id: '21' }, adGroupCriterion: { criterionId: '1' }, metrics: { clicks: '5' } }] }
    },
    'FROM search_term_view': (query) => {
      queries.push(query)
      return { results: [{ searchTermView: { searchTerm: 'tour', status: 'NONE' }, adGroup: { id: '21' }, metrics: { clicks: '2' } }] }
    },
  }
  const keywords = await request('GET', '/api/google/palabras?cuenta=2220000000&periodo=30d&campana=11')
  assert.equal(keywords.status, 200, keywords.text)
  assert.deepEqual(keywords.body.filas.map((f) => [f.texto, f.metricas.clics]), [['tour cde', 5]])
  assert.ok(queries.every((q) => q.includes('campaign.id IN (11)')))
  assert.match(queries.find((q) => q.includes('keyword_view')), /segments\.date DURING LAST_30_DAYS/)
  assert.match(queries.find((q) => q.includes('FROM ad_group_criterion')), /ad_group_criterion\.negative = FALSE/)

  queries.length = 0
  const terms = await request('GET', '/api/google/terminos?cuenta=2220000000&conjunto=21')
  assert.equal(terms.status, 200, terms.text)
  assert.equal(terms.body.filas[0].termino, 'tour')
  assert.match(queries[0], /ad_group\.id IN \(21\).*ORDER BY metrics\.impressions DESC LIMIT 300/)

  const all = await request('GET', '/api/google/recursos?cuenta=2220000000')
  assert.deepEqual(all.body.recursos.map((r) => r.texto), ['Desde 2013', 'Traslados', 'Otra cosa'])
  const one = await request('GET', '/api/google/recursos?cuenta=2220000000&campana=11')
  assert.deepEqual(one.body.recursos.map((r) => [r.texto, r.nivel]), [['Desde 2013', 'cuenta'], ['Traslados', 'campana']])

  assert.equal((await request('GET', '/api/google/palabras?cuenta=2220000000&campana=1%20OR%201')).status, 400)
  assert.equal((await request('GET', '/api/google/terminos?cuenta=2220000000&periodo=siempre')).status, 400)
  assert.equal((await request('POST', '/api/google/recursos?cuenta=2220000000', { body: {} })).status, 405)
})

test('pausar y activar: campañas, grupos y anuncios, y lo guardado se olvida', async () => {
  await connect()
  accountRoutes()
  const mutations = []
  for (const service of ['campaigns', 'adGroups', 'adGroupAds']) {
    routes[`POST customers/3330000000/${service}:mutate`] = ({ body, headers }) => {
      mutations.push({ service, body, login: headers['login-customer-id'] })
      return { results: [{ resourceName: body.operations[0].update.resourceName }] }
    }
  }
  const post = (body) => request('POST', '/api/google/campanas/estado', { body: { cuenta: '3330000000', ...body } })
  assert.deepEqual((await post({ nivel: 'campana', id: '11', estado: 'pausada' })).body, { id: '11', estado: 'pausada' })
  assert.deepEqual(mutations[0], {
    service: 'campaigns',
    login: '1110000000',
    body: { operations: [{ updateMask: 'status', update: { resourceName: 'customers/3330000000/campaigns/11', status: 'PAUSED' } }] },
  })
  await post({ nivel: 'conjunto', id: '21', estado: 'activa' })
  assert.equal(mutations[1].body.operations[0].update.resourceName, 'customers/3330000000/adGroups/21')
  assert.equal(mutations[1].body.operations[0].update.status, 'ENABLED')
  await post({ nivel: 'anuncio', id: '21~31', estado: 'pausada' })
  assert.equal(mutations[2].body.operations[0].update.resourceName, 'customers/3330000000/adGroupAds/21~31')

  assert.match(message(await post({ nivel: 'anuncio', id: '31', estado: 'pausada' })), /Anuncio no válido/)
  assert.match(message(await post({ nivel: 'campana', id: '11', estado: 'borrada' })), /Estado no válido/)
  assert.match(message(await post({ nivel: 'cuenta', id: '11', estado: 'pausada' })), /Nivel no válido/)
  assert.equal(mutations.length, 3, 'nada más se ha mandado')

  // Tras pausar, «En marcha» se vuelve a pedir.
  await request('GET', '/api/google/campanas?cuenta=3330000000')
  calls.length = 0
  await post({ nivel: 'campana', id: '11', estado: 'activa' })
  await request('GET', '/api/google/campanas?cuenta=3330000000')
  assert.ok(calls.some((c) => c.path === 'customers/3330000000/googleAds:search'))
})

test('el token de acceso se renueva al caducar o si Google lo rechaza; la conexión retirada se dice', async () => {
  await connect()
  accountRoutes()
  await request('GET', '/api/google/cuentas')
  assert.equal(calls.filter((c) => c.path === 'token').length, 1, 'el de la conexión vale una hora')

  // Pasada la hora, se pide otro con el de refresco.
  clock += 3_600_000
  await request('GET', '/api/google/cuentas?actualizar=1')
  const refresh = calls.filter((c) => c.path === 'token').at(-1)
  assert.equal(refresh.body.grant_type, 'refresh_token')
  assert.equal(refresh.body.refresh_token, REFRESH)

  // Google rechaza el de acceso: se pide otro una vez y se repite.
  let rejected = false
  routes['GET customers:listAccessibleCustomers'] = ({ headers }) => {
    if (!rejected) {
      rejected = true
      return { status: 401, error: { code: 401, status: 'UNAUTHENTICATED', message: 'Request had invalid authentication credentials.' } }
    }
    assert.notEqual(headers.authorization, 'Bearer acceso-2')
    return { resourceNames: ['customers/2220000000'] }
  }
  const again = await request('GET', '/api/google/cuentas?actualizar=1')
  assert.equal(again.status, 200, again.text)

  // Retirada (o caducada a los 7 días en «Prueba»): 401 y qué hacer.
  clock += 3_600_000
  routes['POST token'] = { status: 400, error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }
  const gone = await request('GET', '/api/google/cuentas?actualizar=1')
  assert.equal(gone.status, 401)
  assert.equal(gone.body.error, 'google-caducada')
  assert.match(gone.body.mensaje, /En producción/)
})

test('desconectar: se olvida el token de refresco y se queda el cliente', async () => {
  await connect()
  const res = await request('POST', '/api/google/desconectar', { body: {} })
  assert.equal(res.body.conectada, false)
  assert.equal(res.body.cliente, true)
  assert.ok(!(await googleFile()).includes(REFRESH))
  assert.equal((await request('GET', '/api/google/cuentas')).status, 401)
})

test('en marcha: los grupos de toda la cuenta, con su campaña', async () => {
  await connect()
  accountRoutes()
  searches['2220000000'] = {
    ...searches['2220000000'],
    'FROM ad_group': (query) => {
      assert.doesNotMatch(query, /campaign\.id =/)
      return query.includes('metrics.')
        ? { results: [] }
        : { results: [{ adGroup: { id: '21', name: 'Grupo 1', status: 'ENABLED', primaryStatus: 'ELIGIBLE' }, campaign: { id: '11', name: 'Búsqueda' } }] }
    },
  }
  const res = await request('GET', '/api/google/campanas?cuenta=2220000000&nivel=conjunto')
  assert.equal(res.status, 200, res.text)
  assert.equal(res.body.nivel, 'conjunto')
  assert.equal(res.body.padre, null)
  assert.deepEqual(res.body.filas[0].padres, { campana: { id: '11', nombre: 'Búsqueda' } })
})

test('editar en Google Ads: nombre y presupuesto de la campaña, grupo y textos de un anuncio adaptable; quitar', async () => {
  await connect()
  accountRoutes()
  const mutations = []
  for (const service of ['campaigns', 'campaignBudgets', 'adGroups', 'ads']) {
    routes[`POST customers/3330000000/${service}:mutate`] = ({ body }) => {
      mutations.push({ service, operation: body.operations[0] })
      return { results: [{}] }
    }
  }
  searches['3330000000'] = {
    'FROM ad_group_ad': {
      results: [
        {
          adGroupAd: {
            ad: {
              id: '31',
              type: 'RESPONSIVE_SEARCH_AD',
              finalUrls: ['https://lto.com.py'],
              responsiveSearchAd: { headlines: [{ text: 'Uno', pinnedField: 'HEADLINE_1' }, { text: 'Dos' }, { text: 'Tres' }], descriptions: [{ text: 'D1' }, { text: 'D2' }], path1: 'tours' },
            },
          },
        },
      ],
    },
    'FROM ad_group': { results: [{ adGroup: { id: '21', name: 'Grupo 1', cpcBidMicros: '1500000000' } }] },
    'campaign_budget.resource_name': { results: [{ campaignBudget: { resourceName: 'customers/3330000000/campaignBudgets/77' } }] },
    'FROM campaign': { results: [{ campaign: { id: '11', name: 'Búsqueda' }, campaignBudget: { amountMicros: '50000000000', explicitlyShared: true } }] },
  }
  const edit = (body) => request('POST', '/api/google/editar', { body: { cuenta: '3330000000', ...body } })

  const campaign = await request('GET', '/api/google/editar?cuenta=3330000000&nivel=campana&id=11')
  assert.equal(campaign.status, 200, campaign.text)
  assert.deepEqual(campaign.body.campana, { presupuesto: 50000, compartido: true })
  await edit({ nivel: 'campana', id: '11', cambios: { nombre: 'Búsqueda · Tours', presupuesto: 60000.4 } })
  assert.deepEqual(mutations[0], { service: 'campaigns', operation: { updateMask: 'name', update: { resourceName: 'customers/3330000000/campaigns/11', name: 'Búsqueda · Tours' } } })
  assert.deepEqual(mutations[1], {
    service: 'campaignBudgets',
    operation: { updateMask: 'amount_micros', update: { resourceName: 'customers/3330000000/campaignBudgets/77', amountMicros: '60000000000' } },
  })

  const group = await request('GET', '/api/google/editar?cuenta=3330000000&nivel=conjunto&id=21')
  assert.deepEqual(group.body.conjunto, { cpc: 1500 })
  await edit({ nivel: 'conjunto', id: '21', cambios: { nombre: 'Grupo A', cpc: 2000 } })
  assert.deepEqual(mutations[2].operation, { updateMask: 'name,cpc_bid_micros', update: { resourceName: 'customers/3330000000/adGroups/21', name: 'Grupo A', cpcBidMicros: '2000000000' } })

  const ad = await request('GET', '/api/google/editar?cuenta=3330000000&nivel=anuncio&id=21~31')
  assert.equal(ad.body.anuncio.editable, true)
  assert.deepEqual(ad.body.anuncio.titulos[0], { texto: 'Uno', fijado: 'HEADLINE_1' })
  const anuncio = { ...ad.body.anuncio, titulos: [...ad.body.anuncio.titulos, { texto: 'Cuatro', fijado: null }] }
  const saved = await edit({ nivel: 'anuncio', id: '21~31', cambios: { anuncio } })
  assert.equal(saved.status, 200, saved.text)
  const op = mutations[3].operation
  assert.equal(op.updateMask, 'final_urls,responsive_search_ad.headlines,responsive_search_ad.descriptions,responsive_search_ad.path1,responsive_search_ad.path2')
  assert.equal(op.update.resourceName, 'customers/3330000000/ads/31')
  assert.deepEqual(op.update.responsiveSearchAd.headlines, [{ text: 'Uno', pinnedField: 'HEADLINE_1' }, { text: 'Dos' }, { text: 'Tres' }, { text: 'Cuatro' }])
  assert.deepEqual(op.update.finalUrls, ['https://lto.com.py'])
  assert.match(message(await edit({ nivel: 'anuncio', id: '21~31', cambios: { anuncio: { ...anuncio, titulos: anuncio.titulos.slice(0, 2) } } })), /entre 3 y 15 títulos/)
  assert.match(message(await edit({ nivel: 'anuncio', id: '21~31', cambios: { anuncio: { ...anuncio, titulos: [...anuncio.titulos, { texto: 'x'.repeat(31) }] } } })), /hasta 30 caracteres/)
  assert.match(message(await edit({ nivel: 'campana', id: '11', cambios: { nombre: ' ' } })), /no puede quedar vacío/)

  routes['POST customers/3330000000/campaigns:mutate'] = ({ body }) => {
    mutations.push({ service: 'campaigns', operation: body.operations[0] })
    return { results: [{}] }
  }
  assert.equal((await request('POST', '/api/google/quitar', { body: { cuenta: '3330000000', nivel: 'campana', id: '11' } })).status, 200)
  assert.deepEqual(mutations.at(-1).operation, { remove: 'customers/3330000000/campaigns/11' })
})
