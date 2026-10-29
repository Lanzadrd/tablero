// Lógica pura de la app para escribir tareas: enlaces, pasos (checklist) y repetición.
// Son módulos TypeScript de src/ sin dependencias: Node los ejecuta quitando los tipos.
import assert from 'node:assert/strict'
import test from 'node:test'

const ts = Boolean(process.features.typescript)
const load = async (file) => (ts ? import(new URL(`../../src/${file}`, import.meta.url).href) : null)
const links = await load('links.ts')
const checklist = await load('checklist.ts')
const repeat = await load('repeat.ts')
const merge = await load('merge.ts')
const { nextTaskId } = await import('../recurrencia.mjs')
const opts = { skip: ts ? false : 'Este Node no ejecuta TypeScript' }

// ── Enlaces ──

test('detecta enlaces http y https y quita la puntuación de detrás', opts, () => {
  const found = links.findLinks('Mira https://github.com/org/repo/pull/12, y (https://es.wikipedia.org/wiki/Foo_(bar)).')
  assert.deepEqual(
    found.map((l) => [l.url, l.domain]),
    [
      ['https://github.com/org/repo/pull/12', 'github.com'],
      ['https://es.wikipedia.org/wiki/Foo_(bar)', 'es.wikipedia.org'],
    ],
  )
})

test('nunca otros esquemas', opts, () => {
  for (const text of ['javascript:alert(1)', 'JAVASCRIPT://x.com/%0aalert(1)', 'data:text/html,hola', 'file:///etc/passwd', 'ftp://x.com', 'mailto:a@b.c', 'xhttps://x.com'])
    assert.deepEqual(links.findLinks(text), [], text)
  assert.equal(links.toLink('javascript:alert(1)'), null)
  assert.equal(links.findLinks('HTTPS://WWW.Example.com/A')[0].url, 'https://www.example.com/A')
  assert.equal(links.findLinks('HTTPS://WWW.Example.com/A')[0].domain, 'example.com')
})

test('parte el texto en trozos y enlaces, en orden', opts, () => {
  const parts = links.splitLinks('Revisar https://x.com/a antes de las 5')
  assert.deepEqual(
    parts.map((p) => (p.link ? `[${p.link.domain}]` : p.text)),
    ['Revisar ', '[x.com]', ' antes de las 5'],
  )
  assert.equal(links.splitLinks('https://x.com/a').length, 1)
  assert.equal(links.withoutLinks('Revisar https://x.com/a antes'), 'Revisar antes')
  assert.equal(links.findLinks('https://x.com', 'otra vez https://x.com/').length, 1)
})

test('solo una URL', opts, () => {
  assert.equal(links.onlyLink('  https://x.com/a?b=1 ').url, 'https://x.com/a?b=1')
  assert.equal(links.onlyLink('Leer https://x.com'), null)
  assert.equal(links.onlyLink('https://x.com y https://y.com'), null)
  assert.equal(links.onlyLink('texto'), null)
})

test('texto de un enlace: dominio y ruta', opts, () => {
  const link = links.toLink('https://www.github.com/org/repo/pull/12/?tab=files#x')
  assert.equal(links.linkText(link), 'github.com/org/repo/pull/12')
  assert.equal(links.linkText(links.toLink('https://es.wikipedia.org/wiki/Le%C3%B3n')), 'es.wikipedia.org/wiki/León')
  assert.equal(links.linkText(links.toLink('https://x.com/')), 'x.com')
  assert.equal(links.linkText(links.toLink('https://x.com/abcdefghij'), 10), 'x.com/abc…')
  // Una ruta mal codificada no rompe nada.
  assert.equal(links.linkText(links.toLink('https://x.com/%E0%A4%A')), 'x.com/%E0%A4%A')
})

// ── Pasos ──

const notes = 'Para el viaje:\n- [ ] Pasaporte\n- [x] Billetes\n  * [X] Cargador\n- [ ]\n- sin casilla'

test('lee los pasos de las notas', opts, () => {
  assert.deepEqual(checklist.steps(notes), [
    { line: 1, text: 'Pasaporte', done: false },
    { line: 2, text: 'Billetes', done: true },
    { line: 3, text: 'Cargador', done: true },
  ])
  assert.deepEqual(checklist.progress(notes), { done: 2, total: 3 })
  assert.equal(checklist.progress('Sin pasos'), null)
  assert.equal(checklist.progress(''), null)
})

test('marcar un paso cambia solo esa línea', opts, () => {
  assert.equal(checklist.toggleStep(notes, 1), notes.replace('- [ ] Pasaporte', '- [x] Pasaporte'))
  assert.equal(checklist.toggleStep(notes, 3), notes.replace('* [X] Cargador', '* [ ] Cargador'))
  assert.equal(checklist.toggleStep(notes, 0), notes)
  assert.equal(checklist.toggleStep('- [ ] a\r\n- [ ] b', 0), '- [x] a\r\n- [ ] b')
})

test('añadir un paso', opts, () => {
  assert.equal(checklist.addStep('', ' Leche '), '- [ ] Leche')
  assert.equal(checklist.addStep('Compra', 'Leche'), 'Compra\n- [ ] Leche')
  assert.equal(checklist.addStep('Compra\n', 'Leche'), 'Compra\n- [ ] Leche')
  assert.equal(checklist.addStep('- [ ] Pan\nNota final', 'Leche'), '- [ ] Pan\n- [ ] Leche\nNota final')
  assert.equal(checklist.addStep('  * [x] Pan', 'Leche'), '  * [x] Pan\n  * [ ] Leche')
  assert.equal(checklist.addStep('Algo', '   '), 'Algo')
})

test('notas sin los pasos (para editarlas en el detalle) y de vuelta', opts, () => {
  const n = 'Para el viaje:\n- [x] Pasaporte\n- [ ] Cargador\nLlevar abrigo'
  assert.equal(checklist.withoutSteps(n), 'Para el viaje:\nLlevar abrigo')
  assert.equal(checklist.withBody(n, 'Para el viaje:\nLlevar abrigo y gorro'), 'Para el viaje:\nLlevar abrigo y gorro\n- [x] Pasaporte\n- [ ] Cargador')
  for (const body of ['', 'Hola', 'Hola\n', '\nHola', 'a\n\nb'])
    assert.equal(checklist.withoutSteps(checklist.withBody(n, body)), body, JSON.stringify(body))
  assert.equal(checklist.withBody('- [ ] solo', ''), '- [ ] solo')
  assert.equal(checklist.withBody('Sin pasos', 'Otra cosa'), 'Otra cosa')
})

test('primera línea de las notas que no es un paso', opts, () => {
  assert.equal(checklist.firstNoteLine(notes), 'Para el viaje:')
  assert.equal(checklist.firstNoteLine('- [ ] a\n\n https://x.com '), 'https://x.com')
  assert.equal(checklist.firstNoteLine('- [ ] a'), '')
})

// ── Repetición ──

const board = () => ({
  columns: [
    {
      id: 'c',
      name: 'Casa',
      color: 'green',
      showCompleted: false,
      tasks: [
        { id: 'a', title: 'Antes', notes: '', done: false, createdAt: 'x', completedAt: null, due: null, time: null },
        {
          id: 'r',
          title: 'Regar',
          notes: '- [x] Balcón\n- [ ] Salón',
          done: false,
          createdAt: 'x',
          completedAt: null,
          due: '2026-10-02',
          time: '09:00',
          firstOn: '2026-10-02',
          repeat: { every: 'week' },
        },
        { id: 'z', title: 'Después', notes: '', done: false, createdAt: 'x', completedAt: null, due: null, time: null },
      ],
    },
  ],
})

test('etiquetas de repetición', opts, () => {
  assert.equal(repeat.repeatLabel({ every: 'week' }), 'Cada semana')
  assert.equal(repeat.repeatLabel({ every: 'weekday' }), 'Laborables')
  assert.equal(repeat.repeatLabel({ every: 'month', interval: 2 }), 'Cada 2 meses')
  assert.equal(repeat.repeatUnit('day', 1), 'día')
  assert.equal(repeat.repeatUnit('weekday', 3), 'días laborables')
})

test('completar una que se repite: hecha, sin regla y la siguiente justo detrás', opts, () => {
  const before = board()
  const after = repeat.completeTask(before, 'r', true, { completedAt: '2026-10-04T10:00:00.000Z', doneOn: '2026-10-04', spareId: 's' })
  const tasks = after.columns[0].tasks
  assert.deepEqual(tasks.map((t) => t.id), ['a', 'r', nextTaskId('r'), 'z'])
  assert.equal(tasks[1].done, true)
  assert.equal(tasks[1].completedAt, '2026-10-04T10:00:00.000Z')
  assert.equal('repeat' in tasks[1], false)
  assert.deepEqual(
    { done: tasks[2].done, due: tasks[2].due, time: tasks[2].time, repeat: tasks[2].repeat, notes: tasks[2].notes, firstOn: tasks[2].firstOn },
    { done: false, due: '2026-10-09', time: '09:00', repeat: { every: 'week' }, notes: '- [ ] Balcón\n- [ ] Salón', firstOn: undefined },
  )
  // El original no se toca (operación pura).
  assert.equal(before.columns[0].tasks.length, 3)
  assert.equal(before.columns[0].tasks[1].done, false)
  assert.equal(repeat.upcomingDue(before, 'r', '2026-10-04'), '2026-10-09')
  assert.equal(repeat.upcomingDue(after, 'r', '2026-10-04'), null)
  assert.equal(repeat.upcomingDue(before, 'a', '2026-10-04'), null)
})

test('sin repetición, o al desmarcar, solo cambia «hecha»', opts, () => {
  const b = board()
  const done = repeat.completeTask(b, 'a', true, { completedAt: 't', doneOn: '2026-10-04', spareId: 's' })
  assert.deepEqual(done.columns[0].tasks.map((t) => t.id), ['a', 'r', 'z'])
  assert.equal(done.columns[0].tasks[0].done, true)
  const undone = repeat.completeTask(done, 'a', false, { completedAt: null, doneOn: '2026-10-04', spareId: 's' })
  assert.equal(undone.columns[0].tasks[0].done, false)
  assert.equal(undone.columns[0].tasks[0].completedAt, null)
  // Sin cambios: el mismo objeto.
  assert.equal(repeat.completeTask(b, 'a', false, { completedAt: null, doneOn: '2026-10-04', spareId: 's' }), b)
  assert.equal(repeat.completeTask(b, 'nada', true, { completedAt: 't', doneOn: '2026-10-04', spareId: 's' }), b)
})

test('desmarcar una que se repetía: su siguiente, si sigue tal cual, se quita y la regla vuelve', opts, () => {
  const b = board()
  const at = { completedAt: 't', doneOn: '2026-10-04', spareId: 's' }
  const done = repeat.completeTask(b, 'r', true, at)
  const undone = repeat.completeTask(done, 'r', false, { ...at, completedAt: null })
  assert.deepEqual(undone.columns[0].tasks.map((t) => t.id), ['a', 'r', 'z'])
  assert.deepEqual(undone.columns[0].tasks[1].repeat, { every: 'week' })
  assert.equal(undone.columns[0].tasks[1].done, false)
  // Con la siguiente ya cambiada, se queda; la original vuelve sin regla.
  const edited = structuredClone(done)
  edited.columns[0].tasks[2].due = '2026-10-20'
  edited.columns[0].tasks[2].title = 'Regar a fondo'
  const kept = repeat.completeTask(edited, 'r', false, { ...at, completedAt: null })
  assert.deepEqual(kept.columns[0].tasks.map((t) => t.id), ['a', 'r', nextTaskId('r'), 'z'])
  assert.equal('repeat' in kept.columns[0].tasks[1], false)
  // Si el id de la siguiente ya existe, usa el de repuesto: nunca dos tareas con el mismo id.
  const again = repeat.completeTask({ ...kept, columns: [{ ...kept.columns[0], tasks: kept.columns[0].tasks.map((t) => (t.id === 'r' ? { ...t, repeat: { every: 'week' } } : t)) }] }, 'r', true, at)
  assert.deepEqual(again.columns[0].tasks.map((t) => t.id), ['a', 'r', 's', nextTaskId('r'), 'z'])
})

test('completada a la vez aquí y fuera (iPhone, MCP): la fusión deja una sola siguiente', opts, () => {
  const base = board()
  const ours = repeat.completeTask(base, 'r', true, { completedAt: '2026-10-04T10:00:00.000Z', doneOn: '2026-10-04', spareId: 'x1' })
  const theirs = repeat.completeTask(base, 'r', true, { completedAt: '2026-10-04T10:00:01.000Z', doneOn: '2026-10-04', spareId: 'x2' })
  const merged = merge.mergeBoards(base, ours, theirs)
  const open = merged.columns[0].tasks.filter((t) => t.title === 'Regar' && !t.done)
  assert.equal(open.length, 1)
  assert.equal(open[0].id, nextTaskId('r'))
})

test('contar desde que se completa', opts, () => {
  const b = board()
  b.columns[0].tasks[1].repeat = { every: 'day', interval: 3, from: 'done' }
  const after = repeat.completeTask(b, 'r', true, { completedAt: 't', doneOn: '2026-10-04', spareId: 's' })
  assert.equal(after.columns[0].tasks[2].due, '2026-10-07')
})
