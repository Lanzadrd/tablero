// Búsqueda de la paleta (⌘K): sin distinguir mayúsculas ni acentos. Lógica pura: solo importa
// tipos de './model', así se prueba con Node tal cual (server/pruebas/teclado.test.mjs).
import { fold } from '../server/lenguaje.mjs'
import type { Board, Column, Task } from './model'

/** Cómo de bien encaja: 0 el título empieza así, 1 empieza una palabra, 2 lo contiene, 3 solo las notas. */
export type Rank = 0 | 1 | 2 | 3

/** Trozo resaltado [start, end) del texto en NFC. */
export interface Range {
  start: number
  end: number
}

export interface Match {
  rank: Rank
  title: Range[]
  notes: Range[]
}

/** Una tarea archivada, tal como la devuelve GET /api/archivo. */
export type ArchivedTask = Task & { columnId: string; columnName: string; archivedAt: string }

export interface TaskHit {
  task: Task
  column: Column
  match: Match
}

export interface ArchivedHit {
  task: ArchivedTask
  match: Match
}

const nfc = (s: string) => s.normalize('NFC')

/** Lo que se busca, plegado y con un solo espacio entre palabras. */
export const prepare = (query: string) => fold(nfc(query)).replace(/\s+/g, ' ').trim()

const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch)

/** `text` plegado; si plegar cambiara la longitud (raro), no se resalta pero se sigue buscando. */
function folded(text: string) {
  const plain = nfc(text)
  const f = fold(plain)
  return { f, exact: f.length === plain.length }
}

/** Dónde aparece `q` en `haystack` (ya plegados): al principio, al principio de una palabra o dentro. */
function find(haystack: string, q: string): { index: number; rank: 0 | 1 | 2 } | null {
  if (haystack.startsWith(q)) return { index: 0, rank: 0 }
  let first = -1
  for (let i = haystack.indexOf(q); i !== -1; i = haystack.indexOf(q, i + 1)) {
    if (first === -1) first = i
    if (!isWordChar(haystack[i - 1])) return { index: i, rank: 1 }
  }
  return first === -1 ? null : { index: first, rank: 2 }
}

function merge(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const out: Range[] = []
  for (const r of sorted) {
    const last = out.at(-1)
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end)
    else out.push({ ...r })
  }
  return out
}

/** Un nombre (columna, comando): null si no encaja. */
export function matchLabel(label: string, query: string): { rank: 0 | 1 | 2; ranges: Range[] } | null {
  const q = prepare(query)
  if (!q) return null
  const { f, exact } = folded(label)
  const hit = find(f, q)
  if (!hit) return null
  return { rank: hit.rank, ranges: exact ? [{ start: hit.index, end: hit.index + q.length }] : [] }
}

/**
 * Una tarea: primero se busca la frase entera en el título y luego en las notas; si no está,
 * vale que estén todas sus palabras (en el título o en las notas).
 */
export function matchTask(title: string, notes: string, query: string): Match | null {
  const q = prepare(query)
  if (!q) return null
  const t = folded(title)
  const n = folded(notes)
  const span = (index: number, length: number, exact: boolean): Range[] => (exact ? [{ start: index, end: index + length }] : [])

  const inTitle = find(t.f, q)
  if (inTitle) return { rank: inTitle.rank, title: span(inTitle.index, q.length, t.exact), notes: [] }
  const inNotes = n.f.indexOf(q)
  if (inNotes !== -1) return { rank: 3, title: [], notes: span(inNotes, q.length, n.exact) }

  const words = q.split(' ')
  if (words.length < 2) return null
  const titleRanges: Range[] = []
  const noteRanges: Range[] = []
  let inNotesOnly = false
  for (const word of words) {
    const a = find(t.f, word)
    if (a) {
      titleRanges.push(...span(a.index, word.length, t.exact))
      continue
    }
    const b = n.f.indexOf(word)
    if (b === -1) return null
    inNotesOnly = true
    noteRanges.push(...span(b, word.length, n.exact))
  }
  return { rank: inNotesOnly ? 3 : 2, title: merge(titleRanges), notes: merge(noteRanges) }
}

/** Las tareas del tablero que encajan: pendientes y completadas, las mejores primero. */
export function searchBoard(board: Board, query: string): { open: TaskHit[]; done: TaskHit[] } {
  const open: TaskHit[] = []
  const done: TaskHit[] = []
  for (const column of board.columns) {
    for (const task of column.tasks) {
      const match = matchTask(task.title, task.notes, query)
      if (match) (task.done ? done : open).push({ task, column, match })
    }
  }
  open.sort((a, b) => a.match.rank - b.match.rank)
  done.sort((a, b) => a.match.rank - b.match.rank || (b.task.completedAt ?? '').localeCompare(a.task.completedAt ?? ''))
  return { open, done }
}

/** Las archivadas que encajan, las mejores primero y, a igualdad, las archivadas más recientemente. */
export function searchArchive(entries: ArchivedTask[], query: string): ArchivedHit[] {
  const hits: ArchivedHit[] = []
  for (const task of entries) {
    if (typeof task?.title !== 'string') continue
    const match = matchTask(task.title, typeof task.notes === 'string' ? task.notes : '', query)
    if (match) hits.push({ task, match })
  }
  return hits.sort((a, b) => a.match.rank - b.match.rank || String(b.task.archivedAt).localeCompare(String(a.task.archivedAt)))
}

/**
 * La línea de las notas donde está lo encontrado, recortada a unos `max` caracteres alrededor,
 * con sus trozos resaltados movidos a su sitio.
 */
export function snippet(notes: string, ranges: Range[], max = 80): { text: string; ranges: Range[] } {
  const text = nfc(notes)
  const at = ranges[0]?.start ?? 0
  const lineStart = text.lastIndexOf('\n', at - 1) + 1
  const lineEnd = text.indexOf('\n', at) === -1 ? text.length : text.indexOf('\n', at)
  let start = lineStart
  let end = lineEnd
  if (end - start > max) {
    start = Math.max(lineStart, Math.min(at - Math.floor(max / 3), lineEnd - max))
    end = Math.min(lineEnd, start + max)
  }
  const before = start > lineStart ? '…' : ''
  const after = end < lineEnd ? '…' : ''
  const shift = before.length - start
  const inside = ranges
    .filter((r) => r.start >= start && r.end <= end)
    .map((r) => ({ start: r.start + shift, end: r.end + shift }))
  return { text: before + text.slice(start, end) + after, ranges: inside }
}
