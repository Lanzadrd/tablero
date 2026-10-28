import { useSyncExternalStore } from 'react'

/**
 * La apariencia: la del sistema (por defecto), clara u oscura. La elegida va en <html data-theme> (los colores
 * oscuros de los CSS miran ese atributo) y se recuerda en este navegador; index.html la pone antes de pintar.
 */
export type Theme = 'system' | 'light' | 'dark'

const KEY = 'tablero.tema'
/** El color de la barra de la ventana (el fondo), como en index.html. */
const BAR = { light: '#f5f5f7', dark: '#111113' }

function read(): Theme {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

let theme: Theme = read()
const listeners = new Set<() => void>()

function apply() {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const own = meta.media.includes('dark') ? BAR.dark : BAR.light
    meta.content = theme === 'system' ? own : BAR[theme]
  }
}

export function setTheme(next: Theme) {
  theme = next
  try {
    if (next === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Sin almacenamiento: dura esta sesión.
  }
  apply()
  for (const listener of listeners) listener()
}

/** Sistema → claro → oscuro → sistema. */
export const nextTheme = (current: Theme): Theme => (current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system')

export const THEME_LABELS: Record<Theme, string> = { system: 'Como el sistema', light: 'Claro', dark: 'Oscuro' }

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useTheme = () => useSyncExternalStore(subscribe, () => theme)

apply()
