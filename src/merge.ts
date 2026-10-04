import type { Board, Column, Task } from './model'

/**
 * Fusión a tres bandas, por ids: une los cambios locales (`ours`) con los que llegaron
 * de fuera (`theirs`: otra ventana, una tarea completada en el iPhone…), partiendo
 * de la última versión común (`base`). Si los dos cambian el mismo campo, gana el local.
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

  return { ...theirs, ...ours, columns: [...columns.values()] }
}

function mergeTask(b: Task | undefined, o: Task | undefined, t: Task | undefined): Task {
  if (!o || !t || !b) return (o ?? t)!
  const merged = { ...t, ...o }
  merged.title = pick(b.title, o.title, t.title)
  merged.notes = pick(b.notes, o.notes, t.notes)
  merged.due = pick(b.due, o.due, t.due)
  merged.time = pick(b.time, o.time, t.time)
  merged.alerts = JSON.stringify(o.alerts) !== JSON.stringify(b.alerts) ? o.alerts : t.alerts
  // «Hecha» y su fecha van juntas.
  const doneFrom = o.done !== b.done ? o : t
  merged.done = doneFrom.done
  merged.completedAt = doneFrom.completedAt
  return merged
}

/** El valor de quien lo cambió; si cambiaron ambos, el local. */
const pick = <V>(base: V, ours: V, theirs: V): V => (ours !== base ? ours : theirs)

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
