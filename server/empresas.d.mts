export type AdPlatform = 'meta' | 'google'

/** Lo que estas funciones necesitan de un portfolio (o cuenta de administrador) y sus cuentas (src/ads.ts tiene los tipos completos). */
export interface AccountLike {
  id: string
  nombre: string
  moneda: string
  activa: boolean
  prueba?: boolean
}

export interface GroupLike {
  id: string
  nombre: string
  foto: string | null
  cuentas: AccountLike[]
}

export interface CompanyAccount {
  plataforma: AdPlatform
  id: string
  nombre: string
  moneda: string
}

export interface Company {
  id: string
  nombre: string
  foto: string | null
  cuentas: CompanyAccount[]
}

export function companiesOf(sources?: {
  meta?: GroupLike[]
  google?: GroupLike[]
  /** Los resúmenes diarios: las cuentas que comparten uno son de la misma empresa. */
  summaries?: Array<{ meta?: string[]; google?: string[] }>
}): Company[]

export type ResultKind = 'conversaciones' | 'leads' | 'conversiones'

export interface AdResult {
  tipo: ResultKind
  cantidad: number
  /** Lo que cuesta cada uno; null si no hay ninguno. */
  coste: number | null
}

export interface CampaignView {
  id: string
  nombre: string
  activa: boolean
  tono: 'ok' | 'off' | 'warning'
  /** Lo que pasa de verdad: «Activa», «En pausa», «Rechazada»… */
  entrega: string
  gasto: number
  resultado: AdResult
}

export interface AccountView {
  moneda: string
  gasto: number
  /** Uno por cada cosa que buscan sus campañas. */
  resultados: AdResult[]
  /** Las activas o con gasto en el periodo; sin ninguna, la cuenta no tiene nada en marcha. */
  campanas: CampaignView[]
  /** Cuántas tienen algo que mirar. */
  avisos: number
}

/** Lo que estas funciones necesitan de las filas de «En marcha». */
export interface RowsLike {
  moneda: string
  totales: Record<string, number | null>
  filas: Array<{
    id: string
    nombre: string
    estado: 'activa' | 'pausada'
    entrega: { texto: string; tono: 'ok' | 'off' | 'warning' }
    resultado?: 'leads' | 'conversaciones'
    metricas: Record<string, number | null>
  }>
}

export function accountView(rows: RowsLike, plataforma: AdPlatform): AccountView
export function resultText(result: Pick<AdResult, 'tipo' | 'cantidad'>): string
