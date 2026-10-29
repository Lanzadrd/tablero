// Entiende lo que se escribe al añadir una tarea, en español:
//   «Llamar a Marta mañana 10:30 #Trabajo»  →  título «Llamar a Marta», mañana a las 10:30, columna Trabajo
//   «Mañana dentista a las 9», «Revisar copias cada lunes», «Leer Sapiens algún día»…
//
// Para no equivocarse con el título, solo se reconocen fechas y horas al principio o al
// final del texto, nunca en medio. Lo usan la app (al escribir), el servidor (captura
// global, Siri) y el MCP de Claude Code.

const pad = (n) => String(n).padStart(2, '0')
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const fromISO = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const addDays = (iso, n) => {
  const d = fromISO(iso)
  d.setDate(d.getDate() + n)
  return toISO(d)
}
const validDate = (y, m, d) => {
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? toISO(date) : null
}

/** Minúsculas y sin acentos, con la misma longitud que el original (en NFC). */
export const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
const MONTHS = {
  enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3, abril: 4, abr: 4, mayo: 5, may: 5,
  junio: 6, jun: 6, julio: 7, jul: 7, agosto: 8, ago: 8, septiembre: 9, setiembre: 9, sep: 9, sept: 9,
  octubre: 10, oct: 10, noviembre: 11, nov: 11, diciembre: 12, dic: 12,
}
const NUMBERS = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 }
const toNumber = (s) => (/^\d+$/.test(s) ? Number(s) : NUMBERS[s] ?? NaN)

/** El próximo día de la semana `wd` (0 = domingo), estrictamente después de hoy salvo `allowToday`. */
function nextWeekday(today, wd, allowToday = false) {
  const current = fromISO(today).getDay()
  let diff = (wd - current + 7) % 7
  if (diff === 0 && !allowToday) diff = 7
  return addDays(today, diff)
}

function addMonths(iso, n) {
  const d = fromISO(iso)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, last))
  return toISO(d)
}

/** «a las 7 de la tarde» → 19:00; «a las 12 de la noche» → 00:00; «a la 1 de la madrugada» → 01:00. */
function partOfDay(h, m, part) {
  const hour = Number(h)
  if (hour < 1 || hour > 12) return null
  let h24 = hour
  if (part === 'tarde') h24 = hour === 12 ? 12 : hour + 12
  else if (part === 'noche') h24 = hour === 12 ? 0 : hour >= 6 ? hour + 12 : hour
  else if (part === 'madrugada') h24 = hour === 12 ? 0 : hour
  return makeTime(h24, m ?? 0)
}

function makeTime(h, m = 0, suffix = '') {
  let hour = Number(h)
  const minute = Number(m)
  if (suffix === 'pm' && hour < 12) hour += 12
  if (suffix === 'am' && hour === 12) hour = 0
  return hour <= 23 && minute <= 59 ? `${pad(hour)}:${pad(minute)}` : null
}

const WD = '(lunes|martes|miercoles|jueves|viernes|sabado|domingo)'
const MONTH = `(${Object.keys(MONTHS).join('|')})`

// Reglas que se buscan al FINAL del texto (sobre el texto sin acentos). Cada una devuelve
// los campos que aporta, o null si no aplica.
const END_RULES = [
  {
    kind: 'columna',
    re: /(?:^|\s)#([\p{L}\p{N}_-]+)$/u,
    apply: (m, ctx) => {
      const column = findColumn(m[1], ctx.columns)
      return column ? { columnId: column.id } : null
    },
  },
  { kind: 'algun-dia', re: /(?:^|\s)(?:para )?algun dia$/, apply: () => ({ someday: true }) },
  { kind: 'repetir', re: /(?:^|\s)(?:todos los dias|cada dia|a diario|diariamente)$/, apply: () => ({ repeat: { every: 'day' } }) },
  {
    kind: 'repetir',
    re: /(?:^|\s)(?:cada dia laborable|todos los dias laborables|(?:los |en )?(?:dias )?laborables|de lunes a viernes)$/,
    apply: () => ({ repeat: { every: 'weekday' } }),
  },
  { kind: 'repetir', re: /(?:^|\s)(?:cada semana|semanalmente|todas las semanas)$/, apply: () => ({ repeat: { every: 'week' } }) },
  { kind: 'repetir', re: /(?:^|\s)(?:cada mes|mensualmente|todos los meses)$/, apply: () => ({ repeat: { every: 'month' } }) },
  { kind: 'repetir', re: /(?:^|\s)(?:cada ano|anualmente|todos los anos)$/, apply: () => ({ repeat: { every: 'year' } }) },
  {
    kind: 'repetir',
    re: /(?:^|\s)cada (\d+|dos|tres|cuatro|cinco|seis) (dias|semanas|meses|anos)$/,
    apply: (m) => {
      const interval = toNumber(m[1])
      const every = { dias: 'day', semanas: 'week', meses: 'month', anos: 'year' }[m[2]]
      return interval >= 1 && interval <= 365 ? { repeat: { every, interval } } : null
    },
  },
  {
    kind: 'repetir',
    re: new RegExp(`(?:^|\\s)(?:cada|todos los) ${WD}s?$`),
    apply: (m, ctx) => ({ repeat: { every: 'week' }, weekdayDue: nextWeekday(ctx.today, WEEKDAYS.indexOf(m[1]), true) }),
  },
  // Horas: «10:30», «a las 9», «a las 9:15», «9pm», «a mediodía», «a las 7 de la tarde». «18h» al
  // final no: «Estudiar 2h» es una duración.
  {
    kind: 'hora',
    re: /(?:^|\s)a las? (\d{1,2})(?::(\d{2}))? de la (manana|tarde|noche|madrugada)$/,
    apply: (m) => time(partOfDay(m[1], m[2], m[3])),
  },
  { kind: 'hora', re: /(?:^|\s)(?:a las? )?(\d{1,2}):(\d{2})\s*(?:h|(am|pm))?$/, apply: (m) => time(makeTime(m[1], m[2], m[3])) },
  { kind: 'hora', re: /(?:^|\s)a las? (\d{1,2})\s*(?:h|(am|pm))?$/, apply: (m) => time(makeTime(m[1], 0, m[2])) },
  { kind: 'hora', re: /(?:^|\s)(\d{1,2})\s*(am|pm)$/, apply: (m) => time(makeTime(m[1], 0, m[2])) },
  { kind: 'hora', re: /(?:^|\s)a mediodia$/, apply: () => time('12:00') },
  // Fechas
  { kind: 'fecha', re: /(?:^|\s)hoy$/, apply: (m, ctx) => ({ due: ctx.today }) },
  { kind: 'fecha', re: /(?:^|\s)esta (?:tarde|noche)$/, apply: (m, ctx) => ({ due: ctx.today }) },
  { kind: 'fecha', re: /(?:^|\s)ayer$/, apply: (m, ctx) => ({ due: addDays(ctx.today, -1) }) },
  { kind: 'fecha', re: /(?:^|\s)pasado manana$/, apply: (m, ctx) => ({ due: addDays(ctx.today, 2) }) },
  {
    kind: 'fecha',
    // «por la mañana», «esta mañana», «cada mañana»… son momentos del día, no «mañana».
    re: /(?:^|\s)manana$/,
    apply: (m, ctx) => (/(?:^|\s)(?:la|esta|cada|toda la|por la|de la)\s+manana$/.test(ctx.folded) ? null : { due: addDays(ctx.today, 1) }),
  },
  {
    kind: 'fecha',
    re: /(?:^|\s)(?:la semana que viene|la proxima semana|proxima semana|semana que viene)$/,
    apply: (m, ctx) => ({ due: nextWeekday(ctx.today, 1) }),
  },
  {
    kind: 'fecha',
    re: /(?:^|\s)(?:el |este )?fin de semana$/,
    apply: (m, ctx) => ({ due: nextWeekday(ctx.today, 6, true) }),
  },
  {
    kind: 'fecha',
    re: new RegExp(`(?:^|\\s)(?:el |este |esta |el proximo |proximo )?${WD}(?: que viene| proximo)?$`),
    apply: (m, ctx) => ({ due: nextWeekday(ctx.today, WEEKDAYS.indexOf(m[1])) }),
  },
  {
    kind: 'fecha',
    re: /(?:^|\s)(?:en|dentro de) (\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez) (dias?|semanas?|mes(?:es)?|anos?)$/,
    apply: (m, ctx) => {
      const n = toNumber(m[1])
      if (!(n >= 1 && n <= 400)) return null
      const unit = m[2]
      if (unit.startsWith('dia')) return { due: addDays(ctx.today, n) }
      if (unit.startsWith('semana')) return { due: addDays(ctx.today, 7 * n) }
      if (unit.startsWith('mes')) return { due: addMonths(ctx.today, n) }
      return { due: addMonths(ctx.today, 12 * n) }
    },
  },
  { kind: 'fecha', re: /(?:^|\s)(?:el )?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/, apply: (m, ctx) => numericDate(m, ctx) },
  {
    kind: 'fecha',
    re: new RegExp(`(?:^|\\s)(?:el )?(\\d{1,2}) (?:de )?${MONTH}\\.?(?: (?:de )?(\\d{4}))?$`),
    apply: (m, ctx) => textualDate(Number(m[1]), MONTHS[m[2]], m[3], ctx),
  },
]

// Reglas al PRINCIPIO: «Mañana llamar a Marta», «10:30 dentista», «18h pádel», «el lunes revisar…».
const START_RULES = [
  { kind: 'fecha', re: /^hoy(?=\s)/, apply: (m, ctx) => ({ due: ctx.today }) },
  { kind: 'fecha', re: /^ayer(?=\s)/, apply: (m, ctx) => ({ due: addDays(ctx.today, -1) }) },
  { kind: 'fecha', re: /^pasado manana(?=\s)/, apply: (m, ctx) => ({ due: addDays(ctx.today, 2) }) },
  { kind: 'fecha', re: /^manana(?=\s)/, apply: (m, ctx) => ({ due: addDays(ctx.today, 1) }) },
  { kind: 'fecha', re: new RegExp(`^(?:el |este |el proximo )?${WD}(?=\\s)`), apply: (m, ctx) => ({ due: nextWeekday(ctx.today, WEEKDAYS.indexOf(m[1])) }) },
  { kind: 'fecha', re: /^(?:el )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?=\s)/, apply: (m, ctx) => numericDate(m, ctx) },
  { kind: 'hora', re: /^(?:a las? )?(\d{1,2}):(\d{2})\s*(?:h|(am|pm))?(?=\s)/, apply: (m) => time(makeTime(m[1], m[2], m[3])) },
  { kind: 'hora', re: /^(\d{1,2})\s*(?:h|(am|pm))(?=\s)/, apply: (m) => time(makeTime(m[1], 0, m[2])) },
  { kind: 'hora', re: /^a las? (\d{1,2})(?=\s)/, apply: (m) => time(makeTime(m[1], 0)) },
]

function time(value) {
  return value ? { time: value } : null
}

function numericDate(m, ctx) {
  const d = Number(m[1])
  const mo = Number(m[2])
  let y = m[3] ? Number(m[3]) : null
  if (y !== null && y < 100) y += 2000
  return textualDate(d, mo, y, ctx)
}

function textualDate(d, mo, year, ctx) {
  const thisYear = fromISO(ctx.today).getFullYear()
  if (year) {
    const iso = validDate(Number(year), mo, d)
    return iso ? { due: iso } : null
  }
  // Sin año: la próxima vez que llegue esa fecha.
  let iso = validDate(thisYear, mo, d)
  if (iso && iso < ctx.today) iso = validDate(thisYear + 1, mo, d)
  return iso ? { due: iso } : null
}

/**
 * La columna a la que se refiere «#trabajo», «#flota»… (sin mayúsculas ni acentos ni espacios): el
 * nombre entero, su principio o un trozo. Con `strict` (donde no hay vista previa que avise, como
 * en lo que llega del iPhone), solo el nombre entero o su principio de 3 letras o más.
 */
export function findColumn(tag, columns = [], { strict = false } = {}) {
  const key = fold(tag).replace(/[\s_-]+/g, '')
  if (!key) return null
  const named = columns.map((c) => ({ column: c, name: fold(c.name).replace(/[\s_-]+/g, '') }))
  const exact = named.find((c) => c.name === key)
  if (strict) return (exact ?? (key.length >= 3 ? named.find((c) => c.name.startsWith(key)) : undefined))?.column ?? null
  return (exact ?? named.find((c) => c.name.startsWith(key)) ?? named.find((c) => c.name.includes(key)))?.column ?? null
}

/**
 * @param {string} input lo escrito
 * @param {{ today: string, time?: string, columns?: {id: string, name: string}[] }} ctx today = 'AAAA-MM-DD'
 *   local; time = 'HH:MM' local de ahora (si se sabe: una hora sin día que ya ha pasado es para mañana)
 */
export function parseTask(input, { today, time: now = null, columns = [] }) {
  const original = input.normalize('NFC').replace(/\s+/g, ' ').trim()
  const result = { title: original, due: null, time: null, columnId: null, repeat: null, someday: false, matches: [] }
  let text = original
  let weekdayDue = null

  let strippedStart = false
  const take = (fields, kind, matched) => {
    for (const [key, value] of Object.entries(fields)) {
      if (key === 'weekdayDue') weekdayDue = value
      else result[key] = value
    }
    result.matches.push({ kind, text: matched.trim() })
  }
  const free = (kind) =>
    kind === 'fecha' ? !result.due : kind === 'hora' ? !result.time : kind === 'columna' ? !result.columnId : kind === 'repetir' ? !result.repeat : !result.someday

  for (let guard = 0; guard < 8; guard++) {
    const folded = fold(text)
    let found = false
    for (const rule of END_RULES) {
      if (!free(rule.kind)) continue
      const m = rule.re.exec(folded)
      if (!m) continue
      const before = folded.slice(0, m.index)
      const fields = rule.apply(m, { today, columns, folded })
      if (!fields) continue
      take(fields, rule.kind, text.slice(m.index))
      text = text.slice(0, before.length).trimEnd()
      found = true
      break
    }
    if (!found) break
  }

  for (let guard = 0; guard < 3; guard++) {
    const folded = fold(text)
    let found = false
    for (const rule of START_RULES) {
      if (!free(rule.kind)) continue
      const m = rule.re.exec(folded)
      if (!m) continue
      const fields = rule.apply(m, { today, columns, folded })
      if (!fields) continue
      take(fields, rule.kind, text.slice(0, m[0].length))
      text = text.slice(m[0].length).trimStart()
      strippedStart = true
      found = true
      break
    }
    if (!found) break
  }

  // Sin título no hay tarea: entonces todo era el título.
  const title = text.replace(/^[\s,.;:–-]+|[\s,.;:–-]+$/g, '')
  if (!title) return { title: original, due: null, time: null, columnId: null, repeat: null, someday: false, matches: [] }
  // «Mañana llamar al gestor» → «Llamar al gestor»
  result.title = strippedStart ? title.charAt(0).toLocaleUpperCase('es') + title.slice(1) : title

  if (result.someday) {
    result.due = null
    result.time = null
    result.repeat = null
  } else {
    if (!result.due && weekdayDue) result.due = weekdayDue
    // Una hora o una repetición sin día empiezan hoy; una hora sola que ya ha pasado, mañana.
    if (!result.due && (result.time || result.repeat)) {
      result.due = result.repeat?.every === 'weekday' && [0, 6].includes(fromISO(today).getDay()) ? nextWeekday(today, 1) : today
      if (!result.repeat && now && result.time < now) result.due = addDays(today, 1)
    }
  }
  return result
}

/** Día de la semana (0 = domingo) de una repetición como «cada lunes», o null si no es de esas. */
export function repeatWeekday(parsed) {
  if (parsed?.repeat?.every !== 'week') return null
  const match = parsed.matches.find((m) => m.kind === 'repetir')
  const words = match ? fold(match.text).split(/\s+/) : []
  const day = WEEKDAYS.findIndex((w) => words.includes(w) || words.includes(`${w}s`))
  return day === -1 ? null : day
}

/** El primer día de la semana `weekday` (0 = domingo) desde `from` incluido. */
export const weekdayFrom = (from, weekday) => nextWeekday(from, weekday, true)

const LONG = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'short' })
const REPEAT_LABEL = { day: 'cada día', weekday: 'laborables', week: 'cada semana', month: 'cada mes', year: 'cada año' }
const UNIT = { day: ['día', 'días'], week: ['semana', 'semanas'], month: ['mes', 'meses'], year: ['año', 'años'] }

/** Resumen corto de lo entendido: «Mañana · 10:30 · Trabajo · cada semana». */
export function describe(parsed, { today, columns = [] }) {
  const parts = []
  if (parsed.due) {
    const diff = Math.round((fromISO(parsed.due) - fromISO(today)) / 86_400_000)
    const day = diff === 0 ? 'Hoy' : diff === 1 ? 'Mañana' : LONG.format(fromISO(parsed.due)).replace(/^\p{L}/u, (c) => c.toUpperCase())
    parts.push(parsed.time ? `${day}, ${parsed.time}` : day)
  }
  if (parsed.someday) parts.push('Algún día')
  if (parsed.repeat) {
    const n = parsed.repeat.interval ?? 1
    parts.push(n > 1 ? `cada ${n} ${UNIT[parsed.repeat.every][1]}` : REPEAT_LABEL[parsed.repeat.every])
  }
  const column = columns.find((c) => c.id === parsed.columnId)
  if (column) parts.push(column.name)
  return parts.join(' · ')
}
