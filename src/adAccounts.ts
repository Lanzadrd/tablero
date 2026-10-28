import { useSyncExternalStore } from 'react'
import { ApiError, googleApi, metaApi, type Portfolio } from './ads'

/**
 * Los portfolios (o cuentas de administrador) con sus cuentas publicitarias y la cuenta elegida, compartidos por
 * el menú lateral (que los enseña bajo «Meta Ads» y «Google Ads») y cada vista. La elegida se recuerda en este
 * navegador.
 */
export interface AdAccounts {
  portfolios: Portfolio[] | null
  selected: string | null
  loading: boolean
  error: string | null
  /** Sin conexión (o caducada): el menú no enseña cuentas y la vista vuelve a «Conectar». */
  disconnected: boolean
}

export interface AccountStore {
  useAccounts: () => AdAccounts
  /** Pide las cuentas (con `fresh`, sin la copia del servidor). Si ya se están pidiendo, espera a esas. */
  load: (fresh?: boolean) => Promise<void>
  select: (id: string) => void
  /** Al desconectar: el menú deja de enseñar las cuentas (la elegida se recuerda para la próxima vez). */
  forget: () => void
}

function storedSelection(key: string): string | null {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? null : (JSON.parse(raw) as string | null)
  } catch {
    return null
  }
}

function createAccountStore(fetchAccounts: (fresh: boolean) => Promise<Portfolio[]>, selectedKey: string): AccountStore {
  let state: AdAccounts = { portfolios: null, selected: storedSelection(selectedKey), loading: false, error: null, disconnected: false }
  let pending: Promise<void> | null = null
  const listeners = new Set<() => void>()

  const set = (next: Partial<AdAccounts>) => {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
  }
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function load(fresh = false): Promise<void> {
    if (pending && !fresh) return pending
    set({ loading: true })
    const request: Promise<void> = fetchAccounts(fresh).then(
      (portfolios) => {
        if (pending === request) set({ portfolios, error: null, disconnected: false })
      },
      (err) => {
        if (pending !== request) return
        if (err instanceof ApiError && err.status === 401) set({ portfolios: null, error: null, disconnected: true })
        else set({ error: err instanceof Error ? err.message : String(err) })
      },
    )
    pending = request
    void request.finally(() => {
      if (pending !== request) return
      pending = null
      set({ loading: false })
    })
    return request
  }

  return {
    useAccounts: () => useSyncExternalStore(subscribe, () => state),
    load,
    select(id) {
      set({ selected: id })
      try {
        localStorage.setItem(selectedKey, JSON.stringify(id))
      } catch {
        // Sin almacenamiento: la elección dura solo esta sesión.
      }
    },
    forget() {
      pending = null
      set({ portfolios: null, loading: false, error: null, disconnected: true })
    },
  }
}

export const metaAccounts = createAccountStore((fresh) => metaApi.portfolios(fresh), 'tablero.anuncios.cuenta')
export const googleAccounts = createAccountStore((fresh) => googleApi.accounts(fresh), 'tablero.google.cuenta')
