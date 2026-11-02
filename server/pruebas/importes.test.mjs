// Los importes mientras se escriben: los puntos se ponen solos.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { amountNumber, amountText, caretAfter, decimalsOf, typedAmount } from '../importes.mjs'

test('decimales de cada moneda', () => {
  assert.equal(decimalsOf('PYG'), 0)
  assert.equal(decimalsOf('USD'), 2)
  assert.equal(decimalsOf('EUR'), 2)
  assert.equal(decimalsOf('???'), 2)
})

test('al escribir se ponen los puntos, también con 4 cifras', () => {
  assert.equal(typedAmount('1000', 0), '1.000')
  assert.equal(typedAmount('20000', 0), '20.000')
  assert.equal(typedAmount('1.0005', 0), '10.005')
  assert.equal(typedAmount('20000000', 2), '20.000.000')
  assert.equal(typedAmount('', 0), '')
  assert.equal(typedAmount('abc', 0), '')
  assert.equal(typedAmount('007', 0), '7')
})

test('decimales: con coma o con un punto al final, solo los que admite la moneda', () => {
  assert.equal(typedAmount('10,5', 2), '10,5')
  assert.equal(typedAmount('10.', 2), '10,')
  assert.equal(typedAmount('10,555', 2), '10,55')
  assert.equal(typedAmount(',5', 2), '0,5')
  assert.equal(typedAmount('1000,50', 2), '1.000,50')
  assert.equal(typedAmount('10,5', 0), '10')
  assert.equal(typedAmount('10.', 0), '10')
})

test('un punto con menos de 3 cifras detrás es la coma (también al pegarlo), salvo al borrar', () => {
  assert.equal(typedAmount('12.5', 2), '12,5')
  assert.equal(typedAmount('10.50', 2), '10,50')
  assert.equal(typedAmount('1.000.5', 2), '1.000,5')
  assert.equal(typedAmount('1.000', 2), '1.000')
  assert.equal(typedAmount('1.00', 2, true), '100')
  assert.equal(typedAmount('12.5', 0), '125')
})

test('el número de lo escrito y lo escrito de un número', () => {
  assert.equal(amountNumber('1.234,5'), 1234.5)
  assert.equal(amountNumber('20.000'), 20000)
  assert.equal(amountNumber('10,'), 10)
  assert.ok(Number.isNaN(amountNumber('')))
  assert.equal(amountText(20000, 0), '20.000')
  assert.equal(amountText(1234.5, 2), '1.234,50')
  assert.equal(amountText(10, 2), '10')
  assert.equal(amountText(Number.NaN, 2), '')
})

test('el cursor se queda después de lo mismo, aunque aparezcan puntos', () => {
  assert.equal(caretAfter('1.000', 1), 1)
  assert.equal(caretAfter('1.000', 2), 3)
  assert.equal(caretAfter('1.000', 4), 5)
  assert.equal(caretAfter('1.000', 0), 0)
})
