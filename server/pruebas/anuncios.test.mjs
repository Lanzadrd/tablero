// Anuncios en Meta: lo que se manda (funciones puras) y la API de verdad con una Meta de mentira, en un
// puerto y una carpeta de datos temporales. Nada sale a internet.
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, test } from 'node:test'

const dir = await mkdtemp(path.join(os.tmpdir(), 'tablero-anuncios-'))
process.env.TABLERO_DATA_DIR = path.join(dir, 'datos')
const { createApi } = await import('../api.mjs')
const ads = await import('../anuncios.mjs')
const { createMeta, META_VERSION } = await import('../meta.mjs')

const APP_ID = '1234567890'
const SECRET = 'a'.repeat(32)
const TOKEN = 'EAAtokenlargo-secreto-que-nunca-sale'

const plan = (extra = {}) => ({
  cuenta: 'act_111',
  pagina: '222',
  instagram: '333',
  presupuesto: 10.5,
  lugares: [
    { key: 'ES', tipo: 'country', nombre: 'España', detalle: 'País' },
    { key: '777', tipo: 'city', nombre: 'Madrid', detalle: 'Comunidad de Madrid, España' },
  ],
  edadMin: 30,
  edadMax: 50,
  genero: 'mujeres',
  advantage: true,
  ubicaciones: 'auto',
  texto: 'Escríbenos por WhatsApp',
  titular: 'Clases de prueba',
  saludo: 'Hola, quiero probar una clase',
  nombre: 'Hoplon · WhatsApp · 26 oct',
  plantilla: 'Hoplon',
  inicio: null,
  fin: null,
  anuncios: [{ nombre: 'foto-1', medio: { tipo: 'imagen', hash: 'abcdef0123456789' } }],
  ...extra,
})

// ── Lo que se manda ──

test('presupuesto en céntimos (o en unidades para el yen y compañía)', () => {
  assert.equal(ads.minorUnits(10.5, 'EUR'), '1050')
  assert.equal(ads.minorUnits(3, 'USD'), '300')
  assert.equal(ads.minorUnits(1500, 'JPY'), '1500')
  assert.equal(ads.minorUnits(5000, 'COP'), '5000')
  assert.throws(() => ads.minorUnits(0, 'EUR'), /mayor que 0/)
})

test('público con Advantage+: solo la edad mínima (como mucho 25), sin máxima ni sexo', () => {
  const t = ads.targetingOf(plan())
  assert.deepEqual(t.targeting_automation, { advantage_audience: 1 })
  assert.equal(t.age_min, 25)
  assert.equal(t.age_max, undefined)
  assert.equal(t.genders, undefined)
  assert.deepEqual(t.geo_locations, { countries: ['ES'], cities: [{ key: '777' }] })
  assert.equal(t.publisher_platforms, undefined)
})

test('público sin Advantage+: edad y sexo como límites, y ubicaciones elegidas', () => {
  const t = ads.targetingOf(plan({ advantage: false, ubicaciones: 'instagram' }))
  assert.deepEqual(t.targeting_automation, { advantage_audience: 0 })
  assert.equal(t.age_min, 30)
  assert.equal(t.age_max, 50)
  assert.deepEqual(t.genders, [2])
  assert.deepEqual(t.publisher_platforms, ['instagram'])
  assert.deepEqual(ads.targetingOf(plan({ advantage: false, genero: 'todos' })).genders, undefined)
  assert.throws(() => ads.targetingOf(plan({ lugares: [] })), /lugar/)
})

test('campaña y conjunto: mensajes a WhatsApp, en pausa, presupuesto en el conjunto', () => {
  const campaign = ads.campaignBody(plan())
  assert.equal(campaign.objective, 'OUTCOME_ENGAGEMENT')
  assert.equal(campaign.status, 'PAUSED')
  assert.deepEqual(campaign.special_ad_categories, [])
  assert.equal(campaign.is_adset_budget_sharing_enabled, false)

  const adSet = ads.adSetBody(plan(), { campaignId: 'c1', currency: 'EUR', today: '2026-10-26' })
  assert.equal(adSet.status, 'PAUSED')
  assert.equal(adSet.destination_type, 'WHATSAPP')
  assert.equal(adSet.optimization_goal, 'CONVERSATIONS')
  assert.equal(adSet.billing_event, 'IMPRESSIONS')
  assert.equal(adSet.daily_budget, '1050')
  assert.deepEqual(adSet.promoted_object, { page_id: '222' })
  assert.equal(adSet.start_time, undefined)
  assert.equal(adSet.end_time, undefined)
})

test('fechas: inicio futuro y fin, con la zona del Mac; hoy no lleva inicio', () => {
  const later = ads.adSetBody(plan({ inicio: '2026-11-02', fin: '2026-11-30' }), { campaignId: 'c', currency: 'EUR', today: '2026-10-26' })
  assert.match(later.start_time, /^2026-11-02T00:00:00[+-]\d{2}:\d{2}$/)
  assert.match(later.end_time, /^2026-11-30T23:59:00[+-]\d{2}:\d{2}$/)
  const today = ads.adSetBody(plan({ inicio: '2026-10-26' }), { campaignId: 'c', currency: 'EUR', today: '2026-10-26' })
  assert.equal(today.start_time, undefined)
  assert.throws(() => ads.adSetBody(plan({ inicio: '2026-11-10', fin: '2026-11-01' }), { campaignId: 'c', currency: 'EUR', today: '2026-10-26' }), /anterior/)
})

test('anuncio con imagen: botón de WhatsApp, Instagram y el mensaje ya escrito', () => {
  const p = plan()
  const body = ads.creativeBody(p, p.anuncios[0])
  const spec = body.object_story_spec
  assert.equal(spec.page_id, '222')
  assert.equal(spec.instagram_user_id, '333')
  assert.equal(spec.link_data.image_hash, 'abcdef0123456789')
  assert.equal(spec.link_data.link, 'https://api.whatsapp.com/send')
  assert.equal(spec.link_data.message, 'Escríbenos por WhatsApp')
  assert.equal(spec.link_data.name, 'Clases de prueba')
  assert.deepEqual(spec.link_data.call_to_action, { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } })
  const welcome = JSON.parse(spec.link_data.page_welcome_message)
  assert.equal(welcome.text_format.customer_action_type, 'autofill_message')
  assert.equal(welcome.text_format.message.autofill_message.content, 'Hola, quiero probar una clase')
  assert.deepEqual(body.contextual_multi_ads, { enroll_status: 'OPT_OUT' })
  assert.equal(body.degrees_of_freedom_spec, undefined)

  const plain = ads.creativeBody(plan({ instagram: null, saludo: '', titular: '' }), p.anuncios[0])
  assert.equal(plain.object_story_spec.instagram_user_id, undefined)
  assert.equal(plain.object_story_spec.link_data.page_welcome_message, undefined)
  assert.equal(plain.object_story_spec.link_data.name, undefined)
})

test('anuncio con vídeo: video_data con su miniatura', () => {
  const ad = { nombre: 'video-1', medio: { tipo: 'video', id: '999' } }
  const spec = ads.creativeBody(plan(), ad, { thumbnailHash: 'feedbeef00' }).object_story_spec
  assert.equal(spec.link_data, undefined)
  assert.equal(spec.video_data.video_id, '999')
  assert.equal(spec.video_data.image_hash, 'feedbeef00')
  assert.equal(spec.video_data.title, 'Clases de prueba')
  assert.equal(spec.video_data.call_to_action.value.app_destination, 'WHATSAPP')
  assert.ok(spec.video_data.page_welcome_message)
})

test('lo que llega de la app se valida', () => {
  assert.throws(() => ads.cleanPlan(plan({ cuenta: '111' })), /cuenta publicitaria/)
  assert.throws(() => ads.cleanPlan(plan({ pagina: null })), /página/)
  assert.throws(() => ads.cleanPlan(plan({ texto: '  ' })), /texto/)
  assert.throws(() => ads.cleanPlan(plan({ anuncios: [] })), /imagen o un vídeo/)
  assert.throws(() => ads.cleanPlan(plan({ anuncios: [{ nombre: 'x', medio: { tipo: 'imagen', hash: '<script>' } }] })), /anuncio 1/)
  const clean = ads.cleanPlan(plan({ inicio: 'mañana', genero: 'otro', ubicaciones: 'tiktok' }))
  assert.equal(clean.inicio, null)
  assert.equal(clean.genero, 'todos')
  assert.equal(clean.ubicaciones, 'auto')
  assert.throws(() => ads.cleanTemplates([{ nombre: '' }]), /nombre/)
})

test('enlace al Administrador de anuncios', () => {
  assert.equal(
    ads.adsManagerLink('act_111', '555', '888'),
    'https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=111&business_id=888&selected_campaign_ids=555',
  )
})

// ── Lo que llega: las campañas en marcha ──

const NOW = Date.parse('2026-10-26T12:00:00Z')
const adSet = (extra = {}) => ({ status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '400', lifetime_budget: '0', ...extra })
const campaign = (extra = {}, adSets = [adSet()]) => ({
  id: '1',
  name: 'Mensajes',
  status: 'ACTIVE',
  effective_status: 'ACTIVE',
  daily_budget: undefined,
  lifetime_budget: undefined,
  adsets: { data: adSets },
  ...extra,
})

test('entrega: lo que pasa de verdad, aunque la campaña esté activa', () => {
  const texto = (c) => ads.deliveryOf(c, NOW).texto
  assert.equal(texto(campaign()), 'Activa')
  assert.equal(texto(campaign({ status: 'PAUSED', effective_status: 'PAUSED' })), 'En pausa')
  assert.equal(texto(campaign({ effective_status: 'WITH_ISSUES' })), 'Con problemas')
  assert.equal(texto(campaign({}, [adSet({ status: 'PAUSED', effective_status: 'PAUSED' })])), 'Conjuntos en pausa')
  assert.equal(texto(campaign({}, [adSet({ end_time: '2026-10-20T23:59:00-0300' })])), 'Terminada')
  assert.equal(texto(campaign({ stop_time: '2026-10-01T00:00:00+0200' })), 'Terminada')
  assert.equal(texto(campaign({}, [adSet({ start_time: '2026-11-03T00:00:00+0100' })])), 'Programada')
  assert.equal(texto(campaign({}, [adSet({ effective_status: 'PENDING_REVIEW' })])), 'En revisión')
  assert.equal(texto(campaign({}, [adSet({ effective_status: 'DISAPPROVED' })])), 'Con problemas')
  assert.equal(ads.deliveryOf(campaign(), NOW).tono, 'ok')
})

test('presupuesto: el de la campaña o la suma de los conjuntos que gastarían, en su moneda', () => {
  assert.deepEqual(ads.budgetOf(campaign({ daily_budget: '2500' }), 'EUR', NOW), { cantidad: 25, tipo: 'dia' })
  assert.deepEqual(ads.budgetOf(campaign({ lifetime_budget: '30000' }), 'EUR', NOW), { cantidad: 300, tipo: 'total' })
  const sets = [adSet({ daily_budget: '20000' }), adSet({ daily_budget: '20000' }), adSet({ status: 'PAUSED', daily_budget: '90000' })]
  assert.deepEqual(ads.budgetOf(campaign({}, sets), 'PYG', NOW), { cantidad: 40000, tipo: 'dia' })
  assert.deepEqual(ads.budgetOf(campaign({}, [adSet({ daily_budget: '0', lifetime_budget: '5000' })]), 'USD', NOW), { cantidad: 50, tipo: 'total' })
  assert.equal(ads.budgetOf(campaign({}, [adSet({ status: 'PAUSED' })]), 'USD', NOW), null)
  assert.equal(ads.majorUnits('1050', 'EUR'), 10.5)
  assert.equal(ads.majorUnits('1050', 'JPY'), 1050)
})

test('filas: gasto, conversaciones y coste por conversación; primero las activas que más gastan', () => {
  const campaigns = [
    campaign({ id: '1', name: 'Poca', updated_time: '2026-10-10T14:00:00-0300' }),
    campaign({ id: '2', name: 'En pausa', status: 'PAUSED', effective_status: 'PAUSED', updated_time: '2026-10-20T10:00:00+0000' }),
    campaign({ id: '3', name: 'Mucha' }),
    campaign({ id: '4', name: 'Pausada antes', status: 'PAUSED', effective_status: 'PAUSED', updated_time: '2026-09-01T10:00:00+0000' }),
  ]
  const insights = [
    { campaign_id: '1', spend: '13.90', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '9' }, { action_type: 'link_click', value: '40' }] },
    { campaign_id: '3', spend: '50', actions: [{ action_type: 'link_click', value: '3' }] },
  ]
  const rows = ads.campaignRows(campaigns, insights, { account: 'act_111', currency: 'USD', businessId: '888', now: NOW })
  assert.deepEqual(
    rows.map((r) => [r.nombre, r.estado]),
    [
      ['Mucha', 'activa'],
      ['Poca', 'activa'],
      ['En pausa', 'pausada'],
      ['Pausada antes', 'pausada'],
    ],
  )
  const poca = rows[1]
  assert.equal(poca.gasto, 13.9)
  assert.equal(poca.conversaciones, 9)
  assert.ok(Math.abs(poca.coste - 13.9 / 9) < 1e-9)
  assert.deepEqual(poca.presupuesto, { cantidad: 4, tipo: 'dia' })
  assert.equal(poca.actualizada, '2026-10-10T17:00:00.000Z')
  assert.match(poca.enlace, /act=111&business_id=888&selected_campaign_ids=1/)
  // Sin conversaciones, sin coste (no 0 ni infinito).
  assert.equal(rows[0].conversaciones, 0)
  assert.equal(rows[0].coste, null)
  assert.equal(rows[2].gasto, 0)
})

// ── La API con una Meta de mentira ──

/** Lo que se ha pedido a Meta: {method, path, params, body}. */
const calls = []
/** Respuestas por «MÉTODO ruta» (función o valor). Lo que no está, 404 de Meta. */
let routes = {}

function fakeFetch(input, init = {}) {
  const url = new URL(String(input))
  const method = init.method ?? 'GET'
  const route = url.hostname === 'graph.facebook.com' ? url.pathname.replace(`/${META_VERSION}/`, '') : url.href
  let body = init.body
  if (typeof body === 'string') body = JSON.parse(body)
  calls.push({ method, path: route, params: Object.fromEntries(url.searchParams), body })
  const handler = routes[`${method} ${route}`]
  if (handler === undefined) {
    return Promise.resolve(new Response(JSON.stringify({ error: { message: `Sin ruta: ${method} ${route}`, code: 100 } }), { status: 400 }))
  }
  const result = typeof handler === 'function' ? handler({ url, body, init }) : handler
  if (result instanceof Response) return Promise.resolve(result)
  if (result?.error) return Promise.resolve(new Response(JSON.stringify(result), { status: 400 }))
  return Promise.resolve(new Response(JSON.stringify(result), { status: 200 }))
}

let server
let port

function request(method, pathname, { body, headers = {}, raw } = {}) {
  return new Promise((resolve, reject) => {
    const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body))
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: pathname,
        // Cada petición en su conexión: la de una subida rechazada a medias no se reutiliza.
        agent: false,
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      },
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

const metaFile = () => readFile(path.join(process.env.TABLERO_DATA_DIR, 'meta.json'), 'utf8')

/** Conecta como lo haría el diálogo de Meta y devuelve el estado. */
async function connect() {
  await request('PUT', '/api/meta/app', { body: { id: APP_ID, secreto: SECRET } })
  const start = await request('GET', '/api/meta/conectar')
  const state = new URL(start.headers.location).searchParams.get('state')
  return request('GET', `/api/meta/volver?code=codigo&state=${state}`, { headers: { 'sec-fetch-site': 'cross-site' } })
}

before(async () => {
  const meta = createMeta({ fetch: fakeFetch })
  const api = createApi({ meta, anuncios: { wait: 1000, poll: 1, fetchImpl: fakeFetch } })
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
  routes = {
    'GET oauth/access_token': ({ url }) =>
      url.searchParams.get('code') ? { access_token: 'corto' } : { access_token: TOKEN, expires_in: 5_184_000 },
    'GET me': { id: '42', name: 'Lanza' },
    'GET me/permissions': {
      data: ['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'pages_manage_ads'].map((permission) => ({
        permission,
        status: 'granted',
      })),
    },
  }
})

test('sin app: el estado lo dice y conectar pide la app primero', async () => {
  const status = await request('GET', '/api/meta/estado')
  assert.equal(status.status, 200)
  assert.equal(status.body.app, false)
  assert.equal(status.body.conectada, false)
  const start = await request('GET', '/api/meta/conectar')
  assert.equal(start.status, 400)
  assert.equal(start.body.error, 'meta-sin-app')
})

test('la app se valida y la clave secreta nunca vuelve a la web', async () => {
  assert.equal((await request('PUT', '/api/meta/app', { body: { id: 'abc', secreto: SECRET } })).status, 400)
  assert.equal((await request('PUT', '/api/meta/app', { body: { id: APP_ID, secreto: 'corta' } })).status, 400)
  const saved = await request('PUT', '/api/meta/app', { body: { id: APP_ID, secreto: SECRET } })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.app, true)
  assert.ok(!saved.text.includes(SECRET))
  assert.equal((await stat(path.join(process.env.TABLERO_DATA_DIR, 'meta.json'))).mode & 0o777, 0o600)
})

test('conectar: al diálogo de Meta con un state, de vuelta a localhost en el mismo puerto', async () => {
  await request('PUT', '/api/meta/app', { body: { id: APP_ID, secreto: SECRET } })
  const start = await request('GET', '/api/meta/conectar')
  assert.equal(start.status, 302)
  const dialog = new URL(start.headers.location)
  assert.equal(dialog.origin, 'https://www.facebook.com')
  assert.equal(dialog.searchParams.get('client_id'), APP_ID)
  assert.equal(dialog.searchParams.get('redirect_uri'), `http://localhost:${port}/api/meta/volver`)
  assert.match(dialog.searchParams.get('scope'), /ads_management/)
  assert.match(dialog.searchParams.get('state'), /^[a-f0-9]{32}$/)

  // Con configuración de inicio de sesión para empresas, config_id en vez de scope.
  await request('PUT', '/api/meta/app', { body: { id: APP_ID, secreto: SECRET, configuracion: '5555555' } })
  const business = new URL((await request('GET', '/api/meta/conectar')).headers.location)
  assert.equal(business.searchParams.get('config_id'), '5555555')
  assert.equal(business.searchParams.get('scope'), null)
})

test('la vuelta de Meta: cambia el código por un token de 60 días y no lo enseña nunca', async () => {
  const back = await connect()
  assert.equal(back.status, 200)
  assert.match(back.headers['content-type'], /text\/html/)
  assert.match(back.text, /conectado con Meta/)
  assert.ok(!back.text.includes(TOKEN))

  const exchange = calls.filter((c) => c.path === 'oauth/access_token')
  assert.equal(exchange[0].params.code, 'codigo')
  assert.equal(exchange[0].params.redirect_uri, `http://localhost:${port}/api/meta/volver`)
  assert.equal(exchange[1].params.grant_type, 'fb_exchange_token')
  assert.equal(exchange[1].params.fb_exchange_token, 'corto')

  const status = await request('GET', '/api/meta/estado')
  assert.equal(status.body.conectada, true)
  assert.deepEqual(status.body.usuario, { id: '42', nombre: 'Lanza' })
  assert.deepEqual(status.body.faltan, [])
  assert.ok(status.body.caduca)
  assert.ok(!status.text.includes(TOKEN))
  assert.ok((await metaFile()).includes(TOKEN))

  // Las llamadas a la Graph API llevan la prueba de la clave secreta.
  const me = calls.find((c) => c.path === 'me')
  assert.equal(me.params.access_token, TOKEN)
  assert.match(me.params.appsecret_proof, /^[a-f0-9]{64}$/)
})

test('la vuelta de Meta: sin el state de Tablero (o repetido) no se conecta nada', async () => {
  await request('PUT', '/api/meta/app', { body: { id: APP_ID, secreto: SECRET } })
  const forged = await request('GET', '/api/meta/volver?code=x&state=inventado')
  assert.equal(forged.status, 400)
  assert.equal(calls.filter((c) => c.path === 'oauth/access_token').length, 0)

  const start = await request('GET', '/api/meta/conectar')
  const state = new URL(start.headers.location).searchParams.get('state')
  const cancelled = await request('GET', `/api/meta/volver?error=access_denied&state=${state}`)
  assert.equal(cancelled.status, 400)
  const reused = await request('GET', `/api/meta/volver?code=x&state=${state}`)
  assert.equal(reused.status, 400)
  assert.equal((await request('GET', '/api/meta/estado')).body.conectada, false)

  // Y nunca desde otro host.
  const foreign = await request('GET', `/api/meta/volver?code=x&state=${state}`, { headers: { host: 'malo.example' } })
  assert.equal(foreign.status, 403)
})

test('los permisos que faltan se avisan; desconectar olvida el token', async () => {
  routes['GET me/permissions'] = { data: [{ permission: 'ads_management', status: 'granted' }, { permission: 'pages_manage_ads', status: 'declined' }] }
  await connect()
  const status = await request('GET', '/api/meta/estado')
  assert.deepEqual(status.body.faltan, ['business_management', 'pages_show_list', 'pages_manage_ads'])
  const off = await request('POST', '/api/meta/desconectar', { body: {} })
  assert.equal(off.body.conectada, false)
  assert.equal(off.body.app, true)
  assert.ok(!(await metaFile()).includes(TOKEN))
})

test('cuentas: agrupadas por portfolio, sin repetir, y las sueltas al final', async () => {
  await connect()
  routes['GET me/adaccounts'] = {
    data: [
      { id: 'act_1', account_id: '1', name: 'Hoplon ad account', account_status: 1, currency: 'EUR', business: { id: 'b1', name: 'Hoplon Club' } },
      { id: 'act_9', account_id: '9', name: 'Personal', account_status: 2, currency: 'EUR' },
    ],
  }
  routes['GET me/businesses'] = { data: [{ id: 'b1', name: 'Hoplon Club' }, { id: 'b2', name: 'Lleva Tour Operator', picture: { data: { url: 'https://x/y.png' } } }] }
  routes['GET b1/owned_ad_accounts'] = { data: [{ id: 'act_1', account_id: '1', name: 'Hoplon ad account', account_status: 1, currency: 'EUR' }] }
  routes['GET b1/client_ad_accounts'] = { data: [] }
  routes['GET b2/owned_ad_accounts'] = {
    data: [
      { id: 'act_3', account_id: '3', name: 'LTO Madrid', account_status: 1, currency: 'EUR' },
      { id: 'act_2', account_id: '2', name: 'LTO Barcelona', account_status: 1, currency: 'EUR' },
    ],
  }
  // Sin permiso para las de clientes: no rompe nada.
  routes['GET b2/client_ad_accounts'] = { error: { message: 'Permisos', code: 10 } }
  const res = await request('GET', '/api/meta/cuentas')
  assert.equal(res.status, 200)
  const list = res.body.portfolios
  assert.deepEqual(
    list.map((p) => [p.nombre, p.cuentas.map((c) => c.nombre)]),
    [
      ['Hoplon Club', ['Hoplon ad account']],
      ['Lleva Tour Operator', ['LTO Barcelona', 'LTO Madrid']],
      ['Sin portfolio', ['Personal']],
    ],
  )
  assert.equal(list[1].foto, 'https://x/y.png')
  assert.equal(list[2].cuentas[0].activa, false)
  assert.equal(list[2].cuentas[0].estado, 'desactivada')

  // Se guardan un rato; «actualizar» las vuelve a pedir.
  const before = calls.length
  await request('GET', '/api/meta/cuentas')
  assert.equal(calls.length, before)
  await request('GET', '/api/meta/cuentas?actualizar=1')
  assert.ok(calls.length > before)
})

test('páginas: con su Instagram (o el de la página) y sin WhatsApp si Meta no lo deja leer', async () => {
  await connect()
  const pageTokenOnly = { error: { message: '(#190) This method must be called with a Page Access Token', code: 190 } }
  routes['GET act_111/promote_pages'] = {
    data: [
      { id: 'p1', name: 'Hoplon' },
      { id: 'p2', name: 'Otra' },
      { id: 'p3', name: 'Sin Instagram' },
    ],
  }
  routes['GET p1'] = ({ url }) =>
    url.searchParams.get('fields').startsWith('instagram')
      ? { instagram_business_account: { id: 'ig1', username: 'hoplonclub' } }
      : { whatsapp_number: '34600000000' }
  routes['GET p2'] = ({ url }) => {
    const fields = url.searchParams.get('fields')
    if (fields === 'access_token') return { access_token: 'token-p2' }
    return fields.startsWith('instagram') ? {} : { error: { message: 'No', code: 10 } }
  }
  // Como Meta: con el token de la persona da un 190 que no es que la conexión haya caducado.
  routes['GET p2/instagram_accounts'] = ({ url }) =>
    url.searchParams.get('access_token') === 'token-p2' ? { data: [{ id: 'ig2', username: 'otra' }] } : pageTokenOnly
  routes['GET p3'] = ({ url }) => (url.searchParams.get('fields') === 'access_token' ? { error: { message: 'No', code: 10 } } : {})
  routes['GET p3/instagram_accounts'] = pageTokenOnly
  const res = await request('GET', '/api/meta/paginas?cuenta=act_111')
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.paginas, [
    { id: 'p1', nombre: 'Hoplon', foto: null, instagram: { id: 'ig1', usuario: 'hoplonclub' }, whatsapp: '34600000000' },
    { id: 'p2', nombre: 'Otra', foto: null, instagram: { id: 'ig2', usuario: 'otra' }, whatsapp: null },
    { id: 'p3', nombre: 'Sin Instagram', foto: null, instagram: null, whatsapp: null },
  ])
  const pageCall = calls.find((c) => c.path === 'p2/instagram_accounts' && c.params.access_token === 'token-p2')
  assert.ok(pageCall, 'pide las cuentas de Instagram con el token de la página')
  assert.equal(pageCall.params.appsecret_proof, createHmac('sha256', SECRET).update('token-p2').digest('hex'))
  assert.equal((await request('GET', '/api/meta/paginas?cuenta=111')).status, 400)
})

test('pasados los 60 días, la conexión cuenta como no conectada', async () => {
  const later = createMeta({ fetch: fakeFetch, now: () => Date.now() + 61 * 86_400_000 })
  await connect()
  assert.equal((await later.status()).conectada, false)
  assert.equal((await later.status()).app, true)
})

test('una conexión caducada lo dice (401) para volver a conectar', async () => {
  await connect()
  routes['GET me/adaccounts'] = { error: { message: 'Session has expired', code: 190 } }
  const res = await request('GET', '/api/meta/cuentas')
  assert.equal(res.status, 401)
  assert.equal(res.body.error, 'meta-caducada')
})

test('subir: la imagen va a la cuenta y vuelve su hash; solo con la cabecera de Tablero', async () => {
  await connect()
  routes['POST act_111/adimages'] = ({ body }) => {
    assert.equal(Buffer.from(body.bytes, 'base64').toString(), 'PNGDATA')
    return { images: { bytes: { hash: 'abcdef0123456789', url: 'https://cdn/x.png' } } }
  }
  const ok = await request('POST', '/api/meta/medios?cuenta=act_111&nombre=foto.png', {
    raw: 'PNGDATA',
    headers: { 'content-type': 'image/png', 'x-tablero-subida': '1' },
  })
  assert.equal(ok.status, 200)
  assert.deepEqual(ok.body.medio, { tipo: 'imagen', hash: 'abcdef0123456789', url: 'https://cdn/x.png' })

  // Sin la cabecera (lo que podría mandar un formulario de otra web), nada.
  const plain = await request('POST', '/api/meta/medios?cuenta=act_111', { raw: 'PNGDATA', headers: { 'content-type': 'image/png' } })
  assert.equal(plain.status, 415)
  const foreign = await request('POST', '/api/meta/medios?cuenta=act_111', {
    raw: 'PNGDATA',
    headers: { 'content-type': 'image/png', 'x-tablero-subida': '1', origin: 'https://malo.example' },
  })
  assert.equal(foreign.status, 403)
  // Ni otra cosa que imágenes o vídeos, ni más de lo que admite Meta.
  const pdf = await request('POST', '/api/meta/medios?cuenta=act_111', { raw: 'x', headers: { 'content-type': 'application/pdf', 'x-tablero-subida': '1' } })
  assert.equal(pdf.status, 415)
  const big = await request('POST', '/api/meta/medios?cuenta=act_111', {
    raw: 'x',
    headers: { 'content-type': 'image/png', 'x-tablero-subida': '1', 'content-length': String(31 * 1024 * 1024) },
  })
  assert.equal(big.status, 413)
})

function launchRoutes() {
  routes['GET act_111'] = { name: 'Hoplon ad account', currency: 'EUR', business: { id: 'b1' } }
  routes['POST act_111/campaigns'] = { id: 'c1' }
  routes['POST act_111/adsets'] = { id: 's1' }
  let n = 0
  routes['POST act_111/adcreatives'] = () => ({ id: `cr${++n}` })
  let m = 0
  routes['POST act_111/ads'] = () => ({ id: `ad${++m}` })
}

test('crear: campaña, conjunto y un anuncio por imagen o vídeo, todo en pausa, y se apunta', async () => {
  await connect()
  launchRoutes()
  // El vídeo: se espera a que esté listo y su miniatura se sube como imagen.
  let polls = 0
  routes['GET v1'] = () => ({ status: { video_status: ++polls < 2 ? 'processing' : 'ready' } })
  routes['GET v1/thumbnails'] = { data: [{ uri: 'https://cdn.example/otra.jpg' }, { uri: 'https://cdn.example/buena.jpg', is_preferred: true }] }
  routes['GET https://cdn.example/buena.jpg'] = () => new Response('JPGDATA', { status: 200 })
  routes['POST act_111/adimages'] = { images: { bytes: { hash: 'feedbeef00' } } }

  const body = plan({ anuncios: [plan().anuncios[0], { nombre: 'video-1', medio: { tipo: 'video', id: 'v1' } }] })
  const res = await request('POST', '/api/meta/lanzar', { body })
  assert.equal(res.status, 200, res.text)
  const launch = res.body.lanzamiento
  assert.equal(launch.campana, 'c1')
  assert.equal(launch.conjunto, 's1')
  assert.deepEqual(launch.anuncios, ['ad1', 'ad2'])
  assert.equal(launch.estado, 'pausada')
  assert.equal(launch.moneda, 'EUR')
  assert.match(launch.enlace, /selected_campaign_ids=c1/)

  const posts = calls.filter((c) => c.method === 'POST')
  assert.equal(posts.find((c) => c.path === 'act_111/campaigns').body.status, 'PAUSED')
  assert.equal(posts.find((c) => c.path === 'act_111/adsets').body.daily_budget, '1050')
  const creatives = posts.filter((c) => c.path === 'act_111/adcreatives')
  assert.equal(creatives[1].body.object_story_spec.video_data.image_hash, 'feedbeef00')
  for (const ad of posts.filter((c) => c.path === 'act_111/ads')) assert.equal(ad.body.status, 'PAUSED')
  assert.ok(calls.some((c) => c.path === 'https://cdn.example/buena.jpg'))

  const saved = await request('GET', '/api/anuncios')
  assert.equal(saved.body.lanzamientos[0].id, launch.id)

  // Activar: la campaña, el conjunto y los anuncios.
  for (const objectId of ['c1', 's1', 'ad1', 'ad2']) routes[`POST ${objectId}`] = { success: true }
  const active = await request('POST', '/api/meta/activar', { body: { id: launch.id } })
  assert.equal(active.status, 200)
  assert.equal(active.body.lanzamiento.estado, 'activa')
  assert.deepEqual(
    calls.filter((c) => c.method === 'POST' && ['c1', 's1', 'ad1', 'ad2'].includes(c.path)).map((c) => [c.path, c.body.status]),
    [
      ['c1', 'ACTIVE'],
      ['s1', 'ACTIVE'],
      ['ad1', 'ACTIVE'],
      ['ad2', 'ACTIVE'],
    ],
  )
  assert.equal((await request('GET', '/api/anuncios')).body.lanzamientos[0].estado, 'activa')
  assert.equal((await request('POST', '/api/meta/activar', { body: { id: 'otra' } })).status, 404)
})

test('crear: si algo falla a medias, se borra la campaña y se dice', async () => {
  await connect()
  launchRoutes()
  routes['POST act_111/adsets'] = { error: { message: 'Invalid parameter', error_user_title: 'Público no válido', error_user_msg: 'La edad no encaja', code: 100 } }
  routes['DELETE c1'] = { success: true }
  const res = await request('POST', '/api/meta/lanzar', { body: plan() })
  assert.equal(res.status, 502)
  assert.match(res.body.mensaje ?? res.body.error, /Público no válido: La edad no encaja.*No se ha creado nada/)
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.path === 'c1'))
  assert.deepEqual((await request('GET', '/api/anuncios')).body.lanzamientos, [])

  // Si tampoco se puede borrar, se avisa de lo que ha quedado.
  delete routes['DELETE c1']
  const stuck = await request('POST', '/api/meta/lanzar', { body: plan() })
  assert.match(stuck.body.mensaje ?? stuck.body.error, /Ha quedado la campaña/)
})

function campaignRoutes() {
  routes['GET act_111'] = { currency: 'EUR', business: { id: '888' } }
  routes['GET act_111/campaigns'] = {
    data: [
      campaign({ id: '10', name: 'Mensajes' }),
      campaign({ id: '20', name: 'Vieja', status: 'PAUSED', effective_status: 'PAUSED' }),
    ],
  }
  routes['GET act_111/insights'] = {
    data: [{ campaign_id: '10', spend: '12.5', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '5' }] }],
  }
}

test('en marcha: las campañas con sus números del periodo, guardadas un minuto', async () => {
  await connect()
  campaignRoutes()
  const res = await request('GET', '/api/meta/campanas?cuenta=act_111&periodo=hoy')
  assert.equal(res.status, 200, res.text)
  assert.equal(res.body.moneda, 'EUR')
  assert.equal(res.body.periodo, 'hoy')
  const [mensajes, vieja] = res.body.campanas
  assert.deepEqual(
    { nombre: mensajes.nombre, estado: mensajes.estado, gasto: mensajes.gasto, conversaciones: mensajes.conversaciones, coste: mensajes.coste },
    { nombre: 'Mensajes', estado: 'activa', gasto: 12.5, conversaciones: 5, coste: 2.5 },
  )
  assert.deepEqual(mensajes.presupuesto, { cantidad: 4, tipo: 'dia' })
  assert.equal(vieja.estado, 'pausada')

  const insights = calls.find((c) => c.path === 'act_111/insights')
  assert.equal(insights.params.date_preset, 'today')
  assert.equal(insights.params.level, 'campaign')
  const list = calls.find((c) => c.path === 'act_111/campaigns')
  assert.deepEqual(JSON.parse(list.params.effective_status), ['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES'])

  // Otra vez enseguida: lo guardado. Con «actualizar», a Meta.
  const before = calls.length
  await request('GET', '/api/meta/campanas?cuenta=act_111&periodo=hoy')
  assert.equal(calls.length, before)
  await request('GET', '/api/meta/campanas?cuenta=act_111&periodo=hoy&actualizar=1')
  assert.ok(calls.length > before)

  assert.equal((await request('GET', '/api/meta/campanas?cuenta=act_111&periodo=siempre')).status, 400)
  assert.equal((await request('GET', '/api/meta/campanas?cuenta=111')).status, 400)
})

test('en marcha: pausar y activar cualquier campaña; lo guardado de la cuenta se olvida', async () => {
  await connect()
  campaignRoutes()
  routes['POST 10'] = { success: true }
  await request('GET', '/api/meta/campanas?cuenta=act_111&periodo=7d')

  const paused = await request('POST', '/api/meta/campanas/estado', { body: { cuenta: 'act_111', id: '10', estado: 'pausada' } })
  assert.equal(paused.status, 200, paused.text)
  assert.deepEqual(paused.body, { id: '10', estado: 'pausada', lanzamiento: null })
  assert.deepEqual(calls.at(-1), { method: 'POST', path: '10', params: calls.at(-1).params, body: { status: 'PAUSED' } })

  const active = await request('POST', '/api/meta/campanas/estado', { body: { cuenta: 'act_111', id: '10', estado: 'activa' } })
  assert.equal(active.body.estado, 'activa')
  assert.deepEqual(calls.at(-1).body, { status: 'ACTIVE' })

  // Tras el cambio, la lista vuelve a pedirse a Meta.
  const before = calls.length
  await request('GET', '/api/meta/campanas?cuenta=act_111&periodo=7d')
  assert.ok(calls.length > before)

  for (const body of [{ id: '10', estado: 'borrada' }, { id: 'act_1/../x', estado: 'activa' }, { estado: 'activa' }]) {
    assert.equal((await request('POST', '/api/meta/campanas/estado', { body })).status, 400)
  }
})

test('en marcha: una creada desde Tablero se enciende entera la primera vez y luego solo la campaña', async () => {
  await connect()
  launchRoutes()
  routes['POST act_111/campaigns'] = { id: '901' }
  routes['POST act_111/adsets'] = { id: '902' }
  routes['POST act_111/ads'] = { id: '903' }
  const { lanzamiento } = (await request('POST', '/api/meta/lanzar', { body: plan() })).body
  for (const objectId of ['901', '902', '903']) routes[`POST ${objectId}`] = { success: true }

  calls.length = 0
  const on = await request('POST', '/api/meta/campanas/estado', { body: { cuenta: 'act_111', id: '901', estado: 'activa' } })
  assert.equal(on.status, 200, on.text)
  assert.equal(on.body.lanzamiento.id, lanzamiento.id)
  assert.equal(on.body.lanzamiento.estado, 'activa')
  assert.deepEqual(
    calls.filter((c) => c.method === 'POST').map((c) => [c.path, c.body.status]),
    [
      ['901', 'ACTIVE'],
      ['902', 'ACTIVE'],
      ['903', 'ACTIVE'],
    ],
  )

  const off = await request('POST', '/api/meta/campanas/estado', { body: { cuenta: 'act_111', id: '901', estado: 'pausada' } })
  assert.equal(off.body.lanzamiento.estado, 'pausada')
  calls.length = 0
  await request('POST', '/api/meta/campanas/estado', { body: { cuenta: 'act_111', id: '901', estado: 'activa' } })
  // Ya se activó una vez: solo la campaña (lo que se pausara a mano en Meta se queda en pausa).
  assert.deepEqual(
    calls.filter((c) => c.method === 'POST').map((c) => [c.path, c.body.status]),
    [['901', 'ACTIVE']],
  )
  assert.equal((await request('GET', '/api/anuncios')).body.lanzamientos[0].estado, 'activa')
})

test('plantillas: se guardan limpias y con id', async () => {
  const res = await request('PUT', '/api/anuncios/plantillas', {
    body: { plantillas: [{ ...plan(), nombre: ' Captación ', id: undefined, presupuesto: '12', edadMin: 99 }] },
  })
  assert.equal(res.status, 200)
  const [saved] = res.body.plantillas
  assert.equal(saved.nombre, 'Captación')
  assert.match(saved.id, /^[\w-]+$/)
  assert.equal(saved.presupuesto, 12)
  assert.equal(saved.edadMin, 65)
  assert.equal(saved.anuncios, undefined)
  assert.deepEqual((await request('GET', '/api/anuncios')).body.plantillas, res.body.plantillas)
  assert.equal((await request('PUT', '/api/anuncios/plantillas', { body: { plantillas: 'x' } })).status, 400)
})

test('las rutas de Meta solo desde Tablero', async () => {
  const ajenas = [{ origin: 'https://malo.example' }, { 'sec-fetch-site': 'cross-site' }, { host: 'malo.example' }]
  for (const [method, pathname, body] of [
    ['GET', '/api/meta/estado'],
    ['GET', '/api/meta/conectar'],
    ['PUT', '/api/meta/app', { id: APP_ID, secreto: SECRET }],
    ['POST', '/api/meta/lanzar', plan()],
    ['GET', '/api/meta/campanas?cuenta=act_111'],
    ['POST', '/api/meta/campanas/estado', { cuenta: 'act_111', id: '10', estado: 'pausada' }],
    ['GET', '/api/anuncios'],
  ]) {
    for (const headers of ajenas) {
      const res = await request(method, pathname, { body, headers })
      assert.equal(res.status, 403, `${method} ${pathname} ${JSON.stringify(headers)}`)
    }
  }
  assert.equal(calls.length, 0)
})
