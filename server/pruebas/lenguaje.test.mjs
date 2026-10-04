import assert from 'node:assert/strict'
import test from 'node:test'
import { describe as resumen, parseTask } from '../lenguaje.mjs'

// Domingo, 4 de octubre de 2026
const today = '2026-10-04'
const columns = [
  { id: 'p', name: 'Personal' },
  { id: 't', name: 'Trabajo' },
  { id: 'f', name: 'LTO · Flota' },
  { id: 'c', name: 'Casa' },
]
const p = (text) => parseTask(text, { today, columns })
const pick = (r) => ({ title: r.title, due: r.due, time: r.time, columnId: r.columnId, repeat: r.repeat, someday: r.someday })
const base = { due: null, time: null, columnId: null, repeat: null, someday: false }

const casos = [
  ['Llamar a Marta mañana 10:30 #Trabajo', { title: 'Llamar a Marta', due: '2026-10-05', time: '10:30', columnId: 't' }],
  ['Mañana llamar al gestor', { title: 'Llamar al gestor', due: '2026-10-05' }],
  ['Dentista a las 9', { title: 'Dentista', due: today, time: '09:00' }],
  ['Cena a las 9pm', { title: 'Cena', due: today, time: '21:00' }],
  ['Reunión el lunes a las 10:30', { title: 'Reunión', due: '2026-10-05', time: '10:30' }],
  ['Entregar diseño el viernes', { title: 'Entregar diseño', due: '2026-10-09' }],
  ['Pagar seguro 15/10', { title: 'Pagar seguro', due: '2026-10-15' }],
  ['Renovar dominio 3/2', { title: 'Renovar dominio', due: '2027-02-03' }],
  ['Cumple de Ana 12 de diciembre', { title: 'Cumple de Ana', due: '2026-12-12' }],
  ['Revisar facturas en 3 días', { title: 'Revisar facturas', due: '2026-10-07' }],
  ['Preparar viaje la semana que viene', { title: 'Preparar viaje', due: '2026-10-05' }],
  ['Pasado mañana gimnasio', { title: 'Gimnasio', due: '2026-10-06' }],
  ['Copias de seguridad cada lunes', { title: 'Copias de seguridad', due: '2026-10-05', repeat: { every: 'week' } }],
  ['Regar plantas cada 3 días', { title: 'Regar plantas', due: today, repeat: { every: 'day', interval: 3 } }],
  ['Standup laborables 9:30', { title: 'Standup', due: '2026-10-05', time: '09:30', repeat: { every: 'weekday' } }],
  ['Leer Sapiens algún día', { title: 'Leer Sapiens', someday: true }],
  ['Revisar camiones #flota', { title: 'Revisar camiones', columnId: 'f' }],
  ['18h Pádel', { title: 'Pádel', due: today, time: '18:00' }],
  // Lo que NO debe tocarse
  ['Llamar por la mañana', { title: 'Llamar por la mañana' }],
  ['Correr esta mañana', { title: 'Correr esta mañana' }],
  ['Estudiar 2h', { title: 'Estudiar 2h' }],
  ['Comprar 2 kilos de tomates', { title: 'Comprar 2 kilos de tomates' }],
  ['Hablar del lunes con Pedro', { title: 'Hablar del lunes con Pedro' }],
  ['Arreglar bug #123', { title: 'Arreglar bug #123' }],
  ['Pagar 10.30', { title: 'Pagar 10.30' }],
  ['Mañana', { title: 'Mañana' }],
  ['Hoy', { title: 'Hoy' }],
]

for (const [texto, esperado] of casos) {
  test(texto, () => assert.deepEqual(pick(p(texto)), { ...base, ...esperado }))
}

test('el resumen se entiende', () => {
  assert.equal(resumen(p('Llamar a Marta mañana 10:30 #Trabajo'), { today, columns }), 'Mañana, 10:30 · Trabajo')
  assert.equal(resumen(p('Copias cada 2 semanas'), { today, columns }), 'Hoy · cada 2 semanas')
})
