import { useEffect, useSyncExternalStore } from 'react'
import type { AdPlatform, CompanyAccount } from '../server/empresas.mjs'
import { googleApi, metaApi, summariesApi, type DailySummary, type Period, type RunningRows } from './ads'

/**
 * Las campañas de todas las cuentas a la vez, para el resumen de «Hoy». Lo leído se guarda mientras Tablero está
 * abierto: al volver a «Hoy» se ve al momento y solo se vuelve a pedir si ya tiene unos minutos.
 */
export interface AccountData {
  /** Lo último leído (sigue a la vista mientras se vuelve a pedir, o si la vez siguiente falla). */
  rows: RunningRows | null
  error: string | null
  loading: boolean
  /** Cuándo se leyó. */
  at: number | null
}

/** Pasado este rato, al volver a «Hoy» (o a la ventana) se piden otra vez. */
const STALE = 5 * 60_000

const keyOf = (plataforma: AdPlatform, id: string, period: Period) => `${plataforma}:${id}:${period}`
const EMPTY: AccountData = { rows: null, error: null, loading: false, at: null }

let state: ReadonlyMap<string, AccountData> = new Map()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
function set(key: string, next: Partial<AccountData>) {
  state = new Map(state).set(key, { ...(state.get(key) ?? EMPTY), ...next })
  for (const listener of listeners) listener()
}

/** Pide las campañas de cada cuenta que no las tenga (o las tenga viejas); con `fresh`, todas y sin la copia del servidor. */
export function loadOverview(accounts: CompanyAccount[], period: Period, fresh = false) {
  for (const { plataforma, id } of accounts) {
    const key = keyOf(plataforma, id, period)
    const known = state.get(key)
    if (known?.loading) continue
    if (!fresh && known?.at && Date.now() - known.at < STALE) continue
    set(key, { loading: true })
    const api = plataforma === 'google' ? googleApi : metaApi
    api.rows(id, period, { nivel: 'campana' }, fresh).then(
      (rows) => set(key, { rows, error: null, loading: false, at: Date.now() }),
      (err) => set(key, { error: err instanceof Error ? err.message : String(err), loading: false, at: Date.now() }),
    )
  }
}

/** Lo leído de cada cuenta en el periodo (`get`), pidiendo lo que falte al entrar, al cambiar de periodo y al volver a la ventana. */
export function useOverview(accounts: CompanyAccount[], period: Period) {
  const data = useSyncExternalStore(subscribe, () => state)
  const wanted = accounts.map((a) => `${a.plataforma}:${a.id}`).join(' ')
  useEffect(() => {
    const load = () => {
      if (document.visibilityState === 'visible') loadOverview(accounts, period)
    }
    load()
    document.addEventListener('visibilitychange', load)
    return () => document.removeEventListener('visibilitychange', load)
    // Las cuentas, por sus identificadores: la lista se rehace en cada pintado.
  }, [wanted, period])
  return (account: CompanyAccount) => data.get(keyOf(account.plataforma, account.id, period)) ?? EMPTY
}

// Los resúmenes diarios dicen qué cuentas de Google Ads y de Meta son de la misma empresa.
let summaries: DailySummary[] = []
let asked = false
const summaryListeners = new Set<() => void>()

/** Los resúmenes diarios (una vez; sin ellos, las cuentas se juntan solo por su nombre). */
export function useSummaryLinks() {
  const list = useSyncExternalStore(
    (listener) => {
      summaryListeners.add(listener)
      return () => summaryListeners.delete(listener)
    },
    () => summaries,
  )
  useEffect(() => {
    if (asked) return
    asked = true
    summariesApi.list().then(
      (found) => {
        summaries = found
        for (const listener of summaryListeners) listener()
      },
      () => {
        asked = false
      },
    )
  }, [])
  return list
}
