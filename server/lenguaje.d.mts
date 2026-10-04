import type { Repeat } from './recurrencia.mjs'

export interface ParsedTask {
  title: string
  due: string | null
  time: string | null
  columnId: string | null
  repeat: Repeat | null
  someday: boolean
  matches: { kind: 'fecha' | 'hora' | 'columna' | 'repetir' | 'algun-dia'; text: string }[]
}

export interface ParseContext {
  /** Hoy, 'AAAA-MM-DD' (hora local). */
  today: string
  columns?: { id: string; name: string }[]
}

export function fold(s: string): string
export function findColumn<C extends { id: string; name: string }>(tag: string, columns?: C[]): C | null
export function parseTask(input: string, ctx: ParseContext): ParsedTask
export function describe(parsed: ParsedTask, ctx: ParseContext): string
