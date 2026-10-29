// La app en el Dock: el número de pendientes para hoy, cómo se abre cada día y los atajos del
// menú del icono (public/manifest.webmanifest → /?vista=hoy, /?vista=calendario, /?vista=suscripciones,
// /?accion=nueva; también /?vista=anuncios, adonde vuelve la conexión con Meta),
// además de los enlaces a una tarea (/t/<id>).
import { useEffect, useRef } from 'react'
import type { View } from './context'
import { todayISO } from './dates'
import type { Board } from './model'
import { dueCount } from './today'

/** Badging API (solo en la app instalada; en otros navegadores no existe). */
type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

/** Número en el icono del Dock: pendientes con fecha de hoy o anterior. 0 = sin número. */
export function useAppBadge(board: Board | null, today: string) {
  const count = board ? dueCount(board, today) : null
  useEffect(() => {
    if (count === null) return
    const nav = navigator as BadgeNavigator
    try {
      const done = count > 0 ? nav.setAppBadge?.(count) : nav.clearAppBadge?.()
      done?.catch(() => {})
    } catch {
      // Sin permiso o sin la API: sin número.
    }
  }, [count])
}

/** Qué pide un atajo del Dock. */
export interface Launch {
  view?: View
  /** Lo mismo que pulsar N en la vista que quede abierta. */
  newTask?: boolean
  /** Enlace a una tarea (/t/<id>, «Copiar enlace» del detalle): enseñarla con su detalle abierto. */
  task?: string
}

const VIEWS: Record<string, View> = {
  hoy: 'today',
  tablero: 'board',
  calendario: 'calendar',
  suscripciones: 'subscriptions',
  anuncios: 'ads',
  google: 'google',
  resumenes: 'summaries',
}

export function readLaunch(url: URL): Launch | null {
  const link = /^\/t\/([^/]+)\/?$/.exec(url.pathname)
  if (link) {
    try {
      return { task: decodeURIComponent(link[1]) }
    } catch {
      return { task: link[1] }
    }
  }
  const view = VIEWS[url.searchParams.get('vista') ?? '']
  const newTask = url.searchParams.get('accion') === 'nueva'
  if (!view && !newTask) return null
  return { ...(view ? { view } : {}), ...(newTask ? { newTask } : {}) }
}

/** Con la ventana ya abierta (launch_handler «focus-existing»), Chrome entrega aquí la URL del atajo. */
interface LaunchQueue {
  setConsumer: (consumer: (params: { targetURL?: string }) => void) => void
}

const DAY_KEY = 'tablero.hoy.dia'

/** ¿Es la primera vez que se abre hoy? Lo apunta. Sin almacenamiento, nunca. */
function firstOpenToday() {
  try {
    const today = todayISO()
    if (localStorage.getItem(DAY_KEY) === today) return false
    localStorage.setItem(DAY_KEY, today)
    return true
  } catch {
    return false
  }
}

/**
 * La primera vez de cada día, «Hoy» (también si la ventana se queda abierta de un día para otro:
 * al volver a ella). Después, lo que pida la URL (y se limpia a «/») o un atajo del Dock.
 */
export function useLaunch(onLaunch: (launch: Launch) => void) {
  const handler = useRef(onLaunch)
  handler.current = onLaunch

  useEffect(() => {
    const run = (launch: Launch) => handler.current(launch)
    const daily = () => {
      if (document.visibilityState === 'visible' && firstOpenToday()) run({ view: 'today' })
    }
    if (firstOpenToday()) run({ view: 'today' })

    const fromUrl = readLaunch(new URL(location.href))
    if (fromUrl) {
      history.replaceState(history.state, '', '/')
      run(fromUrl)
    }

    const queue = (window as Window & { launchQueue?: LaunchQueue }).launchQueue
    queue?.setConsumer(({ targetURL }) => {
      if (!targetURL) return
      try {
        const launch = readLaunch(new URL(targetURL))
        if (launch) run(launch)
      } catch {
        // URL rara: se ignora.
      }
    })

    window.addEventListener('focus', daily)
    document.addEventListener('visibilitychange', daily)
    return () => {
      window.removeEventListener('focus', daily)
      document.removeEventListener('visibilitychange', daily)
    }
  }, [])
}
