// Resúmenes por WhatsApp: el texto (funciones puras) y el envío con una Meta y un Google de mentira, en una
// carpeta de datos temporal. Nada sale a internet.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, beforeEach, test } from 'node:test'

const dir = await mkdtemp(path.join(os.tmpdir(), 'tablero-resumenes-'))
process.env.TABLERO_DATA_DIR = path.join(dir, 'datos')
const r = await import('../resumenes.mjs')
const { createMeta, WHATSAPP_SCOPES } = await import('../meta.mjs')

after(() => rm(dir, { recursive: true, force: true }))
beforeEach(() => rm(process.env.TABLERO_DATA_DIR, { recursive: true, force: true }))

const TODAY = '2026-10-28'
const NOW = Date.parse('2026-10-28T09:05:00')

const metrics = (gasto, conversaciones = 0, extra = {}) => ({ gasto, conversaciones, clics: 0, ...extra })
const campaign = (id, nombre, m, extra = {}) => ({
  id,
  nombre,
  estado: 'activa',
  entrega: { texto: 'Activa', tono: 'ok' },
  termina: null,
  actualizada: '2026-09-01T10:00:00.000Z',
  metricas: m,
  ...extra,
})
const metaAccount = ({ ayer = [], semana = [], anuncios = [], moneda = 'USD', cuenta = {} } = {}) => {
  const sum = (rows) =>
    rows.reduce(
      (t, { metricas: m }) => ({ gasto: t.gasto + m.gasto, conversaciones: t.conversaciones + m.conversaciones, clics: 0, impresiones: t.impresiones + (m.impresiones ?? 0) }),
      metrics(0, 0, { impresiones: 0 }),
    )
  return {
    cuenta: { id: 'act_1', nombre: 'Hoplon ad account', activa: true, estado: 'activa', ...cuenta },
    ayer: { moneda, totales: sum(ayer), filas: ayer },
    semana: { moneda, totales: sum(semana), filas: semana },
    anuncios: { moneda, filas: anuncios },
  }
}
const summary = (extra = {}) => r.cleanSummary({ nombre: 'Hoplon Club', meta: ['act_1'], ...extra })

// ── Lo que se guarda ──

test('números de WhatsApp: con prefijo de país, sin espacios; si no, null', () => {
  assert.equal(r.phoneOf('+34 600 11 22 33'), '+34600112233')
  assert.equal(r.phoneOf('0034 600-11-22-33'), '+34600112233')
  assert.equal(r.phoneOf('+595 (981) 123 456'), '+595981123456')
  assert.equal(r.phoneOf('600112233'), null)
  assert.equal(r.phoneOf('+0 600'), null)
  assert.equal(r.phoneOf(42), null)
})

test('un resumen limpio: hora, cuentas válidas sin repetir, número y destinos; lo enviado no lo cambia la app', () => {
  const saved = { ultimoEnvio: { dia: TODAY, ok: true }, prueba: { ok: false } }
  const clean = r.cleanSummary(
    {
      id: 'r1',
      nombre: '  Hoplon\nClub ',
      activo: true,
      hora: '25:00',
      meta: ['act_1', 'act_1', 'nada', 7],
      google: ['6283411546', '12'],
      columna: 'col-1',
      numero: { id: '799', cuenta: '139', telefono: '+1 555-010-0199', nombre: 'Hoplon Club' },
      destinos: ['+34 600 11 22 33', '+34600112233'],
      ultimoEnvio: { dia: 'inventado' },
    },
    saved,
  )
  assert.equal(clean.nombre, 'Hoplon Club')
  assert.equal(clean.hora, '09:00')
  assert.deepEqual(clean.meta, ['act_1'])
  assert.deepEqual(clean.google, ['6283411546'])
  assert.deepEqual(clean.destinos, ['+34600112233'])
  assert.equal(clean.numero.id, '799')
  assert.deepEqual(clean.ultimoEnvio, saved.ultimoEnvio)
  assert.deepEqual(clean.prueba, saved.prueba)
  assert.equal(r.cleanSummary({ numero: { id: 'x', cuenta: '1' } }).numero, null)
  assert.throws(() => r.cleanSummary({ destinos: ['600112233'] }), /prefijo del país/)
  assert.throws(() => r.cleanSummary({ destinos: ['+34600000001', '+34600000002', '+34600000003', '+34600000004', '+34600000005', '+34600000006'] }), /Como mucho 5/)
})

// ── La plantilla y el mensaje ──

test('las plantillas cumplen lo que pide Meta: sin variable al principio ni al final ni dos seguidas, pocas variables y cortas', () => {
  for (const kind of Object.keys(r.TEMPLATES)) {
    const body = r.templateText(kind)
    assert.doesNotMatch(body, /^\s*\{\{/)
    assert.doesNotMatch(body, /\}\}\s*$/)
    assert.doesNotMatch(body, /\}\}[\s\p{P}]*\{\{/u)
    assert.doesNotMatch(body, /\n\n\n/)
    const placeholders = body.match(/\{\{\w+\}\}/g)
    const words = body.replace(/\{\{\w+\}\}/g, ' ').split(/\s+/).filter((w) => /\p{L}/u.test(w))
    assert.ok(words.length >= placeholders.length * 3, `${kind}: ${words.length} palabras para ${placeholders.length} variables`)
    assert.ok(body.length <= r.MAX_LENGTH)
    const template = r.templateBody(kind)
    assert.equal(template.name, r.TEMPLATES[kind].name)
    assert.equal(template.category, 'UTILITY')
    assert.equal(template.parameter_format, 'named')
    assert.deepEqual(
      template.components[0].example.body_text_named_params.map((p) => p.param_name),
      placeholders.map((p) => p.slice(2, -2)),
    )
    for (const { example } of template.components[0].example.body_text_named_params) assert.ok(example)
  }
  // Cada bloque solo en la suya.
  assert.doesNotMatch(r.templateText('meta'), /Google/)
  assert.doesNotMatch(r.templateText('google'), /Meta Ads/)
  assert.equal(r.templateKind({ meta: ['act_1'], google: [] }), 'meta')
  assert.equal(r.templateKind({ meta: [], google: ['628'] }), 'google')
  assert.equal(r.templateKind({ meta: ['act_1'], google: ['628'] }), 'meta_google')
  assert.equal(r.templateKind({ meta: [], google: [] }), 'meta')
})

test('el mensaje: a quien va sin «+», con la plantilla de su tipo y cada parámetro por su nombre', () => {
  const params = Object.fromEntries(r.paramsOf('meta_google').map((name, i) => [name, `v${i}`]))
  const body = r.messageBody('+595981123456', params, 'meta_google')
  assert.equal(body.to, '595981123456')
  assert.equal(body.template.name, 'tablero_resumen_meta_google')
  assert.deepEqual(
    body.template.components[0].parameters.map((p) => [p.parameter_name, p.text]),
    Object.entries(params),
  )
})

test('el texto: el gasto de ayer, las conversaciones y el CPM, cada moneda aparte; una línea por cosa', () => {
  const usd = metaAccount({
    ayer: [
      campaign('c1', 'Mensajes', metrics(30.1, 25, { impresiones: 10000 })),
      campaign('c2', 'Tráfico', metrics(15.1, 13, { impresiones: 5000 })),
      campaign('c3', 'Sin gasto', metrics(0), { estado: 'pausada' }),
    ],
  })
  const pyg = { ...metaAccount({ moneda: 'PYG', ayer: [campaign('c9', 'LTO - Mensajes', metrics(300000, 12, { impresiones: 20000 }))] }), cuenta: { id: 'act_2', nombre: 'LTO', activa: true } }
  const params = r.composeSummary({ summary: summary({ meta: ['act_1', 'act_2'] }), metaData: [usd, pyg], today: TODAY, now: NOW })
  assert.deepEqual(Object.keys(params).sort(), r.paramsOf('meta').sort())
  assert.equal(params.empresa, 'Hoplon Club')
  assert.equal(params.dia, 'martes 27 de octubre')
  assert.match(params.meta_gasto, /^45,20\s?US\$ \+ 300\.000\s?PYG$/)
  assert.match(params.meta_conversaciones, /^38 · 1,19\s?US\$ c\/u \| 12 · 25\.000\s?PYG c\/u$/)
  assert.match(params.meta_cpm, /^3,01\s?US\$ \| 15\.000\s?PYG$/)
  assert.equal(params.alertas, 'nada, todo en orden')
  assert.equal(params.tareas, '—')
  for (const value of Object.values(params)) assert.doesNotMatch(value, /[\n\t]| {5}/)
  const message = r.render(params, 'meta')
  assert.match(message, /^Resumen de \*Hoplon Club\* del \*martes 27 de octubre\*\n\n\*Meta Ads - 45,20/)
  assert.match(message, /\n\* Conversaciones: 38 · /)
  // Sin gasto ni impresiones.
  const quiet = r.composeSummary({ summary: summary(), metaData: [metaAccount()], today: TODAY, now: NOW })
  assert.match(quiet.meta_gasto, /^0,00\s?US\$$/)
  assert.equal(quiet.meta_conversaciones, '0')
  assert.equal(quiet.meta_cpm, '—')
})

test('alertas: cuenta, anuncios rechazados, activas sin gasto, las que terminan y las que van peor que su media', () => {
  const data = metaAccount({
    cuenta: { activa: false, estado: 'pago pendiente' },
    ayer: [
      campaign('c1', 'Verano', metrics(20, 2), { termina: '2026-10-29T15:00:00.000Z' }),
      campaign('c2', 'Quieta', metrics(0)),
      campaign('c3', 'Recién activada', metrics(0), { actualizada: '2026-10-28T08:00:00.000Z' }),
      campaign('c4', 'Con anuncio rechazado', metrics(5, 5), { entrega: { texto: 'Con problemas', tono: 'warning' } }),
      campaign('c5', 'Conjuntos parados', metrics(0), { entrega: { texto: 'Conjuntos en pausa', tono: 'warning' } }),
      campaign('c6', 'Sin resultados', metrics(9, 0)),
    ],
    semana: [campaign('c1', 'Verano', metrics(70, 14)), campaign('c6', 'Sin resultados', metrics(40, 10))],
    anuncios: [
      { nombre: 'Promo 2', estado: 'activa', entrega: { texto: 'Rechazado', tono: 'warning' }, padres: { campana: { id: 'c4' } } },
      { nombre: 'Pausado y rechazado', estado: 'pausada', entrega: { texto: 'Rechazado', tono: 'warning' }, padres: { campana: { id: 'c4' } } },
    ],
  })
  const { alertas } = r.composeSummary({ summary: summary(), metaData: [data], today: TODAY, now: NOW })
  const list = alertas.split(' · ')
  assert.deepEqual(list, [
    'cuenta «Hoplon ad account»: pago pendiente',
    'anuncio «Promo 2»: rechazado',
    '«Verano» termina mañana',
    // 10 por conversación ayer, 5 de media: el doble.
    '«Verano»: 10,00 US$ por conversación, 2× su media de 7 días',
    '«Quieta» activa pero ayer no gastó',
    '«Conjuntos parados»: conjuntos en pausa',
    // 9 sin ninguna, con 4 de media: lo de más de dos.
    '«Sin resultados» gastó 9,00 US$ sin ninguna conversación',
  ].map((a) => a.replace(/ US\$/g, ' US$')))
})

test('alertas de Google: lo que no entrega y lo que va peor que su media; y las cuentas que no se han podido leer', () => {
  const google = {
    cuenta: { id: '628', nombre: 'HLM', activa: true },
    ayer: {
      moneda: 'USD',
      totales: { gasto: 12.4, conversiones: 9, clics: 210 },
      filas: [
        campaign('g1', 'Búsqueda', { gasto: 12.4, conversiones: 2, clics: 210 }, { entrega: { texto: 'Limitada por presupuesto', tono: 'warning' } }),
      ],
    },
    semana: { moneda: 'USD', filas: [campaign('g1', 'Búsqueda', { gasto: 30, conversiones: 30 })] },
  }
  const broken = { cuenta: { id: 'act_9', nombre: 'Rota' }, error: 'Meta pide esperar un poco' }
  const params = r.composeSummary({ summary: summary({ google: ['6283411546'] }), metaData: [broken], googleData: [google], today: TODAY, now: NOW })
  assert.deepEqual(Object.keys(params).sort(), r.paramsOf('meta_google').sort())
  assert.match(params.google_gasto, /^12,40\s?US\$$/)
  assert.match(params.google_conversiones, /^9 · 1,38\s?US\$ c\/u$/)
  assert.match(params.google_clics, /^210 · CPC 0,06\s?US\$$/)
  assert.equal(params.meta_gasto, 'no se ha podido leer')
  assert.deepEqual(params.alertas.split(' · '), [
    'no se ha podido leer «Rota» (Meta pide esperar un poco)',
    '«Búsqueda» (Google): limitada por presupuesto',
    '«Búsqueda» (Google): 6,20 US$ por conversión, 6,2× su media de 7 días',
  ])
})

test('tareas de hoy de la columna: primero las de hora, luego las del día y las atrasadas; y los cobros cercanos', () => {
  const board = {
    columns: [
      {
        id: 'col-1',
        name: 'Hoplon Club',
        tasks: [
          { id: 't1', title: 'Revisar cuotas', done: false, due: TODAY, time: null },
          { id: 't2', title: 'Llamar al proveedor', done: false, due: TODAY, time: '10:00' },
          { id: 't3', title: 'Pagar alquiler', done: false, due: '2026-10-20', time: null },
          { id: 't4', title: 'Hecha', done: true, due: TODAY },
          { id: 't5', title: 'Mañana', done: false, due: '2026-10-29' },
          { id: 't6', title: 'Algún día', done: false, due: null, someday: true },
          { id: 't7', title: 'Canva se cobra el 30 oct', done: false, due: '2026-10-30', subscriptionId: 's2', subscriptionCharge: '2026-10-30' },
        ],
      },
      { id: 'col-2', name: 'LTO', tasks: [{ id: 't8', title: 'De otra', done: false, due: TODAY }] },
    ],
    subscriptions: [
      { id: 's1', name: 'Gimnasio', amount: 3500, currency: 'EUR', period: 'month', billingDate: '2026-09-29', columnId: 'col-1' },
      { id: 's2', name: 'Canva', amount: 1299, currency: 'EUR', period: 'month', billingDate: '2026-09-30', columnId: 'col-1' },
      { id: 's3', name: 'Lejos', amount: 100, currency: 'EUR', period: 'month', billingDate: '2026-09-15', columnId: 'col-1' },
    ],
  }
  assert.deepEqual(r.tasksOf(board, 'col-1', TODAY), [
    '10:00 Llamar al proveedor',
    'Revisar cuotas',
    'Pagar alquiler (atrasada)',
    'cobro de Gimnasio (35,00 €) mañana',
  ])
  assert.deepEqual(r.tasksOf(board, 'nada', TODAY), [])
  const params = r.composeSummary({ summary: summary({ meta: [], columna: 'col-2' }), board, today: TODAY, now: NOW })
  assert.equal(params.tareas, 'De otra')
  assert.equal(params.meta_gasto, '—')
  assert.equal(r.composeSummary({ summary: summary({ meta: [], columna: 'col-9' }), board, today: TODAY }).tareas, 'nada para hoy')
})

test('si no cabe en 1024 caracteres, se quitan las últimas de la lista más larga («y N más»)', () => {
  const lists = {
    alertas: Array.from({ length: 40 }, (_, i) => `alerta número ${i + 1} con bastante texto para que ocupe`),
    tareas: Array.from({ length: 10 }, (_, i) => `tarea ${i + 1}`),
  }
  const params = r.fitParams({ empresa: 'X', dia: 'hoy', meta_gasto: '—', meta_conversaciones: '—', meta_cpm: '—' }, lists)
  const message = r.render(params, 'meta')
  assert.ok(message.length <= r.MAX_LENGTH, String(message.length))
  assert.match(params.alertas, / · y \d+ más$/)
  assert.equal(params.tareas, lists.tareas.join(' · '))
  // Una sola cosa enorme: se corta.
  const huge = r.fitParams({ empresa: 'X'.repeat(2000), dia: 'hoy' }, { alertas: [], tareas: [] })
  assert.ok(r.render(huge, 'meta').length <= r.MAX_LENGTH)
  assert.match(huge.empresa, /…$/)
})

test('cuándo toca: activo, con número y destinos, pasada su hora; una vez al día y reintentos si falla', () => {
  const base = { activo: true, hora: '09:00', numero: { id: '1', cuenta: '2' }, destinos: ['+34600112233'], ultimoEnvio: null }
  const at = (time) => new Date(`2026-10-28T${time}:00`)
  assert.equal(r.isDue(base, at('08:59')), false)
  assert.equal(r.isDue(base, at('09:00')), true)
  assert.equal(r.isDue({ ...base, activo: false }, at('10:00')), false)
  assert.equal(r.isDue({ ...base, destinos: [] }, at('10:00')), false)
  assert.equal(r.isDue({ ...base, numero: null }, at('10:00')), false)
  assert.equal(r.isDue({ ...base, ultimoEnvio: { dia: TODAY, ok: true, en: '2026-10-28T09:00:00' } }, at('10:00')), false)
  assert.equal(r.isDue({ ...base, ultimoEnvio: { dia: '2026-10-27', ok: true, en: '2026-10-27T09:00:00' } }, at('10:00')), true)
  const failed = { dia: TODAY, ok: false, intentos: 1, en: at('09:00').toISOString() }
  assert.equal(r.isDue({ ...base, ultimoEnvio: failed }, at('09:20')), false)
  assert.equal(r.isDue({ ...base, ultimoEnvio: failed }, at('09:31')), true)
  assert.equal(r.isDue({ ...base, ultimoEnvio: { ...failed, intentos: 3 } }, at('12:00')), false)
})

test('los errores de WhatsApp que más salen, explicados por su código', () => {
  const err = (code, message = 'x') => Object.assign(new Error(message), { meta: { code } })
  assert.match(r.whatsappError(err(132001)), /plantilla no está aprobada/)
  assert.match(r.whatsappError(err(131042)), /forma de pago/)
  assert.match(r.whatsappError(err(200, 'Permissions error')), /Falta el permiso de WhatsApp.*Permissions error/)
  assert.equal(r.whatsappError(err(1, 'Otra cosa')), 'Otra cosa')
})

// ── Con Meta y Google de mentira ──

function fakes({ fail = null } = {}) {
  const sent = []
  const meta = {
    portfolios: async () => [{ id: 'b1', nombre: 'Hoplon Club', cuentas: [{ id: 'act_1', nombre: 'Hoplon ad account', activa: true, estado: 'activa' }] }],
    performance: async (id, { period, level }) => {
      const data = metaAccount({ ayer: [campaign('c1', 'Mensajes', metrics(30.1, 25))] })
      return level === 'anuncio' ? data.anuncios : period === 'ayer' ? data.ayer : data.semana
    },
    graph: async (pathname, { method = 'GET', body } = {}) => {
      if (method === 'POST' && pathname.endsWith('/messages')) {
        if (fail?.(body.to)) throw Object.assign(new Error('(#131026) Message undeliverable'), { status: 502, meta: { code: 131026 } })
        sent.push({ from: pathname.split('/')[0], ...body })
        return { messages: [{ id: `wamid.${sent.length}` }] }
      }
      throw new Error(`Sin ruta: ${method} ${pathname}`)
    },
  }
  const google = { accounts: async () => [], performance: async () => ({ moneda: 'USD', totales: {}, filas: [] }) }
  return { meta, google, sent }
}

async function saveOne(extra = {}) {
  const [saved] = await r.saveSummaries([
    { id: 'r1', nombre: 'Hoplon Club', activo: true, hora: '09:00', meta: ['act_1'], numero: { id: '799', cuenta: '139' }, destinos: ['+34600112233'], ...extra },
  ])
  return saved
}

test('envío de cada día: una vez, a cada destino, y apuntado; el de «Enviar ahora» va aparte', async () => {
  await saveOne({ destinos: ['+34600112233', '+595981123456'] })
  const { meta, google, sent } = fakes()
  let now = NOW
  const summaries = r.createSummaries({ meta, google, now: () => now })

  const [result] = await summaries.runDue()
  assert.equal(result.ok, true)
  assert.deepEqual(sent.map((m) => [m.from, m.to]), [
    ['799', '34600112233'],
    ['799', '595981123456'],
  ])
  assert.equal(sent[0].template.name, 'tablero_resumen_meta')
  assert.match(sent[0].template.components[0].parameters.find((p) => p.parameter_name === 'meta_conversaciones').text, /^25 · 1,20\s?US\$ c\/u$/)
  assert.deepEqual(await summaries.runDue(), [])
  const [stored] = await summaries.list()
  assert.equal(stored.ultimoEnvio.dia, TODAY)
  assert.match(stored.ultimoEnvio.texto, /^Resumen de \*Hoplon Club\* del \*martes 27 de octubre\*\n/)

  // «Enviar ahora»: a todos, sin tocar el de cada día.
  const manual = await summaries.send('r1', { manual: true })
  assert.equal(manual.ok, true)
  assert.equal(sent.length, 4)
  const [after] = await summaries.list()
  assert.equal(after.prueba.ok, true)
  assert.deepEqual(after.ultimoEnvio, stored.ultimoEnvio)

  // Al día siguiente, otra vez.
  now = Date.parse('2026-10-29T09:10:00')
  assert.equal((await summaries.runDue()).length, 1)
  assert.equal(sent.length, 6)
})

test('si falla un destino, se apunta el error y al reintentar solo va a los que faltan', async () => {
  await saveOne({ destinos: ['+34600112233', '+595981123456'] })
  let failing = true
  const { meta, google, sent } = fakes({ fail: (to) => failing && to === '595981123456' })
  let now = NOW
  const summaries = r.createSummaries({ meta, google, now: () => now })
  const [first] = await summaries.runDue()
  assert.equal(first.ok, false)
  assert.match(first.error, /\+595981123456: Ese número no tiene WhatsApp/)
  assert.deepEqual(first.enviados, ['+34600112233'])
  // Antes de media hora, no se reintenta.
  now += 10 * 60_000
  assert.deepEqual(await summaries.runDue(), [])
  now += 25 * 60_000
  failing = false
  const [second] = await summaries.runDue()
  assert.equal(second.ok, true)
  assert.equal(second.intentos, 2)
  assert.deepEqual(sent.map((m) => m.to), ['34600112233', '595981123456'])
})

test('sin número o sin destinos no se manda; y lo que no existe, 404', async () => {
  const { meta, google } = fakes()
  const summaries = r.createSummaries({ meta, google, now: () => NOW })
  await saveOne({ numero: null })
  await assert.rejects(summaries.send('r1', { manual: true }), /desde qué número/)
  await saveOne({ destinos: [] })
  await assert.rejects(summaries.send('r1', { manual: true }), /al menos un número/)
  await assert.rejects(summaries.send('otro', { manual: true }), /ya no existe/)
})

test('las tareas salen del tablero guardado', async () => {
  await mkdir(process.env.TABLERO_DATA_DIR, { recursive: true })
  const board = { columns: [{ id: 'col-1', name: 'Hoplon Club', tasks: [{ id: 't1', title: 'Llamar', done: false, due: TODAY, time: '11:30' }] }] }
  await writeFile(path.join(process.env.TABLERO_DATA_DIR, 'board.json'), JSON.stringify({ rev: 1, board }))
  const { meta, google } = fakes()
  const summaries = r.createSummaries({ meta, google, now: () => NOW })
  const preview = await summaries.preview(r.cleanSummary({ nombre: 'Hoplon Club', meta: [], columna: 'col-1' }))
  assert.equal(preview.parametros.tareas, '11:30 Llamar')
  assert.match(preview.texto, /\*Tareas de hoy:\* 11:30 Llamar/)
})

test('números y plantillas: los de cada portfolio, con el estado de la plantilla; crearla si ya existe no falla', async () => {
  const posts = []
  const meta = {
    graph: async (pathname, { method = 'GET', params = {}, body } = {}) => {
      if (pathname === 'me/businesses') return { data: [{ id: 'b1', name: 'Hoplon Club' }, { id: 'b2', name: 'Sin WhatsApp' }] }
      if (pathname === 'b1/owned_whatsapp_business_accounts') {
        return { data: [{ id: '139', name: 'Hoplon', phone_numbers: { data: [{ id: '799', display_phone_number: '+1 555-010-0199', verified_name: 'Hoplon Club', status: 'CONNECTED' }] } }] }
      }
      if (pathname === 'b1/client_whatsapp_business_accounts') return { data: [{ id: '139', name: 'Hoplon' }] }
      if (pathname.startsWith('b2/')) return { data: [] }
      if (pathname === '139/message_templates' && method === 'GET') {
        return {
          data: [
            { name: 'tablero_resumen_meta', language: 'es', status: 'PENDING', rejected_reason: 'NONE', category: 'UTILITY' },
            { name: 'tablero_resumen_google', language: 'es', status: 'REJECTED', rejected_reason: 'INVALID_FORMAT', category: 'UTILITY' },
            { name: 'otra', language: 'es', status: 'APPROVED' },
          ],
        }
      }
      if (pathname === '139/message_templates' && method === 'POST') {
        posts.push(body)
        throw Object.assign(new Error('Ya existe'), { status: 502, meta: { code: 100, subcode: 2388024 } })
      }
      throw new Error(`Sin ruta: ${method} ${pathname}`)
    },
  }
  const summaries = r.createSummaries({ meta, google: {} })
  const empresas = await summaries.numbers()
  assert.deepEqual(empresas, [
    {
      id: 'b1',
      nombre: 'Hoplon Club',
      error: null,
      cuentas: [
        {
          id: '139',
          nombre: 'Hoplon',
          plantillas: {
            meta: { estado: 'PENDING', motivo: null, categoria: 'UTILITY' },
            google: { estado: 'REJECTED', motivo: 'INVALID_FORMAT', categoria: 'UTILITY' },
            meta_google: { estado: null },
          },
          numeros: [{ id: '799', telefono: '+1 555-010-0199', nombre: 'Hoplon Club', estado: 'CONNECTED' }],
        },
      ],
    },
  ])
  assert.deepEqual(await summaries.createTemplate('139', 'meta'), { estado: 'PENDING', motivo: null, categoria: 'UTILITY' })
  assert.equal(posts[0].name, 'tablero_resumen_meta')
  await assert.rejects(summaries.createTemplate('../x', 'meta'), /no válida/)
  await assert.rejects(summaries.createTemplate('139', 'otra'), /no válido/)
})

test('conectar: los permisos de WhatsApp solo al pedirlos (y luego siempre, si se dieron)', async () => {
  const meta = createMeta({ fetch: async () => new Response('{}') })
  await meta.saveApp({ id: '1234567890', secreto: 'a'.repeat(32) })
  const scopes = async (options) => new URL(await meta.connectUrl('localhost:4747', options)).searchParams.get('scope').split(',')
  assert.ok(!(await scopes()).includes('whatsapp_business_messaging'))
  const withWhatsapp = await scopes({ whatsapp: true })
  for (const p of WHATSAPP_SCOPES) assert.ok(withWhatsapp.includes(p))
  assert.ok(withWhatsapp.includes('ads_management'))
  // Ya dados: al volver a conectar se piden otra vez (si no, se perderían).
  const file = path.join(process.env.TABLERO_DATA_DIR, 'meta.json')
  const store = JSON.parse(await readFile(file, 'utf8'))
  await writeFile(file, JSON.stringify({ ...store, token: 'x', permisos: ['ads_management', ...WHATSAPP_SCOPES] }))
  for (const p of WHATSAPP_SCOPES) assert.ok((await scopes()).includes(p))
  assert.equal((await meta.status()).whatsapp, true)
})
