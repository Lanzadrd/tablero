// Tareas seleccionadas (⌘clic, ⇧clic, ⇧↑↓). Vive fuera de React: cada fila se suscribe solo a
// si está seleccionada, así cambiar la selección no repinta el tablero entero.
import { useSyncExternalStore } from 'react'

type Listener = () => void

let selected: ReadonlySet<string> = new Set()
/** Desde dónde se cuenta un tramo con ⇧clic. */
let anchor: string | null = null
const listeners = new Set<Listener>()

function commit(next: ReadonlySet<string>, nextAnchor: string | null = anchor) {
  anchor = nextAnchor
  if (next.size === selected.size && [...next].every((id) => selected.has(id))) return
  selected = next
  listeners.forEach((fn) => fn())
}

const subscribe = (fn: Listener) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export const selection = {
  ids: () => [...selected],
  size: () => selected.size,
  has: (id: string) => selected.has(id),
  anchor: () => anchor,
  /** ⌘clic: la añade o la quita. */
  toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    commit(next, id)
  },
  /** Añade varias (⇧clic, ⇧↑↓) sin mover el ancla salvo que se pida. */
  add(ids: string[], newAnchor: string | null = anchor) {
    commit(new Set([...selected, ...ids]), newAnchor)
  },
  clear() {
    commit(new Set(), null)
  },
  /** Quita las que ya no existen (borradas aquí o en otro sitio). */
  retain(exists: (id: string) => boolean) {
    const next = [...selected].filter(exists)
    if (next.length !== selected.size) commit(new Set(next), anchor && exists(anchor) ? anchor : null)
  },
}

/** ¿Está seleccionada esta tarea? Solo repinta la fila cuando cambia su respuesta. */
export const useSelected = (id: string) => useSyncExternalStore(subscribe, () => selected.has(id))

/** Todas las seleccionadas (para la barra de abajo). */
export const useSelection = () => useSyncExternalStore(subscribe, () => selected)

// ── Tarea que hay que desplegar para enseñarla (búsqueda, enlace /t/<id>) ──

let revealed: string | null = null
const revealListeners = new Set<Listener>()

export function setRevealed(id: string | null) {
  revealed = id
  revealListeners.forEach((fn) => fn())
}

const subscribeReveal = (fn: Listener) => {
  revealListeners.add(fn)
  return () => {
    revealListeners.delete(fn)
  }
}

/** La tarea que se está buscando para enseñarla (un grupo plegado que la contiene se abre). */
export const useRevealed = () => useSyncExternalStore(subscribeReveal, () => revealed)
