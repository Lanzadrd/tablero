// Anuncios en Meta y Google Ads: lo que las vistas piden al servidor (server/meta.mjs, server/anuncios.mjs y
// server/google.mjs) y las cuentas del formulario. Los tokens nunca llegan aquí: solo si hay conexión y de quién.

import type { Formato } from './placements'

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
  /** ¿Se dieron los permisos de WhatsApp (los de los resúmenes)? */
  whatsapp: boolean
  version: string
}

export interface AdAccount {
  id: string // act_…
  nombre: string
  moneda: string
  estado: string
  activa: boolean
  zona: string | null
  /** Una cuenta de prueba de Google Ads (no gasta ni se muestra). */
  prueba?: boolean
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
  /** La vinculada a la página y las que ya usan sus anuncios (la más usada primero); `usuario` null si Meta no lo da. */
  instagrams: Array<{ id: string; usuario: string | null }>
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

/** Las mejoras automáticas de Meta (Advantage+ creative) que se pueden activar en los anuncios. */
export type Enhancement =
  | 'retoques'
  | 'ampliar'
  | 'brillo'
  | 'superposiciones'
  | 'animacion'
  | 'flexibles'
  | 'filtros'
  | 'subtitulos'
  | 'stickers'
  | 'texto'
  | 'traduccion'
  | 'boton'
  | 'comentarios'
  | 'detalles'
  | 'destino'
  | 'resumen'

/** Cada mejora como la llama el Administrador de anuncios, con lo que hace (IA: la genera Meta). */
export const ENHANCEMENTS: Array<{ key: Enhancement; label: string; note: string; group: 'visual' | 'texto' }> = [
  { key: 'retoques', label: 'Retoques visuales', note: 'Recorta la imagen o el vídeo para cada ubicación.', group: 'visual' },
  { key: 'ampliar', label: 'Ampliar imagen y vídeo', note: 'Rellena los bordes con IA para que ocupen más formatos.', group: 'visual' },
  { key: 'brillo', label: 'Brillo y contraste', note: 'Los ajusta cuando cree que funciona mejor.', group: 'visual' },
  { key: 'superposiciones', label: 'Añadir superposiciones', note: 'Pone tu texto encima de la imagen, con IA.', group: 'visual' },
  { key: 'animacion', label: 'Animar la imagen', note: 'La convierte en un vídeo corto con movimiento, con IA.', group: 'visual' },
  { key: 'flexibles', label: 'Medios flexibles', note: 'Usa la imagen de un formato en todas las ubicaciones.', group: 'visual' },
  { key: 'filtros', label: 'Filtros de vídeo', note: 'Aplica filtros visuales al vídeo.', group: 'visual' },
  { key: 'subtitulos', label: 'Subtítulos automáticos', note: 'En los vídeos de Instagram.', group: 'visual' },
  { key: 'stickers', label: 'Stickers con IA', note: 'Pegatinas generadas con la llamada a la acción.', group: 'visual' },
  { key: 'texto', label: 'Mejoras de texto', note: 'Mueve tu texto a titular o descripción y añade una introducción.', group: 'texto' },
  { key: 'traduccion', label: 'Traducir', note: 'Traduce el texto (y el de la imagen) a otros idiomas.', group: 'texto' },
  { key: 'boton', label: 'Mejorar el botón', note: 'Añade frases de tu anuncio junto a «Enviar mensaje».', group: 'texto' },
  { key: 'comentarios', label: 'Comentarios relevantes', note: 'Enseña un comentario debajo del anuncio.', group: 'texto' },
  { key: 'detalles', label: 'Revelar detalles con el tiempo', note: 'Muestra más información si alguien se detiene en el anuncio.', group: 'texto' },
  { key: 'destino', label: 'Información del destino', note: 'Añade textos sacados de adonde lleva el anuncio.', group: 'texto' },
  { key: 'resumen', label: 'Resumen', note: 'Añade un resumen del anuncio hecho por Meta.', group: 'texto' },
]
/** Automáticas, elegidas (en `posiciones`) o, en las plantillas de antes, solo Facebook o solo Instagram. */
export type Placements = 'auto' | 'manual' | 'facebook' | 'instagram'

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
  /** Las ubicaciones elegidas (src/placements.ts), con `ubicaciones: 'manual'`. */
  posiciones: string[]
  /** Texto principal, título y descripción (los dos últimos, opcionales). */
  texto: string
  titular: string
  descripcion: string
  /** El chat de WhatsApp: vuestro mensaje y, para empezar, el de la persona ya escrito o preguntas que toca. */
  bienvenida: string
  tipoMensaje: 'escrito' | 'preguntas'
  saludo: string
  preguntas: string[]
  /** Las mejoras automáticas de Meta que se activan (las demás se mandan desactivadas). */
  mejoras: Enhancement[]
  /** Si el anuncio puede salir junto a anuncios de otras empresas. */
  multianunciante: boolean
}

export interface Template extends AdSettings {
  id: string
  nombre: string
}

export type Media = { tipo: 'imagen'; hash: string; url: string | null } | { tipo: 'video'; id: string }

/** Una versión de un anuncio: su formato y la imagen o el vídeo ya subido. */
export interface AdVersion {
  formato: Formato
  medio: Media
}

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
export type Period = 'hoy' | 'ayer' | '7d' | '30d'

/** Los niveles de «En marcha»: las campañas de la cuenta, los conjuntos de una campaña, los anuncios de un conjunto. */
export type Level = 'campana' | 'conjunto' | 'anuncio'

/** Las métricas del periodo. Los cocientes son null cuando no hay de qué (sin impresiones, sin clics…). */
export type Metrics = {
  gasto: number
  /** Conversaciones de WhatsApp (o Messenger, Instagram) empezadas desde los anuncios. */
  conversaciones: number
  coste: number | null
  /** Personas que escriben por primera vez. */
  contactos: number
  alcance: number
  impresiones: number
  frecuencia: number | null
  cpm: number | null
  /** Clics en el enlace (el botón de WhatsApp). */
  clics: number
  /** En %. */
  ctr: number | null
  cpc: number | null
  bloqueos: number
}

export type MetricKey = keyof Metrics

/** Las métricas de cualquier sitio (Meta, Google Ads), por su nombre. */
export type MetricValues = Record<string, number | null>

/** Una campaña, un conjunto o un anuncio, activo o en pausa, con sus métricas del periodo. */
export interface AdRow {
  id: string
  nombre: string
  /** Lo que dice el interruptor. */
  estado: 'activa' | 'pausada'
  /** Lo que pasa de verdad: algo activo puede no estar gastando (conjuntos en pausa, terminada…). */
  entrega: { texto: string; tono: 'ok' | 'off' | 'warning' }
  /**
   * Por día o en total; null si no gastaría nada, si va en la campaña (conjuntos) o en los anuncios. `reparte`:
   * es el de la campaña, que Meta reparte entre sus conjuntos (los conjuntos nuevos no llevan).
   */
  presupuesto: { cantidad: number; tipo: 'dia' | 'total'; reparte?: true } | null
  /** Dónde se abre en el sitio de anuncios (null si no hay un enlace que funcione). */
  enlace: string | null
  /** De los anuncios: la imagen o el fotograma, pequeño. */
  miniatura: string | null
  /** De los anuncios: las mejoras automáticas de Meta que tienen activadas y si salen con los de otros. */
  automaticas: { mejoras: Enhancement[]; multianunciante: boolean } | null
  /** De los conjuntos: la página con la que se anuncian. */
  pagina: string | null
  actualizada: string | null
  /** De las campañas de Google Ads: su tipo (Búsqueda, Display…). */
  tipo?: string | null
  /** No tiene nivel de debajo que ver (las campañas de Máximo rendimiento de Google Ads). */
  sinHijos?: boolean
  /** De qué campaña (y conjunto) es: para bajar a él desde la lista de toda la cuenta. */
  padres?: { campana?: { id: string; nombre: string } | null; conjunto?: { id: string; nombre: string } | null } | null
  /** Google Ads: cómo puja la campaña («Maximizar conversiones») y su puntuación de optimización (de 0 a 1). */
  puja?: string | null
  optimizacion?: number | null
  /** Google Ads: su estado en una frase, con lo que se pierde (presupuesto, cuota de búsqueda…). */
  explicacion?: string | null
  /** Google Ads: la imagen que la representa (`logo`: se enseña entera). */
  imagen?: { url: string; logo: boolean } | null
  /** Google Ads: el anuncio, para dibujarlo como sale en Google. */
  vista?: AdPreview
}

/** Un anuncio de Google como sale: de búsqueda (títulos, descripciones, enlaces) o con imágenes. */
export interface AdPreview {
  tipo: 'busqueda' | 'imagen' | 'otro'
  titulos: string[]
  descripciones: string[]
  rutas: string[]
  url: string | null
  empresa: string | null
  accion: string | null
  imagenes: string[]
  logo: string | null
  /** La calidad del anuncio que da Google: EXCELLENT, GOOD, AVERAGE, POOR, PENDING… */
  calidad: string | null
  enlaces: string[]
  destacados: string[]
}

/** Lo que tiene cualquier fila de Google Ads con métricas (palabras clave, términos de búsqueda). */
interface GoogleListRow {
  id: string
  campana: AdRef | null
  grupo: AdRef | null
  metricas: Metrics
}

export interface Keyword extends GoogleListRow {
  texto: string
  /** BROAD, PHRASE o EXACT. */
  concordancia: string | null
  estado: AdRow['estado']
  /** El nivel de calidad (1–10), si Google lo da. */
  calidad: number | null
  aviso: string | null
}

export interface SearchTerm extends GoogleListRow {
  termino: string
  estado: string | null
  palabra: { texto: string; concordancia: string | null } | null
}

/** Un recurso de Google Ads (imagen, logo, enlace de sitio, texto destacado…) y de dónde es. */
export interface GoogleAsset {
  id: string
  /** Para qué se usa: BUSINESS_LOGO, MARKETING_IMAGE, SITELINK, CALLOUT, STRUCTURED_SNIPPET… */
  tipo: string
  texto: string | null
  detalle: string[]
  imagen: string | null
  ancho: number | null
  alto: number | null
  url: string | null
  nivel: 'cuenta' | 'campana' | 'grupo'
  campana: AdRef | null
  grupo: AdRef | null
}

export interface GoogleList<T> {
  moneda: string
  filas: T[]
  totales: Metrics
}

// ── Editar lo publicado ──

/** Las estrategias de puja que se eligen en Tablero; «otra», una que solo se cambia en Meta. */
export type Bid = 'volumen' | 'coste' | 'puja' | 'otra'

export interface Budget {
  cantidad: number
  tipo: 'dia' | 'total'
}

/** El público de un conjunto publicado (`extras`: lo que Tablero no enseña y se conserva tal cual). */
export interface Audience {
  lugares: Place[]
  edadMin: number
  edadMax: number
  genero: Gender
  advantage: boolean
  /** «manual»: elegidas a mano en Meta (se quedan como están si no se cambian). */
  /** «meta»: elegidas en Meta con alguna que Tablero no conoce (se quedan como están si no se cambian). */
  ubicaciones: Placements | 'meta'
  posiciones: string[]
  extras: string[]
}

/** Las otras opciones de texto (las del Administrador de anuncios), además de la principal. */
export interface Variants {
  textos: string[]
  titulos: string[]
  descripciones: string[]
}

export type AdContent = Pick<
  AdSettings,
  'pagina' | 'instagram' | 'texto' | 'titular' | 'descripcion' | 'bienvenida' | 'tipoMensaje' | 'saludo' | 'preguntas' | 'mejoras' | 'multianunciante'
> & { variantes: Variants }

/** Una imagen o un vídeo de un anuncio publicado, con dónde verlo. */
export type MediaPreview = ({ tipo: 'imagen'; hash: string } | { tipo: 'video'; id: string }) & { url: string | null; ratio: number | null }

/** Cómo está una campaña, un conjunto o un anuncio de Meta, para editarlo. */
export interface EditDetails {
  nivel: Level
  id: string
  nombre: string
  estado: 'activa' | 'pausada' | 'archivada'
  moneda: string
  campana?: { objetivo: string | null; presupuesto: Budget | null; puja: Bid; limiteGasto: number | null }
  conjunto?: {
    presupuesto: Budget | null
    presupuestoCampana: Budget | null
    inicio: string | null
    empezado: boolean
    fin: string | null
    puja: Bid
    pujaEnCampana: boolean
    importePuja: number | null
    publico: Audience
    pagina: string | null
    whatsapp: string | null
    optimizacion: string | null
    destino: string | null
  }
  anuncio?: {
    conjunto: string
    editable: boolean
    motivo: string | null
    contenido: AdContent | null
    versiones: Array<{ formato: Formato; medio: MediaPreview }>
    /** Las del conjunto: dónde va cada versión. */
    ubicaciones: { ubicaciones: 'auto' | 'manual' | 'meta'; posiciones: string[] }
  }
}

/** Lo que se cambia (solo lo que se ha tocado). */
export interface EditChanges {
  nombre?: string
  presupuesto?: number
  puja?: Exclude<Bid, 'otra'>
  limiteGasto?: number | null
  inicio?: string | null
  fin?: string | null
  importePuja?: number
  publico?: Audience
  contenido?: AdContent
  /** Todas las versiones del anuncio (las que se quedan y las nuevas). */
  versiones?: AdVersion[]
}

/** Un texto de un anuncio de búsqueda adaptable de Google Ads (`fijado`: en qué posición va siempre). */
export interface SearchAsset {
  texto: string
  fijado: string | null
}

/** Cómo está una campaña, un grupo o un anuncio de Google Ads, para editarlo. */
export interface GoogleEditDetails {
  nivel: Level
  id: string
  nombre: string
  moneda: string
  campana?: { presupuesto: number | null; compartido: boolean }
  conjunto?: { cpc: number | null }
  anuncio?: { editable: boolean; motivo: string | null; titulos: SearchAsset[]; descripciones: SearchAsset[]; url: string; ruta1: string; ruta2: string }
}

export interface GoogleEditChanges {
  nombre?: string
  presupuesto?: number
  cpc?: number
  anuncio?: { titulos: SearchAsset[]; descripciones: SearchAsset[]; url: string; ruta1: string; ruta2: string }
}

/** La consulta de «En marcha»: periodo, nivel y filtro. */
function rowsQuery(account: string, period: Period, path: AdPath, fresh: boolean) {
  const query = new URLSearchParams({ cuenta: account, periodo: period })
  if (path.campanas?.length) query.set('campana', path.campanas.map((c) => c.id).join(','))
  if (path.conjuntos?.length) query.set('conjunto', path.conjuntos.map((c) => c.id).join(','))
  if (path.nivel) query.set('nivel', path.nivel)
  if (fresh) query.set('actualizar', '1')
  return query
}

const editQuery = (account: string, level: Level, id: string) => new URLSearchParams({ cuenta: account, nivel: level, id })

export interface AdRowWithMetrics extends AdRow {
  metricas: Metrics
}

/** Lo que enseña «En marcha» de un nivel, venga de donde venga. */
export interface RunningRows {
  /** Algo que decir de las cifras (las de las campañas inteligentes de Google Ads son de la campaña). */
  nota?: string
  moneda: string
  periodo: Period
  nivel: Level
  actualizado: string
  /** La campaña o el conjunto de arriba (null en las campañas de la cuenta). */
  padre: AdRow | null
  totales: MetricValues
  filas: Array<AdRow & { metricas: MetricValues }>
}

export interface AdRows extends RunningRows {
  /** De Meta, no la suma de las filas: el alcance no se puede sumar. */
  totales: Metrics
  filas: AdRowWithMetrics[]
}

/** Los textos que escribe Claude (todos los del anuncio y el chat). */
export type Copy = Pick<AdSettings, 'texto' | 'titular' | 'descripcion' | 'bienvenida' | 'saludo' | 'preguntas'>

/** Lo que se le manda a Claude: las imágenes (JPEG en base64, ya reducidas), la página, el público y lo escrito. */
export interface CopyRequest {
  imagenes: Array<{ media_type: 'image/jpeg'; data: string }>
  indicaciones: string
  pagina: string
  instagram: string
  lugares: string[]
  actuales: Copy
}

/** Un conjunto creado en una campaña que ya existía (en pausa; sus anuncios, listos). */
export interface NewAdSet {
  id: string
  nombre: string
  campana: string
  anuncios: string[]
  /** Creado activo («Publicar ya»). */
  activo?: boolean
}

/** Una campaña o un conjunto elegido, con su nombre (para decirlo en las pestañas). */
export interface AdRef {
  id: string
  nombre: string
}

/**
 * Dónde se está: qué se ve (`nivel`: campañas, conjuntos o anuncios; sin él, el de debajo del filtro) y lo elegido
 * arriba, como con las casillas del Administrador de anuncios: las campañas filtran los conjuntos y los anuncios;
 * los conjuntos, los anuncios. Sin nada elegido, los de toda la cuenta.
 */
export interface AdPath {
  campanas?: AdRef[]
  conjuntos?: AdRef[]
  nivel?: Level
}

export interface LaunchPlan extends AdSettings {
  cuenta: string
  pagina: string
  nombre: string
  plantilla: string | null
  /** Día de inicio (AAAA-MM-DD); null = en cuanto se active. */
  inicio: string | null
  fin: string | null
  /** Uno por pieza: sus versiones (1:1, 4:5, 9:16, 16:9), cada una en sus ubicaciones. */
  anuncios: Array<{ nombre: string; versiones: AdVersion[] }>
  /** «Publicar ya»: se crea todo activo en vez de en pausa. */
  publicar?: boolean
}

/** Lo primero que ve la persona en el chat si no se escribe otra cosa (el de Meta, en anuncios.mjs igual). */
export const GREETING = '¡Hola! ¿En qué podemos ayudarte?'
/** Como mucho, tantas preguntas frecuentes en el chat. */
export const MAX_QUESTIONS = 4

export const DEFAULT_SETTINGS: AdSettings = {
  cuenta: null,
  pagina: null,
  instagram: null,
  presupuesto: 10,
  // Sin plantilla, Ciudad del Este (la clave es la de Meta).
  lugares: [{ key: '1903856', tipo: 'city', nombre: 'Ciudad del Este', detalle: 'Alto Paraná Department, Paraguay' }],
  edadMin: 18,
  edadMax: 65,
  genero: 'todos',
  advantage: true,
  ubicaciones: 'auto',
  posiciones: [],
  texto: '',
  titular: '',
  descripcion: '',
  bienvenida: GREETING,
  tipoMensaje: 'escrito',
  saludo: 'Hola, quiero más información',
  preguntas: [],
  mejoras: [],
  multianunciante: false,
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
  posiciones: t.posiciones ?? [],
  texto: t.texto,
  titular: t.titular,
  // Las plantillas de antes no tienen descripción ni el chat entero.
  descripcion: t.descripcion ?? '',
  bienvenida: t.bienvenida ?? '',
  tipoMensaje: t.tipoMensaje === 'preguntas' ? 'preguntas' : 'escrito',
  saludo: t.saludo,
  preguntas: t.preguntas ?? [],
  // Las plantillas de antes no las tienen: sin mejoras ni multianunciante.
  mejoras: ENHANCEMENTS.map((e) => e.key).filter((key) => t.mejoras?.includes(key)),
  multianunciante: t.multianunciante === true,
})

/** «10 €», «10,50 €», «5.185.576 ARS» (con los decimales de la moneda solo si hacen falta y aportan algo). */
export const money = (amount: number, currency: string) =>
  new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency,
    ...(amount % 1 && Math.abs(amount) < 1000 ? {} : { maximumFractionDigits: 0 }),
  }).format(amount)

export const sameSettings = (a: AdSettings, b: AdSettings) => JSON.stringify(settingsOf(a)) === JSON.stringify(settingsOf(b))

/** «25.000 PYG al día», «300 € en total». */
export const budgetText = (b: { cantidad: number; tipo: 'dia' | 'total' }, currency: string) =>
  `${money(b.cantidad, currency)} ${b.tipo === 'dia' ? 'al día' : 'en total'}`

/** «sin mejoras de Meta», «2 mejoras de Meta · multianunciante». */
export function automaticSummary(a: { mejoras: Enhancement[]; multianunciante: boolean }) {
  const parts = [
    a.mejoras.length ? (a.mejoras.length === 1 ? '1 mejora de Meta' : `${a.mejoras.length} mejoras de Meta`) : null,
    a.multianunciante ? 'multianunciante' : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'sin mejoras de Meta'
}

/** «Hoplon · WhatsApp · 26 oct». */
export function campaignName(template: string | null, now = new Date()) {
  const day = now.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '')
  return [template, 'WhatsApp', day].filter(Boolean).join(' · ')
}

/** «foto-verano.jpg» → «foto-verano». */
export const adNameFrom = (file: string) => file.replace(/\.[a-z0-9]{2,5}$/i, '').trim() || file

/** Qué falta para poder crear la campaña (null = nada). */
export function missing(
  plan: Pick<AdSettings, 'cuenta' | 'pagina' | 'presupuesto' | 'lugares' | 'texto' | 'tipoMensaje' | 'saludo' | 'preguntas' | 'ubicaciones' | 'posiciones'> & {
    creatividades: number
  },
) {
  if (!plan.cuenta) return 'Elige una cuenta publicitaria'
  if (!plan.pagina) return 'Elige la página de Facebook'
  if (!(plan.presupuesto > 0)) return 'Indica el presupuesto diario'
  if (!plan.lugares.length) return 'Añade al menos un lugar'
  if (!plan.texto.trim()) return 'Escribe el texto principal'
  if (plan.tipoMensaje === 'escrito' && !plan.saludo.trim()) return 'Escribe el mensaje de la persona en WhatsApp'
  if (plan.tipoMensaje === 'preguntas' && !plan.preguntas.some((q) => q.trim())) return 'Añade al menos una pregunta para WhatsApp'
  if (!plan.creatividades) return 'Añade al menos una imagen o un vídeo'
  if (plan.ubicaciones === 'manual' && !plan.posiciones.length) return 'Elige al menos una ubicación'
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

/** La conexión con Google Ads (el cliente OAuth del proyecto de Google Cloud y la cuenta de Google). */
export interface GoogleStatus {
  /** ¿Están el identificador y la clave secreta del cliente OAuth? */
  cliente: boolean
  clienteId: string | null
  conectada: boolean
  usuario: { email: string | null } | null
  conectadaEn: string | null
  version: string
}

/** La dirección a la que vuelve Google al conectar (va en las URI de redireccionamiento del cliente OAuth). */
export const googleRedirectUri = () => `http://localhost${location.port ? `:${location.port}` : ''}/api/google/volver`

export const googleApi = {
  status: () => call<GoogleStatus>('GET', '/api/google/estado'),
  saveClient: (id: string, secreto: string) => call<GoogleStatus>('PUT', '/api/google/cliente', { id, secreto }),
  disconnect: () => call<GoogleStatus>('POST', '/api/google/desconectar', {}),
  accounts: (fresh = false) =>
    call<{ portfolios: Portfolio[] }>('GET', `/api/google/cuentas${fresh ? '?actualizar=1' : ''}`).then((r) => r.portfolios),
  rows: (account: string, period: Period, path: AdPath, fresh = false) =>
    call<RunningRows>('GET', `/api/google/campanas?${rowsQuery(account, period, path, fresh)}`),
  setStatus: (account: string, level: Level, id: string, estado: AdRow['estado']) =>
    call<{ id: string; estado: AdRow['estado'] }>('POST', '/api/google/campanas/estado', { cuenta: account, nivel: level, id, estado }),
  details: (account: string, level: Level, id: string) => call<GoogleEditDetails>('GET', `/api/google/editar?${editQuery(account, level, id)}`),
  update: (account: string, level: Level, id: string, cambios: GoogleEditChanges) =>
    call<GoogleEditDetails>('POST', '/api/google/editar', { cuenta: account, nivel: level, id, cambios }),
  remove: (account: string, level: Level, id: string) => call<{ id: string }>('POST', '/api/google/quitar', { cuenta: account, nivel: level, id }),
  keywords: (account: string, period: Period, path: AdPath, fresh = false) =>
    call<GoogleList<Keyword>>('GET', `/api/google/palabras?${rowsQuery(account, period, path, fresh)}`),
  searchTerms: (account: string, period: Period, path: AdPath, fresh = false) =>
    call<GoogleList<SearchTerm>>('GET', `/api/google/terminos?${rowsQuery(account, period, path, fresh)}`),
  assets: (account: string, path: AdPath, fresh = false) =>
    call<{ recursos: GoogleAsset[] }>('GET', `/api/google/recursos?${rowsQuery(account, '7d', path, fresh)}`).then((r) => r.recursos),
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
  addAdSet: (plan: LaunchPlan & { campana: string }) =>
    call<{ conjunto: NewAdSet }>('POST', '/api/meta/conjuntos', plan).then((r) => r.conjunto),
  activate: (id: string) => call<{ lanzamiento: Launch }>('POST', '/api/meta/activar', { id }).then((r) => r.lanzamiento),
  rows: (account: string, period: Period, path: AdPath, fresh = false) => call<AdRows>('GET', `/api/meta/campanas?${rowsQuery(account, period, path, fresh)}`),
  details: (account: string, level: Level, id: string) => call<EditDetails>('GET', `/api/meta/editar?${editQuery(account, level, id)}`),
  update: (account: string, level: Level, id: string, cambios: EditChanges) =>
    call<EditDetails>('POST', '/api/meta/editar', { cuenta: account, nivel: level, id, cambios }),
  duplicate: (account: string, level: Level, id: string) => call<{ id: string }>('POST', '/api/meta/duplicar', { cuenta: account, nivel: level, id }),
  remove: (account: string, level: Level, id: string, modo: 'archivar' | 'borrar') =>
    call<{ id: string }>('POST', '/api/meta/quitar', { cuenta: account, nivel: level, id, modo }),
  addAds: (plan: AdContent & { cuenta: string; conjunto: string; anuncios: Array<{ nombre: string; versiones: AdVersion[] }> }) =>
    call<{ conjunto: string; anuncios: string[] }>('POST', '/api/meta/anuncios', plan),
  setStatus: (account: string, level: Level, id: string, estado: AdRow['estado']) =>
    call<{ id: string; estado: AdRow['estado']; lanzamiento: Launch | null }>('POST', '/api/meta/campanas/estado', {
      cuenta: account,
      nivel: level,
      id,
      estado,
    }),
  saved: () => call<{ plantillas: Template[]; lanzamientos: Launch[] }>('GET', '/api/anuncios'),
  /** Si hay clave de la API de Claude para escribir los textos. */
  claudeStatus: () => call<{ clave: boolean }>('GET', '/api/anuncios/claude'),
  saveClaudeKey: (clave: string) => call<{ clave: boolean }>('PUT', '/api/anuncios/claude', { clave }),
  writeCopy: (request: CopyRequest) => call<{ textos: Copy }>('POST', '/api/anuncios/textos', request).then((r) => r.textos),
  saveTemplates: (plantillas: Template[]) =>
    call<{ plantillas: Template[] }>('PUT', '/api/anuncios/plantillas', { plantillas }).then((r) => r.plantillas),
}

// ── Resúmenes diarios por WhatsApp (server/resumenes.mjs) ──

/** Cómo fue un envío (el de cada día o el de «Enviar ahora»). */
export interface SummarySend {
  dia: string
  en: string
  ok: boolean
  enviados: string[]
  error: string | null
  intentos: number
  texto: string | null
}

export interface DailySummary {
  id: string
  nombre: string
  activo: boolean
  /** 'HH:MM', hora de este Mac. */
  hora: string
  /** Cuentas publicitarias de Meta (act_…) y de Google Ads que entran. */
  meta: string[]
  google: string[]
  /** La columna de sus tareas. */
  columna: string | null
  /** Desde qué número de WhatsApp sale (`cuenta`: su cuenta de WhatsApp, la de la plantilla). */
  numero: { id: string; cuenta: string; telefono: string; nombre: string } | null
  /** A quién: números con el prefijo del país. */
  destinos: string[]
  ultimoEnvio: SummarySend | null
  prueba: SummarySend | null
}

/** La plantilla en una cuenta de WhatsApp: APPROVED, PENDING, REJECTED… o null si no se ha pedido. */
export interface WhatsappTemplate {
  estado: string | null
  motivo?: string | null
  categoria?: string | null
  error?: string
}

/** Las plantillas del resumen: con Meta, con Google o con los dos (server/resumenes.mjs). */
export type TemplateKind = 'meta' | 'google' | 'meta_google'

/** La que necesita un resumen (sin Meta ni Google, la de Meta), como en el servidor. */
export const templateKind = (s: Pick<DailySummary, 'meta' | 'google'>): TemplateKind =>
  s.meta.length && s.google.length ? 'meta_google' : s.google.length ? 'google' : 'meta'

/** Un portfolio con sus cuentas de WhatsApp y sus números. */
export interface WhatsappBusiness {
  id: string
  nombre: string
  error: string | null
  cuentas: Array<{
    id: string
    nombre: string | null
    plantillas: Record<TemplateKind, WhatsappTemplate>
    numeros: Array<{ id: string; telefono: string; nombre: string; estado: string | null }>
  }>
}

export const summariesApi = {
  list: () => call<{ resumenes: DailySummary[] }>('GET', '/api/resumenes').then((r) => r.resumenes),
  save: (resumenes: DailySummary[]) => call<{ resumenes: DailySummary[] }>('PUT', '/api/resumenes', { resumenes }).then((r) => r.resumenes),
  numbers: () => call<{ empresas: WhatsappBusiness[] }>('GET', '/api/resumenes/numeros').then((r) => r.empresas),
  createTemplate: (cuenta: string, tipo: TemplateKind) =>
    call<{ plantilla: WhatsappTemplate }>('POST', '/api/resumenes/plantilla', { cuenta, tipo }).then((r) => r.plantilla),
  /** El mensaje como está ahora (aunque no se haya guardado), sin mandarlo. */
  preview: (resumen: DailySummary) => call<{ texto: string }>('POST', '/api/resumenes/vista', { resumen }).then((r) => r.texto),
  send: (id: string) => call<{ envio: SummarySend }>('POST', '/api/resumenes/enviar', { id }).then((r) => r.envio),
}

/** «+34 600 11 22 33» → «+34600112233»; null si no parece un número con prefijo de país (como en el servidor). */
export function phoneOf(value: string) {
  const clean = value.trim().replace(/^00/, '+').replace(/[\s().-]/g, '')
  return /^\+[1-9]\d{7,14}$/.test(clean) ? clean : null
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
