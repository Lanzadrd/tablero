// Pasos dentro de las notas: líneas «- [ ] paso» y «- [x] paso» (también con «*»).
// Las notas siguen siendo texto: marcar un paso solo cambia esa línea. Sin dependencias.

export interface Step {
  /** Nº de línea dentro de las notas. */
  line: number
  text: string
  done: boolean
}

/** Mismo formato que reinicia server/recurrencia.mjs al repetir una tarea. */
const STEP = /^(\s*[-*] )\[([ xX])\]\s+(\S[^\r]*?)\s*\r?$/

export function steps(notes: string): Step[] {
  const list: Step[] = []
  notes.split('\n').forEach((text, line) => {
    const m = STEP.exec(text)
    if (m) list.push({ line, text: m[3], done: m[2] !== ' ' })
  })
  return list
}

/** «2 de 5» hechos, o null si no hay pasos. */
export function progress(notes: string): { done: number; total: number } | null {
  const list = steps(notes)
  return list.length ? { done: list.filter((s) => s.done).length, total: list.length } : null
}

/** Marca o desmarca el paso de la línea `line`. */
export function toggleStep(notes: string, line: number): string {
  const lines = notes.split('\n')
  const m = STEP.exec(lines[line] ?? '')
  if (!m) return notes
  lines[line] = lines[line].replace(/\[[ xX]\]/, m[2] === ' ' ? '[x]' : '[ ]')
  return lines.join('\n')
}

/** Añade un paso detrás del último (o al final de las notas si aún no hay ninguno). */
export function addStep(notes: string, text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return notes
  const lines = notes.split('\n')
  const last = steps(notes).at(-1)
  if (last) {
    const bullet = STEP.exec(lines[last.line])?.[1] ?? '- '
    lines.splice(last.line + 1, 0, `${bullet}[ ] ${clean}`)
    return lines.join('\n')
  }
  const step = `- [ ] ${clean}`
  if (!notes.trim()) return step
  return notes.endsWith('\n') ? `${notes}${step}` : `${notes}\n${step}`
}

/** Las notas sin las líneas de pasos: lo que se edita como texto mientras los pasos se ven como casillas. */
export function withoutSteps(notes: string): string {
  return notes
    .split('\n')
    .filter((line) => !STEP.test(line))
    .join('\n')
}

/**
 * Las notas con el texto `body` (sin pasos) y detrás los pasos de `notes`, en su orden. Inversa de
 * withoutSteps: withoutSteps(withBody(n, b)) === b.
 */
export function withBody(notes: string, body: string): string {
  const stepLines = notes.split('\n').filter((line) => STEP.test(line))
  if (stepLines.length === 0) return body
  return body ? `${body}\n${stepLines.join('\n')}` : stepLines.join('\n')
}

/** La primera línea de las notas que no es un paso (para la vista previa de la fila). */
export function firstNoteLine(notes: string): string {
  return (
    notes
      .split('\n')
      .find((line) => line.trim() && !STEP.test(line))
      ?.trim() ?? ''
  )
}
