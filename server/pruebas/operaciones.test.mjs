import assert from 'node:assert/strict'
import test from 'node:test'
import { localDay } from '../almacen.mjs'
import { applyOperations, taggedColumn } from '../operaciones.mjs'
import { nextTaskId } from '../recurrencia.mjs'

const task = (id, extra = {}) => ({
  id,
  title: id,
  notes: '',
  done: false,
  createdAt: '2026-10-01T08:00:00.000Z',
  completedAt: null,
  due: null,
  time: null,
  ...extra,
})

function board() {
  return {
    columns: [
      { id: 'b', name: 'Bandeja', color: 'gray', inbox: true, showCompleted: false, tasks: [task('b1')] },
      { id: 'c', name: 'Casa', color: 'green', showCompleted: false, tasks: [task('c1'), task('c2', { done: true })] },
      { id: 't', name: 'Trabajo', color: 'orange', showCompleted: false, tasks: [] },
      { id: 'v', name: 'Viejo', color: 'brown', archived: true, showCompleted: false, tasks: [] },
    ],
  }
}
const ids = (b, columnId) => b.columns.find((c) => c.id === columnId).tasks.map((t) => t.id)
const find = (b, id) => b.columns.flatMap((c) => c.tasks).find((t) => t.id === id)

test('taggedColumn: solo columnas no archivadas y con título', () => {
  const { columns } = board()
  assert.equal(taggedColumn('Comprar pan #casa', columns).column.id, 'c')
  assert.equal(taggedColumn('Comprar pan #casa', columns).title, 'Comprar pan')
  assert.equal(taggedColumn('Informe #TRAB', columns).column.id, 't')
  assert.equal(taggedColumn('Cosa #viejo', columns), null)
  assert.equal(taggedColumn('Arreglar bug #123', columns), null)
  assert.equal(taggedColumn('#casa', columns), null)
  assert.equal(taggedColumn('Casa #casa en medio', columns), null)
  // Sin vista previa que avise: el nombre entero o su principio de 3 letras o más, nunca un trozo.
  assert.equal(taggedColumn('Ver capítulo #a', columns), null)
  assert.equal(taggedColumn('Ir a #ca', columns), null)
  assert.equal(taggedColumn('Algo #asa', columns), null)
  assert.equal(taggedColumn('Llamar a Ana #tra', columns).column.id, 't')
})

test('crear o mover una tarea a una columna archivada la saca del archivo (si no, no se vería)', () => {
  const b = board()
  assert.equal(applyOperations(b, [{ op: 'crearTarea', id: 'iphone-1', columna: 'v', tarea: { title: 'Añadida en el iPhone' } }]), 1)
  const viejo = b.columns.find((c) => c.id === 'v')
  assert.deepEqual(ids(b, 'v'), ['iphone-1'])
  assert.equal(viejo.archived, undefined)
  viejo.archived = true
  assert.equal(applyOperations(b, [{ op: 'moverTarea', id: 'c1', columna: 'v' }]), 1)
  assert.equal(viejo.archived, undefined)
  // Completar algo que ya estaba allí no la saca.
  viejo.archived = true
  assert.equal(applyOperations(b, [{ op: 'actualizarTarea', id: 'c1', cambios: { done: true } }]), 1)
  assert.equal(viejo.archived, true)
})

test('crearTarea con #columna la crea en esa columna, sin la etiqueta', () => {
  const b = board()
  const n = applyOperations(b, [{ op: 'crearTarea', id: 'n1', columna: 'b', tarea: { title: 'Comprar pan #casa' } }])
  assert.equal(n, 1)
  assert.deepEqual(ids(b, 'b'), ['b1'])
  assert.deepEqual(ids(b, 'c'), ['c1', 'n1', 'c2']) // tras la última pendiente
  assert.equal(find(b, 'n1').title, 'Comprar pan')
  // Reenviarla no la duplica.
  assert.equal(applyOperations(b, [{ op: 'crearTarea', id: 'n1', columna: 'b', tarea: { title: 'Comprar pan #casa' } }]), 0)
})

test('crearTarea con una etiqueta que no es columna la deja como está', () => {
  const b = board()
  applyOperations(b, [
    { op: 'crearTarea', id: 'n1', columna: 'b', tarea: { title: 'Arreglar bug #123' } },
    { op: 'crearTarea', id: 'n2', columna: 'b', tarea: { title: 'Mirar #viejo' } },
  ])
  assert.deepEqual(ids(b, 'b'), ['b1', 'n1', 'n2'])
  assert.equal(find(b, 'n1').title, 'Arreglar bug #123')
  assert.equal(find(b, 'n2').title, 'Mirar #viejo')
})

test('actualizarTarea con #columna en el título mueve la tarea; reenviarla no cambia nada', () => {
  const b = board()
  const op = { op: 'actualizarTarea', id: 'b1', cambios: { title: 'Preparar informe #trabajo' } }
  assert.equal(applyOperations(b, [op]), 1)
  assert.deepEqual(ids(b, 'b'), [])
  assert.deepEqual(ids(b, 't'), ['b1'])
  assert.equal(find(b, 'b1').title, 'Preparar informe')
  assert.equal(applyOperations(b, [op]), 0)
  // Sin cambiar el título no se mira la etiqueta.
  find(b, 'b1').title = 'Otra #casa'
  assert.equal(applyOperations(b, [{ op: 'actualizarTarea', id: 'b1', cambios: { notes: 'x' } }]), 1)
  assert.deepEqual(ids(b, 't'), ['b1'])
})

test('completar una que se repite crea la siguiente justo detrás y la original deja de repetirse', () => {
  const b = board()
  const c1 = find(b, 'c1')
  Object.assign(c1, { due: '2026-10-01', time: '09:00', repeat: { every: 'week' }, firstOn: '2026-10-01', notes: '- [x] uno\n- [ ] dos' })
  const completedAt = new Date(2026, 9, 4, 18, 30).toISOString() // 4 oct, hora local
  const op = { op: 'actualizarTarea', id: 'c1', cambios: { done: true, completedAt } }
  assert.equal(applyOperations(b, [op]), 1)
  const column = b.columns.find((c) => c.id === 'c')
  assert.equal(column.tasks.length, 3)
  const [original, next] = column.tasks
  assert.equal(original.id, 'c1')
  assert.equal(original.done, true)
  assert.equal(original.completedAt, completedAt)
  assert.equal(original.repeat, undefined)
  assert.notEqual(next.id, 'c1')
  assert.match(next.id, /^[0-9a-f-]{36}$/)
  assert.deepEqual(
    { title: next.title, done: next.done, due: next.due, time: next.time, repeat: next.repeat, completedAt: next.completedAt, firstOn: next.firstOn },
    { title: 'c1', done: false, due: '2026-10-08', time: '09:00', repeat: { every: 'week' }, completedAt: null, firstOn: undefined },
  )
  assert.equal(next.notes, '- [ ] uno\n- [ ] dos')
  // Reenviar la misma operación no crea otra.
  assert.equal(applyOperations(b, [op]), 0)
  assert.equal(column.tasks.length, 3)
})

test('sin completedAt, la siguiente cuenta desde hoy', () => {
  const b = board()
  Object.assign(find(b, 'c1'), { due: '2020-01-01', repeat: { every: 'day' } })
  applyOperations(b, [{ op: 'actualizarTarea', id: 'c1', cambios: { done: true } }])
  const next = b.columns.find((c) => c.id === 'c').tasks[1]
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  assert.equal(next.due, localDay(tomorrow))
})

test('la siguiente tiene el mismo id que pondría la app: completada a la vez en los dos sitios, sale una', () => {
  const b = board()
  Object.assign(find(b, 'c1'), { due: '2026-10-01', repeat: { every: 'week' } })
  applyOperations(b, [{ op: 'actualizarTarea', id: 'c1', cambios: { done: true } }])
  assert.equal(b.columns.find((c) => c.id === 'c').tasks[1].id, nextTaskId('c1'))
  // Si ese id ya existe (rarísimo), otro cualquiera: nunca dos tareas con el mismo id.
  const otra = board()
  Object.assign(find(otra, 'c1'), { due: '2026-10-01', repeat: { every: 'week' } })
  otra.columns[2].tasks.push(task(nextTaskId('c1')))
  applyOperations(otra, [{ op: 'actualizarTarea', id: 'c1', cambios: { done: true } }])
  const all = otra.columns.flatMap((c) => c.tasks.map((t) => t.id))
  assert.equal(new Set(all).size, all.length)
})

test('desmarcar una que se repetía: si su siguiente sigue tal cual, se quita y la regla vuelve', () => {
  const b = board()
  Object.assign(find(b, 'c1'), { due: '2026-10-01', time: '09:00', repeat: { every: 'week' }, notes: '- [x] uno' })
  applyOperations(b, [{ op: 'actualizarTarea', id: 'c1', cambios: { done: true } }])
  assert.deepEqual(ids(b, 'c'), ['c1', nextTaskId('c1'), 'c2'])
  assert.equal(applyOperations(b, [{ op: 'actualizarTarea', id: 'c1', cambios: { done: false } }]), 1)
  assert.deepEqual(ids(b, 'c'), ['c1', 'c2'])
  assert.deepEqual(find(b, 'c1').repeat, { every: 'week' })
  assert.equal(find(b, 'c1').done, false)
  // Volver a completarla vuelve a crear la siguiente (una sola).
  applyOperations(b, [{ op: 'actualizarTarea', id: 'c1', cambios: { done: true } }])
  assert.deepEqual(ids(b, 'c'), ['c1', nextTaskId('c1'), 'c2'])

  // Si la siguiente ya se ha cambiado, se queda (y la original, sin regla).
  find(b, nextTaskId('c1')).title = 'Cambiada'
  applyOperations(b, [{ op: 'actualizarTarea', id: 'c1', cambios: { done: false } }])
  assert.deepEqual(ids(b, 'c'), ['c1', nextTaskId('c1'), 'c2'])
  assert.equal(find(b, 'c1').repeat, undefined)
})

test('completar una que no se repite no crea nada', () => {
  const b = board()
  applyOperations(b, [{ op: 'actualizarTarea', id: 'c1', cambios: { done: true } }])
  assert.deepEqual(ids(b, 'c'), ['c1', 'c2'])
})

test('el resto de operaciones sigue igual', () => {
  const b = board()
  assert.equal(applyOperations(b, [{ op: 'moverTarea', id: 'c1', columna: 't' }]), 1)
  assert.deepEqual(ids(b, 't'), ['c1'])
  assert.equal(applyOperations(b, [{ op: 'borrarTarea', id: 'c1' }]), 1)
  assert.equal(applyOperations(b, [{ op: 'renombrarColumna', id: 't', name: ' Oficina ' }]), 1)
  assert.equal(b.columns.find((c) => c.id === 't').name, 'Oficina')
  assert.equal(applyOperations(b, [{ op: 'nada' }, null]), 0)
})
