// Anuncios en Meta: lo que la vista pide al servidor (server/meta.mjs y server/anuncios.mjs) y las cuentas
// del formulario. El token de Meta nunca llega aquí: solo si hay conexión, de quién y hasta cuándo.

export interface MetaStatus {
  /** ¿Están el identificador y la clave secreta de la app de Meta? */
  app: boolean
  appId: string | null
  /** Configuración de «Inicio de sesión con Facebook para empresas» (si se usa en vez de los permisos sueltos). */
  configuracion: string | null
  conectada: boolean
  usuario: { id: string; nombre: string } | null
  /** ISO; null si no caduca (o no hay conexión). */
  caduca: string | null
  /** Permisos imprescindibles que no se concedieron al conectar. */
  faltan: string[]
  version: string
}

export interface AdAccount {
  id: string // act_…
  nombre: string
  moneda: string
  estado: string
  activa: boolean
  zona: string | null
}

export interface Portfolio {
  id: string
  nombre: string
  foto: string | null
  cuentas: AdAccount[]
}

export interface MetaPage {
  id: string
  nombre: string
  foto: string | null
  instagram: { id: string; usuario: string } | null
  /** Número de WhatsApp conectado a la página, si Meta lo enseña. */
  whatsapp: string | null
}

/** Un lugar del público: país, región o ciudad (las claves son las de Meta). */
export interface Place {
  key: string
  tipo: 'country' | 'region' | 'city'
  nombre: string
  detalle: string
}

export type Gender = 'todos' | 'hombres' | 'mujeres'
export type Placements = 'auto' | 'facebook' | 'instagram'

/** Lo que se repite de una campaña a otra. Una plantilla es esto con nombre (y sin las creatividades). */
export interface AdSettings {
  cuenta: string | null
  pagina: string | null
  /** Cuenta de Instagram que firma el anuncio; null = la página. */
  instagram: string | null
  /** Presupuesto diario, en la moneda de la cuenta. */
  presupuesto: number
  lugares: Place[]
  edadMin: number
  edadMax: number
  genero: Gender
  /** Público Advantage+: Meta puede ir más allá de la edad y el sexo si encuentra más conversaciones. */
  advantage: boolean
  ubicaciones: Placements
  texto: string
  titular: string
  /** Lo que aparece escrito en WhatsApp para que la persona lo envíe. */
  saludo: string
}

export interface Template extends AdSettings {
  id: string
  nombre: string
}

export type Media = { tipo: 'imagen'; hash: string; url: string | null } | { tipo: 'video'; id: string }

export interface Launch {
  id: string
  creadoEn: string
  cuenta: string
  cuentaNombre: string | null
  plantilla: string | null
  nombre: string
  campana: string
  conjunto: string
  anuncios: string[]
  presupuesto: number
  moneda: string
  estado: 'pausada' | 'activa'
  /** Ya se activó alguna vez (desde entonces, «Activar» solo enciende la campaña). */
  activada?: boolean
  enlace: string
}

/** Los periodos de «En marcha» (en la zona horaria de la cuenta). */
export type Period = 'hoy' | '7d' | '30d'

/** Una campaña de la cuenta, activa o en pausa, con sus números del periodo. */
export interface Campaign {
  id: string
  nombre: string
  /** Lo que dice el interruptor. */
  estado: 'activa' | 'pausada'
  /** Lo que pasa de verdad: una campaña activa puede no estar gastando (conjuntos en pausa, terminada…). */
  entrega: { texto: string; tono: 'ok' | 'off' | 'warning' }
  /** Por día o en total; null si ningún conjunto gastaría. */
  presupuesto: { cantidad: number; tipo: 'dia' | 'total' } | null
  gasto: number
  /** Conversaciones de WhatsApp (o Messenger, Instagram) empezadas desde los anuncios. */
  conversaciones: number
  /** Coste por conversación; null sin conversaciones. */
  coste: number | null
  enlace: string
  actualizada: string | null
}

export interface CampaignList {
  moneda: string
  periodo: Period
  actualizado: string
  campanas: Campaign[]
}

export interface LaunchPlan extends AdSettings {
  cuenta: string
  pagina: string
  nombre: string
  plantilla: string | null
  /** Día de inicio (AAAA-MM-DD); null = en cuanto se active. */
  inicio: string | null
  fin: string | null
  anuncios: Array<{ nombre: string; medio: Media }>
}

export const DEFAULT_SETTINGS: AdSettings = {
  cuenta: null,
  pagina: null,
  instagram: null,
  presupuesto: 10,
  lugares: [{ key: 'ES', tipo: 'country', nombre: 'España', detalle: 'País' }],
  edadMin: 18,
  edadMax: 65,
  genero: 'todos',
  advantage: true,
  ubicaciones: 'auto',
  texto: '',
  titular: '',
  saludo: 'Hola, quiero más información',
}

/** Los campos de una plantilla que se copian al formulario (los de AdSettings). */
export const settingsOf = (t: AdSettings): AdSettings => ({
  cuenta: t.cuenta,
  pagina: t.pagina,
  instagram: t.instagram,
  presupuesto: t.presupuesto,
  lugares: t.lugares,
  edadMin: t.edadMin,
  edadMax: t.edadMax,
  genero: t.genero,
  advantage: t.advantage,
  ubicaciones: t.ubicaciones,
  texto: t.texto,
  titular: t.titular,
  saludo: t.saludo,
})

/** «10 €», «10,50 €», «5.185.576 ARS» (con los decimales de la moneda solo si hacen falta y aportan algo). */
export const money = (amount: number, currency: string) =>
  new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency,
    ...(amount % 1 && Math.abs(amount) < 1000 ? {} : { maximumFractionDigits: 0 }),
  }).format(amount)

export const sameSettings = (a: AdSettings, b: AdSettings) => JSON.stringify(settingsOf(a)) === JSON.stringify(settingsOf(b))

/** «Hoplon · WhatsApp · 26 oct». */
export function campaignName(template: string | null, now = new Date()) {
  const day = now.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '')
  return [template, 'WhatsApp', day].filter(Boolean).join(' · ')
}

/** «foto-verano.jpg» → «foto-verano». */
export const adNameFrom = (file: string) => file.replace(/\.[a-z0-9]{2,5}$/i, '').trim() || file

/** Qué falta para poder crear la campaña (null = nada). */
export function missing(plan: { cuenta: string | null; pagina: string | null; presupuesto: number; lugares: Place[]; creatividades: number; texto: string }) {
  if (!plan.cuenta) return 'Elige una cuenta publicitaria'
  if (!plan.pagina) return 'Elige la página de Facebook'
  if (!(plan.presupuesto > 0)) return 'Indica el presupuesto diario'
  if (!plan.lugares.length) return 'Añade al menos un lugar'
  if (!plan.texto.trim()) return 'Escribe el texto del anuncio'
  if (!plan.creatividades) return 'Añade al menos una imagen o un vídeo'
  return null
}

// ── Servidor ──

export class ApiError extends Error {
  readonly status: number
  readonly code: string | null
  constructor(message: string, status: number, code: string | null) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      cache: 'no-store',
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
  } catch {
    throw new ApiError('Sin conexión con el servidor local de Tablero', 0, null)
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string; mensaje?: string }) | null
  if (!res.ok) {
    const message = data?.mensaje ?? data?.error ?? `Error ${res.status}`
    throw new ApiError(message, res.status, data?.mensaje ? (data.error ?? null) : null)
  }
  return data as T
}

export const metaApi = {
  status: () => call<MetaStatus>('GET', '/api/meta/estado'),
  saveApp: (id: string, secreto: string, configuracion: string) => call<MetaStatus>('PUT', '/api/meta/app', { id, secreto, configuracion }),
  saveToken: (token: string) => call<MetaStatus>('POST', '/api/meta/token', { token }),
  disconnect: () => call<MetaStatus>('POST', '/api/meta/desconectar', {}),
  portfolios: (fresh = false) =>
    call<{ portfolios: Portfolio[] }>('GET', `/api/meta/cuentas${fresh ? '?actualizar=1' : ''}`).then((r) => r.portfolios),
  pages: (account: string, fresh = false) =>
    call<{ paginas: MetaPage[] }>('GET', `/api/meta/paginas?cuenta=${encodeURIComponent(account)}${fresh ? '&actualizar=1' : ''}`).then(
      (r) => r.paginas,
    ),
  places: (query: string) =>
    call<{ lugares: Place[] }>('GET', `/api/meta/lugares?q=${encodeURIComponent(query)}`).then((r) => r.lugares),
  launch: (plan: LaunchPlan) => call<{ lanzamiento: Launch }>('POST', '/api/meta/lanzar', plan).then((r) => r.lanzamiento),
  activate: (id: string) => call<{ lanzamiento: Launch }>('POST', '/api/meta/activar', { id }).then((r) => r.lanzamiento),
  campaigns: (account: string, period: Period, fresh = false) =>
    call<CampaignList>(
      'GET',
      `/api/meta/campanas?cuenta=${encodeURIComponent(account)}&periodo=${period}${fresh ? '&actualizar=1' : ''}`,
    ),
  setCampaignStatus: (account: string, id: string, estado: Campaign['estado']) =>
    call<{ id: string; estado: Campaign['estado']; lanzamiento: Launch | null }>('POST', '/api/meta/campanas/estado', {
      cuenta: account,
      id,
      estado,
    }),
  saved: () => call<{ plantillas: Template[]; lanzamientos: Launch[] }>('GET', '/api/anuncios'),
  saveTemplates: (plantillas: Template[]) =>
    call<{ plantillas: Template[] }>('PUT', '/api/anuncios/plantillas', { plantillas }).then((r) => r.plantillas),
}

/**
 * Sube una imagen o un vídeo a la cuenta publicitaria. Va tal cual (no en JSON): la cabecera propia hace que
 * otra web no pueda mandarlo (el navegador pediría permiso antes, y el servidor nunca lo da).
 */
export async function uploadMedia(account: string, file: File): Promise<Media> {
  const url = `/api/meta/medios?cuenta=${encodeURIComponent(account)}&nombre=${encodeURIComponent(file.name)}`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': file.type || 'application/octet-stream', 'x-tablero-subida': '1' },
      body: file,
    })
  } catch {
    throw new ApiError('Sin conexión con el servidor local de Tablero', 0, null)
  }
  const data = (await res.json().catch(() => null)) as { medio?: Media; error?: string; mensaje?: string } | null
  if (!res.ok || !data?.medio) throw new ApiError(data?.mensaje ?? data?.error ?? `Error ${res.status}`, res.status, data?.error ?? null)
  return data.medio
}

/** Adonde vuelve Meta tras conectar: hay que darla de alta en la app de Meta tal cual. */
export const redirectUri = () => `http://localhost${location.port ? `:${location.port}` : ''}/api/meta/volver`

/** Días que le quedan a la conexión (null si no caduca). */
export function daysLeft(caduca: string | null, now = new Date()) {
  if (!caduca) return null
  return Math.max(0, Math.floor((new Date(caduca).getTime() - now.getTime()) / 86_400_000))
}
