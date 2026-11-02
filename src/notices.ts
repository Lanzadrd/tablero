// Los avisos en pantalla de lo que sale bien o mal. Fuera de React: los lanza también la capa que habla con el servidor,
// así no se queda ninguna acción sin decir cómo ha ido.
import { useSyncExternalStore } from 'react'

export type NoticeTone = 'ok' | 'error' | 'info'

export interface Notice {
  id: number
  tone: NoticeTone
  text: string
}

/** Más a la vez no caben ni se leen: se van los más antiguos (primero los que no son errores). */
const MAX_NOTICES = 4

let notices: Notice[] = []
let nextId = 1
const listeners = new Set<() => void>()

function publish(next: Notice[]) {
  notices = next
  listeners.forEach((listener) => listener())
}

export function notify(tone: NoticeTone, text: string) {
  // El mismo aviso otra vez no se apila: vuelve a empezar su tiempo.
  const next = [...notices.filter((n) => n.tone !== tone || n.text !== text), { id: nextId++, tone, text }]
  while (next.length > MAX_NOTICES) next.splice(Math.max(next.findIndex((n) => n.tone !== 'error'), 0), 1)
  publish(next)
}

export const dismissNotice = (id: number) => publish(notices.filter((n) => n.id !== id))

/** Una acción que cambia algo: salga bien o mal, se avisa (también si el formulario ya no se ve). */
export function announce<T>(work: Promise<T>, failed: string, done?: string | ((result: T) => string | null)): Promise<T> {
  return work.then(
    (result) => {
      const text = typeof done === 'function' ? done(result) : done
      if (text) notify('ok', text)
      return result
    },
    (err: unknown) => {
      notify('error', `${failed}: ${err instanceof Error ? err.message : String(err)}`)
      throw err
    },
  )
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useNotices = () => useSyncExternalStore(subscribe, () => notices)
