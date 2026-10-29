export type RepeatEvery = 'day' | 'weekday' | 'week' | 'month' | 'year'

export interface Repeat {
  every: RepeatEvery
  /** Cada cuántos (1 por defecto). */
  interval?: number
  /** Desde la fecha de la tarea ('due', por defecto) o desde que se completa ('done'). */
  from?: 'due' | 'done'
}

export const EVERY: RepeatEvery[]
export function isRepeat(value: unknown): value is Repeat
export function nextDue(repeat: Repeat, dates: { due: string | null; doneOn: string }): string
export function nextTaskId(id: string): string
export function nextOccurrence<T extends { id: string; repeat?: Repeat | null; due: string | null; notes: string }>(
  task: T,
  options: { id?: string; doneOn: string; now?: string },
): T
export function isUntouchedNext(
  task: { id: string; title: string; notes: string; time?: string | null },
  next: { id: string; title: string; notes: string; done: boolean; repeat?: unknown; time?: string | null } | undefined | null,
): boolean
