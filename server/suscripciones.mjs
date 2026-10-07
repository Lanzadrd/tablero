// Suscripciones: cuánto cuestan, cuándo se cobran y el aviso en la Bandeja antes de cada cobro.
// Lógica pura, sin dependencias: la usan la app (src/subscriptions.ts), el servidor (el aviso,
// server/api.mjs) y el MCP de Claude Code. Las fechas son días 'AAAA-MM-DD' (hora local de
// quien llama); las cuentas se hacen en UTC para que los cambios de hora no muevan ningún día.

export const PERIODS = ['week', 'month', 'quarter', 'half', 'year']
export const CURRENCIES = ['EUR', 'USD', 'GBP']

const LABELS = { week: 'Semanal', month: 'Mensual', quarter: 'Trimestral', half: 'Semestral', year: 'Anual' }
const UNITS = { week: 'semana', month: 'mes', quarter: 'trimestre', half: 'semestre', year: 'año' }
const MONTHS = { month: 1, quarter: 3, half: 6, year: 12 }
/** Cobros al año de cada periodicidad (enteros: el total anual sale exacto). */
const PER_YEAR = { week: 52, month: 12, quarter: 4, half: 2, year: 1 }

export const isPeriod = (value) => PERIODS.includes(value)
export const isCurrency = (value) => CURRENCIES.includes(value)

/** 'Semanal', 'Mensual', 'Trimestral', 'Semestral' o 'Anual'. */
export const periodLabel = (period) => LABELS[period] ?? LABELS.month

/** 'semana', 'mes'…: para «12,99 € / mes». */
export const periodUnit = (period) => UNITS[period] ?? UNITS.month

// ── Días ──

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const pad = (n) => String(n).padStart(2, '0')

/**
 * ¿Es un día real 'AAAA-MM-DD' (no vale el 31 de abril)? Desde 1900: un año 0026 no es un cobro, sino
 * un año a medio escribir.
 */
export function isDay(value) {
  const m = typeof value === 'string' ? DAY.exec(value) : null
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return y >= 1900 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo - 1)
}

/** 'AAAA-MM-DD' en hora local. */
export const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const parts = (day) => day.split('-').map(Number)
/** Como Date.UTC, pero sin su atajo de dos cifras (que lleva los años 0–99 a 1900–1999). */
const utcDate = (year, month, day) => {
  const d = new Date(0)
  d.setUTCFullYear(year, month, day)
  return d
}
const utc = (day) => {
  const [y, m, d] = parts(day)
  return utcDate(y, m - 1, d).getTime()
}
const fromUtc = (ms) => {
  const d = new Date(ms)
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}
/** Días del mes (`month` de 0 a 11). */
const daysInMonth = (year, month) => utcDate(year, month + 1, 0).getUTCDate()

export const addDays = (day, n) => fromUtc(utc(day) + n * 86_400_000)

/** Días de `from` a `to` (negativo si `to` es antes). */
export const daysBetween = (from, to) => Math.round((utc(to) - utc(from)) / 86_400_000)

/** `months` meses después de `day`; el 31 pasa al último día de los meses cortos. */
function addMonths(day, months) {
  const [y, m, d] = parts(day)
  const index = y * 12 + (m - 1) + months
  const year = Math.floor(index / 12)
  const month = index - year * 12
  return `${String(year).padStart(4, '0')}-${pad(month + 1)}-${pad(Math.min(d, daysInMonth(year, month)))}`
}

// ── Cobros ──

/** El cobro nº `k` (0 = billingDate), contado siempre desde billingDate para que el 31 no derive. */
function nth(sub, k) {
  return sub.period === 'week' ? addDays(sub.billingDate, 7 * k) : addMonths(sub.billingDate, (MONTHS[sub.period] ?? 1) * k)
}

/** El primer k ≥ 0 cuyo cobro cae en `day` o después. Sin bucles: se calcula directamente. */
function firstIndex(sub, day) {
  if (sub.billingDate >= day) return 0
  if (sub.period === 'week') return Math.ceil(daysBetween(sub.billingDate, day) / 7)
  const step = MONTHS[sub.period] ?? 1
  const [by, bm] = parts(sub.billingDate)
  const [dy, dm] = parts(day)
  // El cobro k cae en el mes bm + k·step: el de k0 es de este mes o antes; el de k0 + 1, ya de otro.
  const k = Math.floor((dy * 12 + dm - (by * 12 + bm)) / step)
  return nth(sub, k) >= day ? k : k + 1
}

const active = (sub) => !sub.cancelledOn
const valid = (sub) => !!sub && isDay(sub.billingDate)

/** El primer cobro el día `today` o después ('AAAA-MM-DD'). null si está dada de baja. */
export function chargeAfter(sub, today) {
  if (!valid(sub) || !active(sub)) return null
  return nth(sub, firstIndex(sub, today))
}

/** Los cobros entre `from` y `to` (ambos incluidos), en orden. Ninguno si está dada de baja. */
export function chargesBetween(sub, from, to, { max = 1000 } = {}) {
  if (!valid(sub) || !active(sub) || to < from) return []
  const out = []
  for (let k = firstIndex(sub, from); out.length < max; k++) {
    const day = nth(sub, k)
    if (day > to) break
    out.push(day)
  }
  return out
}

// ── Importes (en céntimos) ──

/** Lo que cuesta al año, en céntimos. */
export const yearlyAmount = (sub) => (Number.isFinite(sub?.amount) ? sub.amount : 0) * (PER_YEAR[sub?.period] ?? 12)

/** Lo que cuesta al mes, en céntimos y sin redondear (semanal: ×52/12; anual: /12…). */
export const monthlyAmount = (sub) => yearlyAmount(sub) / 12

/**
 * Totales de las activas por moneda (nunca se suman monedas distintas):
 * { EUR: { monthly, yearly, count }, … }, en céntimos sin redondear. Con `cardId`, solo las de esa
 * tarjeta (null = las que no tienen).
 */
export function totals(subs, { cardId } = {}) {
  const out = {}
  for (const sub of Array.isArray(subs) ? subs : []) {
    if (!sub || !active(sub) || (cardId !== undefined && (sub.cardId ?? null) !== cardId)) continue
    const currency = isCurrency(sub.currency) ? sub.currency : 'EUR'
    const total = (out[currency] ??= { monthly: 0, yearly: 0, count: 0 })
    total.yearly += yearlyAmount(sub)
    total.monthly = total.yearly / 12
    total.count++
  }
  return out
}

const formats = new Map()

/** «12,99 €», «12,99 $», «12,99 £». */
export function formatMoney(cents, currency = 'EUR') {
  let format = formats.get(currency)
  if (!format) {
    try {
      format = new Intl.NumberFormat('es-ES', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
    } catch {
      format = { format: (n) => `${n.toFixed(2).replace('.', ',')} ${currency}` }
    }
    formats.set(currency, format)
  }
  return format.format((Number.isFinite(cents) ? cents : 0) / 100)
}

/**
 * Un importe escrito a mano, en céntimos: «12,99», «12.99», «1.299,00», «9», «€ 9,5», «9,99 €».
 * Con 1 o 2 cifras detrás, el último punto o coma es el decimal; con 3, separa los miles.
 * null si no se entiende (o es negativo).
 */
export function parseMoney(text) {
  if (typeof text !== 'string') return null
  const s = text
    .replace(/[\s  ]+/g, ' ')
    .replace(/[€$£]|\b(?:eur|usd|gbp|us)\b/gi, '')
    .trim()
  if (!s) return null
  let digits = s
  // Espacios dentro solo como separador de miles: «1 299,00».
  if (s.includes(' ')) {
    if (!/^\d{1,3}(?: \d{3})+(?:[.,]\d{0,2})?$/.test(s)) return null
    digits = s.replace(/ /g, '')
  }
  if (!/^[\d.,]+$/.test(digits) || !/\d/.test(digits)) return null
  const last = Math.max(digits.lastIndexOf(','), digits.lastIndexOf('.'))
  let whole = digits
  let cents = 0
  if (last >= 0) {
    const after = digits.length - last - 1
    if (after <= 2) {
      whole = digits.slice(0, last)
      cents = Number(digits.slice(last + 1).padEnd(2, '0'))
    } else if (after !== 3) return null
  }
  if (whole && !/^\d+$/.test(whole)) {
    // Separadores de miles: siempre el mismo, cada tres cifras, y distinto del decimal.
    const sep = whole.includes('.') ? '.' : ','
    const groups = new RegExp(`^\\d{1,3}(?:\\${sep}\\d{3})+$`)
    if (!groups.test(whole) || (last >= 0 && whole.length < digits.length && digits[last] === sep)) return null
    whole = whole.split(sep).join('')
  }
  const total = Number(whole || '0') * 100 + cents
  return Number.isSafeInteger(total) ? total : null
}

// ── Tarjetas ──

/**
 * ¿Lleva un número de tarjeta? 6 cifras o más en total, las separe lo que las separe («4111 1111 1111
 * 1111», «4111.1111.1111.1111», «Visa ··4111 ··1111…»). Solo no cuentan las de una palabra con letras
 * que lleva 3 como mucho, como «N26» o «B2B»: así valen las 4 últimas junto a un nombre con cifras,
 * «BBVA ··1234», «N26 ··1234».
 */
export function hasCardNumber(name) {
  if (typeof name !== 'string') return false
  let digits = 0
  for (const word of name.split(/\s+/)) {
    const count = word.match(/\p{Nd}/gu)?.length ?? 0
    if (count > 3 || !/\p{L}/u.test(word)) digits += count
  }
  return digits >= 6
}

/** El nombre sin sus cifras (si traía un número de tarjeta). */
export const withoutDigits = (name) => name.replace(/\p{Nd}/gu, '').replace(/\s+/g, ' ').trim()

// ── Avisos antes del cobro ──

const dayFormat = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const dayFormatYear = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** «15 oct»; con el año si no es el de `today`: «3 ene 2027» (como formatDay de src/dates.ts). */
export function chargeDayText(day, today) {
  const format = day.slice(0, 4) === today?.slice(0, 4) ? dayFormat : dayFormatYear
  return format.format(new Date(utc(day))).replace('.', '')
}

/** «Netflix se cobra el 15 oct · 12,99 € · BBVA» (sin la tarjeta si no tiene). */
export function reminderTitle(sub, charge, { today, cards = [] } = {}) {
  const card = sub.cardId ? cards.find((c) => c?.id === sub.cardId) : null
  return [
    `${(typeof sub.name === 'string' && sub.name.trim()) || 'Suscripción'} se cobra el ${chargeDayText(charge, today)}`,
    formatMoney(sub.amount, isCurrency(sub.currency) ? sub.currency : 'EUR'),
    card?.name,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** ¿Tiene aviso? `remind` entero de 0 a 30 (días antes del cobro). */
export const hasReminder = (sub) => Number.isInteger(sub?.remind) && sub.remind >= 0 && sub.remind <= 30

/** Días de margen: el aviso se crea antes, para que llegue al iPhone aunque luego el Mac duerma. */
export const REMINDER_LEAD = 2

/**
 * Los campos que salen en la tarea de aviso o deciden cuándo toca: si cambian, su aviso pendiente sobra
 * (src/subscriptions.ts lo quita, y src/merge.ts el que el servidor creó con los datos de antes).
 */
export const REMINDER_FIELDS = ['name', 'amount', 'currency', 'period', 'billingDate', 'cardId', 'remind']

const allTasks = (board) => (Array.isArray(board?.columns) ? board.columns : []).flatMap((c) => (Array.isArray(c?.tasks) ? c.tasks : []))

/**
 * Los avisos que toca crear hoy: [{ subscription, charge, due }], con `charge` el cobro y `due` el día de
 * la tarea (el del aviso, o hoy si ese ya pasó). Uno por cobro de cada suscripción activa con aviso, si
 * faltan como mucho REMINDER_LEAD días para el día del aviso y aún no se creó: ni lo cubre `remindedFor`
 * (el último cobro avisado, y con él los de antes), ni hay ya una tarea suya para ese cobro (hecha o no).
 * Normalmente es el próximo cobro; si se avisa con tanta antelación como dura el periodo (semanal con
 * «1 semana antes»), el aviso del siguiente toca antes de que pase el próximo, y se crea también.
 */
export function remindersDue(board, today) {
  const subs = Array.isArray(board?.subscriptions) ? board.subscriptions : []
  const tasks = allTasks(board)
  const out = []
  for (const sub of subs) {
    if (!sub || !hasReminder(sub)) continue
    for (const charge of chargesBetween(sub, today, addDays(today, sub.remind + REMINDER_LEAD), { max: 10 })) {
      if (isDay(sub.remindedFor) && charge <= sub.remindedFor) continue
      const day = addDays(charge, -sub.remind)
      if (tasks.some((t) => t?.subscriptionId === sub.id && remindsOf(t, day, charge))) continue
      out.push({ subscription: sub, charge, due: day < today ? today : day })
    }
  }
  return out
}

/** ¿Es `t` el aviso del cobro `charge`? Lo dice la propia tarea; una sin ese dato, por su fecha. */
const remindsOf = (t, day, charge) =>
  isDay(t.subscriptionCharge) ? t.subscriptionCharge === charge : typeof t.due === 'string' && t.due >= day && t.due <= charge

/**
 * Crea las tareas de aviso que tocan (remindersDue) en la Bandeja (o, si no hay, en la primera
 * columna sin archivar; si tampoco, en ninguna), cada una con el cobro del que avisa
 * (`subscriptionCharge`), y anota `remindedFor` en cada suscripción.
 * Modifica `board`. Devuelve cuántas ha creado. Llamarla otra vez no repite nada.
 */
export function applyReminders(board, today, { newId, now = new Date().toISOString() }) {
  const columns = Array.isArray(board?.columns) ? board.columns : []
  const target = columns.find((c) => c?.inbox && !c.archived) ?? columns.find((c) => c && !c.archived)
  if (!target) return 0
  if (!Array.isArray(target.tasks)) target.tasks = []
  const cards = Array.isArray(board.cards) ? board.cards : []
  let created = 0
  for (const { subscription: sub, charge, due } of remindersDue(board, today)) {
    insertOpen(target, {
      id: newId(),
      title: reminderTitle(sub, charge, { today, cards }),
      notes: '',
      done: false,
      createdAt: now,
      completedAt: null,
      due,
      time: null,
      subscriptionId: sub.id,
      subscriptionCharge: charge,
    })
    sub.remindedFor = charge
    created++
  }
  return created
}

/** Detrás de la última pendiente, como al añadir una tarea (igual que insertOpen de operaciones.mjs). */
function insertOpen(column, task) {
  let last = -1
  column.tasks.forEach((t, i) => {
    if (!t.done) last = i
  })
  column.tasks.splice(last + 1, 0, task)
}
