export type BillingPeriod = 'week' | 'month' | 'quarter' | 'half' | 'year'
export type Currency = 'EUR' | 'USD' | 'GBP'

/** Lo que estas funciones necesitan de una suscripción (src/model.ts tiene el tipo completo). */
export interface SubscriptionLike {
  id: string
  name: string
  /** Céntimos. */
  amount: number
  currency: string
  period: BillingPeriod
  /** Un día de cobro conocido, 'AAAA-MM-DD'. */
  billingDate: string
  cardId: string | null
  remind?: number
  remindedFor?: string
  cancelledOn?: string
}

/** Por moneda, en céntimos sin redondear: { EUR: { monthly, yearly, count } }. */
export type Totals = Record<string, { monthly: number; yearly: number; count: number }>

export interface ReminderDue<S extends SubscriptionLike = SubscriptionLike> {
  subscription: S
  /** El próximo cobro. */
  charge: string
  /** El día de la tarea de aviso (el del aviso, o hoy si ya pasó). */
  due: string
}

export const PERIODS: BillingPeriod[]
export const CURRENCIES: Currency[]
export function isPeriod(value: unknown): value is BillingPeriod
export function isCurrency(value: unknown): value is Currency
/** 'Semanal' | 'Mensual' | 'Trimestral' | 'Semestral' | 'Anual' */
export function periodLabel(period: BillingPeriod): string
/** 'semana' | 'mes' | 'trimestre' | 'semestre' | 'año' (para «12,99 € / mes»). */
export function periodUnit(period: BillingPeriod): string

/** ¿Es un día real 'AAAA-MM-DD', desde 1900? */
export function isDay(value: unknown): value is string
/** Hoy (o `d`), 'AAAA-MM-DD' en hora local. */
export function localDay(d?: Date): string
export function addDays(day: string, n: number): string
/** Días de `from` a `to` (negativo si `to` es antes). */
export function daysBetween(from: string, to: string): number

/** El primer cobro el día `today` o después; null si está dada de baja. */
export function chargeAfter(sub: SubscriptionLike, today: string): string | null
/** Los cobros entre `from` y `to` (incluidos); ninguno si está dada de baja. */
export function chargesBetween(sub: SubscriptionLike, from: string, to: string, options?: { max?: number }): string[]

/** Céntimos al año. */
export function yearlyAmount(sub: Pick<SubscriptionLike, 'amount' | 'period'>): number
/** Céntimos al mes, sin redondear. */
export function monthlyAmount(sub: Pick<SubscriptionLike, 'amount' | 'period'>): number
/** Totales de las activas por moneda; con `cardId`, solo las de esa tarjeta (null = sin tarjeta). */
export function totals(subs: readonly SubscriptionLike[] | undefined, options?: { cardId?: string | null }): Totals
/** «12,99 €» */
export function formatMoney(cents: number, currency?: string): string
/** «12,99», «1.299,00», «€ 9,5»… → céntimos; null si no se entiende. */
export function parseMoney(text: string): number | null

/** ¿6 cifras o más, las separe lo que las separe (un número de tarjeta)? «N26 ··1234» vale. */
export function hasCardNumber(name: unknown): boolean
export function withoutDigits(name: string): string

/** «15 oct» (con el año si no es el de `today`). */
export function chargeDayText(day: string, today: string): string
/** «Netflix se cobra el 15 oct · 12,99 € · BBVA» */
export function reminderTitle(
  sub: SubscriptionLike,
  charge: string,
  options?: { today?: string; cards?: readonly { id: string; name: string }[] },
): string
export function hasReminder(sub: Pick<SubscriptionLike, 'remind'> | null | undefined): boolean
export const REMINDER_LEAD: number
/** Lo que sale en la tarea de aviso o decide cuándo toca. */
export const REMINDER_FIELDS: readonly ['name', 'amount', 'currency', 'period', 'billingDate', 'cardId', 'remind']

interface BoardLike {
  columns: { id: string; inbox?: boolean; archived?: boolean; tasks: unknown[] }[]
  cards?: { id: string; name: string }[]
  subscriptions?: SubscriptionLike[]
}

export function remindersDue<B extends BoardLike>(board: B, today: string): ReminderDue<NonNullable<B['subscriptions']>[number]>[]
/** Modifica `board`: crea las tareas de aviso que tocan y anota `remindedFor`. Devuelve cuántas. */
export function applyReminders(board: BoardLike, today: string, options: { newId: () => string; now?: string }): number
