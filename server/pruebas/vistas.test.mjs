// Lógica pura de las vistas «Hoy», «Algún día», «Sin fecha» y el número del Dock (src/today.ts).
// Es TypeScript sin dependencias: Node lo ejecuta quitando los tipos.
import assert from 'node:assert/strict'
import test from 'node:test'

const ts = Boolean(process.features.typescript)
const today = ts ? await import(new URL('../../src/today.ts', import.meta.url).href) : null
const opts = { skip: ts ? false : 'Este Node no ejecuta TypeScript' }

const HOY = '2026-10-04'
let n = 0
const task = (title, extra = {}) => ({
  id: `t${++n}`,
  title,
  notes: '',
  done: false,
  createdAt: '2026-10-01T10:00:00.000Z',
  completedAt: null,
  due: null,
  time: null,
  ...extra,
})
const column = (name, tasks, extra = {}) => ({ id: name.toLowerCase(), name, color: 'blue', showCompleted: false, tasks, ...extra })
const titles = (items) => items.map((i) => i.task.title)

/** Mediodía local de HOY en ISO (para completedAt). */
const noon = (day) => new Date(`${day}T12:00:00`).toISOString()

function sample() {
  return {
    columns: [
      column('Bandeja', [task('Sin clasificar')], { inbox: true }),
      column('Trabajo', [
        task('Informe', { due: HOY }),
        task('Llamada', { due: HOY, time: '16:00' }),
        task('Reunión', { due: HOY, time: '09:30' }),
        task('Factura', { due: '2026-10-02' }),
        task('Correo', { due: '2026-10-03', time: '08:00' }),
        task('Hecha hoy', { due: HOY, done: true, completedAt: noon(HOY) }),
        task('Hecha ayer', { due: '2026-10-03', done: true, completedAt: noon('2026-10-03') }),
      ]),
      column('Casa', [task('Plantas', { someday: true }), task('Pintar'), task('Lámpara', { firstOn: HOY })]),
      column('Viejo', [task('Archivada', { due: HOY })], { archived: true }),
      column('Proyecto', [task('Leer', { someday: true }), task('Escribir README'), task('Otra')]),
      column('Mañana', [task('Mañana', { due: '2026-10-05' }), task('Siguiente')]),
    ],
  }
}

test('Hoy: lo primero, atrasadas, las de hoy por columna y por hora, hechas hoy', opts, () => {
  const data = today.todayData(sample(), HOY)
  assert.equal(data.first.task.title, 'Lámpara')
  assert.deepEqual(titles(data.overdue), ['Factura', 'Correo'])
  assert.deepEqual(
    data.groups.map((g) => [g.column.name, titles(g.items)]),
    [['Trabajo', ['Reunión', 'Llamada', 'Informe']]],
  )
  assert.deepEqual(titles(data.done), ['Hecha hoy'])
  // 1 primero + 2 atrasadas + 3 de hoy; nada de columnas archivadas.
  assert.equal(data.count, 6)
})

test('Siguiente en cada proyecto: sin Bandeja, sin columnas con algo para hoy, sin «algún día»', opts, () => {
  const data = today.todayData(sample(), HOY)
  // Trabajo tiene cosas para hoy; Casa tiene «Lo primero»; Viejo está archivada.
  assert.deepEqual(
    data.next.map((i) => [i.column.name, i.task.title]),
    [
      ['Proyecto', 'Escribir README'],
      ['Mañana', 'Siguiente'],
    ],
  )
})

test('«Lo primero» completada no ocupa el hueco', opts, () => {
  const board = { columns: [column('A', [task('Hecha', { firstOn: HOY, done: true, completedAt: noon(HOY) }), task('Hoy', { due: HOY })])] }
  const data = today.todayData(board, HOY)
  assert.equal(data.first, null)
  assert.deepEqual(titles(data.done), ['Hecha'])
})

test('número del Dock: pendientes con fecha de hoy o antes, sin algún día ni archivadas', opts, () => {
  assert.equal(today.dueCount(sample(), HOY), 5)
  assert.equal(today.dueCount({ columns: [] }, HOY), 0)
})

test('«algún día» solo si no tiene fecha (si la tiene, manda la fecha)', opts, () => {
  assert.equal(today.isSomeday(task('a', { someday: true })), true)
  assert.equal(today.isSomeday(task('b', { someday: true, due: HOY })), false)
  assert.equal(today.isSomeday(task('c')), false)
})

test('Sin fecha: pendientes sin día ni «algún día», por columna', opts, () => {
  const groups = today.undatedGroups(sample())
  assert.deepEqual(
    groups.map((g) => [g.column.name, titles(g.items)]),
    [
      ['Bandeja', ['Sin clasificar']],
      ['Casa', ['Pintar', 'Lámpara']],
      ['Proyecto', ['Escribir README', 'Otra']],
      ['Mañana', ['Siguiente']],
    ],
  )
})

test('setFirstOn deja una sola por día y null la quita', opts, () => {
  const board = sample()
  const pintar = board.columns[2].tasks[1]
  const next = today.setFirstOn(board, pintar.id, HOY)
  const firsts = next.columns.flatMap((c) => c.tasks).filter((t) => t.firstOn === HOY)
  assert.deepEqual(firsts.map((t) => t.title), ['Pintar'])
  assert.equal(today.setFirstOn(next, pintar.id, HOY), next, 'sin cambios devuelve el mismo tablero')
  const none = today.setFirstOn(next, null, HOY)
  assert.equal(none.columns.flatMap((c) => c.tasks).some((t) => t.firstOn === HOY), false)
  // Las de otros días no se tocan.
  const other = { columns: [column('A', [task('x', { firstOn: '2026-10-01' })])] }
  assert.equal(today.setFirstOn(other, null, HOY), other)
})

test('rescheduleTasks: varias a la vez, conservan la hora y dejan de ser «algún día»', opts, () => {
  const board = sample()
  const [factura, correo] = board.columns[1].tasks.slice(3, 5)
  const plantas = board.columns[2].tasks[0]
  const next = today.rescheduleTasks(board, [factura.id, correo.id, plantas.id], HOY)
  const all = next.columns.flatMap((c) => c.tasks)
  const byId = (id) => all.find((t) => t.id === id)
  assert.equal(byId(factura.id).due, HOY)
  assert.equal(byId(correo.id).time, '08:00')
  assert.equal(byId(plantas.id).due, HOY)
  assert.equal('someday' in byId(plantas.id), false)
  assert.equal(next.columns[0], board.columns[0], 'las columnas sin cambios se reutilizan')
  assert.equal(today.rescheduleTasks(next, [factura.id], HOY), next)
})

test('withSomeday quita fecha, hora, avisos, repetición y «Lo primero»; al revés solo la marca', opts, () => {
  const t = task('x', { due: HOY, time: '10:00', alerts: [0], repeat: { every: 'week' }, firstOn: HOY })
  const on = today.withSomeday(t, true)
  assert.equal(on.someday, true)
  assert.equal(on.due, null)
  assert.equal(on.time, null)
  for (const key of ['alerts', 'repeat', 'firstOn']) assert.equal(key in on, false, key)
  assert.equal(today.withSomeday(on, true), on)
  const off = today.withSomeday(on, false)
  assert.equal('someday' in off, false)
  assert.equal(today.withSomeday(off, false), off)
})

test('openIndexFor traduce el puesto de la lista arrastrable (sin «algún día») al de todas las pendientes', opts, () => {
  const a = task('a')
  const s1 = task('s1', { someday: true })
  const b = task('b')
  const s2 = task('s2', { someday: true })
  const c = task('c')
  const hecha = task('hecha', { done: true })
  const board = { columns: [column('X', [a, s1, b, hecha, s2, c]), column('Y', [])] }
  // Lista visible de X: a, b, c. Pendientes: a, s1, b, s2, c.
  assert.equal(today.openIndexFor(board, 'nueva', 'x', 0), 0) // antes de a
  assert.equal(today.openIndexFor(board, 'nueva', 'x', 1), 2) // antes de b
  assert.equal(today.openIndexFor(board, 'nueva', 'x', 2), 4) // antes de c
  assert.equal(today.openIndexFor(board, 'nueva', 'x', 3), Infinity) // al final
  // Moviendo «a» dentro de X: la lista sin ella es b, c.
  assert.equal(today.openIndexFor(board, a.id, 'x', 1), 3) // antes de c, entre s1, b, s2, c
  assert.equal(today.openIndexFor(board, a.id, 'y', 0), Infinity)
})

test('localDay usa la hora local', opts, () => {
  assert.equal(today.localDay(noon(HOY)), HOY)
  assert.equal(today.localDay(null), null)
  assert.equal(today.localDay('no es una fecha'), null)
})
