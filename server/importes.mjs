// Los importes mientras se escriben: con sus puntos de miles y coma para los decimales. Compartido con la app.

/** Cuántos decimales lleva una moneda (el guaraní, ninguno). */
export function decimalsOf(currency) {
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

const grouped = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')

/**
 * Lo escrito, con sus puntos y los decimales que admita la moneda. Un punto con menos de 3 cifras detrás no es de miles
 * sino la coma (10.5), salvo al borrar (de 1.000 a 1.00, que es 100).
 */
export function typedAmount(typed, decimals, deleting = false) {
  const text = decimals > 0 && !deleting && !typed.includes(',') ? typed.replace(/\.(\d{0,2})$/, ',$1') : typed
  const comma = text.indexOf(',')
  const whole = (comma < 0 ? text : text.slice(0, comma)).replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  if (comma < 0 || decimals === 0) return grouped(whole)
  return `${grouped(whole || '0')},${text.slice(comma + 1).replace(/\D/g, '').slice(0, decimals)}`
}

/** «1.234,5» → 1234.5; sin nada, NaN. */
export const amountNumber = (text) => (text ? Number(text.replace(/\./g, '').replace(',', '.')) : Number.NaN)

/** 1234.5 → «1.234,50»; sin decimales si no hacen falta. */
export function amountText(value, decimals) {
  if (!Number.isFinite(value)) return ''
  const [whole, cents] = value.toFixed(value % 1 ? decimals : 0).split('.')
  return cents ? `${grouped(whole)},${cents}` : grouped(whole)
}

/** Dónde va el cursor para dejar delante `count` caracteres que no son puntos. */
export function caretAfter(text, count) {
  let seen = 0
  for (let i = 0; i < text.length; i++) {
    if (seen === count) return i
    if (text[i] !== '.') seen++
  }
  return text.length
}
