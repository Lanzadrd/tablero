// Suscripciones y tarjetas, del lado de la app: los cambios (puros: devuelven el mismo tablero si no
// cambia nada) y lo que la vista necesita leer. Las cuentas (cobros, importes, avisos) están en
// server/suscripciones.mjs, compartidas con el servidor y el MCP. Solo importa tipos de './model',
// así se prueba con Node tal cual (server/pruebas/suscripciones.test.mjs).
import {
  afterLastOpen,
  chargeAfter,
  CURRENCIES,
  daysBetween,
  formatMoney,
  hasCardNumber,
  isCurrency,
  isDay,
  isPeriod,
  localDay,
  REMINDER_FIELDS,
  reminderColumn,
  totals,
  type Totals,
} from '../server/suscripciones.mjs'
import type { Board, Card, ColorKey, Column, Subscription, Task } from './model'

// Lo que la vista necesita de las cuentas, a mano desde aquí.
export {
  CURRENCIES,
  PERIODS,
  chargeAfter,
  chargesBetween,
  daysBetween,
  formatMoney,
  hasReminder,
  isDay,
  monthlyAmount,
  parseMoney,
  periodLabel,
  periodUnit,
  REMINDER_FIELDS,
  reminderColumn,
  yearlyAmount,
} from '../server/suscripciones.mjs'
export type { BillingPeriod, Currency, Totals } from '../server/suscripciones.mjs'

// ── Leer ──

export const cardsOf = (board: Board): Card[] => board.cards ?? []
export const subscriptionsOf = (board: Board): Subscription[] => board.subscriptions ?? []

export const findCard = (board: Board, id: string | null | undefined): Card | null =>
  (id && cardsOf(board).find((c) => c.id === id)) || null

export const findSubscription = (board: Board, id: string | null | undefined): Subscription | null =>
  (id && subscriptionsOf(board).find((s) => s.id === id)) || null

/** La suscripción de la que una tarea es el aviso (si aún existe). */
export const subscriptionOfTask = (board: Board, task: Pick<Task, 'subscriptionId'>) => findSubscription(board, task.subscriptionId)

export const isActive = (sub: Subscription) => !sub.cancelledOn

/**
 * Filtro por tarjeta: `undefined` = todas; `null` = las que no tienen tarjeta; un id = las de esa.
 */
export type CardFilter = string | null | undefined

const matches = (sub: Subscription, cardId: CardFilter) => cardId === undefined || sub.cardId === cardId

export interface UpcomingSubscription {
  subscription: Subscription
  card: Card | null
  /** Próximo cobro, 'AAAA-MM-DD'. */
  charge: string
  /** Días que faltan para el cobro (0 = hoy). */
  days: number
}

const byName = (a: Subscription, b: Subscription) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })

/** Las activas (de la tarjeta `cardId`, si se da), por próximo cobro y luego por nombre. */
export function activeSubscriptions(board: Board, today: string, cardId?: CardFilter): UpcomingSubscription[] {
  const out: UpcomingSubscription[] = []
  for (const subscription of subscriptionsOf(board)) {
    if (!isActive(subscription) || !matches(subscription, cardId)) continue
    const charge = chargeAfter(subscription, today)
    if (!charge) continue
    out.push({ subscription, card: findCard(board, subscription.cardId), charge, days: daysBetween(today, charge) })
  }
  return out.sort((a, b) => a.charge.localeCompare(b.charge) || byName(a.subscription, b.subscription))
}

/** Las dadas de baja (de la tarjeta `cardId`, si se da), la más reciente primero. */
export function cancelledSubscriptions(board: Board, cardId?: CardFilter): { subscription: Subscription; card: Card | null }[] {
  return subscriptionsOf(board)
    .filter((s) => !isActive(s) && matches(s, cardId))
    .sort((a, b) => (b.cancelledOn ?? '').localeCompare(a.cancelledOn ?? '') || byName(a, b))
    .map((subscription) => ({ subscription, card: findCard(board, subscription.cardId) }))
}

/** El cobro más cercano (para «Netflix · mañana · 12,99 €»), o null si no hay ninguna activa. */
export const nextCharge = (board: Board, today: string, cardId?: CardFilter): UpcomingSubscription | null =>
  activeSubscriptions(board, today, cardId)[0] ?? null

/** Al mes y al año por moneda, de las activas (de la tarjeta `cardId`, si se da). */
export const subscriptionTotals = (board: Board, cardId?: CardFilter): Totals => totals(subscriptionsOf(board), { cardId })

// ── Por columna (la empresa a la que pertenece cada una) ──

/** Su columna del tablero, si existe (si no, está «Sin columna»). */
export const columnOf = (board: Board, sub: Pick<Subscription, 'columnId'>): Column | null =>
  (sub.columnId && board.columns.find((c) => c.id === sub.columnId)) || null

/** ¿Se le ponen suscripciones? Las columnas del tablero sin archivar, salvo la Bandeja. */
export const isAssignable = (column: Column) => !column.archived && !column.inbox

/** Una columna de la vista Suscripciones: la del tablero (o «Sin columna») con sus activas. */
export interface SubscriptionGroup {
  /** null = «Sin columna». */
  column: Column | null
  /** Las activas (de la tarjeta del filtro, si hay), por próximo cobro. */
  items: UpcomingSubscription[]
  /** Lo que suman esas, por moneda. */
  totals: Totals
}

/**
 * Las activas por columna, en el orden del tablero. Las columnas sin archivar que no son la Bandeja
 * salen siempre, aunque no tengan ninguna (para añadir o soltar ahí); una archivada o la Bandeja, solo
 * si tiene alguna; y «Sin columna», al final, solo si tiene alguna. Con `cardId`, solo las de esa tarjeta.
 */
export function subscriptionColumns(board: Board, today: string, cardId?: CardFilter): SubscriptionGroup[] {
  const byColumn = new Map<string | null, UpcomingSubscription[]>()
  for (const item of activeSubscriptions(board, today, cardId)) {
    const key = columnOf(board, item.subscription)?.id ?? null
    byColumn.set(key, [...(byColumn.get(key) ?? []), item])
  }
  const group = (column: Column | null, items: UpcomingSubscription[]): SubscriptionGroup => ({
    column,
    items,
    totals: totals(items.map((i) => i.subscription)),
  })
  const groups = board.columns
    .filter((c) => isAssignable(c) || byColumn.has(c.id))
    .map((c) => group(c, byColumn.get(c.id) ?? []))
  const loose = byColumn.get(null)
  return loose ? [...groups, group(null, loose)] : groups
}

/** Cuántas suman unos totales (de todas las monedas). */
export const totalCount = (t: Totals) => Object.values(t).reduce((n, total) => n + total.count, 0)

/** «28,22 € / mes»; con varias monedas, una tras otra: «28,22 € · 20,00 $ / mes» (nunca se suman). '' si no hay. */
export function perMonthText(t: Totals): string {
  const parts = CURRENCIES.filter((c) => t[c]).map((c) => formatMoney(t[c].monthly, c))
  return parts.length ? `${parts.join(' · ')} / mes` : ''
}

/** Al mes y al año por moneda, de las activas de una columna (null = las que no tienen). */
export const columnTotals = (board: Board, columnId: string | null): Totals =>
  totals(subscriptionsOf(board).filter((s) => (columnOf(board, s)?.id ?? null) === columnId))

/**
 * Las columnas que ofrece la ficha: las que admiten suscripciones y, si la suya es una archivada o la
 * Bandeja, también esa (para no perderla con solo abrir la ficha).
 */
export const columnChoices = (board: Board, current: string | null): Column[] =>
  board.columns.filter((c) => isAssignable(c) || c.id === current)

/** Dónde va una nueva desde «+ Suscripción» de arriba: la última columna usada si aún vale; si no, la primera. */
export function newSubscriptionColumn(board: Board, lastId: string | null | undefined): string | null {
  const columns = board.columns.filter(isAssignable)
  return (columns.find((c) => c.id === lastId) ?? columns[0])?.id ?? null
}

// ── Tarjetas: solo un nombre ──

export const CARD_NUMBER_MESSAGE = 'Sin números de tarjeta: basta un nombre, como «BBVA» o «Revolut»'

/** Qué falla en el nombre de una tarjeta (para enseñarlo junto al campo), o null si vale. */
export function cardNameError(name: string): string | null {
  if (!name.trim()) return 'Escribe un nombre'
  return hasCardNumber(name) ? CARD_NUMBER_MESSAGE : null
}

/** Añade una tarjeta. Mismo tablero si el nombre está vacío o lleva un número de tarjeta. */
export function insertCard(board: Board, card: Card): Board {
  const name = card.name.trim().slice(0, 60)
  if (cardNameError(name) || cardsOf(board).some((c) => c.id === card.id)) return board
  return { ...board, cards: [...cardsOf(board), { ...card, name }] }
}

/** Cambia nombre o color. Un nombre vacío o con número de tarjeta no se guarda. */
export function changeCard(board: Board, id: string, patch: { name?: string; color?: ColorKey }): Board {
  const card = findCard(board, id)
  if (!card) return board
  const next = { ...card }
  if (typeof patch.name === 'string' && !cardNameError(patch.name)) next.name = patch.name.slice(0, 60)
  if (typeof patch.color === 'string') next.color = patch.color
  if (next.name === card.name && next.color === card.color) return board
  return { ...board, cards: cardsOf(board).map((c) => (c === card ? next : c)) }
}

/**
 * Borra una tarjeta. Las suscripciones que la usaban se quedan sin tarjeta (y, como cambia su
 * tarjeta, sin el aviso pendiente: el servidor crea otro sin ella).
 */
export function removeCard(board: Board, id: string): Board {
  if (!findCard(board, id)) return board
  let next: Board = { ...board, cards: cardsOf(board).filter((c) => c.id !== id) }
  for (const sub of subscriptionsOf(board)) if (sub.cardId === id) next = changeSubscription(next, sub.id, { cardId: null })
  return next
}

// ── Suscripciones ──

/** Lo que se cambia desde la ficha. `undefined` en url, notes o remind los quita. */
export type SubscriptionPatch = Partial<
  Pick<Subscription, 'name' | 'amount' | 'currency' | 'period' | 'billingDate' | 'cardId' | 'columnId' | 'url' | 'notes' | 'remind'>
>

/** Avisos que se ofrecen en la ficha (`null` = sin aviso). */
export const REMIND_OPTIONS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: null, label: 'No' },
  { value: 0, label: 'El mismo día' },
  { value: 1, label: '1 día antes' },
  { value: 3, label: '3 días antes' },
  { value: 7, label: '1 semana antes' },
]

/** «1 día antes», «El mismo día»… o «No». */
export function remindLabel(remind: number | undefined | null): string {
  if (remind === undefined || remind === null) return 'No'
  return REMIND_OPTIONS.find((o) => o.value === remind)?.label ?? `${remind} días antes`
}

const isHttp = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\/\S+$/i.test(v)

/** Los cambios válidos de `patch`: [campo, valor] (valor `undefined` = quitar el campo). */
function cleanPatch(board: Board, patch: Record<string, unknown>): [keyof Subscription, unknown][] {
  const out: [keyof Subscription, unknown][] = []
  for (const [key, value] of Object.entries(patch)) {
    switch (key) {
      case 'name':
        if (typeof value === 'string') out.push([key, value.slice(0, 60)])
        break
      case 'amount':
        if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) out.push([key, value])
        break
      case 'currency':
        if (isCurrency(value)) out.push([key, value])
        break
      case 'period':
        if (isPeriod(value)) out.push([key, value])
        break
      case 'billingDate':
        if (isDay(value)) out.push([key, value])
        break
      case 'cardId':
        if (value === null || (typeof value === 'string' && findCard(board, value))) out.push([key, value])
        break
      case 'columnId':
        if (value === null || (typeof value === 'string' && board.columns.some((c) => c.id === value))) out.push([key, value])
        break
      case 'url':
        if (value === undefined || value === null || value === '') out.push([key, undefined])
        else if (isHttp(value)) out.push([key, value])
        break
      case 'notes':
        if (value === undefined || value === null || value === '') out.push([key, undefined])
        else if (typeof value === 'string') out.push([key, value.slice(0, 10_000)])
        break
      case 'remind':
        if (value === undefined || value === null) out.push([key, undefined])
        else if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 30) out.push([key, value])
        break
    }
  }
  return out
}

/** `sub` con los cambios válidos de `patch`; la misma si no cambia nada. */
function patched(board: Board, sub: Subscription, patch: Record<string, unknown>): Subscription {
  const next = { ...sub } as Record<string, unknown>
  let changed = false
  for (const [key, value] of cleanPatch(board, patch)) {
    if (next[key] === value) continue
    changed = true
    if (value === undefined) delete next[key]
    else next[key] = value
  }
  return changed ? (next as unknown as Subscription) : sub
}

function replaceSubscription(board: Board, next: Subscription): Board {
  return { ...board, subscriptions: subscriptionsOf(board).map((s) => (s.id === next.id ? next : s)) }
}

/** Añade una suscripción (solo con sus campos válidos; lo demás, por defecto). */
export function insertSubscription(board: Board, sub: Subscription): Board {
  if (findSubscription(board, sub.id)) return board
  const blank: Subscription = {
    id: sub.id,
    name: '',
    amount: 0,
    currency: 'EUR',
    period: 'month',
    billingDate: isDay(sub.billingDate) ? sub.billingDate : localDay(),
    cardId: null,
    columnId: null,
    createdAt: sub.createdAt,
  }
  return { ...board, subscriptions: [...subscriptionsOf(board), patched(board, blank, { ...sub })] }
}

/**
 * Cambia campos de una suscripción (los que no valen se ignoran). Si cambia algo de lo que sale en el
 * aviso o decide cuándo toca (REMINDER_FIELDS), en el mismo cambio se rehace el aviso (resetReminder).
 * Si cambia de columna, su aviso pendiente se va con ella (moveReminders). Notas y enlace no lo tocan.
 */
export function changeSubscription(board: Board, id: string, patch: SubscriptionPatch): Board {
  const sub = findSubscription(board, id)
  if (!sub) return board
  const next = patched(board, sub, patch)
  if (next === sub) return board
  let updated = replaceSubscription(board, next)
  if ((next.columnId ?? null) !== (sub.columnId ?? null)) {
    updated = moveReminders(updated, id, reminderColumn(board, sub)?.id, reminderColumn(updated, next)?.id)
  }
  return REMINDER_FIELDS.some((key) => next[key] !== sub[key]) ? resetReminder(updated, id) : updated
}

/**
 * Los avisos pendientes de la suscripción `id` que están en la columna donde se crearon (`from`) pasan
 * a `to`, detrás de su última pendiente: el aviso va donde va ella. Uno que se movió a mano a otra
 * columna se queda donde está. Mismo tablero si no hay nada que mover.
 */
function moveReminders(board: Board, id: string, from: string | undefined, to: string | undefined): Board {
  if (!from || !to || from === to) return board
  const moving = board.columns.find((c) => c.id === from)?.tasks.filter((t) => t.subscriptionId === id && !t.done) ?? []
  if (moving.length === 0) return board
  const columns = board.columns.map((c) => {
    if (c.id === from) return { ...c, tasks: c.tasks.filter((t) => !moving.includes(t)) }
    if (c.id === to) return { ...c, tasks: afterLastOpen(c.tasks, moving) }
    return c
  })
  return { ...board, columns }
}

/** Da de baja (`on`, con fecha `today`) o reactiva. El aviso pendiente se quita en el mismo cambio. */
export function setCancelled(board: Board, id: string, on: boolean, today: string): Board {
  const sub = findSubscription(board, id)
  if (!sub || Boolean(sub.cancelledOn) === on) return board
  const next = { ...sub }
  if (on) next.cancelledOn = today
  else delete next.cancelledOn
  return resetReminder(replaceSubscription(board, next), id)
}

/** Borra una suscripción y su aviso pendiente (los avisos ya completados se quedan). */
export function removeSubscription(board: Board, id: string): Board {
  if (!findSubscription(board, id)) return board
  const cleared = resetReminder(board, id)
  return { ...cleared, subscriptions: subscriptionsOf(cleared).filter((s) => s.id !== id) }
}

/**
 * El aviso vuelve a empezar: se borran sus tareas de aviso pendientes (las completadas se quedan) y,
 * si había alguna, se olvida `remindedFor`, para que el servidor cree otra con los datos de ahora. Sin
 * ninguna pendiente, `remindedFor` se queda: el aviso de ese cobro ya se completó, se archivó o se borró,
 * y no vuelve (si cambia el cobro, el nuevo es otro y tendrá el suyo). Mismo tablero si no hay nada que quitar.
 */
export function resetReminder(board: Board, id: string): Board {
  const pending = (t: Task) => t.subscriptionId === id && !t.done
  if (!board.columns.some((c) => c.tasks.some(pending))) return board
  const columns = board.columns.map((c) => (c.tasks.some(pending) ? { ...c, tasks: c.tasks.filter((t) => !pending(t)) } : c))
  const sub = findSubscription(board, id)
  if (!sub || sub.remindedFor === undefined) return { ...board, columns }
  const next = { ...sub }
  delete next.remindedFor
  return replaceSubscription({ ...board, columns }, next)
}
