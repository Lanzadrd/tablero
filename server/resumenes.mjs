// Resúmenes diarios por WhatsApp: cada día, a su hora, un mensaje por empresa con cómo fueron ayer sus anuncios de
// Meta y de Google, lo que hay que revisar y sus tareas del día. Sale de un número de la empresa por la API de
// WhatsApp de Meta (Cloud API), con el token de la conexión con Meta (meta.mjs) y una plantilla que Meta aprueba
// una vez por cuenta de WhatsApp: fuera de una conversación abierta, WhatsApp solo deja mandar plantillas.
//
// Lo que se configura (qué cuentas entran, desde qué número, a quién y a qué hora) y cómo fue el último envío se
// guardan en datos/resumenes.json. server/index.mjs mira cada pocos minutos si toca mandar alguno.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DATA_DIR, HttpError, localDay, localTime, readStore } from './almacen.mjs'
import { addDays, chargeAfter, daysBetween, formatMoney, isCurrency } from './suscripciones.mjs'

const FILE = path.join(DATA_DIR, 'resumenes.json')

/**
 * Las plantillas: una cosa por línea, con su título en negrita. WhatsApp no deja saltos de línea dentro de un
 * parámetro, así que cada línea es de la plantilla, y hay una con Meta, otra con Google y otra con los dos (así no
 * sale un bloque vacío). Meta pide una palabra entre dos variables y unas tres palabras por variable: de ahí la
 * etiqueta de cada viñeta y la frase del final.
 */
export const TEMPLATE_LANGUAGE = 'es'
const HEAD = ['Resumen de *{{empresa}}* del *{{dia}}*']
const BLOCKS = {
  meta: ['*Meta Ads - {{meta_gasto}}*', '', '* Conversaciones: {{meta_conversaciones}}', '* CPM: {{meta_cpm}}'],
  google: ['*Google Ads - {{google_gasto}}*', '', '* Conversiones: {{google_conversiones}}', '* Clics: {{google_clics}}'],
}
const TAIL = ['*Para revisar:* {{alertas}}', '*Tareas de hoy:* {{tareas}}']
const FOOT = ['_Te lo envía Tablero cada día con los datos de ayer de tus cuentas de anuncios y tus tareas._']
export const TEMPLATES = {
  meta: { name: 'tablero_resumen_meta', blocks: ['meta'] },
  google: { name: 'tablero_resumen_google', blocks: ['google'] },
  meta_google: { name: 'tablero_resumen_meta_google', blocks: ['meta', 'google'] },
}
/** El texto de la plantilla de cada tipo. */
export const templateText = (kind) => [HEAD, ...TEMPLATES[kind].blocks.map((b) => BLOCKS[b]), TAIL, FOOT].map((lines) => lines.join('\n')).join('\n\n')
/** Sus parámetros, en orden. */
export const paramsOf = (kind) => [...templateText(kind).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])
/** La que necesita un resumen: con Meta, con Google o con los dos (sin ninguna de las dos, la de Meta). */
export const templateKind = (summary) => (summary.meta?.length && summary.google?.length ? 'meta_google' : summary.google?.length ? 'google' : 'meta')
/** Los ejemplos que ve Meta al revisar la plantilla. */
const EXAMPLES = {
  empresa: 'Hoplon Club',
  dia: 'lunes 27 de octubre',
  meta_gasto: '45,20 US$',
  meta_conversaciones: '38 · 1,19 US$ c/u',
  meta_cpm: '2,10 US$',
  google_gasto: '12,40 US$',
  google_conversiones: '9 · 1,38 US$ c/u',
  google_clics: '210 · CPC 0,06 US$',
  alertas: 'anuncio «Promo 2»: rechazado · «Verano» termina mañana',
  tareas: '10:00 Llamar al proveedor · Revisar las cuotas',
}
/** WhatsApp no manda un mensaje de plantilla de más de 1024 caracteres. */
export const MAX_LENGTH = 1024
const MAX_SUMMARIES = 20
const MAX_ACCOUNTS = 20
const MAX_RECIPIENTS = 5
/** Si falla, se reintenta al cabo de media hora, como mucho tres veces al día. */
const RETRY_AFTER = 30 * 60_000
const MAX_TRIES = 3
/** Entre las cosas de una lista. */
const SEP = ' · '
/** Peor que esto respecto a su media de 7 días (coste por resultado), es una alerta. */
const WORSE = 1.5

// ── Lo que se guarda ──

const text = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const digits = (value, min = 1, max = 32) => (typeof value === 'string' && new RegExp(`^\\d{${min},${max}}$`).test(value) ? value : null)

/** «+34 600 11 22 33», «0034600112233» → «+34600112233»; null si no parece un número internacional. */
export function phoneOf(value) {
  if (typeof value !== 'string') return null
  const clean = value.trim().replace(/^00/, '+').replace(/[\s().-]/g, '')
  return /^\+[1-9]\d{7,14}$/.test(clean) ? clean : null
}

/** Un resumen como llega de la app, limpio (el último envío no lo cambia la app: se queda el guardado). */
export function cleanSummary(raw, saved = null) {
  const hora = typeof raw?.hora === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.hora) ? raw.hora : '09:00'
  const unique = (list, check) => [...new Set((Array.isArray(list) ? list : []).filter((v) => check(v)))].slice(0, MAX_ACCOUNTS)
  const numero = raw?.numero && digits(raw.numero.id) && digits(raw.numero.cuenta)
    ? {
        id: raw.numero.id,
        cuenta: raw.numero.cuenta,
        telefono: text(raw.numero.telefono, 40),
        nombre: text(raw.numero.nombre, 120),
      }
    : null
  const destinos = []
  for (const value of Array.isArray(raw?.destinos) ? raw.destinos : []) {
    const phone = phoneOf(value)
    if (!phone) throw new HttpError(400, `«${text(value, 40)}» no es un número de WhatsApp: escríbelo con el prefijo del país (+34…, +595…).`)
    if (!destinos.includes(phone)) destinos.push(phone)
  }
  if (destinos.length > MAX_RECIPIENTS) throw new HttpError(400, `Como mucho ${MAX_RECIPIENTS} números por resumen.`)
  return {
    id: typeof raw?.id === 'string' && /^[\w-]{1,64}$/.test(raw.id) ? raw.id : randomUUID(),
    nombre: text(raw?.nombre, 80) || 'Resumen',
    activo: raw?.activo === true,
    hora,
    meta: unique(raw?.meta, (v) => typeof v === 'string' && /^act_\d{1,32}$/.test(v)),
    google: unique(raw?.google, (v) => Boolean(digits(v, 6, 12))),
    columna: typeof raw?.columna === 'string' && /^[\w-]{1,64}$/.test(raw.columna) ? raw.columna : null,
    numero,
    destinos,
    ultimoEnvio: saved?.ultimoEnvio ?? null,
    prueba: saved?.prueba ?? null,
  }
}

export async function readSummaries() {
  let data = null
  try {
    data = JSON.parse(await readFile(FILE, 'utf8'))
  } catch (err) {
    if (err.code !== 'ENOENT') throw new HttpError(500, `${FILE} no se puede leer; no se ha modificado.`)
  }
  return Array.isArray(data?.resumenes) ? data.resumenes : []
}

async function writeSummaries(list) {
  await mkdir(DATA_DIR, { recursive: true })
  const tmp = `${FILE}.tmp`
  await writeFile(tmp, `${JSON.stringify({ app: 'tablero', version: 1, savedAt: new Date().toISOString(), resumenes: list }, null, 2)}\n`, 'utf8')
  await rename(tmp, FILE)
}

// Las escrituras van de una en una.
let queue = Promise.resolve()
function changeSummaries(fn) {
  const run = queue.then(async () => {
    const list = await readSummaries()
    const result = await fn(list)
    await writeSummaries(list)
    return result
  })
  queue = run.catch(() => {})
  return run
}

/** Guarda la lista de la app (en su orden), con el último envío de cada uno. */
export function saveSummaries(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_SUMMARIES) throw new HttpError(400, 'Resúmenes no válidos')
  return changeSummaries((list) => {
    const saved = new Map(list.map((s) => [s.id, s]))
    const clean = raw.map((r) => cleanSummary(r, saved.get(r?.id)))
    list.splice(0, list.length, ...clean)
    return clean
  })
}

// ── El texto ──

const moneyFormats = new Map()
/** «45,20 US$», «3.579 PYG» (importes de anuncios: en unidades, no en céntimos; con punto de miles siempre). */
export function money(amount, currency) {
  if (!moneyFormats.has(currency)) {
    let format
    try {
      format = new Intl.NumberFormat('es-ES', { style: 'currency', currency, useGrouping: 'always' })
    } catch {
      format = { format: (n) => `${n.toFixed(2).replace('.', ',')} ${currency}` }
    }
    moneyFormats.set(currency, format)
  }
  return moneyFormats.get(currency).format(Number(amount) || 0)
}
const count = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1, useGrouping: 'always' })
const plural = (n, one, many) => `${count.format(n)} ${n === 1 ? one : many}`
const dayFormat = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
/** «lunes 27 de octubre». */
export const dayText = (day) => dayFormat.format(new Date(`${day}T12:00:00Z`)).replace(',', '')
const weekday = new Intl.DateTimeFormat('es-ES', { weekday: 'long', timeZone: 'UTC' })
/** «hoy», «mañana», «el jueves». */
function whenText(day, today) {
  const n = daysBetween(today, day)
  return n === 0 ? 'hoy' : n === 1 ? 'mañana' : `el ${weekday.format(new Date(`${day}T12:00:00Z`))}`
}

/** Lo que se suma de cada cuenta, por moneda (no se suman monedas distintas). */
function byCurrency(list, key) {
  const sums = new Map()
  for (const { ayer } of list) {
    const t = ayer.totales ?? {}
    const sum = sums.get(ayer.moneda) ?? { gasto: 0, resultados: 0, clics: 0, impresiones: 0 }
    sum.gasto += Number(t.gasto) || 0
    sum.resultados += Number(t[key]) || 0
    sum.clics += Number(t.clics) || 0
    sum.impresiones += Number(t.impresiones) || 0
    sums.set(ayer.moneda, sum)
  }
  return [...sums]
}

/**
 * Las cifras de ayer de Meta (conversaciones de WhatsApp y CPM) o de Google (conversiones, clics y CPC), cada una en
 * su línea; con varias monedas, separadas por « | ». Si no se ha podido leer ninguna cuenta, lo dice.
 */
function platformParams(list, platform) {
  const ok = list.filter((d) => !d.error)
  const prefix = platform === 'meta' ? 'meta' : 'google'
  if (!list.length) return Object.fromEntries(paramsOf(platform).filter((p) => p.startsWith(prefix)).map((p) => [p, '—']))
  if (!ok.length) {
    const none = 'no se ha podido leer'
    return platform === 'meta'
      ? { meta_gasto: none, meta_conversaciones: '—', meta_cpm: '—' }
      : { google_gasto: none, google_conversiones: '—', google_clics: '—' }
  }
  const sums = byCurrency(ok, platform === 'meta' ? 'conversaciones' : 'conversiones')
  const each = (fn) => sums.map(([currency, s]) => fn(s, currency)).join(' | ')
  const results = (s, currency) => (s.resultados ? `${count.format(s.resultados)}${SEP}${money(s.gasto / s.resultados, currency)} c/u` : s.gasto ? 'ninguna' : '0')
  const gasto = sums.map(([currency, s]) => money(s.gasto, currency)).join(' + ')
  if (platform === 'meta') {
    return {
      meta_gasto: gasto,
      meta_conversaciones: each(results),
      meta_cpm: each((s, currency) => (s.impresiones ? money((s.gasto / s.impresiones) * 1000, currency) : '—')),
    }
  }
  return {
    google_gasto: gasto,
    google_conversiones: each(results),
    google_clics: each((s, currency) => (s.clics ? `${count.format(s.clics)}${SEP}CPC ${money(s.gasto / s.clics, currency)}` : '0')),
  }
}

/**
 * Lo que hay que revisar de una cuenta de Meta: si no está activa, los anuncios rechazados o con problemas, las
 * campañas activas que no entregan o no gastaron, las que terminan pronto y las que van mucho peor que su media.
 */
function metaAlerts({ cuenta, ayer, semana, anuncios }, { today, now }) {
  const alerts = []
  if (cuenta.activa === false) alerts.push(`cuenta «${cuenta.nombre}»: ${cuenta.estado}`)
  const flagged = new Set()
  for (const ad of anuncios?.filas ?? []) {
    if (ad.estado !== 'activa' || ad.entrega?.tono !== 'warning') continue
    alerts.push(`anuncio «${ad.nombre}»: ${ad.entrega.texto.toLowerCase()}`)
    if (ad.padres?.campana?.id) flagged.add(ad.padres.campana.id)
  }
  const week = new Map((semana?.filas ?? []).map((r) => [r.id, r.metricas]))
  for (const c of ayer?.filas ?? []) {
    if (c.estado !== 'activa') continue
    const m = c.metricas ?? {}
    if (c.entrega?.tono === 'warning') {
      // «Con problemas» de una campaña ya sale en sus anuncios.
      if (!flagged.has(c.id)) alerts.push(`«${c.nombre}»: ${c.entrega.texto.toLowerCase()}`)
      continue
    }
    if (c.entrega?.tono !== 'ok') continue
    const changedLately = c.actualizada && now - Date.parse(c.actualizada) < 36 * 3_600_000
    if (!m.gasto && !changedLately) alerts.push(`«${c.nombre}» activa pero ayer no gastó`)
    if (c.termina) {
      const end = localDay(new Date(c.termina))
      if (end >= today && daysBetween(today, end) <= 2) alerts.push(`«${c.nombre}» termina ${whenText(end, today)}`)
    }
    alerts.push(...worse(`«${c.nombre}»`, m, week.get(c.id), ayer.moneda, 'conversaciones', 'conversación'))
  }
  return alerts
}

/** Lo mismo de Google: la cuenta, las campañas activas que no entregan del todo y las que van peor que su media. */
function googleAlerts({ cuenta, ayer, semana }) {
  const alerts = []
  if (cuenta.activa === false) alerts.push(`cuenta de Google «${cuenta.nombre}»: ${cuenta.estado}`)
  const week = new Map((semana?.filas ?? []).map((r) => [r.id, r.metricas]))
  for (const c of ayer?.filas ?? []) {
    if (c.estado !== 'activa') continue
    const label = `«${c.nombre}» (Google)`
    if (c.entrega?.tono === 'warning') alerts.push(`${label}: ${c.entrega.texto.toLowerCase()}`)
    alerts.push(...worse(label, c.metricas ?? {}, week.get(c.id), ayer.moneda, 'conversiones', 'conversión'))
  }
  return alerts
}

/**
 * Si ayer fue mucho peor que su media de 7 días: el coste por resultado (WORSE veces o más) o gastar lo de dos
 * resultados sin ninguno. Solo con una media que diga algo (3 resultados o más en la semana).
 */
function worse(label, day, week, currency, key, one) {
  const average = week?.[key] >= 3 ? week.gasto / week[key] : null
  if (!average || !day?.gasto) return []
  if (!day[key]) return day.gasto >= 2 * average ? [`${label} gastó ${money(day.gasto, currency)} sin ninguna ${one}`] : []
  const cost = day.gasto / day[key]
  if (cost < WORSE * average) return []
  return [`${label}: ${money(cost, currency)} por ${one}, ${count.format(cost / average)}× su media de 7 días`]
}

/**
 * Las tareas de hoy de la columna del resumen (las atrasadas también, y primero las de hora) y los cobros de sus
 * suscripciones de hoy a pasado mañana que no tengan ya su tarea de aviso.
 */
export function tasksOf(board, columnId, today) {
  const column = board?.columns?.find((c) => c.id === columnId && !c.archived)
  if (!column) return []
  const open = (column.tasks ?? []).filter((t) => !t.done && !t.someday && t.due && t.due <= today)
  const order = (t) => (t.due < today ? 2 : t.time ? 0 : 1)
  open.sort((a, b) => order(a) - order(b) || (a.time ?? '').localeCompare(b.time ?? ''))
  const items = open.map((t) => {
    const title = text(t.title, 120) || 'Sin título'
    if (t.due < today) return `${title} (atrasada)`
    return t.time ? `${t.time} ${title}` : title
  })
  const reminded = new Set(
    (board.columns ?? []).flatMap((c) => c.tasks ?? []).filter((t) => !t.done && t.subscriptionId).map((t) => `${t.subscriptionId}:${t.subscriptionCharge}`),
  )
  for (const sub of board.subscriptions ?? []) {
    if (sub?.columnId !== column.id) continue
    const charge = chargeAfter(sub, today)
    if (!charge || daysBetween(today, charge) > 2 || reminded.has(`${sub.id}:${charge}`)) continue
    const amount = formatMoney(sub.amount, isCurrency(sub.currency) ? sub.currency : 'EUR')
    items.push(`cobro de ${text(sub.name, 60) || 'una suscripción'} (${amount}) ${whenText(charge, today)}`)
  }
  return items
}

/** El mensaje con los parámetros puestos (como lo verá quien lo reciba). */
export const render = (params, kind = 'meta') => templateText(kind).replace(/\{\{(\w+)\}\}/g, (_, key) => params[key] ?? '')

/**
 * Junta las listas en los parámetros y, si el mensaje no cabe en MAX_LENGTH, quita de la lista más larga las
 * últimas (que dicen «y N más») hasta que quepa. WhatsApp no deja saltos de línea ni tabuladores en un parámetro.
 */
export function fitParams(fixed, lists, { empty = {}, max = MAX_LENGTH, kind = 'meta' } = {}) {
  const shown = Object.fromEntries(Object.entries(lists).map(([key, items]) => [key, [...items]]))
  const dropped = Object.fromEntries(Object.keys(lists).map((key) => [key, 0]))
  // Los espacios duros de los importes («10,00 US$») se quedan: así no se parten al final de una línea.
  const flat = (value) => value.replace(/[^\S\u00a0]+/g, ' ').trim()
  const build = () => {
    const params = { ...fixed }
    for (const [key, items] of Object.entries(shown)) {
      const more = dropped[key] ? `${SEP}y ${dropped[key]} más` : ''
      params[key] = items.length ? `${items.join(SEP)}${more}` : more ? `${dropped[key]} más` : (empty[key] ?? '—')
    }
    return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, flat(String(value)) || '—']))
  }
  let params = build()
  while (render(params, kind).length > max) {
    const longest = Object.keys(shown)
      .filter((key) => shown[key].length > 1)
      .sort((a, b) => params[b].length - params[a].length)[0]
    if (!longest) {
      // Una sola cosa muy larga: se corta.
      const key = Object.keys(params).sort((a, b) => params[b].length - params[a].length)[0]
      const extra = render(params, kind).length - max
      params[key] = `${params[key].slice(0, Math.max(1, params[key].length - extra - 1))}…`
      break
    }
    shown[longest].pop()
    dropped[longest] += 1
    params = build()
  }
  return params
}

/**
 * Los parámetros del mensaje de un resumen a partir de lo leído de Meta (`metaData`: por cuenta, sus campañas de
 * ayer y de 7 días y sus anuncios de ayer, o el error) y de Google (`googleData`), y del tablero.
 */
export function composeSummary({ summary, metaData = [], googleData = [], board = null, today, now = Date.now() }) {
  const kind = templateKind(summary)
  const ok = (list) => list.filter((d) => !d.error)
  const failed = [...metaData, ...googleData].filter((d) => d.error).map((d) => `no se ha podido leer «${d.cuenta.nombre}» (${d.error})`)
  const wanted = new Set(paramsOf(kind))
  const figures = { ...platformParams(metaData, 'meta'), ...platformParams(googleData, 'google') }
  return fitParams(
    {
      empresa: text(summary.nombre, 80) || 'tu empresa',
      dia: dayText(addDays(today, -1)),
      ...Object.fromEntries(Object.entries(figures).filter(([key]) => wanted.has(key))),
    },
    {
      alertas: [...failed, ...ok(metaData).flatMap((d) => metaAlerts(d, { today, now })), ...ok(googleData).flatMap(googleAlerts)],
      tareas: summary.columna ? tasksOf(board, summary.columna, today) : [],
    },
    { empty: { alertas: 'nada, todo en orden', tareas: summary.columna ? 'nada para hoy' : '—' }, kind },
  )
}

// ── El envío ──

/** ¿Toca mandarlo ya? Activo, con número y destinos, pasada su hora y sin mandar hoy (o falló hace rato). */
export function isDue(summary, now = new Date()) {
  if (!summary.activo || !summary.numero || !summary.destinos?.length) return false
  if (localTime(now) < summary.hora) return false
  const last = summary.ultimoEnvio
  if (!last || last.dia !== localDay(now)) return true
  if (last.ok) return false
  return (last.intentos ?? 1) < MAX_TRIES && now.getTime() - Date.parse(last.en) >= RETRY_AFTER
}

const errorText = (err) => (err?.message ?? String(err)).slice(0, 300)

/**
 * `meta` y `google` son los de meta.mjs y google.mjs. Devuelve lo que usa la API: la lista, guardarla, los números
 * de WhatsApp con su plantilla, crear la plantilla, ver un resumen, mandarlo y mandar los que toquen.
 */
export function createSummaries({ meta, google, now = () => Date.now() }) {
  const maybe = (promise, fallback) => promise.catch((err) => (err?.status === 401 ? Promise.reject(err) : fallback))

  /** Lo de ayer (y de 7 días) de las cuentas del resumen, cada una con su error si no se ha podido leer. */
  async function collect(summary) {
    const [metaGroups, googleGroups] = await Promise.all([
      summary.meta.length ? maybe(meta.portfolios(), []) : [],
      summary.google.length ? maybe(google.accounts(), []) : [],
    ])
    const find = (groups, id) => groups.flatMap((g) => g.cuentas).find((c) => c.id === id) ?? { id, nombre: id }
    const read = async (cuenta, load) => {
      try {
        return { cuenta, ...(await load()) }
      } catch (err) {
        if (err?.status === 401) throw err
        return { cuenta, error: errorText(err) }
      }
    }
    const [metaData, googleData] = await Promise.all([
      Promise.all(
        summary.meta.map((id) =>
          read(find(metaGroups, id), async () => {
            const [ayer, semana, anuncios] = await Promise.all([
              meta.performance(id, { period: 'ayer', fresh: true }),
              meta.performance(id, { period: '7d', fresh: true }),
              meta.performance(id, { period: 'ayer', level: 'anuncio', fresh: true }),
            ])
            return { ayer, semana, anuncios }
          }),
        ),
      ),
      Promise.all(
        summary.google.map((id) =>
          read(find(googleGroups, id), async () => {
            const [ayer, semana] = await Promise.all([google.performance(id, { period: 'ayer', fresh: true }), google.performance(id, { period: '7d', fresh: true })])
            return { ayer, semana }
          }),
        ),
      ),
    ])
    return { metaData, googleData }
  }

  /** El mensaje de un resumen, sin mandarlo. */
  async function preview(summary) {
    const current = new Date(now())
    const [{ metaData, googleData }, { board }] = await Promise.all([collect(summary), readStore()])
    const params = composeSummary({ summary, metaData, googleData, board, today: localDay(current), now: current.getTime() })
    const kind = templateKind(summary)
    return { tipo: kind, plantilla: TEMPLATES[kind].name, parametros: params, texto: render(params, kind) }
  }

  /**
   * Manda el mensaje a cada destino y apunta cómo fue. El de cada día, solo a los que aún no lo tienen hoy (si
   * falla, se reintenta); `manual` («Enviar ahora»), a todos, y se apunta aparte: no cuenta como el de hoy.
   */
  async function send(summaryId, { manual = false } = {}) {
    const summary = (await readSummaries()).find((s) => s.id === summaryId)
    if (!summary) throw new HttpError(404, 'Ese resumen ya no existe')
    if (!summary.numero) throw new HttpError(400, 'Elige desde qué número de WhatsApp sale.')
    if (!summary.destinos.length) throw new HttpError(400, 'Añade al menos un número al que mandarlo.')
    const current = new Date(now())
    const today = localDay(current)
    const last = !manual && summary.ultimoEnvio?.dia === today ? summary.ultimoEnvio : null
    const pending = summary.destinos.filter((to) => !last?.enviados?.includes(to))
    let texto = null
    const enviados = [...(last?.enviados ?? [])]
    const errores = []
    try {
      const built = await preview(summary)
      texto = built.texto
      for (const to of pending) {
        try {
          await meta.graph(`${summary.numero.id}/messages`, { method: 'POST', body: messageBody(to, built.parametros, built.tipo) })
          enviados.push(to)
        } catch (err) {
          errores.push(`${to}: ${whatsappError(err)}`)
        }
      }
    } catch (err) {
      errores.push(whatsappError(err))
    }
    const ok = errores.length === 0
    const record = {
      dia: today,
      en: current.toISOString(),
      ok,
      enviados,
      error: ok ? null : errores.join(' · '),
      intentos: (last?.intentos ?? 0) + 1,
      texto,
    }
    await changeSummaries((list) => {
      const found = list.find((s) => s.id === summaryId)
      if (found) found[manual ? 'prueba' : 'ultimoEnvio'] = record
    })
    return record
  }

  /** Manda los que toquen (lo llama server/index.mjs cada pocos minutos). */
  async function runDue() {
    const due = (await readSummaries()).filter((s) => isDue(s, new Date(now())))
    const results = []
    for (const summary of due) results.push({ id: summary.id, nombre: summary.nombre, ...(await send(summary.id)) })
    return results
  }

  /**
   * Los números de WhatsApp de cada portfolio (de sus cuentas de WhatsApp, propias y de clientes) y, de cada
   * cuenta, cómo están las plantillas de los resúmenes (una por tipo: con Meta, con Google o con los dos).
   */
  async function numbers() {
    const businesses = await meta.graph('me/businesses', { params: { fields: 'id,name', limit: 100 } })
    const fields = 'id,name,phone_numbers{id,display_phone_number,verified_name,status,quality_rating}'
    const groups = await Promise.all(
      (businesses.data ?? []).map(async (business) => {
        const lists = await Promise.all(
          ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts'].map((edge) =>
            meta.graph(`${business.id}/${edge}`, { params: { fields, limit: 100 } }).then(
              (r) => ({ data: r.data ?? [] }),
              (err) => (err?.status === 401 ? Promise.reject(err) : { error: err }),
            ),
          ),
        )
        const seen = new Set()
        const wabas = lists.flatMap((l) => l.data ?? []).filter((w) => !seen.has(w.id) && seen.add(w.id))
        const cuentas = await Promise.all(
          wabas.map(async (w) => ({
            id: String(w.id),
            nombre: w.name ?? null,
            plantillas: await templateStatus(w.id),
            numeros: (w.phone_numbers?.data ?? []).map((p) => ({
              id: String(p.id),
              telefono: p.display_phone_number ?? '',
              nombre: p.verified_name ?? '',
              estado: p.status ?? null,
            })),
          })),
        )
        const error = lists.find((l) => l.error)?.error
        return { id: String(business.id), nombre: business.name, cuentas, error: !cuentas.length && error ? whatsappError(error) : null }
      }),
    )
    return groups.filter((g) => g.cuentas.length || g.error)
  }

  /**
   * Cómo están las plantillas en una cuenta de WhatsApp, por tipo: «APPROVED», «PENDING», «REJECTED»… o null si no
   * está.
   */
  async function templateStatus(wabaId) {
    const kinds = Object.keys(TEMPLATES)
    try {
      const { data } = await meta.graph(`${wabaId}/message_templates`, { params: { name: 'tablero_resumen', fields: 'name,status,language,rejected_reason,category', limit: 100 } })
      return Object.fromEntries(
        kinds.map((kind) => {
          const found = (data ?? []).find((t) => t.name === TEMPLATES[kind].name && t.language === TEMPLATE_LANGUAGE)
          if (!found) return [kind, { estado: null }]
          const reason = found.rejected_reason && found.rejected_reason !== 'NONE' ? found.rejected_reason : null
          return [kind, { estado: found.status ?? null, motivo: reason, categoria: found.category ?? null }]
        }),
      )
    } catch (err) {
      if (err?.status === 401) throw err
      return Object.fromEntries(kinds.map((kind) => [kind, { estado: null, error: whatsappError(err) }]))
    }
  }

  /** Pide a Meta una plantilla en una cuenta de WhatsApp (la revisa: suele tardar de minutos a unas horas). */
  async function createTemplate(wabaId, kind) {
    if (!digits(wabaId)) throw new HttpError(400, 'Cuenta de WhatsApp no válida')
    if (!Object.hasOwn(TEMPLATES, kind)) throw new HttpError(400, 'Tipo de plantilla no válido')
    try {
      await meta.graph(`${wabaId}/message_templates`, { method: 'POST', body: templateBody(kind) })
    } catch (err) {
      // Ya estaba (creada antes, quizá a mano): vale la que hay.
      if (err?.meta?.subcode !== 2388024) throw new HttpError(err?.status === 401 ? 401 : 502, whatsappError(err), err?.code)
    }
    return (await templateStatus(wabaId))[kind]
  }

  return { list: readSummaries, save: saveSummaries, numbers, createTemplate, templateStatus, preview, send, runDue }
}

/** Lo que se manda a Meta para crear la plantilla de un tipo. */
export function templateBody(kind) {
  return {
    name: TEMPLATES[kind].name,
    language: TEMPLATE_LANGUAGE,
    category: 'UTILITY',
    parameter_format: 'named',
    components: [
      {
        type: 'body',
        text: templateText(kind),
        example: { body_text_named_params: paramsOf(kind).map((name) => ({ param_name: name, example: EXAMPLES[name] })) },
      },
    ],
  }
}

/** El mensaje de un destino (sin el «+»: así lo pide la API), con la plantilla de su tipo. */
export function messageBody(to, params, kind) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to.replace(/^\+/, ''),
    type: 'template',
    template: {
      name: TEMPLATES[kind].name,
      language: { code: TEMPLATE_LANGUAGE },
      components: [{ type: 'body', parameters: paramsOf(kind).map((name) => ({ type: 'text', parameter_name: name, text: params[name] })) }],
    },
  }
}

/** Los errores de WhatsApp que más salen (por su código de Meta), en algo que se entienda; el resto, como vienen. */
const WHATSAPP_ERRORS = {
  132001: 'La plantilla no está aprobada en esta cuenta de WhatsApp (o no existe): créala y espera a que Meta la apruebe.',
  131030: 'Ese número no puede recibir mensajes de esta app todavía: Meta solo deja mandar a los números de prueba.',
  131042: 'La cuenta de WhatsApp no tiene forma de pago o tiene un pago pendiente: revísalo en el Administrador de WhatsApp.',
  131026: 'Ese número no tiene WhatsApp o no puede recibir el mensaje.',
  133010: 'El número desde el que sale no está registrado en la API de WhatsApp.',
  131031: 'La cuenta de WhatsApp está bloqueada: mira el Administrador de WhatsApp.',
}
export function whatsappError(err) {
  const code = err?.meta?.code
  if (WHATSAPP_ERRORS[code]) return WHATSAPP_ERRORS[code]
  const message = errorText(err)
  if (code === 10 || code === 200) return `Falta el permiso de WhatsApp: pulsa «Dar permiso de WhatsApp» en Resúmenes. (${message})`
  return message
}

// Para las pruebas.
export const _private = { platformParams, metaAlerts, googleAlerts, worse, whenText }
