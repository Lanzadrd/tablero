// Las empresas de «Hoy»: qué cuentas van juntas y qué se enseña de cada una.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accountView, companiesOf, resultText } from '../empresas.mjs'

const account = (id, nombre, extra = {}) => ({ id, nombre, moneda: 'USD', activa: true, ...extra })

test('empresas: los portfolios de Meta con sus cuentas activas; las sueltas, al final', () => {
  const meta = [
    { id: 'sin-portfolio', nombre: 'Sin portfolio', foto: null, cuentas: [account('act_9', 'Personal')] },
    { id: 'b1', nombre: 'Hoplon Club ', foto: 'h.png', cuentas: [account('act_1', 'Hoplon ad account'), account('act_2', 'Vieja', { activa: false })] },
    { id: 'b2', nombre: 'Cerrada', foto: null, cuentas: [account('act_3', 'Nada', { activa: false })] },
  ]
  assert.deepEqual(companiesOf({ meta }), [
    { id: 'b1', nombre: 'Hoplon Club', foto: 'h.png', cuentas: [{ plataforma: 'meta', id: 'act_1', nombre: 'Hoplon ad account', moneda: 'USD' }] },
    { id: 'sin-portfolio', nombre: 'Sin portfolio', foto: null, cuentas: [{ plataforma: 'meta', id: 'act_9', nombre: 'Personal', moneda: 'USD' }] },
  ])
  assert.deepEqual(companiesOf(), [])
})

test('empresas: cada cuenta de Google Ads, con la empresa que es suya', () => {
  const meta = [
    { id: 'b1', nombre: 'Acme Studio', foto: null, cuentas: [account('act_1', 'Acme')] },
    { id: 'b2', nombre: 'Hoplon Club', foto: null, cuentas: [account('act_2', 'Hoplon ad account')] },
    // Una cuenta desactivada que se llama como otra empresa no se la lleva.
    { id: 'b3', nombre: 'Viajes del Sur', foto: null, cuentas: [account('act_3', 'Hoplon Club', { activa: false }), account('act_4', 'Sur')] },
    { id: 'b4', nombre: 'Academia Norte', foto: null, cuentas: [account('act_5', 'Internos')] },
  ]
  const google = [
    {
      id: 'sin-administrador',
      nombre: 'Sin administrador',
      foto: null,
      cuentas: [account('1', 'Acme'), account('2', 'Otra marca'), account('3', 'Hoplon Club'), account('4', 'Suelta'), account('5', 'De prueba', { prueba: true }), account('6', 'ACADEMIA norte – Búsqueda')],
    },
    { id: 'mcc-7', nombre: 'Agencia', foto: null, cuentas: [account('8', 'Cliente A'), account('9', 'Cliente B')] },
  ]
  const summaries = [{ meta: ['act_4'], google: ['2'] }, { meta: [], google: ['4'] }]
  const of = (name) => companiesOf({ meta, google, summaries }).find((c) => c.nombre === name)?.cuentas.map((a) => `${a.plataforma}:${a.nombre}`)
  // Por una cuenta de Meta que se llama igual.
  assert.deepEqual(of('Acme Studio'), ['meta:Acme', 'google:Acme'])
  // Por el nombre de la empresa.
  assert.deepEqual(of('Hoplon Club'), ['meta:Hoplon ad account', 'google:Hoplon Club'])
  // Por compartir resumen diario.
  assert.deepEqual(of('Viajes del Sur'), ['meta:Sur', 'google:Otra marca'])
  // Por empezar igual (sin tildes ni mayúsculas).
  assert.deepEqual(of('Academia Norte'), ['meta:Internos', 'google:ACADEMIA norte – Búsqueda'])
  // Sin nada en común: sola. Las de un administrador, juntas con su nombre. Las de prueba, no salen.
  assert.deepEqual(of('Suelta'), ['google:Suelta'])
  assert.deepEqual(of('Agencia'), ['google:Cliente A', 'google:Cliente B'])
  assert.equal(of('De prueba'), undefined)
  assert.deepEqual(
    companiesOf({ meta, google, summaries }).map((c) => c.id),
    ['b1', 'b2', 'b3', 'b4', 'google-4', 'google-mcc-7'],
  )
})

const row = (id, nombre, metricas, extra = {}) => ({ id, nombre, estado: 'activa', entrega: { texto: 'Activa', tono: 'ok' }, metricas, ...extra })

test('una cuenta de Meta: las campañas activas o con gasto, lo que hay que mirar primero y lo que busca cada una', () => {
  const view = accountView(
    {
      moneda: 'USD',
      totales: { gasto: 45.2, conversaciones: 38, coste: 1.19, leads: 4, costeLead: 3 },
      filas: [
        row('1', 'Eventos', { gasto: 15, conversaciones: 13, coste: 1.15 }),
        row('2', 'San Valentín', { gasto: 30, conversaciones: 25, coste: 1.2 }),
        row('3', 'Web', { gasto: 0.2, leads: 4, costeLead: 3 }, { resultado: 'leads' }),
        row('4', 'Parada con gasto', { gasto: 5, conversaciones: 0, coste: null }, { estado: 'pausada', entrega: { texto: 'En pausa', tono: 'off' } }),
        row('5', 'Parada sin gasto', { gasto: 0 }, { estado: 'pausada', entrega: { texto: 'En pausa', tono: 'off' } }),
        row('6', 'Rechazada', { gasto: 0 }, { entrega: { texto: 'Anuncios rechazados', tono: 'warning' } }),
      ],
    },
    'meta',
  )
  assert.deepEqual(
    view.campanas.map((c) => c.nombre),
    ['Rechazada', 'San Valentín', 'Eventos', 'Parada con gasto', 'Web'],
  )
  assert.deepEqual(view.campanas[1], { id: '2', nombre: 'San Valentín', activa: true, tono: 'ok', entrega: 'Activa', gasto: 30, resultado: { tipo: 'conversaciones', cantidad: 25, coste: 1.2 } })
  assert.deepEqual(view.campanas[4].resultado, { tipo: 'leads', cantidad: 4, coste: 3 })
  assert.equal(view.gasto, 45.2)
  assert.equal(view.avisos, 1)
  // De cada cosa que buscan sus campañas, el total de la cuenta.
  assert.deepEqual(view.resultados, [
    { tipo: 'conversaciones', cantidad: 38, coste: 1.19 },
    { tipo: 'leads', cantidad: 4, coste: 3 },
  ])
})

test('una cuenta de Google Ads busca conversiones; sin nada en marcha, no tiene campañas que enseñar', () => {
  const google = accountView({ moneda: 'EUR', totales: { gasto: 12.4, conversiones: 2.5, coste: 4.96 }, filas: [row('1', 'Búsqueda', { gasto: 12.4, conversiones: 2.5, coste: 4.96 })] }, 'google')
  assert.deepEqual(google.resultados, [{ tipo: 'conversiones', cantidad: 2.5, coste: 4.96 }])
  assert.deepEqual(google.campanas[0].resultado, { tipo: 'conversiones', cantidad: 2.5, coste: 4.96 })
  const idle = accountView({ moneda: 'EUR', totales: {}, filas: [row('1', 'Vieja', { gasto: 0 }, { estado: 'pausada' })] }, 'meta')
  assert.deepEqual(idle, { moneda: 'EUR', gasto: 0, resultados: [], campanas: [], avisos: 0 })
})

test('los resultados, con su palabra', () => {
  assert.equal(resultText({ tipo: 'conversaciones', cantidad: 38 }), '38 conversaciones')
  assert.equal(resultText({ tipo: 'conversaciones', cantidad: 1 }), '1 conversación')
  assert.equal(resultText({ tipo: 'leads', cantidad: 1 }), '1 cliente potencial')
  assert.equal(resultText({ tipo: 'leads', cantidad: 0 }), '0 clientes potenciales')
  assert.equal(resultText({ tipo: 'conversiones', cantidad: 2.5 }), '2,5 conversiones')
  assert.equal(resultText({ tipo: 'conversaciones', cantidad: 1389 }), '1.389 conversaciones')
})
