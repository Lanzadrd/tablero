import { REMINDER_FIELDS } from '../server/suscripciones.mjs'
import type { Board, Column, Subscription, Task } from './model'

/**
 * Fusión a tres bandas, por ids: une los cambios locales (`ours`) con los que llegaron
 * de fuera (`theirs`: otra ventana, una tarea completada en el iPhone, el aviso de una
 * suscripción que crea el servidor…), partiendo de la última versión común (`base`). Si los
 * dos cambian el mismo campo, gana el local.
 */
export function mergeBoards(base: Board, ours: Board, theirs: Board): Board {
  const B = locate(base)
  const O = locate(ours)
  const T = locate(theirs)
  const baseCols = byId(base.columns)
  const ourCols = byId(ours.columns)
  const theirCols = byId(theirs.columns)

  // Columnas: se borra la que uno de los dos borró; se añaden las nuevas de ambos.
  const columnOrder = pickOrder(
    base.columns.map((c) => c.id),
    ours.columns.map((c) => c.id),
    theirs.columns.map((c) => c.id),
  )
  const columns = new Map<string, Column>()
  for (const id of columnOrder) {
    const b = baseCols.get(id)
    const o = ourCols.get(id)
    const t = theirCols.get(id)
    if (b ? !(o && t) : !(o || t)) continue
    const merged = { ...t, ...o } as Column
    if (b && o && t) {
      merged.name = pick(b.name, o.name, t.name)
      merged.color = pick(b.color, o.color, t.color)
      merged.showCompleted = pick(b.showCompleted, o.showCompleted, t.showCompleted)
      merged.inbox = pick(b.inbox, o.inbox, t.inbox)
      merged.archived = pick(b.archived, o.archived, t.archived)
      merged.project = pickJson(b.project, o.project, t.project)
    }
    columns.set(id, { ...merged, tasks: [] })
  }

  // Tareas: campo a campo; la columna es la de quien la movió.
  const placed = new Map<string, Task[]>()
  for (const id of new Set([...O.keys(), ...T.keys()])) {
    const b = B.get(id)
    const o = O.get(id)
    const t = T.get(id)
    if (b ? !(o && t) : !(o || t)) continue
    const task = mergeTask(b?.task, o?.task, t?.task)
    const columnId = o && (!b || o.columnId !== b.columnId) ? o.columnId : (t ?? o)!.columnId
    if (!columns.has(columnId)) continue
    const list = placed.get(columnId) ?? []
    list.push(task)
    placed.set(columnId, list)
  }

  for (const [id, column] of columns) {
    const tasks = placed.get(id) ?? []
    const order = pickOrder(
      (baseCols.get(id)?.tasks ?? []).map((t) => t.id),
      (ourCols.get(id)?.tasks ?? []).map((t) => t.id),
      (theirCols.get(id)?.tasks ?? []).map((t) => t.id),
    )
    const rank = new Map(order.map((taskId, i) => [taskId, i]))
    column.tasks = tasks.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity))
  }

  const merged: Board = { ...theirs, ...ours, columns: [...columns.values()] }
  // Tarjetas y suscripciones: por id y campo a campo (si el servidor anota `remindedFor` mientras
  // aquí se cambia el precio, se quedan los dos).
  const cards = mergeList(base.cards, ours.cards, theirs.cards)
  if (cards) merged.cards = cards
  const subscriptions = mergeList(base.subscriptions, ours.subscriptions, theirs.subscriptions)
  if (subscriptions) {
    // Una tarjeta que se borró en un lado mientras en el otro se elegía: sin tarjeta.
    const cardIds = new Set((cards ?? []).map((c) => c.id))
    merged.subscriptions = subscriptions.map((s) => (s.cardId && !cardIds.has(s.cardId) ? { ...s, cardId: null } : s))
  }
  return settleReminders(merged, base, ours, theirs)
}

/**
 * Los avisos de las suscripciones, coherentes tras fusionar. Si aquí se cambió una (algo de lo que sale
 * en su aviso o decide cuándo toca, o la baja) mientras el servidor creaba su aviso con los datos de
 * antes, ese aviso sobra: se quita y `remindedFor` vuelve a ser el de aquí, para que el servidor cree
 * otro (como hace resetReminder en src/subscriptions.ts). Y los avisos pendientes de una suscripción
 * que ya no existe, también se quitan.
 */
function settleReminders(merged: Board, base: Board, ours: Board, theirs: Board): Board {
  if (!merged.subscriptions) return merged
  const B = byId(base.subscriptions ?? [])
  const O = byId(ours.subscriptions ?? [])
  const M = byId(merged.subscriptions)
  const differs = (a: Subscription, b: Subscription, key: keyof Subscription) => JSON.stringify(a[key]) !== JSON.stringify(b[key])
  const changedHere = new Set<string>()
  for (const [id, o] of O) {
    const b = B.get(id)
    if (b && [...REMINDER_FIELDS, 'cancelledOn' as const].some((key) => differs(b, o, key))) changedHere.add(id)
  }
  const known = new Set([...B.keys(), ...O.keys(), ...(theirs.subscriptions ?? []).map((s) => s.id)])
  const ourTasks = new Set(ours.columns.flatMap((c) => c.tasks.map((t) => t.id)))
  const stale = (t: Task) =>
    !t.done &&
    !!t.subscriptionId &&
    ((changedHere.has(t.subscriptionId) && !ourTasks.has(t.id)) || (known.has(t.subscriptionId) && !M.has(t.subscriptionId)))

  const cleared = new Set<string>()
  const columns = merged.columns.map((c) => {
    if (!c.tasks.some(stale)) return c
    for (const t of c.tasks) if (stale(t)) cleared.add(t.subscriptionId!)
    return { ...c, tasks: c.tasks.filter((t) => !stale(t)) }
  })
  if (cleared.size === 0) return merged
  const subscriptions = merged.subscriptions.map((s) => {
    const o = O.get(s.id)
    if (!cleared.has(s.id) || !o || s.remindedFor === o.remindedFor) return s
    const next = { ...s }
    if (o.remindedFor === undefined) delete next.remindedFor
    else next.remindedFor = o.remindedFor
    return next
  })
  return { ...merged, columns, subscriptions }
}

/**
 * Listas de elementos con id (tarjetas, suscripciones): se borra lo que uno de los dos borró, se
 * añade lo nuevo de ambos y cada elemento se fusiona campo a campo. undefined si ninguna versión
 * tiene la lista.
 */
function mergeList<T extends { id: string }>(base: T[] | undefined, ours: T[] | undefined, theirs: T[] | undefined): T[] | undefined {
  if (!base && !ours && !theirs) return undefined
  const B = byId(base ?? [])
  const O = byId(ours ?? [])
  const T = byId(theirs ?? [])
  const ids = (list: T[] | undefined) => (list ?? []).map((item) => item.id)
  const out: T[] = []
  for (const id of pickOrder(ids(base), ids(ours), ids(theirs))) {
    const b = B.get(id)
    const o = O.get(id)
    const t = T.get(id)
    if (b ? !(o && t) : !(o || t)) continue
    out.push(b && o && t ? mergeFields(b, o, t) : (o ?? t)!)
  }
  return out
}

/** Campo a campo: el valor de quien lo cambió (quitar un campo también es cambiarlo). */
function mergeFields<T extends object>(b: T, o: T, t: T): T {
  const merged: Record<string, unknown> = {}
  const [base, ours, theirs] = [b, o, t] as Record<string, unknown>[]
  for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs), ...Object.keys(base)])) {
    const value = pickJson(base[key], ours[key], theirs[key])
    if (value !== undefined) merged[key] = value
  }
  return merged as T
}

function mergeTask(b: Task | undefined, o: Task | undefined, t: Task | undefined): Task {
  if (!o || !t || !b) return (o ?? t)!
  const merged = { ...t, ...o }
  merged.title = pick(b.title, o.title, t.title)
  merged.notes = pick(b.notes, o.notes, t.notes)
  merged.due = pick(b.due, o.due, t.due)
  merged.time = pick(b.time, o.time, t.time)
  merged.alerts = pickJson(b.alerts, o.alerts, t.alerts)
  merged.firstOn = pick(b.firstOn, o.firstOn, t.firstOn)
  merged.someday = pick(b.someday, o.someday, t.someday)
  merged.repeat = pickJson(b.repeat, o.repeat, t.repeat)
  // «Hecha» y su fecha van juntas.
  const doneFrom = o.done !== b.done ? o : t
  merged.done = doneFrom.done
  merged.completedAt = doneFrom.completedAt
  return merged
}

/** El valor de quien lo cambió; si cambiaron ambos, el local. */
const pick = <V>(base: V, ours: V, theirs: V): V => (ours !== base ? ours : theirs)

/** Igual que `pick`, para objetos y listas (se comparan por contenido). */
const pickJson = <V>(base: V, ours: V, theirs: V): V => (JSON.stringify(ours) !== JSON.stringify(base) ? ours : theirs)

/** Orden de quien reordenó (el local si ambos), con lo nuevo del otro al final. */
function pickOrder(base: string[], ours: string[], theirs: string[]) {
  const oursReordered = !sameRelativeOrder(base, ours)
  const [first, second] = oursReordered || sameRelativeOrder(base, theirs) ? [ours, theirs] : [theirs, ours]
  return [...new Set([...first, ...second])]
}

function sameRelativeOrder(a: string[], b: string[]) {
  const inB = new Set(b)
  const inA = new Set(a)
  const x = a.filter((id) => inB.has(id))
  const y = b.filter((id) => inA.has(id))
  return x.every((id, i) => id === y[i])
}

function byId<T extends { id: string }>(items: T[]) {
  return new Map(items.map((item) => [item.id, item]))
}

function locate(board: Board) {
  const found = new Map<string, { task: Task; columnId: string }>()
  for (const column of board.columns) for (const task of column.tasks) found.set(task.id, { task, columnId: column.id })
  return found
}
