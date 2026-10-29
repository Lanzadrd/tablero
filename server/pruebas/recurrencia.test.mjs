import assert from 'node:assert/strict'
import test from 'node:test'
import { isRepeat, nextDue, nextOccurrence } from '../recurrencia.mjs'

test('cada día, aunque se complete tarde, nunca queda en el pasado', () => {
  assert.equal(nextDue({ every: 'day' }, { due: '2026-10-01', doneOn: '2026-10-04' }), '2026-10-05')
})
test('cada semana desde la fecha', () => {
  assert.equal(nextDue({ every: 'week' }, { due: '2026-10-05', doneOn: '2026-10-04' }), '2026-10-12')
})
test('desde que se completa', () => {
  assert.equal(nextDue({ every: 'day', interval: 3, from: 'done' }, { due: '2026-10-01', doneOn: '2026-10-04' }), '2026-10-07')
})
test('laborables saltan el fin de semana', () => {
  assert.equal(nextDue({ every: 'weekday' }, { due: '2026-10-09', doneOn: '2026-10-09' }), '2026-10-12')
})
test('el 31 de cada mes cae en el último día de los meses cortos', () => {
  assert.equal(nextDue({ every: 'month' }, { due: '2026-01-31', doneOn: '2026-01-31' }), '2026-02-28')
})
test('cada año, 29 de febrero', () => {
  assert.equal(nextDue({ every: 'year' }, { due: '2028-02-29', doneOn: '2028-02-29' }), '2029-02-28')
})
test('sin fecha cuenta desde hoy', () => {
  assert.equal(nextDue({ every: 'week' }, { due: null, doneOn: '2026-10-04' }), '2026-10-11')
})
test('la siguiente tarea: nueva, pendiente y con la checklist desmarcada', () => {
  const t = { id: 'a', title: 'Copias', notes: '- [x] Servidor\n- [ ] Portátil', done: true, completedAt: 'x', createdAt: 'y', due: '2026-10-05', time: '09:00', repeat: { every: 'week' }, firstOn: '2026-10-05' }
  const n = nextOccurrence(t, { id: 'b', doneOn: '2026-10-05', now: 'z' })
  assert.deepEqual(
    { id: n.id, done: n.done, due: n.due, time: n.time, notes: n.notes, repeat: n.repeat, firstOn: n.firstOn, completedAt: n.completedAt },
    { id: 'b', done: false, due: '2026-10-12', time: '09:00', notes: '- [ ] Servidor\n- [ ] Portátil', repeat: { every: 'week' }, firstOn: undefined, completedAt: null },
  )
})
test('la siguiente de un aviso de suscripción ya no es el aviso', () => {
  const t = { id: 'a', title: 'Netflix se cobra el 15 oct', notes: '', done: true, due: '2026-10-14', repeat: { every: 'month' }, subscriptionId: 'netflix', subscriptionCharge: '2026-10-15' }
  const n = nextOccurrence(t, { id: 'b', doneOn: '2026-10-14', now: 'z' })
  assert.equal('subscriptionId' in n, false)
  assert.equal('subscriptionCharge' in n, false)
  assert.equal(n.due, '2026-11-14')
})
test('valida reglas', () => {
  assert.ok(isRepeat({ every: 'week', interval: 2, from: 'done' }))
  assert.ok(!isRepeat({ every: 'hour' }))
  assert.ok(!isRepeat({ every: 'day', interval: 0 }))
})
