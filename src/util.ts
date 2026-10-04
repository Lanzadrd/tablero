import { useCallback, useState, type CSSProperties } from 'react'
import type { ColorKey } from './model'

export const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ')

export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))

/** ¿El foco está en un campo de texto? (para no robarle las teclas) */
export const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select') !== null)

/** Convierte un texto pegado en una lista de tareas (quita viñetas y casillas). */
export const splitLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•·]|\d+[.)]|\[[ xX]?\])\s+/, '').trim())
    .filter(Boolean)

export const tint = (color: ColorKey) => ({ '--tint': `var(--c-${color})` }) as CSSProperties

/** Preferencia de interfaz guardada en este navegador (vista, modo del calendario…). */
export function useStoredState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })
  const update = useCallback(
    (next: T) => {
      setValue(next)
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // Sin almacenamiento: la preferencia dura solo esta sesión.
      }
    },
    [key],
  )
  return [value, update] as const
}
