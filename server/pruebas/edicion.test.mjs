// Editar lo publicado en Meta: cómo se lee el público y el contenido de un anuncio (funciones puras) y la API de verdad
// con una Meta de mentira, en un puerto y una carpeta de datos temporales. Nada sale a internet.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, test } from 'node:test'

const dir = await mkdtemp(path.join(os.tmpdir(), 'tablero-edicion-'))
process.env.TABLERO_DATA_DIR = path.join(dir, 'datos')
const { createApi } = await import('../api.mjs')
const { audienceOf, contentOf, mergeTargeting } = await import('../edicion.mjs')
const { createMeta, META_VERSION } = await import('../meta.mjs')

const welcome = (format) => JSON.stringify({ type: 'VISUAL_EDITOR', version: 2, landing_screen_type: 'welcome_message', media_type: 'text', text_format: format })

// ── El público ──

const TARGETING = {
  geo_locations: {
    countries: ['PY'],
    cities: [{ key: '1903856', name: 'Ciudad del Este', region: 'Alto Paraná', country: 'PY', radius: 25, distance_unit: 'kilometer' }],
    location_types: ['home', 'recent'],
  },
  age_min: 25,
  age_max: 54,
  genders: [2],
  flexible_spec: [{ interests: [{ id: '6003', name: 'Viajes' }] }],
  custom_audiences: [{ id: '42' }],
  publisher_platforms: ['facebook', 'instagram'],
  facebook_positions: ['feed'],
  instagram_positions: ['stream'],
  targeting_automation: { advantage_audience: 0 },
}

test('público: lugares con su nombre, edad, sexo, ubicaciones y lo que Tablero no enseña', () => {
  const a = audienceOf(TARGETING)
  assert.deepEqual(
    a.lugares.map((l) => [l.tipo, l.key, l.nombre, l.detalle]),
    [
      ['country', 'PY', 'Paraguay', 'País'],
      ['city', '1903856', 'Ciudad del Este', 'Alto Paraná, Paraguay'],
    ],
  )
  assert.equal(a.edadMin, 25)
  assert.equal(a.edadMax, 54)
  assert.equal(a.genero, 'mujeres')
  assert.equal(a.advantage, false)
  assert.equal(a.ubicaciones, 'manual')
  assert.deepEqual(a.posiciones, ['fb_feed', 'ig_feed'])
  assert.deepEqual(a.extras, ['intereses y comportamientos', 'públicos personalizados'])
  // Solo Instagram (sin posiciones): todas las suyas.
  assert.deepEqual(audienceOf({ geo_locations: { countries: ['ES'] }, publisher_platforms: ['instagram'] }).posiciones, ['ig_feed', 'ig_profile', 'ig_explore_home', 'ig_search', 'ig_story', 'ig_reels', 'ig_profile_reels'])
  // Con una que Tablero no conoce, se quedan las de Meta.
  assert.equal(audienceOf({ geo_locations: { countries: ['ES'] }, publisher_platforms: ['audience_network'] }).ubicaciones, 'meta')
  assert.equal(audienceOf({ geo_locations: { countries: ['ES'] } }).ubicaciones, 'auto')
})

test('público al guardar: cambia lo de Tablero y conserva lo demás (intereses, radio de la ciudad, ubicaciones de Meta)', () => {
  const lugares = [
    { key: '1903856', tipo: 'city', nombre: 'Ciudad del Este', detalle: '' },
    { key: '2591', tipo: 'region', nombre: 'Central', detalle: '' },
  ]
  const kept = mergeTargeting(TARGETING, { lugares, edadMin: 30, edadMax: 50, genero: 'todos', advantage: false, ubicaciones: 'meta', posiciones: [] })
  assert.deepEqual(kept.geo_locations, { cities: [{ key: '1903856', radius: 25, distance_unit: 'kilometer' }], regions: [{ key: '2591' }], location_types: ['home', 'recent'] })
  assert.equal(kept.age_min, 30)
  assert.equal(kept.age_max, 50)
  assert.equal(kept.genders, undefined)
  assert.deepEqual(kept.flexible_spec, TARGETING.flexible_spec)
  assert.deepEqual(kept.custom_audiences, TARGETING.custom_audiences)
  assert.deepEqual(kept.facebook_positions, ['feed'], 'las ubicaciones de Meta se quedan')
  const chosen = mergeTargeting(TARGETING, { lugares, edadMin: 30, edadMax: 50, genero: 'todos', advantage: false, ubicaciones: 'manual', posiciones: ['fb_marketplace', 'ig_story'] })
  assert.deepEqual(chosen.publisher_platforms, ['facebook', 'instagram'])
  assert.deepEqual(chosen.facebook_positions, ['marketplace'])
  assert.deepEqual(chosen.instagram_positions, ['story'])
  assert.throws(() => mergeTargeting(TARGETING, { lugares, edadMin: 30, edadMax: 50, genero: 'todos', advantage: false, ubicaciones: 'manual', posiciones: [] }), /al menos una ubicación/)
  assert.equal(TARGETING.age_min, 25, 'no toca el original')

  const auto = mergeTargeting(TARGETING, { lugares, edadMin: 40, edadMax: 60, genero: 'hombres', advantage: true, ubicaciones: 'auto', posiciones: [] })
  assert.equal(auto.age_min, 25, 'con Advantage+, como mucho 25')
  assert.equal(auto.age_max, undefined)
  assert.equal(auto.genders, undefined)
  assert.equal(auto.targeting_automation.advantage_audience, 1)
  assert.deepEqual(auto.targeting_relaxation_types, { lookalike: 1, custom_audience: 1 }, 'Meta lo pide al guardar con Advantage+')
  assert.equal(auto.targeting_optimization, 'expansion_all')
  assert.equal(mergeTargeting({ ...TARGETING, age_range: [25, 54] }, { lugares, edadMin: 30, edadMax: 40, genero: 'todos', advantage: false, ubicaciones: 'meta', posiciones: [] }).age_range, undefined)
  assert.equal(auto.publisher_platforms, undefined)
  assert.equal(auto.facebook_positions, undefined)
  assert.deepEqual(mergeTargeting(TARGETING, { lugares, edadMin: 18, edadMax: 65, genero: 'todos', advantage: false, ubicaciones: 'instagram', posiciones: [] }).publisher_platforms, ['instagram'])
  assert.throws(() => mergeTargeting(TARGETING, { lugares: [], edadMin: 18, edadMax: 65, genero: 'todos', advantage: true, ubicaciones: 'auto', posiciones: [] }), /al menos un lugar/)
})

// ── El contenido de un anuncio ──

test('contenido: un anuncio a WhatsApp con imagen se puede editar; con otro destino o una publicación, no', () => {
  const creative = {
    object_story_spec: {
      page_id: '222',
      instagram_user_id: '333',
      link_data: {
        image_hash: 'abc123def456',
        message: 'Escríbenos',
        name: 'City tour',
        description: 'Desde 150.000',
        call_to_action: { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } },
        page_welcome_message: welcome({ customer_action_type: 'ice_breakers', message: { text: '¡Hola!', ice_breakers: [{ title: '¿Precio?' }, { title: '¿Horarios?' }] } }),
      },
    },
    degrees_of_freedom_spec: { creative_features_spec: { image_touchups: { enroll_status: 'OPT_IN' } } },
    contextual_multi_ads: { enroll_status: 'OPT_OUT' },
  }
  const c = contentOf(creative)
  assert.equal(c.editable, true)
  assert.deepEqual(c.versiones, [{ formato: '4:5', medio: { tipo: 'imagen', hash: 'abc123def456' } }])
  assert.equal(c.ajustes.texto, 'Escríbenos')
  assert.equal(c.ajustes.titular, 'City tour')
  assert.equal(c.ajustes.descripcion, 'Desde 150.000')
  assert.equal(c.ajustes.bienvenida, '¡Hola!')
  assert.equal(c.ajustes.tipoMensaje, 'preguntas')
  assert.deepEqual(c.ajustes.preguntas, ['¿Precio?', '¿Horarios?'])
  assert.equal(c.ajustes.instagram, '333')
  assert.deepEqual(c.ajustes.mejoras, ['retoques'])

  const web = structuredClone(creative)
  web.object_story_spec.link_data.call_to_action = { type: 'LEARN_MORE', value: { link: 'https://lto.com.py' } }
  assert.match(contentOf(web).motivo, /no lleva a WhatsApp/)
  assert.match(contentOf({ object_story_id: '222_999', effective_object_story_id: '222_999' }).motivo, /publicación que ya existía/)
  const carousel = structuredClone(creative)
  carousel.object_story_spec.link_data.child_attachments = [{}, {}]
  assert.match(contentOf(carousel).motivo, /carrusel/)
})

test('contenido: con versión vertical (vídeos), cada una en su sitio y con su miniatura', () => {
  const c = contentOf({
    object_story_spec: { page_id: '222' },
    asset_feed_spec: {
      videos: [
        { video_id: '901', thumbnail_hash: 'aaa111', adlabels: [{ name: 'tablero_feed_x' }] },
        { video_id: '902', thumbnail_hash: 'bbb222', adlabels: [{ name: 'tablero_vertical_x' }] },
      ],
      bodies: [{ text: 'Texto' }],
      titles: [{ text: 'Título' }],
      call_to_action_types: ['WHATSAPP_MESSAGE'],
      additional_data: { page_welcome_message: welcome({ customer_action_type: 'autofill_message', message: { text: 'Hola', autofill_message: { content: 'Quiero info' } } }) },
    },
  })
  assert.equal(c.editable, true)
  assert.deepEqual(c.versiones, [
    { formato: '4:5', medio: { tipo: 'video', id: '901' } },
    { formato: '9:16', medio: { tipo: 'video', id: '902' } },
  ])
  assert.deepEqual(c.miniaturas, [['901', 'aaa111'], ['902', 'bbb222']])
  assert.equal(c.ajustes.saludo, 'Quiero info')
  assert.equal(c.ajustes.tipoMensaje, 'escrito')
})

// ── La API con una Meta de mentira ──

const calls = []
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
  const result = typeof handler === 'function' ? handler({ url, body }) : handler
  if (result?.error) return Promise.resolve(new Response(JSON.stringify(result), { status: 400 }))
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
          resolve({ status: res.statusCode, text, body: json })
        })
      },
    )
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

const message = (res) => res.body?.mensaje ?? res.body?.error
const posted = (route) => calls.filter((c) => c.method === 'POST' && c.path === route).map((c) => c.body)

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

/** Conectado como lo haría el diálogo de Meta. */
async function connected() {
  await request('PUT', '/api/meta/app', { body: { id: '1234567890', secreto: 'a'.repeat(32) } })
  const location = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/api/meta/conectar', agent: false }, (res) => {
      res.resume()
      resolve(res.headers.location)
    }).on('error', reject)
  })
  const state = new URL(location).searchParams.get('state')
  await request('GET', `/api/meta/volver?code=codigo&state=${state}`, { headers: { 'sec-fetch-site': 'cross-site' } })
}

beforeEach(async () => {
  await rm(process.env.TABLERO_DATA_DIR, { recursive: true, force: true })
  calls.length = 0
  routes = {
    'GET oauth/access_token': ({ url }) => (url.searchParams.get('code') ? { access_token: 'corto' } : { access_token: 'EAAlargo', expires_in: 5_184_000 }),
    'GET me': { id: '42', name: 'Lanza' },
    'GET me/permissions': { data: ['ads_management', 'business_management', 'pages_show_list', 'pages_manage_ads'].map((permission) => ({ permission, status: 'granted' })) },
    'GET act_111': { currency: 'PYG' },
  }
  await connected()
  calls.length = 0
})

test('campaña: se lee y se cambia el nombre, el presupuesto, la puja y el límite de gasto (y se quita)', async () => {
  let campaign = { name: 'LTO - Mensajes', status: 'ACTIVE', account_id: '111', objective: 'OUTCOME_ENGAGEMENT', daily_budget: '40000', bid_strategy: 'LOWEST_COST_WITHOUT_CAP', spend_cap: '2000000' }
  routes['GET 10'] = () => campaign
  routes['POST 10'] = ({ body }) => {
    campaign = { ...campaign, ...body }
    return { success: true }
  }
  const read = await request('GET', '/api/meta/editar?cuenta=act_111&nivel=campana&id=10')
  assert.equal(read.status, 200, read.text)
  assert.deepEqual(read.body.campana, { objetivo: 'OUTCOME_ENGAGEMENT', presupuesto: { cantidad: 40000, tipo: 'dia' }, puja: 'volumen', limiteGasto: 2000000 })

  const saved = await request('POST', '/api/meta/editar', {
    body: { cuenta: 'act_111', nivel: 'campana', id: '10', cambios: { nombre: 'LTO · WhatsApp', presupuesto: 55000, puja: 'coste', limiteGasto: null } },
  })
  assert.equal(saved.status, 200, saved.text)
  assert.deepEqual(posted('10').at(-1), { name: 'LTO · WhatsApp', daily_budget: '55000', bid_strategy: 'COST_CAP', spend_cap: '922337203685478' })
  assert.equal(saved.body.nombre, 'LTO · WhatsApp')
  assert.equal(saved.body.campana.limiteGasto, null)

  // Sin presupuesto propio (va en los conjuntos), no se cambia en la campaña.
  campaign = { ...campaign, daily_budget: undefined }
  assert.match(message(await request('POST', '/api/meta/editar', { body: { cuenta: 'act_111', nivel: 'campana', id: '10', cambios: { presupuesto: 1 } } })), /va en cada conjunto/)
  // Lo de otra cuenta, no.
  campaign = { ...campaign, account_id: '999' }
  assert.match(message(await request('GET', '/api/meta/editar?cuenta=act_111&nivel=campana&id=10')), /no es de esta cuenta/)
})

test('conjunto: presupuesto, sin fecha de fin, puja con importe y público; con presupuesto total hace falta el fin', async () => {
  let adSet = {
    name: 'Grupo 1',
    status: 'ACTIVE',
    account_id: '111',
    daily_budget: '15000',
    start_time: '2026-10-01T00:00:00-0300',
    end_time: '2026-12-31T23:59:00-0300',
    targeting: TARGETING,
    promoted_object: { page_id: '222' },
    optimization_goal: 'CONVERSATIONS',
    destination_type: 'WHATSAPP',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    campaign: { id: '10', name: 'LTO' },
  }
  routes['GET 20'] = () => adSet
  routes['POST 20'] = { success: true }
  const read = await request('GET', '/api/meta/editar?cuenta=act_111&nivel=conjunto&id=20')
  assert.equal(read.status, 200, read.text)
  assert.equal(read.body.conjunto.presupuesto.cantidad, 15000)
  assert.equal(read.body.conjunto.empezado, true)
  assert.equal(read.body.conjunto.fin, '2026-12-31')
  assert.equal(read.body.conjunto.pujaEnCampana, false)
  assert.equal(read.body.conjunto.publico.ubicaciones, 'manual')

  const publico = { ...read.body.conjunto.publico, lugares: [{ key: 'PY', tipo: 'country', nombre: 'Paraguay', detalle: 'País' }], advantage: true, ubicaciones: 'auto' }
  const saved = await request('POST', '/api/meta/editar', {
    body: { cuenta: 'act_111', nivel: 'conjunto', id: '20', cambios: { presupuesto: 20000, fin: null, puja: 'coste', importePuja: 5000, publico } },
  })
  assert.equal(saved.status, 200, saved.text)
  const body = posted('20').at(-1)
  assert.equal(body.daily_budget, '20000')
  assert.equal(body.end_time, 0)
  assert.equal(body.bid_strategy, 'COST_CAP')
  assert.equal(body.bid_amount, '5000')
  assert.deepEqual(body.targeting.geo_locations, { countries: ['PY'], location_types: ['home', 'recent'] })
  assert.deepEqual(body.targeting.flexible_spec, TARGETING.flexible_spec, 'los intereses se quedan')
  assert.equal(body.targeting.publisher_platforms, undefined)

  assert.match(message(await request('POST', '/api/meta/editar', { body: { cuenta: 'act_111', nivel: 'conjunto', id: '20', cambios: { inicio: '2027-01-01' } } })), /ya ha empezado/)
  assert.match(message(await request('POST', '/api/meta/editar', { body: { cuenta: 'act_111', nivel: 'conjunto', id: '20', cambios: { puja: 'coste' } } })), /coste por resultado/)
  adSet = { ...adSet, daily_budget: undefined, lifetime_budget: '300000' }
  assert.match(message(await request('POST', '/api/meta/editar', { body: { cuenta: 'act_111', nivel: 'conjunto', id: '20', cambios: { fin: null } } })), /hace falta una fecha de fin/)
  adSet = { ...adSet, lifetime_budget: undefined, campaign: { id: '10', name: 'LTO', daily_budget: '40000', bid_strategy: 'LOWEST_COST_WITHOUT_CAP' } }
  assert.match(message(await request('POST', '/api/meta/editar', { body: { cuenta: 'act_111', nivel: 'conjunto', id: '20', cambios: { presupuesto: 1 } } })), /el de la campaña/)
})

test('anuncio: cambiar el texto crea otro contenido con lo demás igual y se lo pone al mismo anuncio', async () => {
  const creative = {
    id: '700',
    object_story_spec: {
      page_id: '222',
      link_data: { image_hash: 'abc123def456', message: 'Antes', name: 'City tour', call_to_action: { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } } },
    },
  }
  routes['GET 30'] = { name: 'Anuncio 1', status: 'ACTIVE', account_id: '111', adset_id: '20', creative }
  routes['GET 20'] = { targeting: { geo_locations: { countries: ['PY'] } } }
  routes['GET act_111/adimages'] = { data: [{ hash: 'abc123def456', url: 'https://cdn/abc.jpg', width: 1080, height: 1350 }] }
  routes['POST act_111/adcreatives'] = { id: '701' }
  routes['POST 30'] = { success: true }
  const read = await request('GET', '/api/meta/editar?cuenta=act_111&nivel=anuncio&id=30')
  assert.equal(read.status, 200, read.text)
  assert.equal(read.body.anuncio.editable, true)
  assert.equal(read.body.anuncio.versiones[0].medio.url, 'https://cdn/abc.jpg')
  assert.equal(read.body.anuncio.versiones[0].medio.ratio, 0.8)
  assert.equal(read.body.anuncio.versiones[0].formato, '4:5', 'el formato de una sola imagen, por su proporción')

  const saved = await request('POST', '/api/meta/editar', {
    body: { cuenta: 'act_111', nivel: 'anuncio', id: '30', cambios: { contenido: { ...read.body.anuncio.contenido, texto: 'Después' } } },
  })
  assert.equal(saved.status, 200, saved.text)
  const created = posted('act_111/adcreatives')[0]
  assert.equal(created.object_story_spec.page_id, '222')
  assert.equal(created.object_story_spec.link_data.message, 'Después')
  assert.equal(created.object_story_spec.link_data.name, 'City tour')
  assert.equal(created.object_story_spec.link_data.image_hash, 'abc123def456')
  assert.deepEqual(posted('30').at(-1), { creative: { creative_id: '701' } })

  // Solo el nombre: sin contenido nuevo.
  calls.length = 0
  await request('POST', '/api/meta/editar', { body: { cuenta: 'act_111', nivel: 'anuncio', id: '30', cambios: { nombre: 'Otro nombre' } } })
  assert.equal(posted('act_111/adcreatives').length, 0)
  assert.deepEqual(posted('30').at(-1), { name: 'Otro nombre' })
})

test('duplicar: campañas y conjuntos se copian pieza a pieza, en pausa; los anuncios, con su nombre', async () => {
  routes['GET 10'] = { name: 'LTO', account_id: '111' }
  routes['GET 20'] = { name: 'Grupo', account_id: '111' }
  routes['POST 10/copies'] = { copied_campaign_id: '11' }
  routes['GET 10/adsets'] = { data: [{ id: '20' }] }
  routes['POST 20/copies'] = { copied_adset_id: '21' }
  routes['GET 20/ads'] = { data: [{ id: '30' }, { id: '31' }] }
  routes['POST 30/copies'] = { copied_ad_id: '40' }
  routes['POST 31/copies'] = { copied_ad_id: '41' }
  const copy = await request('POST', '/api/meta/duplicar', { body: { cuenta: 'act_111', nivel: 'campana', id: '10' } })
  assert.equal(copy.status, 200, copy.text)
  assert.deepEqual(copy.body, { id: '11' })
  assert.deepEqual(posted('10/copies')[0], { deep_copy: false, status_option: 'PAUSED' })
  assert.deepEqual(posted('20/copies')[0], { deep_copy: false, status_option: 'PAUSED', campaign_id: '11', rename_options: { rename_strategy: 'NO_RENAME' } })
  assert.deepEqual(posted('30/copies')[0], { adset_id: '21', status_option: 'PAUSED', rename_options: { rename_strategy: 'NO_RENAME' } })
  assert.ok(calls.some((c) => c.path === '20/ads' && c.params.effective_status.includes('PAUSED') && !c.params.effective_status.includes('ARCHIVED')))

  calls.length = 0
  const adSetCopy = await request('POST', '/api/meta/duplicar', { body: { cuenta: 'act_111', nivel: 'conjunto', id: '20' } })
  assert.deepEqual(adSetCopy.body, { id: '21' })
  assert.deepEqual(posted('20/copies')[0], { deep_copy: false, status_option: 'PAUSED' }, 'el conjunto, con «- Copia»')

  routes['POST 31/copies'] = { error: { message: 'Límite', code: 100 } }
  assert.match(message(await request('POST', '/api/meta/duplicar', { body: { cuenta: 'act_111', nivel: 'conjunto', id: '20' } })), /Límite.*en pausa/)
})

test('archivar y borrar', async () => {
  routes['GET 30'] = { account_id: '111' }
  routes['POST 30'] = { success: true }
  routes['DELETE 30'] = { success: true }
  assert.equal((await request('POST', '/api/meta/quitar', { body: { cuenta: 'act_111', nivel: 'anuncio', id: '30', modo: 'archivar' } })).status, 200)
  assert.deepEqual(posted('30').at(-1), { status: 'ARCHIVED' })
  assert.equal((await request('POST', '/api/meta/quitar', { body: { cuenta: 'act_111', nivel: 'anuncio', id: '30', modo: 'borrar' } })).status, 200)
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.path === '30'))
  assert.match(message(await request('POST', '/api/meta/quitar', { body: { cuenta: 'act_111', nivel: 'anuncio', id: '30', modo: 'tirar' } })), /Modo no válido/)
})

test('añadir anuncios a un conjunto: con su página, en pausa', async () => {
  routes['GET 20'] = { name: 'Grupo', account_id: '111', promoted_object: { page_id: '222' } }
  routes['POST act_111/adcreatives'] = { id: '801' }
  routes['POST act_111/ads'] = { id: '802' }
  const res = await request('POST', '/api/meta/anuncios', {
    body: { cuenta: 'act_111', conjunto: '20', texto: 'Hola', anuncios: [{ nombre: 'Nuevo', medio: { tipo: 'imagen', hash: 'abc123def456' } }] },
  })
  assert.equal(res.status, 200, res.text)
  assert.deepEqual(res.body, { conjunto: '20', anuncios: ['802'] })
  assert.equal(posted('act_111/adcreatives')[0].object_story_spec.page_id, '222')
  const ad = posted('act_111/ads')[0]
  assert.equal(ad.adset_id, '20')
  assert.equal(ad.status, 'PAUSED')
})

test('en marcha: los conjuntos de toda la cuenta y los anuncios de una campaña, con de quién son', async () => {
  routes['GET act_111'] = { currency: 'PYG', business: { id: 'b1' } }
  routes['GET act_111/adsets'] = { data: [{ id: '20', name: 'Grupo', status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '15000', campaign: { id: '10', name: 'LTO' } }] }
  routes['GET act_111/insights'] = ({ url }) => (url.searchParams.get('level') === 'adset' ? { data: [{ adset_id: '20', spend: '5000' }] } : { data: [{ spend: '5000' }] })
  const adSets = await request('GET', '/api/meta/campanas?cuenta=act_111&nivel=conjunto')
  assert.equal(adSets.status, 200, adSets.text)
  assert.equal(adSets.body.nivel, 'conjunto')
  assert.equal(adSets.body.padre, null)
  assert.deepEqual(adSets.body.filas[0].padres, { campana: { id: '10', nombre: 'LTO' } })

  routes['GET 10/ads'] = { data: [{ id: '30', name: 'Anuncio', status: 'ACTIVE', effective_status: 'ACTIVE', campaign: { id: '10', name: 'LTO' }, adset: { id: '20', name: 'Grupo' } }] }
  routes['GET 10/insights'] = { data: [] }
  routes['GET 10'] = { id: '10', name: 'LTO', status: 'ACTIVE', effective_status: 'ACTIVE' }
  const ads = await request('GET', '/api/meta/campanas?cuenta=act_111&nivel=anuncio&campana=10')
  assert.equal(ads.status, 200, ads.text)
  assert.equal(ads.body.nivel, 'anuncio')
  assert.equal(ads.body.padre.nombre, 'LTO')
  assert.deepEqual(ads.body.filas[0].padres, { campana: { id: '10', nombre: 'LTO' }, conjunto: { id: '20', nombre: 'Grupo' } })
  assert.equal((await request('GET', '/api/meta/campanas?cuenta=act_111&nivel=cuenta')).status, 400)
})

test('varias opciones de texto (las del Administrador de anuncios): se leen y se vuelven a mandar todas', async () => {
  const { creativeBody } = await import('../anuncios.mjs')
  const c = contentOf({
    object_story_spec: {
      page_id: '222',
      video_data: { video_id: '905', image_hash: 'ccc333', call_to_action: { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } } },
    },
    asset_feed_spec: { bodies: [{ text: 'Uno' }, { text: 'Dos' }], titles: [{ text: 'T1' }], descriptions: [], optimization_type: 'DEGREES_OF_FREEDOM' },
  })
  assert.equal(c.editable, true)
  assert.equal(c.ajustes.texto, 'Uno')
  assert.equal(c.ajustes.titular, 'T1')
  assert.deepEqual(c.ajustes.variantes, { textos: ['Dos'], titulos: [], descripciones: [] })
  assert.deepEqual(c.miniaturas, [['905', 'ccc333']])

  const plan = { ...c.ajustes, variantes: { textos: ['Dos', 'Tres'], titulos: ['T2'], descripciones: [] }, cuenta: 'act_111', mejoras: [], anuncios: [] }
  const body = creativeBody(plan, { nombre: 'A', medio: c.versiones[0].medio }, { thumbs: new Map(c.miniaturas) })
  assert.deepEqual(body.asset_feed_spec, {
    bodies: [{ text: 'Uno' }, { text: 'Dos' }, { text: 'Tres' }],
    titles: [{ text: 'T1' }, { text: 'T2' }],
    optimization_type: 'DEGREES_OF_FREEDOM',
  })
  assert.equal(body.object_story_spec.video_data.message, undefined, 'los textos van solo en asset_feed_spec')
  assert.equal(body.object_story_spec.video_data.video_id, '905')
  // Sin variantes, como siempre.
  const single = creativeBody({ ...plan, variantes: { textos: [], titulos: [], descripciones: [] } }, { nombre: 'A', medio: c.versiones[0].medio }, { thumbs: new Map(c.miniaturas) })
  assert.equal(single.asset_feed_spec, undefined)
  assert.equal(single.object_story_spec.video_data.message, 'Uno')
})
