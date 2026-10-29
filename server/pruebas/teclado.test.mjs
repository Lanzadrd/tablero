// Lógica pura del teclado: cambios a varias tareas a la vez (src/batch.ts) y la búsqueda de la
// paleta ⌘K (src/search.ts). Es TypeScript sin dependencias: Node lo ejecuta quitando los tipos.
import assert from 'node:assert/strict'
import test from 'node:test'

const ts = Boolean(process.features.typescript)
const load = async (file) => (ts ? import(new URL(`../../src/${file}`, import.meta.url).href) : null)
const batch = await load('batch.ts')
const search = await load('search.ts')
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
const titles = (col) => col.tasks.map((t) => t.title)

// ── Varias tareas a la vez ──

test('scheduleTask: pone el día, conserva la hora y deja de ser «algún día»', opts, () => {
  const t = task('Llamar', { due: '2026-10-01', time: '10:30', someday: true })
  const next = batch.scheduleTask(t, HOY, HOY)
  assert.equal(next.due, HOY)
  assert.equal(next.time, '10:30')
  assert.equal('someday' in next, false)
  assert.equal(t.due, '2026-10-01', 'no toca la original')
})

test('scheduleTask: «Lo primero» de hoy se pierde si se va a otro día, no si se queda', opts, () => {
  const t = task('Informe', { due: HOY, firstOn: HOY })
  assert.equal(batch.scheduleTask(t, HOY, HOY), t, 'sin cambios: el mismo objeto')
  const manana = batch.scheduleTask(t, '2026-10-05', HOY)
  assert.equal(manana.due, '2026-10-05')
  assert.equal('firstOn' in manana, false)
  // La de otro día no se toca.
  const otra = task('Otra', { due: HOY, firstOn: '2026-10-03' })
  assert.equal(batch.scheduleTask(otra, '2026-10-05', HOY).firstOn, '2026-10-03')
})

test('undateTask: sin fecha, hora, avisos ni repetición; si ya lo estaba, la misma', opts, () => {
  const t = task('Dentista', { due: HOY, time: '09:00', alerts: [0], repeat: { every: 'month' } })
  const next = batch.undateTask(t)
  assert.equal(next.due, null)
  assert.equal(next.time, null)
  assert.equal('alerts' in next, false)
  assert.equal('repeat' in next, false)
  const plain = task('Nada')
  assert.equal(batch.undateTask(plain), plain)
})

test('mapTasks: solo las elegidas y el mismo tablero si nada cambia', opts, () => {
  const a = task('A')
  const b = task('B')
  const board = { columns: [column('Uno', [a]), column('Dos', [b])] }
  assert.equal(batch.mapTasks(board, [a.id], (t) => t), board)
  const next = batch.mapTasks(board, [a.id, b.id], (t) => ({ ...t, due: HOY }))
  assert.deepEqual(
    next.columns.map((c) => c.tasks[0].due),
    [HOY, HOY],
  )
  assert.equal(batch.mapTasks(board, ['no-existe'], () => task('X')), board)
})

test('moveTasksTo: van tras la última pendiente del destino, en el orden del tablero', opts, () => {
  const a = task('A')
  const b = task('B')
  const c = task('C')
  const x = task('X')
  const hecha = task('Hecha', { done: true, completedAt: '2026-10-02T10:00:00.000Z' })
  const board = { columns: [column('Uno', [a, b]), column('Dos', [c]), column('Tres', [x, hecha])] }
  const next = batch.moveTasksTo(board, [c.id, a.id], 'tres')
  assert.deepEqual(titles(next.columns[0]), ['B'])
  assert.deepEqual(titles(next.columns[1]), [])
  assert.deepEqual(titles(next.columns[2]), ['X', 'A', 'C', 'Hecha'])
  // Las que ya están ahí, o una columna que no existe: nada.
  assert.equal(batch.moveTasksTo(board, [x.id], 'tres'), board)
  assert.equal(batch.moveTasksTo(board, [a.id], 'nada'), board)
})

test('removeTasks: quita varias de columnas distintas', opts, () => {
  const a = task('A')
  const b = task('B')
  const c = task('C')
  const board = { columns: [column('Uno', [a, b]), column('Dos', [c])] }
  const next = batch.removeTasks(board, [a.id, c.id])
  assert.deepEqual(next.columns.map(titles), [['B'], []])
  assert.equal(batch.removeTasks(board, ['no-existe']), board)
})

test('duplicateTasks: la copia va justo detrás, pendiente, con id nuevo y sin «Lo primero»', opts, () => {
  const a = task('A', { due: HOY, time: '10:00', notes: 'n', repeat: { every: 'week' }, firstOn: HOY })
  const b = task('B', { done: true, completedAt: '2026-10-02T10:00:00.000Z' })
  const c = task('C')
  const board = { columns: [column('Uno', [a, b, c])] }
  const next = batch.duplicateTasks(board, [a.id, b.id], ['copia-a', 'copia-b'], '2026-10-04T12:00:00.000Z')
  const tasks = next.columns[0].tasks
  assert.deepEqual(
    tasks.map((t) => t.id),
    [a.id, 'copia-a', b.id, 'copia-b', c.id],
  )
  const copia = tasks[1]
  assert.equal(copia.title, 'A')
  assert.equal(copia.due, HOY)
  assert.equal(copia.time, '10:00')
  assert.deepEqual(copia.repeat, { every: 'week' })
  assert.equal(copia.createdAt, '2026-10-04T12:00:00.000Z')
  assert.equal('firstOn' in copia, false)
  assert.equal(tasks[3].done, false, 'la copia de una completada queda pendiente')
  assert.equal(tasks[3].completedAt, null)
  assert.equal(tasks[0].firstOn, HOY, 'la original no cambia')
})

test('duplicateTasks: la copia de un aviso de suscripción es una tarea más (no se va con el aviso)', opts, () => {
  const aviso = task('Netflix se cobra el 15 oct', { done: true, due: '2026-10-14', subscriptionId: 'netflix', subscriptionCharge: '2026-10-15' })
  const board = { columns: [column('Bandeja', [aviso])] }
  const [original, copia] = batch.duplicateTasks(board, [aviso.id], ['copia'], '2026-10-04T12:00:00.000Z').columns[0].tasks
  assert.equal('subscriptionId' in copia, false)
  assert.equal('subscriptionCharge' in copia, false)
  assert.equal(copia.done, false)
  assert.equal(original.subscriptionId, 'netflix', 'la original sigue siendo el aviso')
})

// ── Búsqueda ──

test('matchTask: título que empieza > palabra que empieza > contiene > notas', opts, () => {
  assert.equal(search.matchTask('Llamar a Marta', '', 'llam').rank, 0)
  assert.equal(search.matchTask('Hay que llamar', '', 'llam').rank, 1)
  assert.equal(search.matchTask('Rellamar', '', 'llam').rank, 2)
  assert.equal(search.matchTask('Otra cosa', 'llamar mañana', 'llam').rank, 3)
  assert.equal(search.matchTask('Otra cosa', '', 'llam'), null)
  assert.equal(search.matchTask('Algo', '', '   '), null)
})

test('matchTask: sin mayúsculas ni acentos, y resalta en el texto original', opts, () => {
  const m = search.matchTask('Comprar CAFÉ en Málaga', '', 'cafe')
  assert.equal(m.rank, 1)
  assert.deepEqual(m.title, [{ start: 8, end: 12 }])
  assert.equal('Comprar CAFÉ en Málaga'.slice(8, 12), 'CAFÉ')
  assert.equal(search.matchTask('Ir a Málaga', '', 'MALAGA').rank, 1)
  // El texto en NFD (p. ej. desde otro sistema) también encaja.
  assert.equal(search.matchTask('Café solo', '', 'café').rank, 0)
})

test('matchTask: varias palabras sueltas, en el título o en las notas', opts, () => {
  const m = search.matchTask('Llamar a Marta', 'por lo del presupuesto', 'marta presupuesto')
  assert.equal(m.rank, 3)
  assert.deepEqual(m.title, [{ start: 9, end: 14 }])
  assert.equal(m.notes.length, 1)
  assert.equal(search.matchTask('Llamar a Marta', '', 'marta llamar').rank, 2)
  assert.equal(search.matchTask('Llamar a Marta', '', 'marta pepe'), null)
})

test('matchLabel: columnas y comandos', opts, () => {
  assert.equal(search.matchLabel('Trabajo', 'tra').rank, 0)
  assert.equal(search.matchLabel('Nueva columna', 'col').rank, 1)
  assert.deepEqual(search.matchLabel('Nueva columna', 'col').ranges, [{ start: 6, end: 9 }])
  assert.equal(search.matchLabel('Calendario', 'xyz'), null)
})

test('searchBoard: pendientes y completadas aparte, las que mejor encajan primero', opts, () => {
  const board = {
    columns: [
      column('Uno', [
        task('Revisar factura'),
        task('Factura de la luz'),
        task('Pagar', { notes: 'la factura' }),
        task('Facturas viejas', { done: true, completedAt: '2026-10-01T10:00:00.000Z' }),
        task('Factura del gas', { done: true, completedAt: '2026-10-03T10:00:00.000Z' }),
      ]),
      column('Dos', [task('Sin relación')]),
    ],
  }
  const { open, done } = search.searchBoard(board, 'factura')
  assert.deepEqual(
    open.map((h) => h.task.title),
    ['Factura de la luz', 'Revisar factura', 'Pagar'],
  )
  assert.deepEqual(
    done.map((h) => h.task.title),
    ['Factura del gas', 'Facturas viejas'],
    'a igual encaje, la completada más reciente primero',
  )
  assert.equal(open[0].column.name, 'Uno')
})

test('searchArchive: busca en las archivadas y tolera entradas raras', opts, () => {
  const entries = [
    { ...task('Viejo informe'), columnId: 'uno', columnName: 'Uno', archivedAt: '2026-09-01T10:00:00.000Z' },
    { ...task('Informe anual'), columnId: 'uno', columnName: 'Uno', archivedAt: '2026-09-20T10:00:00.000Z' },
    { ...task('Informe'), columnId: 'dos', columnName: 'Dos', archivedAt: '2026-08-01T10:00:00.000Z' },
    { id: 'roto' },
    null,
  ]
  const hits = search.searchArchive(entries, 'informe')
  assert.deepEqual(
    hits.map((h) => h.task.title),
    ['Informe anual', 'Informe', 'Viejo informe'],
  )
})

test('snippet: la línea de las notas con lo encontrado, recortada y con el resaltado en su sitio', opts, () => {
  const notes = 'Primera línea\nAquí está la palabra clave que buscamos\nOtra'
  const m = search.matchTask('Título', notes, 'clave')
  const s = search.snippet(notes, m.notes)
  assert.equal(s.text, 'Aquí está la palabra clave que buscamos')
  assert.equal(s.text.slice(s.ranges[0].start, s.ranges[0].end), 'clave')

  const long = `${'a'.repeat(100)} objetivo ${'b'.repeat(100)}`
  const m2 = search.matchTask('x', long, 'objetivo')
  const s2 = search.snippet(long, m2.notes, 40)
  assert.ok(s2.text.startsWith('…') && s2.text.endsWith('…'))
  assert.equal(s2.text.slice(s2.ranges[0].start, s2.ranges[0].end), 'objetivo')
})
