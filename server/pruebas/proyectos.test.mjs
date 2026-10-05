// Proyectos y columnas (src/projects.ts): la Bandeja, archivar, la ficha, el pulso y «Lo hecho».
// Es TypeScript sin dependencias: Node lo ejecuta quitando los tipos.
import assert from 'node:assert/strict'
import test from 'node:test'
import { capture } from '../captura.mjs'

const ts = Boolean(process.features.typescript)
const p = ts ? await import(new URL('../../src/projects.ts', import.meta.url).href) : null
const opts = { skip: ts ? false : 'Este Node no ejecuta TypeScript' }

const HOY = '2026-10-04' // domingo
let n = 0
const task = (title, extra = {}) => ({
  id: `t${++n}`,
  title,
  notes: '',
  done: false,
  createdAt: noon(HOY),
  completedAt: null,
  due: null,
  time: null,
  ...extra,
})
const column = (name, tasks = [], extra = {}) => ({ id: name.toLowerCase(), name, color: 'blue', showCompleted: false, tasks, ...extra })
/** Mediodía local de un día, en ISO (para createdAt y completedAt). */
function noon(day) {
  return new Date(`${day}T12:00:00`).toISOString()
}

// ── Bandeja ──

test('ensureInbox: crea la Bandeja la primera, con id fijo, y no toca nada si ya está', opts, () => {
  const board = { columns: [column('Trabajo')] }
  const next = p.ensureInbox(board, 'otro')
  assert.deepEqual(next.columns[0], { id: 'bandeja', name: 'Bandeja', color: 'gray', tasks: [], showCompleted: false, inbox: true })
  assert.equal(next.columns[1], board.columns[0])
  assert.equal(p.ensureInbox(next, 'otro'), next, 'mismo tablero si ya hay Bandeja')
  assert.equal(p.needsInbox(board), true)
  assert.equal(p.needsInbox(next), false)
})

test('ensureInbox: usa otro id si «bandeja» está cogido, y saca de archivadas a la Bandeja', opts, () => {
  const taken = p.ensureInbox({ columns: [{ ...column('Entrada'), id: 'bandeja' }] }, 'otro')
  assert.deepEqual(
    taken.columns.map((c) => [c.id, Boolean(c.inbox)]),
    [
      ['otro', true],
      ['bandeja', false],
    ],
  )
  const archived = { columns: [column('Trabajo'), column('Entrada', [], { inbox: true, archived: true })] }
  assert.equal(p.needsInbox(archived), true)
  const back = p.ensureInbox(archived, 'otro')
  assert.equal(back.columns.length, 2)
  assert.equal('archived' in back.columns[1], false)
})

test('ensureInbox: si ya hay una columna «Bandeja» normal, pasa a ser la Bandeja (no se crea otra)', opts, () => {
  const board = { columns: [column('Trabajo'), column('bandéja ', [task('Algo')])] }
  const next = p.ensureInbox(board, 'otro')
  assert.equal(next.columns.length, 2)
  assert.equal(next.columns[1].inbox, true)
  assert.equal(next.columns[1].tasks.length, 1)
  assert.equal(p.needsInbox(next), false)
  // Una archivada con ese nombre no cuenta: se crea la Bandeja.
  const archived = p.ensureInbox({ columns: [column('Bandeja', [], { archived: true })] }, 'otro')
  assert.deepEqual(
    archived.columns.map((c) => [c.id, Boolean(c.inbox)]),
    [
      ['otro', true],
      ['bandeja', false],
    ],
  )
})

test('setArchived y deleteColumn: la Bandeja ni se archiva ni se borra', opts, () => {
  const board = { columns: [column('Bandeja', [], { inbox: true }), column('Viejo')] }
  const archived = p.setArchived(board, 'viejo', true)
  assert.equal(archived.columns[1].archived, true)
  assert.equal(p.setArchived(archived, 'viejo', true), archived, 'mismo tablero si no cambia')
  const restored = p.setArchived(archived, 'viejo', false)
  assert.equal('archived' in restored.columns[1], false)
  assert.equal(p.setArchived(board, 'bandeja', true), board)
  assert.equal(p.deleteColumn(board, 'bandeja'), board)
  assert.deepEqual(
    p.deleteColumn(board, 'viejo').columns.map((c) => c.id),
    ['bandeja'],
  )
})

test('columnSlot: índices reales en el tablero aunque haya archivadas en medio', opts, () => {
  const board = { columns: [column('A'), column('B', [], { archived: true }), column('C')] }
  assert.deepEqual(p.columnSlot(board, 'c', 'a'), [2, 0])
  assert.deepEqual(p.columnSlot(board, 'a', 'c'), [0, 2])
})

// ── Ficha ──

test('normalizeUrl: añade https://, solo http/https y con dominio', opts, () => {
  assert.equal(p.normalizeUrl('github.com/lanza/tablero'), 'https://github.com/lanza/tablero')
  assert.equal(p.normalizeUrl('  http://staging.lto.app  '), 'http://staging.lto.app/')
  assert.equal(p.normalizeUrl('localhost:3000'), 'http://localhost:3000/')
  assert.equal(p.normalizeUrl(''), '')
  for (const bad of ['javascript:alert(1)', 'ftp://x.com', 'file:///etc', 'lto', 'a b.com', 'https://']) {
    assert.equal(p.normalizeUrl(bad), null, bad)
  }
})

test('projectFromDraft: limpia, normaliza y conserva la dirección anterior si la nueva no vale', opts, () => {
  const previous = { repo: 'https://github.com/a/b' }
  const project = p.projectFromDraft(
    {
      folder: '  ~/Desktop/Claude Code/lto ',
      repo: 'no vale',
      production: 'lto.app',
      staging: '',
      deadline: '2026-10-09',
      links: [
        { label: ' Figma ', url: 'figma.com/file/x' },
        { label: 'Roto', url: 'javascript:x' },
        { label: '', url: '' },
      ],
    },
    previous,
  )
  assert.deepEqual(project, {
    folder: '~/Desktop/Claude Code/lto',
    repo: 'https://github.com/a/b',
    production: 'https://lto.app/',
    deadline: '2026-10-09',
    links: [{ label: 'Figma', url: 'https://figma.com/file/x' }],
  })
  assert.equal(p.projectFromDraft(p.draftOf(undefined)), undefined)
  assert.deepEqual(p.draftOf(project).links, project.links)
})

test('withProject: mismo tablero si no cambia; sin ficha quita la clave', opts, () => {
  const board = { columns: [column('Lto', [], { project: { folder: '~/lto' } })] }
  assert.equal(p.withProject(board, 'lto', { folder: '~/lto' }), board)
  const without = p.withProject(board, 'lto', undefined)
  assert.equal('project' in without.columns[0], false)
  assert.deepEqual(
    p.projectLinks({ staging: 'https://s.x.com/', repo: 'https://github.com/a/b' }).map((l) => l.field),
    ['repo', 'staging'],
  )
})

// ── Pulso ──

test('Pulso: entrega (urgente si pasó o quedan ≤2 días), sin próxima acción, parada', opts, () => {
  const open = [task('Algo')]
  const withDeadline = (deadline, tasks = open) => column('Lto', tasks, { project: { deadline } })
  // Solo en los proyectos (columnas con ficha).
  const project = (name, tasks = [], extra = {}) => column(name, tasks, { project: { folder: '~/x' }, ...extra })
  assert.equal(p.projectPulse(column('Vacía'), HOY), null)
  assert.equal(p.projectPulse(column('Parada', [task('Vieja', { createdAt: noon('2026-09-01') })]), HOY), null)
  assert.deepEqual(p.projectPulse(withDeadline('2026-10-09'), HOY), {
    deadline: { text: 'Entrega vie 9 oct', urgent: false },
    alert: null,
  })
  assert.equal(p.projectPulse(withDeadline('2026-10-06'), HOY).deadline.urgent, true)
  assert.equal(p.projectPulse(withDeadline('2026-10-01'), HOY).deadline.urgent, true)
  assert.equal(p.projectPulse(withDeadline(HOY), HOY).deadline.text, 'Entrega hoy')
  assert.equal(p.projectPulse(withDeadline('2026-10-05'), HOY).deadline.text, 'Entrega mañana')
  assert.equal(p.projectPulse(withDeadline('2027-01-08'), HOY).deadline.text, 'Entrega vie 8 ene 2027')

  assert.deepEqual(p.projectPulse(project('Vacía'), HOY), { deadline: null, alert: 'Sin próxima acción' })
  assert.equal(p.projectPulse(project('Hecha', [task('x', { done: true, completedAt: noon(HOY) })]), HOY).alert, 'Sin próxima acción')

  const stale = project('Parada', [task('Vieja', { createdAt: noon('2026-09-22') })])
  assert.equal(p.projectPulse(stale, HOY).alert, 'Parada · 12 d')
  // Algo con fecha para los próximos días: no está parada (una atrasada no cuenta).
  const planned = project('Con fecha', [task('Vieja', { createdAt: noon('2026-09-01'), due: '2026-10-09' })])
  assert.equal(p.projectPulse(planned, HOY), null)
  const late = project('Atrasada', [task('Vieja', { createdAt: noon('2026-09-01'), due: '2026-09-29' })])
  assert.equal(p.projectPulse(late, HOY).alert, 'Parada · 33 d')
  // La última actividad cuenta también lo completado.
  stale.tasks.push(task('Hecha hace poco', { createdAt: noon('2026-09-01'), done: true, completedAt: noon('2026-10-01') }))
  assert.equal(p.projectPulse(stale, HOY), null)
  // Exactamente 7 días todavía no es «parada».
  assert.equal(p.projectPulse(project('Justo', [task('x', { createdAt: noon('2026-09-27') })]), HOY), null)

  assert.equal(p.projectPulse(column('Bandeja', [], { inbox: true, project: { deadline: HOY } }), HOY), null)
  assert.equal(
    p.pulseText({ deadline: { text: 'Entrega hoy', urgent: true }, alert: 'Sin próxima acción' }),
    'Entrega hoy · Sin próxima acción',
  )
})

// ── Lo hecho ──

test('periodRange: semanas de lunes a domingo y meses enteros', opts, () => {
  assert.deepEqual(p.periodRange('week', HOY), ['2026-09-28', '2026-10-04'])
  assert.deepEqual(p.periodRange('lastWeek', HOY), ['2026-09-21', '2026-09-27'])
  assert.deepEqual(p.periodRange('month', HOY), ['2026-10-01', '2026-10-31'])
  assert.deepEqual(p.periodRange('lastMonth', HOY), ['2026-09-01', '2026-09-30'])
  assert.deepEqual(p.periodRange('lastMonth', '2026-01-15'), ['2025-12-01', '2025-12-31'])
  assert.deepEqual(p.periodRange('week', '2026-10-05'), ['2026-10-05', '2026-10-11'], 'el lunes empieza semana')
  assert.equal(p.periodRange('all', HOY), null)
})

test('Lo hecho: une tablero y archivo sin repetir, por periodo, y copia «• Tarea — 3 oct»', opts, () => {
  const tasks = [
    task('Pendiente'),
    task('Maquetar portada', { id: 'a', done: true, completedAt: noon('2026-10-03') }),
    task('Corregir menú', { id: 'b', done: true, completedAt: noon('2026-09-29') }),
  ]
  const archived = [
    { id: 'a', title: 'Título viejo', completedAt: noon('2026-10-03'), archivedAt: noon('2026-10-04') },
    { id: 'c', title: 'Reunión inicial', completedAt: noon('2026-09-15'), archivedAt: noon('2026-09-20') },
    { id: 'd', title: 'Del año pasado', completedAt: noon('2025-12-30'), archivedAt: noon('2026-01-02') },
    { id: 'e', title: 'Sin fecha de hecho', completedAt: null, archivedAt: noon('2026-10-02') },
  ]
  const all = p.doneItems(tasks, archived)
  assert.deepEqual(
    all.map((i) => i.title),
    ['Del año pasado', 'Reunión inicial', 'Corregir menú', 'Sin fecha de hecho', 'Maquetar portada'],
  )
  const week = p.inPeriod(all, 'week', HOY)
  assert.deepEqual(
    week.map((i) => i.id),
    ['b', 'e', 'a'],
  )
  assert.equal(p.doneText(week, HOY), '• Corregir menú — 29 sept\n• Sin fecha de hecho — 2 oct\n• Maquetar portada — 3 oct')
  assert.equal(p.inPeriod(all, 'lastMonth', HOY).length, 2)
  assert.equal(p.doneText(p.inPeriod(all, 'all', HOY).slice(0, 1), HOY), '• Del año pasado — 30 dic 2025')
  assert.equal(p.isDonePeriod('lastWeek'), true)
  assert.equal(p.isDonePeriod('ayer'), false)
})

// ── Servidor: la Bandeja que crea la captura usa el mismo id que la app ──

test('capturar sin Bandeja la crea con id «bandeja»', () => {
  const board = { columns: [column('Trabajo')] }
  const result = capture(board, { texto: 'Llamar a Marta' }, { today: HOY })
  assert.equal(result.columnId, 'bandeja')
  assert.equal(board.columns[0].id, 'bandeja')
  assert.equal(board.columns[0].inbox, true)
})
