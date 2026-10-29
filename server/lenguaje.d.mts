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
  /** Ahora, 'HH:MM' (hora local). Si se sabe, una hora sin día que ya ha pasado es para mañana. */
  time?: string | null
  columns?: { id: string; name: string }[]
}

export function fold(s: string): string
export function findColumn<C extends { id: string; name: string }>(tag: string, columns?: C[], options?: { strict?: boolean }): C | null
export function parseTask(input: string, ctx: ParseContext): ParsedTask
export function describe(parsed: ParsedTask, ctx: ParseContext): string
/** Día de la semana (0 = domingo) de una repetición como «cada lunes», o null. */
export function repeatWeekday(parsed: ParsedTask): number | null
/** El primer día de la semana `weekday` (0 = domingo) desde `from` ('AAAA-MM-DD') incluido. */
export function weekdayFrom(from: string, weekday: number): string
