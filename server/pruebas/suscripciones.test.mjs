// Suscripciones: las cuentas compartidas (server/suscripciones.mjs: cobros, importes, avisos), y
// en la app la lectura del tablero (src/model.ts), los cambios (src/subscriptions.ts) y la fusión
// (src/merge.ts). Los módulos de src/ son TypeScript sin dependencias: Node los ejecuta quitando los tipos.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addDays,
  applyReminders,
  chargeAfter,
  chargesBetween,
  formatMoney,
  hasCardNumber,
  isDay,
  isPeriod,
  monthlyAmount,
  parseMoney,
  periodLabel,
  periodUnit,
  remindersDue,
  totals,
  yearlyAmount,
} from '../suscripciones.mjs'

const ts = Boolean(process.features.typescript)
const load = async (file) => (ts ? import(new URL(`../../src/${file}`, import.meta.url).href) : null)
const model = await load('model.ts')
const subs = await load('subscriptions.ts')
const merge = await load('merge.ts')
const opts = { skip: ts ? false : 'Este Node no ejecuta TypeScript' }

const HOY = '2026-10-07' // miércoles
/** Intl separa la cifra y el símbolo con un espacio duro: aquí, uno normal. */
const plain = (text) => text.replace(/\s/g, ' ')

const sub = (id, extra = {}) => ({
  id,
  name: id,
  amount: 1000,
  currency: 'EUR',
  period: 'month',
  billingDate: '2026-09-15',
  cardId: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  ...extra,
})
const task = (id, extra = {}) => ({
  id,
  title: id,
  notes: '',
  done: false,
  createdAt: '2026-10-01T10:00:00.000Z',
  completedAt: null,
  due: null,
  time: null,
  ...extra,
})
const column = (id, tasks = [], extra = {}) => ({ id, name: id, color: 'blue', showCompleted: false, tasks, ...extra })

function board() {
  return {
    columns: [
      column('bandeja', [task('a'), task('b', { done: true, completedAt: '2026-10-01T11:00:00.000Z' })], { name: 'Bandeja', inbox: true }),
      column('personal', [task('p')]),
    ],
    cards: [
      { id: 'bbva', name: 'BBVA', color: 'blue' },
      { id: 'revolut', name: 'Revolut', color: 'purple' },
    ],
    subscriptions: [
      sub('netflix', { name: 'Netflix', amount: 1299, billingDate: '2026-09-15', cardId: 'bbva', remind: 1 }),
      sub('icloud', { name: 'iCloud+', amount: 299, billingDate: '2026-08-08', cardId: 'revolut' }),
      sub('chatgpt', { name: 'ChatGPT', amount: 2000, currency: 'USD', billingDate: '2026-10-20' }),
      sub('spotify', { name: 'Spotify', amount: 1099, cardId: 'bbva', cancelledOn: '2026-09-30' }),
    ],
  }
}
const allTasks = (b) => b.columns.flatMap((c) => c.tasks)

// ── Periodicidad y cobros ──

test('periodicidades: lista, nombre y unidad', () => {
  assert.deepEqual(
    ['week', 'month', 'quarter', 'half', 'year'].map((p) => [isPeriod(p), periodLabel(p), periodUnit(p)]),
    [
      [true, 'Semanal', 'semana'],
      [true, 'Mensual', 'mes'],
      [true, 'Trimestral', 'trimestre'],
      [true, 'Semestral', 'semestre'],
      [true, 'Anual', 'año'],
    ],
  )
  assert.equal(isPeriod('day'), false)
})

test('chargeAfter mensual: el 31 pasa al último día de los meses cortos y no deriva', () => {
  const s = sub('x', { billingDate: '2026-01-31' })
  assert.equal(chargeAfter(s, '2026-01-31'), '2026-01-31', 'el mismo día cuenta')
  assert.equal(chargeAfter(s, '2026-02-01'), '2026-02-28')
  assert.equal(chargeAfter(s, '2026-03-01'), '2026-03-31', 'después de febrero vuelve al 31')
  assert.equal(chargeAfter(s, '2026-04-15'), '2026-04-30')
  assert.equal(chargeAfter(s, '2026-05-01'), '2026-05-31')
  assert.equal(chargeAfter(sub('x', { billingDate: '2028-01-31' }), '2028-02-01'), '2028-02-29', 'bisiesto')
  // Muy atrás: se calcula directamente, sin recorrer todos los meses.
  assert.equal(chargeAfter(sub('x', { billingDate: '2000-01-15' }), HOY), '2026-10-15')
})

test('chargeAfter anual (29 feb), trimestral, semestral y semanal', () => {
  const bisiesto = sub('x', { period: 'year', billingDate: '2024-02-29' })
  assert.equal(chargeAfter(bisiesto, '2024-03-01'), '2025-02-28')
  assert.equal(chargeAfter(bisiesto, '2027-03-01'), '2028-02-29')
  assert.equal(chargeAfter(sub('x', { period: 'quarter', billingDate: '2026-01-31' }), '2026-02-01'), '2026-04-30')
  assert.equal(chargeAfter(sub('x', { period: 'quarter', billingDate: '2026-01-31' }), '2026-05-01'), '2026-07-31')
  assert.equal(chargeAfter(sub('x', { period: 'half', billingDate: '2025-08-31' }), '2026-01-01'), '2026-02-28')
  const semanal = sub('x', { period: 'week', billingDate: '2026-10-01' }) // jueves
  assert.equal(chargeAfter(semanal, HOY), '2026-10-08')
  assert.equal(chargeAfter(semanal, '2026-10-08'), '2026-10-08')
  assert.equal(chargeAfter(semanal, '2026-10-09'), '2026-10-15')
  // Con cambio de hora por medio (29 mar 2026) no se mueve ningún día.
  assert.equal(chargeAfter(sub('x', { period: 'week', billingDate: '2026-03-26' }), '2026-04-01'), '2026-04-02')
})

test('chargeAfter: con el cobro en el futuro, ese; dada de baja o sin fecha, null', () => {
  assert.equal(chargeAfter(sub('x', { billingDate: '2026-12-01', period: 'year' }), HOY), '2026-12-01')
  assert.equal(chargeAfter(sub('x', { cancelledOn: '2026-10-01' }), HOY), null)
  assert.equal(chargeAfter(sub('x', { billingDate: 'pronto' }), HOY), null)
})

test('chargesBetween: los cobros del intervalo, ambos días incluidos', () => {
  assert.deepEqual(chargesBetween(sub('x', { billingDate: '2026-01-31' }), '2026-01-01', '2026-06-30'), [
    '2026-01-31',
    '2026-02-28',
    '2026-03-31',
    '2026-04-30',
    '2026-05-31',
    '2026-06-30',
  ])
  assert.deepEqual(chargesBetween(sub('x', { period: 'week', billingDate: '2026-10-01' }), '2026-10-08', '2026-10-22'), [
    '2026-10-08',
    '2026-10-15',
    '2026-10-22',
  ])
  assert.deepEqual(chargesBetween(sub('x', { period: 'year', billingDate: '2026-12-01' }), HOY, '2026-11-30'), [])
  assert.deepEqual(chargesBetween(sub('x', { cancelledOn: HOY }), HOY, '2027-10-07'), [])
  assert.equal(chargesBetween(sub('x', { period: 'week' }), '2000-01-01', '2100-01-01', { max: 5 }).length, 5)
})

// ── Importes ──

test('monthlyAmount: semanal ×52/12, trimestral /3, semestral /6, anual /12 (sin redondear)', () => {
  assert.equal(monthlyAmount(sub('x', { amount: 1299 })), 1299)
  assert.equal(monthlyAmount(sub('x', { amount: 1200, period: 'week' })), 5200)
  assert.equal(monthlyAmount(sub('x', { amount: 3000, period: 'quarter' })), 1000)
  assert.equal(monthlyAmount(sub('x', { amount: 6000, period: 'half' })), 1000)
  assert.equal(monthlyAmount(sub('x', { amount: 9999, period: 'year' })), 833.25)
  assert.equal(yearlyAmount(sub('x', { amount: 9999, period: 'year' })), 9999)
  assert.equal(yearlyAmount(sub('x', { amount: 100, period: 'week' })), 5200)
})

test('totals: por moneda (nunca se suman), solo las activas, y por tarjeta', () => {
  const list = board().subscriptions
  assert.deepEqual(totals(list), {
    EUR: { monthly: 1598, yearly: 19176, count: 2 },
    USD: { monthly: 2000, yearly: 24000, count: 1 },
  })
  assert.deepEqual(totals(list, { cardId: 'bbva' }), { EUR: { monthly: 1299, yearly: 15588, count: 1 } })
  assert.deepEqual(totals(list, { cardId: null }), { USD: { monthly: 2000, yearly: 24000, count: 1 } })
  assert.deepEqual(totals(list, { cardId: 'nada' }), {})
  assert.deepEqual(totals(undefined), {})
  // Una anual: el total del año sale exacto.
  assert.deepEqual(totals([sub('x', { amount: 9999, period: 'year' })]).EUR, { monthly: 833.25, yearly: 9999, count: 1 })
})

test('formatMoney: «12,99 €», con su símbolo y redondeando al céntimo', () => {
  assert.equal(plain(formatMoney(1299, 'EUR')), '12,99 €')
  assert.equal(plain(formatMoney(1299)), '12,99 €')
  assert.equal(plain(formatMoney(2000, 'USD')), '20,00 $')
  assert.equal(plain(formatMoney(999, 'GBP')), '9,99 £')
  assert.equal(plain(formatMoney(1234567, 'EUR')), '12.345,67 €')
  assert.equal(plain(formatMoney(833.25, 'EUR')), '8,33 €')
  assert.equal(plain(formatMoney(0, 'EUR')), '0,00 €')
})

test('parseMoney: coma o punto decimal, miles, símbolo; null si no se entiende', () => {
  const casos = {
    '12,99': 1299,
    '12.99': 1299,
    '1.299,00': 129900,
    '1,299.00': 129900,
    '1.299': 129900,
    '1 299,00': 129900,
    9: 900,
    '€ 9,5': 950,
    '9,99 €': 999,
    '9.99 EUR': 999,
    '$20': 2000,
    ',5': 50,
    '12,': 1200,
    0: 0,
  }
  for (const [text, cents] of Object.entries(casos)) assert.equal(parseMoney(text), cents, text)
  for (const text of ['', '  ', 'abc', '-5', '12 99', '1.2.3', '1.299.00', '12.3456', '1e5', '12,99,00']) {
    assert.equal(parseMoney(text), null, text)
  }
  assert.equal(parseMoney(null), null)
})

test('hasCardNumber: 6 cifras o más, las separe lo que las separe; las 4 últimas valen', () => {
  for (const name of [
    '4111 1111 1111 1111',
    '4111-1111-1111-1111',
    '4111 – 1111',
    'Visa 411111',
    'Visa4111111111111111',
    '12 34 56',
    'BBVA 1234 5678',
    '4111.1111.1111.1111',
    '4111/1111/1111/1111',
    '4111·1111·1111·1111',
    '4111,1111,1111,1111',
    '4111_1111_1111_1111',
    'Visa ··4111 ··1111 ··1111 ··1111',
    'Visa/4111/1111',
    'N26 4111 1111',
  ]) {
    assert.equal(hasCardNumber(name), true, name)
  }
  for (const name of ['BBVA', 'BBVA ··1234', 'N26 ··1234', 'Revolut 12345', 'N26', 'B2B ··1234', 'Tarjeta 2 de 3', '']) {
    assert.equal(hasCardNumber(name), false, name)
  }
  assert.equal(hasCardNumber(undefined), false)
})

test('isDay: un día real desde 1900; las cuentas no confunden los años de dos cifras', () => {
  assert.equal(isDay('2026-10-14'), true)
  assert.equal(isDay('2028-02-29'), true)
  assert.equal(isDay('2026-02-29'), false)
  // Un año a medio escribir en el campo de fecha (2028 → 0002, 0020, 0202) no es un cobro.
  for (const day of ['0002-10-07', '0026-10-14', '0202-10-07', '1899-12-31']) assert.equal(isDay(day), false, day)
  // Date.UTC lleva los años 0–99 a 1900–1999: aquí no.
  assert.equal(addDays('0026-10-14', 7), '0026-10-21')
  assert.equal(addDays('2026-10-14', 7), '2026-10-21')
})

// ── Avisos antes del cobro ──

test('remindersDue: solo desde 2 días antes del día del aviso', () => {
  // Netflix: cobro el 15 oct, aviso 1 día antes (14 oct) → toca desde el 12.
  assert.deepEqual(remindersDue(board(), '2026-10-11'), [])
  const [due] = remindersDue(board(), '2026-10-12')
  assert.equal(due.subscription.id, 'netflix')
  assert.equal(due.charge, '2026-10-15')
  assert.equal(due.due, '2026-10-14')
  // Sin aviso, dada de baja o «el mismo día» lejos: nada.
  assert.deepEqual(remindersDue(board(), '2026-10-12').map((d) => d.subscription.id), ['netflix'])
})

test('applyReminders: la tarea en la Bandeja, con su título, y una sola vez', () => {
  const b = board()
  let n = 0
  const created = applyReminders(b, '2026-10-12', { newId: () => `aviso-${++n}`, now: '2026-10-12T08:00:00.000Z' })
  assert.equal(created, 1)
  const inbox = b.columns[0].tasks
  assert.deepEqual(inbox.map((t) => t.id), ['a', 'aviso-1', 'b'], 'detrás de la última pendiente')
  assert.deepEqual({ ...inbox[1], title: plain(inbox[1].title) }, {
    id: 'aviso-1',
    title: 'Netflix se cobra el 15 oct · 12,99 € · BBVA',
    notes: '',
    done: false,
    createdAt: '2026-10-12T08:00:00.000Z',
    completedAt: null,
    due: '2026-10-14',
    time: null,
    subscriptionId: 'netflix',
    subscriptionCharge: '2026-10-15',
  })
  assert.equal('alerts' in inbox[1], false, 'los avisos de por defecto: ese día a las 9:00')
  assert.equal(b.subscriptions[0].remindedFor, '2026-10-15')

  // Otra vez (el mismo día o al siguiente): nada nuevo.
  assert.equal(applyReminders(b, '2026-10-12', { newId: () => 'otra' }), 0)
  assert.equal(applyReminders(b, '2026-10-13', { newId: () => 'otra' }), 0)
  // Aunque se pierda remindedFor, la tarea ya está.
  delete b.subscriptions[0].remindedFor
  assert.equal(applyReminders(b, '2026-10-13', { newId: () => 'otra' }), 0)
  // Y si el usuario borra la tarea, remindedFor evita que vuelva.
  b.subscriptions[0].remindedFor = '2026-10-15'
  b.columns[0].tasks.splice(1, 1)
  assert.equal(applyReminders(b, '2026-10-14', { newId: () => 'otra' }), 0)
  assert.deepEqual(allTasks(b).map((t) => t.id), ['a', 'b', 'p'])

  // El cobro siguiente tiene su propio aviso.
  assert.equal(applyReminders(b, '2026-11-12', { newId: () => 'aviso-nov' }), 1)
  const nov = allTasks(b).find((t) => t.id === 'aviso-nov')
  assert.equal(plain(nov.title), 'Netflix se cobra el 15 nov · 12,99 € · BBVA')
  assert.equal(b.subscriptions[0].remindedFor, '2026-11-15')
})

test('applyReminders: si el Mac estuvo apagado, el aviso es para hoy; si el cobro ya pasó, nada', () => {
  const tarde = board()
  assert.equal(applyReminders(tarde, '2026-10-15', { newId: () => 'hoy' }), 1)
  const t = allTasks(tarde).find((x) => x.id === 'hoy')
  assert.equal(t.due, '2026-10-15')
  assert.match(plain(t.title), /se cobra el 15 oct/)

  const pasado = board()
  assert.equal(applyReminders(pasado, '2026-10-16', { newId: () => 'x' }), 0, 'el siguiente cobro (15 nov) aún queda lejos')
  assert.equal(pasado.subscriptions[0].remindedFor, undefined)
})

test('applyReminders: sin tarjeta, otra moneda, el mismo día y cambio de año', () => {
  const b = { columns: [column('bandeja', [], { inbox: true })], subscriptions: [sub('gpt', { name: 'ChatGPT', amount: 2000, currency: 'USD', billingDate: '2027-01-05', remind: 0 })] }
  assert.equal(applyReminders(b, '2027-01-02', { newId: () => 'pronto' }), 0)
  assert.equal(applyReminders(b, '2026-12-30', { newId: () => 'pronto' }), 0)
  assert.equal(applyReminders(b, '2027-01-03', { newId: () => 'gpt-1' }), 1)
  const [t] = b.columns[0].tasks
  assert.equal(plain(t.title), 'ChatGPT se cobra el 5 ene · 20,00 $')
  assert.equal(t.due, '2027-01-05')

  const año = { columns: [column('bandeja', [], { inbox: true })], subscriptions: [sub('gpt', { billingDate: '2027-01-02', remind: 7 })] }
  assert.equal(applyReminders(año, '2026-12-24', { newId: () => 'y' }), 1)
  assert.match(plain(año.columns[0].tasks[0].title), /se cobra el 2 ene 2027 · 10,00 €$/)
})

test('applyReminders: semanal con «1 semana antes», un aviso por cobro, el día del anterior', () => {
  const b = { columns: [column('bandeja', [], { inbox: true })], subscriptions: [sub('w', { name: 'Gimnasio', amount: 500, period: 'week', billingDate: '2026-10-07', remind: 7 })] }
  let n = 0
  const created = []
  for (let day = '2026-10-07'; day <= '2026-11-04'; day = addDays(day, 1)) {
    applyReminders(b, day, { newId: () => `t${++n}`, now: `${day}T08:00:00.000Z` })
    for (const t of b.columns[0].tasks) if (!created.some((c) => c.id === t.id)) created.push({ id: t.id, on: day, due: t.due, charge: t.subscriptionCharge })
    // Se completan al llegar su día (y se archivan: ya no están en el tablero).
    b.columns[0].tasks = b.columns[0].tasks.filter((t) => t.due > day)
  }
  assert.deepEqual(
    created.map(({ on, due, charge }) => [on, due, charge]),
    [
      ['2026-10-07', '2026-10-07', '2026-10-07'], // el primero, ya tarde: para hoy
      ['2026-10-07', '2026-10-07', '2026-10-14'],
      ['2026-10-12', '2026-10-14', '2026-10-21'], // con sus 2 días de margen, el día del cobro anterior
      ['2026-10-19', '2026-10-21', '2026-10-28'],
      ['2026-10-26', '2026-10-28', '2026-11-04'],
      ['2026-11-02', '2026-11-04', '2026-11-11'],
    ],
  )
})

test('applyReminders: sin Bandeja, la primera columna sin archivar; sin ninguna, nada', () => {
  const b = { columns: [column('viejo', [], { archived: true }), column('personal')], subscriptions: [sub('n', { remind: 3 })] }
  assert.equal(applyReminders(b, '2026-10-10', { newId: () => 'x' }), 1)
  assert.deepEqual(b.columns[1].tasks.map((t) => t.id), ['x'])
  assert.deepEqual(b.columns[0].tasks, [])

  const nada = { columns: [column('viejo', [], { archived: true })], subscriptions: [sub('n', { remind: 3 })] }
  assert.equal(applyReminders(nada, '2026-10-10', { newId: () => 'x' }), 0)
  assert.equal(nada.subscriptions[0].remindedFor, undefined, 'sin tarea creada no se anota')
  assert.equal(applyReminders({ columns: [column('c')] }, HOY, { newId: () => 'x' }), 0, 'sin suscripciones')
})

// ── Leer el tablero (src/model.ts) ──

test('normalizeBoard: siempre trae tarjetas y suscripciones; las tarjetas nunca con número', opts, () => {
  const empty = model.normalizeBoard({ columns: [] })
  assert.deepEqual(empty, { columns: [], cards: [], subscriptions: [] })
  const b = model.normalizeBoard({
    columns: [],
    cards: [
      { id: 'c1', name: 'Visa 4111 1111 1111 1111', color: 'neón', extra: 1 },
      { id: 'c2', name: '   ' },
      'basura',
      { id: 'c3', name: 'BBVA ··1234', color: 'blue' },
      { id: 'c4', name: '4111111111111111' },
      { id: 'c5', name: 'Visa 4111.1111.1111.1111', color: 'red' },
      { id: 'c6', name: 'N26 ··1234', color: 'mint' },
    ],
  })
  assert.deepEqual(b.cards[0], { id: 'c1', name: 'Visa', color: 'gray', extra: 1 })
  assert.deepEqual(b.cards[1], { id: 'c2', name: 'Tarjeta', color: 'gray' })
  assert.deepEqual(b.cards[2], { id: 'c3', name: 'BBVA ··1234', color: 'blue' })
  assert.equal(b.cards[3].name, 'Tarjeta')
  assert.equal(b.cards[4].name, 'Visa ...')
  assert.equal(b.cards[5].name, 'N26 ··1234')
  assert.equal(b.cards.length, 6)
  assert.equal(typeof model.normalizeBoard({ columns: [], cards: [{ name: 'Sin id' }] }).cards[0].id, 'string')
})

test('normalizeBoard: suscripciones con valores raros', opts, () => {
  const today = new Date()
  const hoy = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const b = model.normalizeBoard({
    columns: [
      {
        id: 'c',
        name: 'C',
        color: 'blue',
        tasks: [
          { id: 't1', subscriptionId: 'netflix', subscriptionCharge: '2026-10-15' },
          { id: 't2', subscriptionId: '', subscriptionCharge: 'pronto' },
          { id: 't3', subscriptionId: 7 },
        ],
      },
    ],
    cards: [{ id: 'bbva', name: 'BBVA', color: 'blue' }],
    subscriptions: [
      {
        id: 'raro',
        name: 'x'.repeat(80),
        amount: -5,
        currency: 'JPY',
        period: 'daily',
        billingDate: '2026-02-31',
        cardId: 'no-existe',
        url: 'javascript:alert(1)',
        notes: '',
        remind: 31,
        remindedFor: 'mañana',
        cancelledOn: 'ayer',
        otra: 'se conserva',
      },
      {
        id: 'bueno',
        name: 'Netflix',
        amount: 1299,
        currency: 'USD',
        period: 'quarter',
        billingDate: '2026-09-15',
        cardId: 'bbva',
        url: 'https://netflix.com/account',
        notes: 'Plan estándar',
        remind: 0,
        remindedFor: '2026-12-15',
        cancelledOn: '2026-10-01',
        createdAt: '2026-09-01T10:00:00.000Z',
      },
      { amount: 12.5, remind: 2.5 },
      null,
    ],
  })
  const [raro, bueno, minimo] = b.subscriptions
  assert.equal(b.subscriptions.length, 3)
  assert.equal(raro.name.length, 60)
  assert.deepEqual(
    { amount: raro.amount, currency: raro.currency, period: raro.period, billingDate: raro.billingDate, cardId: raro.cardId, otra: raro.otra },
    { amount: 0, currency: 'EUR', period: 'month', billingDate: hoy, cardId: null, otra: 'se conserva' },
  )
  for (const key of ['url', 'notes', 'remind', 'remindedFor', 'cancelledOn']) assert.equal(key in raro, false, key)
  assert.ok(!Number.isNaN(Date.parse(raro.createdAt)))
  assert.deepEqual(bueno, {
    id: 'bueno',
    name: 'Netflix',
    amount: 1299,
    currency: 'USD',
    period: 'quarter',
    billingDate: '2026-09-15',
    cardId: 'bbva',
    url: 'https://netflix.com/account',
    notes: 'Plan estándar',
    remind: 0,
    remindedFor: '2026-12-15',
    cancelledOn: '2026-10-01',
    createdAt: '2026-09-01T10:00:00.000Z',
  })
  assert.equal(minimo.amount, 0)
  assert.equal('remind' in minimo, false)
  assert.equal(minimo.name, '')
  assert.equal(typeof minimo.id, 'string')
  assert.deepEqual(b.columns[0].tasks.map((t) => t.subscriptionId), ['netflix', undefined, undefined])
  assert.deepEqual(b.columns[0].tasks.map((t) => t.subscriptionCharge), ['2026-10-15', undefined, undefined])
  // Ida y vuelta por JSON: igual.
  assert.deepEqual(model.normalizeBoard(JSON.parse(JSON.stringify(b))).subscriptions, b.subscriptions)
})

test('newSubscription: mensual, en euros, sin tarjeta y con cobro hoy por defecto', opts, () => {
  const s = model.newSubscription({ name: 'Netflix', amount: 1299 }, HOY)
  assert.deepEqual({ ...s, id: 'x', createdAt: 'y' }, {
    id: 'x',
    name: 'Netflix',
    amount: 1299,
    currency: 'EUR',
    period: 'month',
    billingDate: HOY,
    cardId: null,
    createdAt: 'y',
  })
  assert.notEqual(model.newSubscription({}, HOY).id, s.id)
})

// ── Cambios desde la app (src/subscriptions.ts) ──

/** El tablero de siempre con el aviso de Netflix ya creado (pendiente) y otro de antes completado. */
function withReminder() {
  const b = board()
  applyReminders(b, '2026-10-12', { newId: () => 'aviso', now: '2026-10-12T08:00:00.000Z' })
  b.columns[1].tasks.push(task('aviso-sept', { subscriptionId: 'netflix', due: '2026-09-14', done: true, completedAt: '2026-09-14T09:00:00.000Z' }))
  return b
}
const ids = (b) => allTasks(b).map((t) => t.id)

test('tarjetas: nunca con número; nombre y color', opts, () => {
  const b = board()
  assert.equal(subs.insertCard(b, { id: 'n', name: '4111 1111 1111 1111', color: 'red' }), b)
  assert.equal(subs.insertCard(b, { id: 'n', name: '   ', color: 'red' }), b)
  assert.equal(subs.insertCard(b, { id: 'bbva', name: 'Otra', color: 'red' }), b, 'id repetido')
  const added = subs.insertCard(b, { id: 'n', name: '  N26 ··1234  ', color: 'mint' })
  assert.deepEqual(added.cards.at(-1), { id: 'n', name: 'N26 ··1234', color: 'mint' })
  assert.equal(added.subscriptions, b.subscriptions)

  assert.equal(subs.cardNameError('Visa 4111-1111'), subs.CARD_NUMBER_MESSAGE)
  assert.match(subs.CARD_NUMBER_MESSAGE, /^Sin números de tarjeta: basta un nombre, como «BBVA» o «Revolut»/)
  assert.equal(subs.cardNameError(''), 'Escribe un nombre')
  assert.equal(subs.cardNameError('BBVA'), null)

  assert.equal(subs.changeCard(b, 'bbva', { name: 'BBVA 4111 1111' }), b, 'un número no se guarda')
  assert.equal(subs.changeCard(b, 'bbva', { name: '' }), b)
  assert.equal(subs.changeCard(b, 'bbva', { name: 'BBVA', color: 'blue' }), b, 'nada cambia')
  assert.equal(subs.changeCard(b, 'zzz', { name: 'X' }), b)
  const renamed = subs.changeCard(b, 'bbva', { name: 'BBVA Online', color: 'teal' })
  assert.deepEqual(renamed.cards[0], { id: 'bbva', name: 'BBVA Online', color: 'teal' })
  assert.equal(renamed.cards[1], b.cards[1])
})

test('removeCard: sus suscripciones se quedan sin tarjeta, en el mismo cambio', opts, () => {
  const b = withReminder()
  const next = subs.removeCard(b, 'bbva')
  assert.deepEqual(next.cards.map((c) => c.id), ['revolut'])
  const byId = Object.fromEntries(next.subscriptions.map((s) => [s.id, s]))
  assert.equal(byId.netflix.cardId, null)
  assert.equal(byId.spotify.cardId, null)
  assert.equal(byId.icloud, b.subscriptions[1], 'las demás, intactas')
  // Cambia la tarjeta del aviso: el pendiente se rehace; el completado se queda.
  assert.ok(!ids(next).includes('aviso'))
  assert.ok(ids(next).includes('aviso-sept'))
  assert.equal(byId.netflix.remindedFor, undefined)
  assert.equal(subs.removeCard(b, 'zzz'), b)
})

test('changeSubscription: cambiar el día de cobro rehace el aviso; las notas no', opts, () => {
  const b = withReminder()
  assert.equal(b.subscriptions[0].remindedFor, '2026-10-15')

  const moved = subs.changeSubscription(b, 'netflix', { billingDate: '2026-09-20' })
  assert.equal(moved.subscriptions[0].billingDate, '2026-09-20')
  assert.equal('remindedFor' in moved.subscriptions[0], false)
  assert.ok(!ids(moved).includes('aviso'), 'la tarea de aviso pendiente se quita')
  assert.ok(ids(moved).includes('aviso-sept'), 'la completada se queda')
  assert.equal(moved.columns[1], b.columns[1], 'columna sin avisos pendientes: la misma')
  // Y el servidor crea el nuevo, con la fecha nueva.
  assert.equal(applyReminders(moved, '2026-10-17', { newId: () => 'nuevo' }), 1)
  assert.match(plain(allTasks(moved).find((t) => t.id === 'nuevo').title), /se cobra el 20 oct/)

  const notes = subs.changeSubscription(b, 'netflix', { notes: 'Plan con anuncios', url: 'https://netflix.com/account' })
  assert.equal(notes.subscriptions[0].notes, 'Plan con anuncios')
  assert.equal(notes.subscriptions[0].remindedFor, '2026-10-15')
  assert.equal(notes.columns, b.columns, 'el aviso no se toca')

  for (const patch of [{ amount: 1499 }, { name: 'Netflix 4K' }, { currency: 'USD' }, { period: 'year' }, { cardId: 'revolut' }, { cardId: null }, { remind: 3 }, { remind: undefined }]) {
    const next = subs.changeSubscription(b, 'netflix', patch)
    assert.ok(!ids(next).includes('aviso'), JSON.stringify(patch))
    assert.equal(next.subscriptions[0].remindedFor, undefined, JSON.stringify(patch))
  }
  assert.equal('remind' in subs.changeSubscription(b, 'netflix', { remind: undefined }).subscriptions[0], false)
})

test('changeSubscription: el aviso de un cobro ya completado, archivado o borrado no vuelve', opts, () => {
  const b = board()
  applyReminders(b, '2026-10-12', { newId: () => 'aviso' })
  // applyReminders cambia el tablero que recibe: cada prueba, con su copia.
  const reminders = (x, day, id) => applyReminders(structuredClone(x), day, { newId: () => id })
  // Completado y archivado (o borrado a mano): ya no está en el tablero.
  const archivado = { ...b, columns: b.columns.map((c) => ({ ...c, tasks: c.tasks.filter((t) => t.id !== 'aviso') })) }
  for (const patch of [{ amount: 1499 }, { name: 'Netflix 4K' }, { cardId: 'revolut' }, { remind: 3 }]) {
    const next = subs.changeSubscription(archivado, 'netflix', patch)
    assert.equal(next.subscriptions[0].remindedFor, '2026-10-15', JSON.stringify(patch))
    assert.equal(reminders(next, '2026-10-13', 'otra'), 0, JSON.stringify(patch))
  }
  assert.equal(reminders(subs.setCancelled(subs.setCancelled(archivado, 'netflix', true, HOY), 'netflix', false, HOY), '2026-10-13', 'otra'), 0)
  // Completado y aún en el tablero: igual.
  const hecho = structuredClone(b)
  allTasks(hecho).find((t) => t.id === 'aviso').done = true
  assert.equal(subs.changeSubscription(hecho, 'netflix', { amount: 1499 }).subscriptions[0].remindedFor, '2026-10-15')
  // Si cambia el cobro, el nuevo tiene su aviso.
  assert.equal(reminders(subs.changeSubscription(archivado, 'netflix', { billingDate: '2026-09-20' }), '2026-10-18', 'nuevo'), 1)
  // Con el aviso aún pendiente, en cambio, se rehace con los datos nuevos.
  const pendiente = subs.changeSubscription(b, 'netflix', { amount: 1499 })
  assert.equal('remindedFor' in pendiente.subscriptions[0], false)
  assert.equal(reminders(pendiente, '2026-10-13', 'rehecho'), 1)
  assert.equal(subs.resetReminder(archivado, 'netflix'), archivado, 'nada que quitar: el mismo tablero')
})

test('changeSubscription: el mismo tablero si no cambia nada o si no vale', opts, () => {
  const b = withReminder()
  assert.equal(subs.changeSubscription(b, 'netflix', { name: 'Netflix', amount: 1299 }), b)
  assert.equal(subs.changeSubscription(b, 'zzz', { name: 'X' }), b)
  for (const patch of [{ amount: -1 }, { amount: 12.5 }, { currency: 'JPY' }, { period: 'daily' }, { billingDate: '2026-02-30' }, { billingDate: '0026-10-14' }, { cardId: 'nada' }, { url: 'ftp://x.com' }, { remind: 31 }, { remindedFor: '2026-11-15' }, { id: 'otro' }]) {
    assert.equal(subs.changeSubscription(b, 'netflix', patch), b, JSON.stringify(patch))
  }
  const sinEnlace = subs.changeSubscription(subs.changeSubscription(b, 'netflix', { url: 'https://x.com' }), 'netflix', { url: '' })
  assert.equal('url' in sinEnlace.subscriptions[0], false)
  assert.equal(subs.changeSubscription(b, 'netflix', { name: 'y'.repeat(80) }).subscriptions[0].name.length, 60)
})

test('setCancelled y removeSubscription: fuera el aviso pendiente', opts, () => {
  const b = withReminder()
  const baja = subs.setCancelled(b, 'netflix', true, HOY)
  assert.equal(baja.subscriptions[0].cancelledOn, HOY)
  assert.ok(!ids(baja).includes('aviso'))
  assert.equal(baja.subscriptions[0].remindedFor, undefined)
  assert.equal(subs.setCancelled(baja, 'netflix', true, '2026-10-08'), baja, 'ya estaba de baja')
  assert.equal(chargeAfter(baja.subscriptions[0], HOY), null)
  assert.deepEqual(remindersDue(baja, '2026-10-12'), [])

  const vuelta = subs.setCancelled(baja, 'netflix', false, HOY)
  assert.equal('cancelledOn' in vuelta.subscriptions[0], false)
  assert.equal(subs.setCancelled(vuelta, 'netflix', false, HOY), vuelta)
  assert.equal(remindersDue(vuelta, '2026-10-12').length, 1, 'reactivada, vuelve a avisar')

  const borrada = subs.removeSubscription(b, 'netflix')
  assert.deepEqual(borrada.subscriptions.map((s) => s.id), ['icloud', 'chatgpt', 'spotify'])
  assert.ok(!ids(borrada).includes('aviso'))
  assert.ok(ids(borrada).includes('aviso-sept'))
  assert.equal(subs.removeSubscription(b, 'zzz'), b)
})

test('insertSubscription: solo los campos válidos', opts, () => {
  const b = board()
  const s = model.newSubscription({ name: 'Disney+', amount: 899, currency: 'JPY', cardId: 'nada', remind: 3, remindedFor: '2026-10-10', cancelledOn: HOY }, HOY)
  const next = subs.insertSubscription(b, s)
  const added = next.subscriptions.at(-1)
  assert.deepEqual(
    { name: added.name, amount: added.amount, currency: added.currency, cardId: added.cardId, remind: added.remind, billingDate: added.billingDate },
    { name: 'Disney+', amount: 899, currency: 'EUR', cardId: null, remind: 3, billingDate: HOY },
  )
  assert.equal('remindedFor' in added, false)
  assert.equal('cancelledOn' in added, false)
  assert.equal(added.id, s.id)
  assert.equal(subs.insertSubscription(next, s), next, 'el mismo id no se repite')
  assert.equal(next.columns, b.columns)
})

test('lectura: activas por próximo cobro, bajas, el próximo, totales y la de una tarea', opts, () => {
  const b = board()
  const active = subs.activeSubscriptions(b, HOY)
  assert.deepEqual(
    active.map((a) => [a.subscription.id, a.charge, a.days, a.card?.name ?? null]),
    [
      ['icloud', '2026-10-08', 1, 'Revolut'],
      ['netflix', '2026-10-15', 8, 'BBVA'],
      ['chatgpt', '2026-10-20', 13, null],
    ],
  )
  assert.deepEqual(subs.activeSubscriptions(b, HOY, 'bbva').map((a) => a.subscription.id), ['netflix'])
  assert.deepEqual(subs.activeSubscriptions(b, HOY, null).map((a) => a.subscription.id), ['chatgpt'])
  assert.deepEqual(subs.cancelledSubscriptions(b).map((c) => [c.subscription.id, c.card?.id]), [['spotify', 'bbva']])
  assert.deepEqual(subs.cancelledSubscriptions(b, 'revolut'), [])
  assert.equal(subs.nextCharge(b, HOY).subscription.id, 'icloud')
  assert.equal(subs.nextCharge(b, HOY, 'bbva').charge, '2026-10-15')
  assert.equal(subs.nextCharge({ columns: [] }, HOY), null)
  assert.deepEqual(subs.subscriptionTotals(b, 'revolut'), { EUR: { monthly: 299, yearly: 3588, count: 1 } })
  assert.deepEqual(subs.subscriptionTotals({ columns: [] }), {})
  assert.equal(subs.subscriptionOfTask(b, { subscriptionId: 'netflix' }).name, 'Netflix')
  assert.equal(subs.subscriptionOfTask(b, { subscriptionId: 'borrada' }), null)
  assert.equal(subs.subscriptionOfTask(b, {}), null)
  assert.deepEqual(subs.REMIND_OPTIONS.map((o) => subs.remindLabel(o.value)), ['No', 'El mismo día', '1 día antes', '3 días antes', '1 semana antes'])
  assert.equal(subs.remindLabel(14), '14 días antes')
})

// ── Fusión (src/merge.ts) ──

test('mergeBoards: campos distintos de la misma suscripción se conservan los dos', opts, () => {
  const base = board()
  const ours = subs.changeSubscription(base, 'netflix', { notes: 'Plan con anuncios' })
  // Mientras, el servidor crea el aviso (otra copia del tablero guardado).
  const theirs = structuredClone(base)
  applyReminders(theirs, '2026-10-12', { newId: () => 'aviso' })
  const merged = merge.mergeBoards(base, ours, theirs)
  const netflix = merged.subscriptions.find((s) => s.id === 'netflix')
  assert.equal(netflix.notes, 'Plan con anuncios')
  assert.equal(netflix.remindedFor, '2026-10-15')
  assert.ok(allTasks(merged).some((t) => t.id === 'aviso'))
  assert.deepEqual(merged.cards, base.cards)

  // Quitar un campo también es un cambio: el aviso desactivado aquí no vuelve (ni el que el servidor
  // acababa de crear).
  const off = subs.changeSubscription(base, 'netflix', { remind: undefined })
  const both = merge.mergeBoards(base, off, theirs)
  const sinAviso = both.subscriptions.find((s) => s.id === 'netflix')
  assert.equal('remind' in sinAviso, false)
  assert.equal('remindedFor' in sinAviso, false)
  assert.ok(!allTasks(both).some((t) => t.id === 'aviso'))
  // Y lo que quita el otro lado, tampoco.
  const cleared = merge.mergeBoards(theirs, theirs, subs.resetReminder(theirs, 'netflix'))
  assert.equal('remindedFor' in cleared.subscriptions.find((s) => s.id === 'netflix'), false)
  assert.ok(!allTasks(cleared).some((t) => t.id === 'aviso'))
  // Si los dos cambian el mismo campo, gana el local.
  const oursAmount = subs.changeSubscription(base, 'netflix', { amount: 1499 })
  const theirsAmount = subs.changeSubscription(base, 'netflix', { amount: 999 })
  assert.equal(merge.mergeBoards(base, oursAmount, theirsAmount).subscriptions.find((s) => s.id === 'netflix').amount, 1499)
})

test('mergeBoards: el aviso que el servidor crea con los datos de antes no sobrevive a un cambio de aquí', opts, () => {
  // Netflix (12,99 €, BBVA, aviso 1 día antes) aún sin aviso; el servidor lo crea mientras aquí se cambia.
  const base = board()
  const theirs = structuredClone(base)
  applyReminders(theirs, '2026-10-12', { newId: () => 'T1' })
  assert.ok(allTasks(theirs).some((t) => t.id === 'T1'))
  const netflix = (b) => b.subscriptions.find((s) => s.id === 'netflix')
  const pending = (b) => allTasks(b).filter((t) => t.subscriptionId === 'netflix' && !t.done).map((t) => t.id)

  // Borrada aquí: su aviso no se queda huérfano.
  const borrada = merge.mergeBoards(base, subs.removeSubscription(base, 'netflix'), theirs)
  assert.equal(netflix(borrada), undefined)
  assert.deepEqual(pending(borrada), [])

  // Dada de baja aquí: no avisa de un cobro que ya no habrá.
  const baja = merge.mergeBoards(base, subs.setCancelled(base, 'netflix', true, HOY), theirs)
  assert.equal(netflix(baja).cancelledOn, HOY)
  assert.deepEqual(pending(baja), [])
  assert.equal('remindedFor' in netflix(baja), false)

  // Otro importe: el aviso viejo (12,99 €) se va y el servidor crea el nuevo.
  const importe = merge.mergeBoards(base, subs.changeSubscription(base, 'netflix', { amount: 1599 }), theirs)
  assert.equal(netflix(importe).amount, 1599)
  assert.deepEqual(pending(importe), [])
  assert.equal('remindedFor' in netflix(importe), false)
  assert.equal(applyReminders(importe, '2026-10-12', { newId: () => 'T2' }), 1)
  assert.match(plain(allTasks(importe).find((t) => t.id === 'T2').title), /15,99 €/)

  // Otro día de cobro: solo queda el aviso del nuevo, no también el del viejo.
  const fecha = merge.mergeBoards(base, subs.changeSubscription(base, 'netflix', { billingDate: '2026-09-20' }), theirs)
  assert.deepEqual(pending(fecha), [])
  assert.equal(applyReminders(fecha, '2026-10-18', { newId: () => 'T3' }), 1)
  assert.deepEqual(pending(fecha), ['T3'])
  assert.match(plain(allTasks(fecha).find((t) => t.id === 'T3').title), /se cobra el 20 oct/)

  // Con un remindedFor de antes (el aviso del cobro anterior), vuelve a ese, no al del servidor.
  const antes = structuredClone(base)
  netflix(antes).remindedFor = '2026-09-15'
  const servidor = structuredClone(antes)
  applyReminders(servidor, '2026-10-12', { newId: () => 'T1' })
  const conAntes = merge.mergeBoards(antes, subs.changeSubscription(antes, 'netflix', { amount: 1599 }), servidor)
  assert.equal(netflix(conAntes).remindedFor, '2026-09-15')
  assert.deepEqual(pending(conAntes), [])

  // Lo que el servidor crea para otra suscripción, o un cambio aquí que no toca el aviso, se queda.
  const notas = merge.mergeBoards(base, subs.changeSubscription(base, 'icloud', { amount: 399 }), theirs)
  assert.deepEqual(pending(notas), ['T1'])
})

test('mergeBoards: borrados de un lado y altas de los dos', opts, () => {
  const base = board()
  let ours = subs.removeSubscription(base, 'icloud')
  ours = subs.insertCard(ours, { id: 'n26', name: 'N26', color: 'mint' })
  ours = subs.insertSubscription(ours, sub('disney', { name: 'Disney+' }))
  let theirs = subs.changeSubscription(base, 'icloud', { notes: 'Plan de 200 GB' })
  theirs = subs.insertSubscription(theirs, sub('hbo', { name: 'Max' }))
  theirs = subs.removeCard(theirs, 'revolut')
  const merged = merge.mergeBoards(base, ours, theirs)
  assert.deepEqual(merged.subscriptions.map((s) => s.id), ['netflix', 'chatgpt', 'spotify', 'disney', 'hbo'])
  assert.deepEqual(merged.cards.map((c) => c.id), ['bbva', 'n26'])

  // Una tarjeta borrada en un lado mientras en el otro se elegía: la suscripción se queda sin tarjeta.
  const elige = subs.changeSubscription(base, 'chatgpt', { cardId: 'revolut' })
  const sinTarjeta = merge.mergeBoards(base, elige, theirs)
  assert.equal(sinTarjeta.subscriptions.find((s) => s.id === 'chatgpt').cardId, null)
})

test('mergeBoards: si ninguna versión tiene la lista, no la añade', opts, () => {
  const plainBoard = { columns: [column('c', [task('t')])] }
  const merged = merge.mergeBoards(plainBoard, structuredClone(plainBoard), structuredClone(plainBoard))
  assert.equal('cards' in merged, false)
  assert.equal('subscriptions' in merged, false)
  // Solo uno la tiene (una ventana con la versión nueva): se queda.
  const withList = { ...plainBoard, cards: [{ id: 'bbva', name: 'BBVA', color: 'blue' }] }
  assert.deepEqual(merge.mergeBoards(plainBoard, withList, plainBoard).cards, withList.cards)
  assert.deepEqual(merge.mergeBoards(plainBoard, plainBoard, withList).cards, withList.cards)
})
