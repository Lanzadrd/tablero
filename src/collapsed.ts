// Columnas contraídas: preferencia de este Mac (localStorage), no del tablero. Vive fuera de React
// para que App pueda expandir una columna antes de escribir en ella (1–9, «Nueva tarea»…).
import { useSyncExternalStore } from 'react'

const KEY = 'tablero.columnas.contraidas'

function read(): ReadonlySet<string> {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return new Set(Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

let ids = read()
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((fn) => fn())

// Otra ventana de Tablero en este Mac.
window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return
  ids = read()
  notify()
})

export const collapsed = {
  has: (id: string) => ids.has(id),
  set(id: string, on: boolean) {
    if (ids.has(id) === on) return
    const next = new Set(ids)
    if (on) next.add(id)
    else next.delete(id)
    ids = next
    try {
      localStorage.setItem(KEY, JSON.stringify([...next]))
    } catch {
      // Sin almacenamiento: dura lo que la ventana.
    }
    notify()
  },
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export const useCollapsed = (id: string) => useSyncExternalStore(subscribe, () => ids.has(id))
