// Editar lo que ya está publicado en Meta, sin pasar por el Administrador de anuncios: cómo está una campaña, un
// conjunto o un anuncio, y cambiarlo (nombre, presupuesto, fechas, puja, límite de gasto, público, ubicaciones y el
// contenido de los anuncios); duplicarlo en pausa, archivarlo o borrarlo, y añadir anuncios a un conjunto.
//
// El contenido de un anuncio publicado no se puede tocar en Meta: se crea uno nuevo con los cambios y se le pone al
// mismo anuncio, que conserva sus métricas (Meta lo vuelve a revisar). Del público, Tablero cambia solo lo que
// enseña (lugares, edad, sexo, Advantage+, ubicaciones); lo demás (intereses, públicos personalizados…) se queda.
import { HttpError, localDay } from './almacen.mjs'
import {
  automaticOf,
  FORMATS,
  cleanMedia,
  cleanPlan,
  cleanSettings,
  createAds,
  creativeBody,
  GREETING,
  localDateTime,
  majorUnits,
  minorUnits,
  placementKeysOf,
  positionsOf,
  text,
  thumbnailsOf,
} from './anuncios.mjs'

const LEVELS = ['campana', 'conjunto', 'anuncio']
const ID = /^\d{1,32}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
/** Lo que Meta entiende como «sin límite de gasto». */
const NO_SPEND_CAP = '922337203685478'

/** Las estrategias de puja que se eligen en Tablero, con su nombre en Meta. */
export const BIDS = { volumen: 'LOWEST_COST_WITHOUT_CAP', coste: 'COST_CAP', puja: 'LOWEST_COST_WITH_BID_CAP' }
const bidOf = (strategy) => Object.keys(BIDS).find((key) => BIDS[key] === strategy) ?? (strategy ? 'otra' : 'volumen')
/** Las que necesitan un importe (el coste por resultado o la puja máxima). */
const WITH_AMOUNT = new Set(['coste', 'puja'])

/** Lo que está vivo (para duplicar: lo archivado y lo borrado no se copia). */
const LIVE = ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'PENDING_REVIEW', 'PREAPPROVED', 'DISAPPROVED', 'PENDING_BILLING_INFO']

const countryName = (() => {
  const names = new Intl.DisplayNames(['es'], { type: 'region' })
  return (code) => {
    try {
      return names.of(code) ?? code
    } catch {
      return code
    }
  }
})()

/** La cuenta, el nivel y el objeto de una petición, comprobados. */
function target(raw) {
  const cuenta = typeof raw?.cuenta === 'string' && /^act_\d{1,32}$/.test(raw.cuenta) ? raw.cuenta : null
  if (!cuenta) throw new HttpError(400, 'Cuenta publicitaria no válida')
  if (!LEVELS.includes(raw?.nivel)) throw new HttpError(400, 'Nivel no válido')
  const id = typeof raw?.id === 'string' && ID.test(raw.id) ? raw.id : null
  if (!id) throw new HttpError(400, { campana: 'Campaña no válida', conjunto: 'Conjunto no válido', anuncio: 'Anuncio no válido' }[raw.nivel])
  return { cuenta, nivel: raw.nivel, id }
}

/** Que lo que se toca sea de la cuenta que se está viendo. */
function own(object, cuenta) {
  if (`act_${object?.account_id}` !== cuenta) throw new HttpError(400, 'Eso no es de esta cuenta publicitaria.')
}

const budget = (object, currency) =>
  Number(object?.daily_budget) > 0
    ? { cantidad: majorUnits(object.daily_budget, currency), tipo: 'dia' }
    : Number(object?.lifetime_budget) > 0
      ? { cantidad: majorUnits(object.lifetime_budget, currency), tipo: 'total' }
      : null

/** Un importe en la moneda de la cuenta, en su unidad mínima (como los presupuestos). */
function amount(value, currency, what) {
  if (!(Number(value) > 0)) throw new HttpError(400, `${what} tiene que ser mayor que 0.`)
  return minorUnits(value, currency)
}

/** «2026-11-02T00:00:00-0300» → «2026-11-02» (el día en la zona de la cuenta). */
const dayOf = (time) => (typeof time === 'string' && DAY.test(time.slice(0, 10)) ? time.slice(0, 10) : null)

const stateOf = (object) => (object.status === 'ACTIVE' ? 'activa' : object.status === 'ARCHIVED' ? 'archivada' : 'pausada')

// ── El público ──

/** Lo que Tablero no enseña del público (se conserva tal cual al guardar), dicho en pocas palabras. */
function extrasOf(t) {
  const geo = t?.geo_locations ?? {}
  const extras = []
  if (t?.flexible_spec?.length || t?.interests?.length || t?.behaviors?.length) extras.push('intereses y comportamientos')
  if (t?.custom_audiences?.length) extras.push('públicos personalizados')
  if (t?.excluded_custom_audiences?.length || t?.exclusions) extras.push('exclusiones')
  if (t?.excluded_geo_locations) extras.push('lugares excluidos')
  if (['custom_locations', 'zips', 'places', 'geo_markets', 'electoral_districts', 'location_cluster_ids'].some((key) => geo[key]?.length)) {
    extras.push('puntos del mapa y códigos postales')
  }
  if (t?.locales?.length) extras.push('idiomas')
  if (t?.device_platforms?.length || t?.user_os?.length || t?.user_device?.length) extras.push('dispositivos')
  return extras
}

/**
 * Las ubicaciones: automáticas, elegidas (las de Tablero, en `posiciones`) o «meta»: elegidas en Meta con alguna que
 * Tablero no conoce (se quedan como están si no se cambian).
 */
function placementsOf(t) {
  if (!t?.publisher_platforms?.length) return { ubicaciones: 'auto', posiciones: [] }
  const keys = placementKeysOf(t)
  return keys ? { ubicaciones: 'manual', posiciones: keys } : { ubicaciones: 'meta', posiciones: [] }
}

/** El público de un conjunto, como lo enseña el formulario de Tablero. */
export function audienceOf(t) {
  const geo = t?.geo_locations ?? {}
  const lugares = [
    ...(geo.countries ?? []).map((code) => ({ key: code, tipo: 'country', nombre: countryName(code), detalle: 'País' })),
    ...(geo.regions ?? []).map((r) => ({ key: String(r.key), tipo: 'region', nombre: r.name ?? String(r.key), detalle: ['Región', r.country && countryName(r.country)].filter(Boolean).join(', ') })),
    ...(geo.cities ?? []).map((c) => ({
      key: String(c.key),
      tipo: 'city',
      nombre: c.name ?? String(c.key),
      detalle: [c.region, c.country && countryName(c.country)].filter(Boolean).join(', '),
    })),
  ]
  const genders = t?.genders ?? []
  return {
    lugares,
    edadMin: t?.age_min ?? 18,
    edadMax: t?.age_max ?? 65,
    genero: genders.length === 1 ? (genders[0] === 1 ? 'hombres' : 'mujeres') : 'todos',
    advantage: t?.targeting_automation?.advantage_audience === 1,
    ...placementsOf(t),
    extras: extrasOf(t),
  }
}

/**
 * El público nuevo: el de antes con lo que se ha cambiado en Tablero. Los lugares que ya estaban conservan lo suyo
 * (el radio de una ciudad, por ejemplo); con las ubicaciones de Meta que Tablero no conoce («meta»), no se tocan.
 */
export function mergeTargeting(original, publico) {
  const t = structuredClone(original ?? {})
  const before = original?.geo_locations ?? {}
  const of = (tipo) => publico.lugares.filter((p) => p.tipo === tipo)
  const kept = (list) => new Map((list ?? []).map((item) => [String(item.key), item]))
  const oldCities = kept(before.cities)
  const geo = { ...before }
  delete geo.countries
  delete geo.regions
  delete geo.cities
  if (of('country').length) geo.countries = of('country').map((p) => p.key)
  if (of('region').length) geo.regions = of('region').map((p) => ({ key: p.key }))
  if (of('city').length) {
    geo.cities = of('city').map((p) => {
      const old = oldCities.get(p.key)
      return old?.radius ? { key: p.key, radius: old.radius, distance_unit: old.distance_unit ?? 'kilometer' } : { key: p.key }
    })
  }
  const located = ['countries', 'regions', 'cities', 'custom_locations', 'zips', 'places', 'geo_markets'].some((key) => geo[key]?.length)
  if (!located) throw new HttpError(400, 'Añade al menos un lugar al público.')
  t.geo_locations = geo

  t.targeting_automation = { ...(t.targeting_automation ?? {}), advantage_audience: publico.advantage ? 1 : 0 }
  // La edad que Meta calcula a partir de la mínima y la máxima: se vuelve a calcular.
  delete t.age_range
  if (publico.advantage) {
    // Con Advantage+, Meta solo admite la edad mínima (hasta 25) y decide lo demás. Y al guardar un público que ya
    // lo tiene, hay que volver a decir que se amplía (Meta no lo devuelve al leerlo; sin esto, cree que se quita).
    t.age_min = Math.min(Math.max(publico.edadMin, 18), 25)
    delete t.age_max
    delete t.genders
    t.targeting_relaxation_types = { lookalike: 1, custom_audience: 1 }
    t.targeting_optimization = 'expansion_all'
  } else {
    t.age_min = Math.min(Math.max(publico.edadMin, 18), 65)
    t.age_max = Math.min(Math.max(publico.edadMax, t.age_min), 65)
    if (publico.genero === 'hombres') t.genders = [1]
    else if (publico.genero === 'mujeres') t.genders = [2]
    else delete t.genders
  }
  if (publico.ubicaciones !== 'meta') {
    for (const key of Object.keys(t)) if (key.endsWith('_positions')) delete t[key]
    delete t.publisher_platforms
    if (publico.ubicaciones === 'manual') Object.assign(t, positionsOf(publico.posiciones))
    else if (publico.ubicaciones === 'facebook' || publico.ubicaciones === 'instagram') t.publisher_platforms = [publico.ubicaciones]
  }
  return t
}

function cleanAudience(raw) {
  const settings = cleanSettings(raw)
  return {
    lugares: settings.lugares,
    edadMin: settings.edadMin,
    edadMax: settings.edadMax,
    genero: settings.genero,
    advantage: settings.advantage,
    ubicaciones: raw?.ubicaciones === 'meta' ? 'meta' : settings.ubicaciones,
    posiciones: settings.posiciones,
  }
}

// ── El contenido de un anuncio ──

/** Vuestro mensaje y cómo empieza la persona, del JSON que guarda Meta. */
function chatOf(json) {
  const empty = { bienvenida: '', tipoMensaje: 'escrito', saludo: '', preguntas: [] }
  if (!json) return empty
  try {
    const format = JSON.parse(json)?.text_format
    const text = format?.message?.text ?? ''
    const bienvenida = text === GREETING ? '' : text
    if (format?.customer_action_type === 'ice_breakers') {
      return { ...empty, bienvenida, tipoMensaje: 'preguntas', preguntas: (format.message.ice_breakers ?? []).map((q) => q.title).filter(Boolean) }
    }
    return { ...empty, bienvenida, saludo: format?.message?.autofill_message?.content ?? '' }
  } catch {
    return empty
  }
}

const isWhatsApp = (cta) => cta?.type === 'WHATSAPP_MESSAGE'

/**
 * Lo que se puede editar de un anuncio: sus textos, su imagen o vídeo (y la vertical), el chat de WhatsApp, las
 * mejoras… tal como lo crea Tablero. De los que son de otra forma (una publicación que ya existía, un carrusel, uno
 * que lleva a una web), `motivo` dice por qué no.
 */
export function contentOf(creative) {
  const spec = creative?.object_story_spec ?? {}
  const feed = creative?.asset_feed_spec
  const base = {
    pagina: spec.page_id ?? null,
    instagram: spec.instagram_user_id ?? creative?.instagram_user_id ?? null,
    ...automaticOf(creative),
  }
  const no = (motivo) => ({ editable: false, motivo, ajustes: null, versiones: [], miniaturas: [] })
  if (!creative) return no('No se ha podido leer el anuncio.')
  if (!creative.object_story_spec && (creative.object_story_id || creative.effective_object_story_id)) {
    return no('Este anuncio usa una publicación que ya existía: su contenido es el de la publicación.')
  }
  const texts = (t) => ({ texto: t.texto ?? '', titular: t.titular ?? '', descripcion: t.descripcion ?? '' })
  const all = (list) => (list ?? []).map((item) => item?.text?.trim()).filter(Boolean)
  // Las opciones de texto del Administrador de anuncios (sin imágenes ni vídeos en asset_feed_spec): la primera de
  // cada una es la principal; las demás, «variantes».
  const variants = feed && !feed.images?.length && !feed.videos?.length ? { textos: all(feed.bodies), titulos: all(feed.titles), descripciones: all(feed.descriptions) } : null
  const fromVariants = (fallback) =>
    variants
      ? {
          texto: variants.textos[0] ?? fallback.texto,
          titular: variants.titulos[0] ?? fallback.titular,
          descripcion: variants.descripciones[0] ?? fallback.descripcion,
          variantes: { textos: variants.textos.slice(1), titulos: variants.titulos.slice(1), descripciones: variants.descripciones.slice(1) },
        }
      : { ...fallback, variantes: { textos: [], titulos: [], descripciones: [] } }

  if (feed && !variants) {
    const video = Boolean(feed.videos?.length)
    const assets = (video ? feed.videos : feed.images) ?? []
    if (!assets.length || !feed.bodies?.length) return no('Este anuncio tiene un formato que Tablero no edita.')
    if (feed.call_to_action_types?.length && !feed.call_to_action_types.includes('WHATSAPP_MESSAGE')) {
      return no('Este anuncio no lleva a WhatsApp: su contenido se cambia en el Administrador de anuncios.')
    }
    const toMedia = (a) => (video ? { tipo: 'video', id: String(a.video_id) } : { tipo: 'imagen', hash: a.hash })
    return {
      editable: true,
      motivo: null,
      ajustes: {
        ...base,
        ...texts({ texto: feed.bodies[0]?.text, titular: feed.titles?.[0]?.text, descripcion: feed.descriptions?.[0]?.text }),
        variantes: { textos: [], titulos: [], descripciones: [] },
        ...chatOf(feed.additional_data?.page_welcome_message),
      },
      versiones: formatsOfAssets(feed, assets, video).map((formato, i) => ({ formato, medio: toMedia(assets[i]) })),
      miniaturas: video ? assets.filter((a) => a.thumbnail_hash).map((a) => [String(a.video_id), a.thumbnail_hash]) : [],
    }
  }
  if (spec.link_data) {
    const link = spec.link_data
    if (link.child_attachments?.length) return no('Este anuncio es un carrusel: Tablero aún no edita carruseles.')
    if (!isWhatsApp(link.call_to_action)) return no('Este anuncio no lleva a WhatsApp: su contenido se cambia en el Administrador de anuncios.')
    if (!link.image_hash) return no('Este anuncio tiene un formato que Tablero no edita.')
    return {
      editable: true,
      motivo: null,
      ajustes: { ...base, ...fromVariants(texts({ texto: link.message, titular: link.name, descripcion: link.description })), ...chatOf(link.page_welcome_message) },
      versiones: [{ formato: '4:5', medio: { tipo: 'imagen', hash: link.image_hash } }],
      miniaturas: [],
    }
  }
  if (spec.video_data) {
    const video = spec.video_data
    if (!isWhatsApp(video.call_to_action)) return no('Este anuncio no lleva a WhatsApp: su contenido se cambia en el Administrador de anuncios.')
    return {
      editable: true,
      motivo: null,
      ajustes: { ...base, ...fromVariants(texts({ texto: video.message, titular: video.title, descripcion: video.link_description })), ...chatOf(video.page_welcome_message) },
      versiones: [{ formato: '4:5', medio: { tipo: 'video', id: String(video.video_id) } }],
      miniaturas: video.image_hash ? [[String(video.video_id), video.image_hash]] : [],
    }
  }
  return no('Este anuncio tiene un formato que Tablero no edita.')
}

/** Lo que dicen las posiciones de una regla del formato de lo que enseña. */
function formatOfPositions(spec) {
  const positions = Object.keys(spec ?? {})
    .filter((key) => key.endsWith('_positions'))
    .flatMap((key) => spec[key])
  if (!positions.length) return null
  if (positions.every((p) => /story|reels/.test(p))) return '9:16'
  if (positions.every((p) => p === 'instream_video')) return '16:9'
  if (positions.every((p) => ['marketplace', 'search', 'right_hand_column', 'notification', 'messenger_home', 'explore_home'].includes(p))) return '1:1'
  return '4:5'
}

/**
 * El formato de cada versión de un anuncio con varias: por su etiqueta (las de Tablero lo llevan; las de antes,
 * «feed» y «vertical») o por las ubicaciones de su regla. Sin repetir: si dos salen igual, la segunda toma otro libre.
 */
function formatsOfAssets(feed, assets, video) {
  const rules = feed.asset_customization_rules ?? []
  const used = new Set()
  return assets.map((asset) => {
    const name = asset.adlabels?.[0]?.name ?? ''
    const ours = /^tablero_(\d+)x(\d+)_/.exec(name)
    const rule = rules.find((r) => r[video ? 'video_label' : 'image_label']?.name === name)
    let formato = ours ? `${ours[1]}:${ours[2]}` : /tablero_vertical/.test(name) ? '9:16' : /tablero_feed/.test(name) ? '4:5' : formatOfPositions(rule?.customization_spec)
    if (!FORMATS.includes(formato) || used.has(formato)) formato = FORMATS.find((f) => !used.has(f))
    used.add(formato)
    return formato
  })
}

/** El formato de una imagen por su proporción (la más cercana de las de Tablero). */
function formatOfRatio(ratio) {
  if (!ratio) return null
  return ratio < 0.7 ? '9:16' : ratio < 0.9 ? '4:5' : ratio < 1.25 ? '1:1' : '16:9'
}

/** Dónde se ve cada imagen o vídeo (para enseñarlos en el formulario): su dirección y su proporción. */
async function previews(meta, cuenta, media) {
  const hashes = media.filter((m) => m?.tipo === 'imagen').map((m) => m.hash)
  const images = hashes.length
    ? await meta.graph(`${cuenta}/adimages`, { params: { hashes, fields: 'hash,url,width,height' } }).catch(() => ({ data: [] }))
    : { data: [] }
  const byHash = new Map((images.data ?? []).map((i) => [i.hash, i]))
  return Promise.all(
    media.map(async (m) => {
      if (!m) return null
      if (m.tipo === 'imagen') {
        const image = byHash.get(m.hash)
        return { ...m, url: image?.url ?? null, ratio: image?.width && image?.height ? image.width / image.height : null }
      }
      const video = await meta.graph(m.id, { params: { fields: 'picture' } }).catch(() => ({}))
      return { ...m, url: video.picture ?? null, ratio: null }
    }),
  )
}

/** Meta admite hasta 5 de cada uno: el principal y 4 más. */
const MAX_VARIANTS = 4

function cleanVariants(raw) {
  const list = (value, max) => (Array.isArray(value) ? value : []).map((t) => text(t, max)).filter(Boolean).slice(0, MAX_VARIANTS)
  return { textos: list(raw?.textos, 3000), titulos: list(raw?.titulos, 255), descripciones: list(raw?.descripciones, 255) }
}

/** Las versiones de un anuncio que llegan del formulario: de 1 a 4, cada una de un formato, todas del mismo tipo. */
function cleanVersions(raw) {
  const versions = []
  for (const version of (Array.isArray(raw) ? raw : []).slice(0, FORMATS.length)) {
    const medio = cleanMedia(version?.medio)
    if (!medio || !FORMATS.includes(version?.formato)) throw new HttpError(400, 'Versión del anuncio no válida.')
    if (versions.some((v) => v.formato === version.formato)) throw new HttpError(400, `Hay dos versiones ${version.formato}.`)
    versions.push({ formato: version.formato, medio })
  }
  if (!versions.length) throw new HttpError(400, 'Falta la imagen o el vídeo del anuncio.')
  if (versions.some((v) => v.medio.tipo !== versions[0].medio.tipo)) throw new HttpError(400, 'Todas las versiones tienen que ser imágenes o todas vídeos.')
  return versions
}

/** Las ubicaciones de un conjunto, como las usa `creativeBody` (para saber qué versión va en cada una). */
function placementsForAds(targeting) {
  const { ubicaciones, posiciones } = placementsOf(targeting)
  return ubicaciones === 'manual' ? { ubicaciones, posiciones } : { ubicaciones: 'auto', posiciones: [] }
}

async function adSetPlacements(meta, adSetId) {
  const { targeting } = await meta.graph(String(adSetId), { params: { fields: 'targeting' } })
  return placementsForAds(targeting)
}

const CONTENT_KEYS = ['instagram', 'texto', 'titular', 'descripcion', 'bienvenida', 'tipoMensaje', 'saludo', 'preguntas', 'mejoras', 'multianunciante']

// ── Leer ──

const CAMPAIGN_FIELDS = 'name,status,account_id,objective,daily_budget,lifetime_budget,bid_strategy,spend_cap'
const ADSET_FIELDS =
  'name,status,account_id,daily_budget,lifetime_budget,start_time,end_time,targeting,promoted_object,optimization_goal,destination_type,' +
  'bid_strategy,bid_amount,campaign{id,name,daily_budget,lifetime_budget,bid_strategy}'
const AD_FIELDS =
  'name,status,account_id,adset_id,adset{targeting},creative{id,object_story_spec,asset_feed_spec,degrees_of_freedom_spec,contextual_multi_ads,instagram_user_id,object_story_id,effective_object_story_id}'

/** Cómo está ahora una campaña, un conjunto o un anuncio, para el formulario de editar. */
export async function details(meta, raw, { now = Date.now() } = {}) {
  const { cuenta, nivel, id } = target(raw)
  const { currency } = await meta.graph(cuenta, { params: { fields: 'currency' } })
  if (nivel === 'campana') {
    const c = await meta.graph(id, { params: { fields: CAMPAIGN_FIELDS } })
    own(c, cuenta)
    const cap = Number(c.spend_cap)
    return {
      nivel,
      id,
      nombre: c.name ?? '',
      estado: stateOf(c),
      moneda: currency,
      campana: {
        objetivo: c.objective ?? null,
        presupuesto: budget(c, currency),
        puja: bidOf(c.bid_strategy),
        limiteGasto: cap > 0 && String(c.spend_cap) !== NO_SPEND_CAP ? majorUnits(c.spend_cap, currency) : null,
      },
    }
  }
  if (nivel === 'conjunto') {
    const s = await meta.graph(id, { params: { fields: ADSET_FIELDS } })
    own(s, cuenta)
    const campaignBudget = budget(s.campaign, currency)
    return {
      nivel,
      id,
      nombre: s.name ?? '',
      estado: stateOf(s),
      moneda: currency,
      conjunto: {
        presupuesto: budget(s, currency),
        presupuestoCampana: campaignBudget,
        inicio: dayOf(s.start_time),
        empezado: !s.start_time || Date.parse(s.start_time) <= now,
        fin: dayOf(s.end_time),
        puja: bidOf(campaignBudget ? s.campaign?.bid_strategy : s.bid_strategy),
        pujaEnCampana: Boolean(campaignBudget),
        importePuja: Number(s.bid_amount) > 0 ? majorUnits(s.bid_amount, currency) : null,
        publico: audienceOf(s.targeting),
        pagina: s.promoted_object?.page_id ?? null,
        whatsapp: s.promoted_object?.whatsapp_phone_number ?? null,
        optimizacion: s.optimization_goal ?? null,
        destino: s.destination_type ?? null,
      },
    }
  }
  const ad = await meta.graph(id, { params: { fields: AD_FIELDS } })
  own(ad, cuenta)
  const content = contentOf(ad.creative)
  const shown = content.editable ? await previews(meta, cuenta, content.versiones.map((v) => v.medio)) : []
  // Con una sola imagen, su formato es el de su proporción (con varias, el de su sitio en el anuncio).
  const versiones = content.versiones.map((v, i) => ({
    formato: content.versiones.length === 1 ? (formatOfRatio(shown[i]?.ratio) ?? v.formato) : v.formato,
    medio: shown[i],
  }))
  return {
    nivel,
    id,
    nombre: ad.name ?? '',
    estado: stateOf(ad),
    moneda: currency,
    anuncio: {
      conjunto: String(ad.adset_id),
      // Las del conjunto: dónde va cada versión.
      ubicaciones: placementsOf(ad.adset?.targeting),
      editable: content.editable,
      motivo: content.motivo,
      contenido: content.ajustes,
      versiones,
    },
  }
}

// ── Cambiar ──

/**
 * Guarda lo que se ha cambiado en el formulario (`cambios` lleva solo eso). Devuelve cómo ha quedado.
 * `options` son las de la subida de vídeos (en pruebas, sin esperas).
 */
export async function update(meta, raw, options = {}) {
  const { cuenta, nivel, id } = target(raw)
  const cambios = raw?.cambios ?? {}
  const { currency } = await meta.graph(cuenta, { params: { fields: 'currency' } })
  const body = {}
  if (cambios.nombre !== undefined) {
    body.name = text(cambios.nombre, 400)
    if (!body.name) throw new HttpError(400, 'El nombre no puede quedar vacío.')
  }

  if (nivel === 'campana') {
    const c = await meta.graph(id, { params: { fields: CAMPAIGN_FIELDS } })
    own(c, cuenta)
    const own_ = budget(c, currency)
    if (cambios.presupuesto !== undefined) {
      if (!own_) throw new HttpError(400, 'Esta campaña no tiene presupuesto propio: va en cada conjunto.')
      body[own_.tipo === 'dia' ? 'daily_budget' : 'lifetime_budget'] = amount(cambios.presupuesto, currency, 'El presupuesto')
    }
    if (cambios.puja !== undefined) {
      if (!own_) throw new HttpError(400, 'La puja va en cada conjunto (la campaña no reparte su presupuesto).')
      if (!BIDS[cambios.puja]) throw new HttpError(400, 'Estrategia de puja no válida')
      body.bid_strategy = BIDS[cambios.puja]
    }
    if (cambios.limiteGasto !== undefined) {
      body.spend_cap = cambios.limiteGasto === null ? NO_SPEND_CAP : amount(cambios.limiteGasto, currency, 'El límite de gasto')
    }
  } else if (nivel === 'conjunto') {
    const s = await meta.graph(id, { params: { fields: ADSET_FIELDS } })
    own(s, cuenta)
    const own_ = budget(s, currency)
    const shared = Boolean(budget(s.campaign, currency))
    const today = localDay()
    if (cambios.presupuesto !== undefined) {
      if (!own_) throw new HttpError(400, 'El presupuesto es el de la campaña: cámbialo en la campaña.')
      body[own_.tipo === 'dia' ? 'daily_budget' : 'lifetime_budget'] = amount(cambios.presupuesto, currency, 'El presupuesto')
    }
    if (cambios.inicio !== undefined) {
      if (s.start_time && Date.parse(s.start_time) <= Date.now()) throw new HttpError(400, 'Este conjunto ya ha empezado: su inicio no se puede cambiar.')
      if (cambios.inicio !== null && !DAY.test(cambios.inicio)) throw new HttpError(400, 'Fecha de inicio no válida')
      body.start_time = cambios.inicio && cambios.inicio > today ? localDateTime(cambios.inicio, '00:00:00') : new Date(Date.now() + 60_000).toISOString()
    }
    if (cambios.fin !== undefined) {
      if (cambios.fin === null) {
        if (own_?.tipo === 'total') throw new HttpError(400, 'Con presupuesto total hace falta una fecha de fin.')
        body.end_time = 0
      } else {
        if (!DAY.test(cambios.fin)) throw new HttpError(400, 'Fecha de fin no válida')
        const from = cambios.inicio ?? dayOf(s.start_time) ?? today
        if (cambios.fin < (from > today ? from : today)) throw new HttpError(400, 'La fecha de fin tiene que ser hoy o después (y no antes del inicio).')
        body.end_time = localDateTime(cambios.fin, '23:59:00')
      }
    }
    const strategy = cambios.puja ?? bidOf(shared ? s.campaign?.bid_strategy : s.bid_strategy)
    if (cambios.puja !== undefined) {
      if (shared) throw new HttpError(400, 'La estrategia de puja es la de la campaña: cámbiala en la campaña.')
      if (!BIDS[cambios.puja]) throw new HttpError(400, 'Estrategia de puja no válida')
      body.bid_strategy = BIDS[cambios.puja]
    }
    if (cambios.importePuja !== undefined || (cambios.puja !== undefined && WITH_AMOUNT.has(strategy))) {
      if (WITH_AMOUNT.has(strategy)) body.bid_amount = amount(cambios.importePuja ?? majorUnits(s.bid_amount, currency), currency, strategy === 'coste' ? 'El coste por resultado' : 'La puja máxima')
    }
    if (cambios.publico !== undefined) body.targeting = mergeTargeting(s.targeting, cleanAudience(cambios.publico))
  } else {
    const ad = await meta.graph(id, { params: { fields: AD_FIELDS } })
    own(ad, cuenta)
    if (cambios.contenido !== undefined || cambios.versiones !== undefined) {
      const current = contentOf(ad.creative)
      if (!current.editable) throw new HttpError(400, current.motivo)
      const settings = cleanSettings({ ...current.ajustes, ...pick(cambios.contenido ?? {}, CONTENT_KEYS) })
      const versiones = cambios.versiones !== undefined ? cleanVersions(cambios.versiones) : current.versiones
      if (!settings.texto) throw new HttpError(400, 'Falta el texto del anuncio.')
      const plan = {
        ...settings,
        // Las ubicaciones del conjunto, para saber dónde va cada versión.
        ...(await adSetPlacements(meta, ad.adset_id)),
        variantes: cleanVariants(cambios.contenido?.variantes ?? current.ajustes.variantes),
        cuenta,
        pagina: current.ajustes.pagina,
        anuncios: [{ nombre: body.name ?? ad.name, medio: versiones[0].medio, versiones }],
      }
      if (versiones.length > 1 && Object.values(plan.variantes).some((list) => list.length)) {
        throw new HttpError(400, 'Con varias versiones (cuadrada, vertical…), cada texto va uno solo: quita las otras opciones de texto o deja una versión.')
      }
      // Las miniaturas de los vídeos que ya tenía se reutilizan; las de los nuevos se suben.
      const thumbs = new Map(current.miniaturas)
      const missing = versiones.map((v) => v.medio).filter((m) => m.tipo === 'video' && !thumbs.has(m.id))
      if (missing.length) {
        for (const [videoId, hash] of await thumbnailsOf(meta, { cuenta, anuncios: missing.map((m) => ({ medio: m })) }, options)) thumbs.set(videoId, hash)
      }
      const creative = await meta.graph(`${cuenta}/adcreatives`, { method: 'POST', body: creativeBody(plan, plan.anuncios[0], { thumbs }) })
      body.creative = { creative_id: String(creative.id) }
    }
  }
  if (!Object.keys(body).length) return details(meta, { cuenta, nivel, id })
  await meta.graph(id, { method: 'POST', body })
  return details(meta, { cuenta, nivel, id })
}

const pick = (object, keys) => Object.fromEntries(keys.filter((key) => object[key] !== undefined).map((key) => [key, object[key]]))

// ── Duplicar, archivar, borrar ──

const NO_RENAME = { rename_strategy: 'NO_RENAME' }

async function liveChildren(meta, parentId, edge) {
  const page = await meta.graph(`${parentId}/${edge}`, { params: { fields: 'id', effective_status: LIVE, limit: 100 } })
  return (page.data ?? []).map((item) => String(item.id))
}

/** Copia un conjunto (en su campaña o en `campaignId`) y, uno a uno, sus anuncios. */
async function copyAdSet(meta, adSetId, campaignId, rename) {
  const copy = await meta.graph(`${adSetId}/copies`, {
    method: 'POST',
    body: { deep_copy: false, status_option: 'PAUSED', ...(campaignId ? { campaign_id: campaignId } : {}), ...(rename ? {} : { rename_options: NO_RENAME }) },
  })
  const adSetCopy = String(copy.copied_adset_id)
  for (const adId of await liveChildren(meta, adSetId, 'ads')) {
    await meta.graph(`${adId}/copies`, { method: 'POST', body: { adset_id: adSetCopy, status_option: 'PAUSED', rename_options: NO_RENAME } })
  }
  return adSetCopy
}

/**
 * Una copia en pausa (con todo lo que cuelga: conjuntos y anuncios), con «- Copia» en el nombre. Se copia pieza a
 * pieza: Meta no copia de una vez más de 3 anuncios. Si falla a medias, lo copiado se queda en pausa.
 */
export async function duplicate(meta, raw) {
  const { cuenta, nivel, id } = target(raw)
  const source = await meta.graph(id, { params: { fields: 'name,account_id' } })
  own(source, cuenta)
  try {
    if (nivel === 'anuncio') {
      const copy = await meta.graph(`${id}/copies`, { method: 'POST', body: { status_option: 'PAUSED' } })
      return { id: String(copy.copied_ad_id) }
    }
    if (nivel === 'conjunto') return { id: await copyAdSet(meta, id, null, true) }
    const copy = await meta.graph(`${id}/copies`, { method: 'POST', body: { deep_copy: false, status_option: 'PAUSED' } })
    const campaignCopy = String(copy.copied_campaign_id)
    for (const adSetId of await liveChildren(meta, id, 'adsets')) await copyAdSet(meta, adSetId, campaignCopy, false)
    return { id: campaignCopy }
  } catch (err) {
    throw new HttpError(err?.status ?? 502, `${err?.message ?? err} (Si se ha copiado algo, está en pausa.)`, err?.code)
  }
}

/** Archiva (sale de «En marcha» y se puede recuperar en Meta) o borra (no se puede deshacer). */
export async function remove(meta, raw) {
  const { cuenta, nivel, id } = target(raw)
  if (!['archivar', 'borrar'].includes(raw?.modo)) throw new HttpError(400, 'Modo no válido')
  const object = await meta.graph(id, { params: { fields: 'account_id' } })
  own(object, cuenta)
  if (raw.modo === 'archivar') await meta.graph(id, { method: 'POST', body: { status: 'ARCHIVED' } })
  else await meta.graph(id, { method: 'DELETE' })
  return { id, nivel, modo: raw.modo }
}

/**
 * Anuncios nuevos en un conjunto que ya existe (uno por pieza, con sus versiones de cada formato), con la
 * página del conjunto. Se crean en pausa: se encienden con su interruptor.
 */
export async function addAds(meta, raw, options = {}) {
  const adSetId = typeof raw?.conjunto === 'string' && ID.test(raw.conjunto) ? raw.conjunto : null
  if (!adSetId) throw new HttpError(400, 'Conjunto no válido')
  const adSet = await meta.graph(adSetId, { params: { fields: 'name,account_id,promoted_object,targeting' } })
  // Con las ubicaciones del conjunto, para saber dónde va cada versión.
  const plan = { ...cleanPlan({ ...raw, nombre: adSet.name ?? 'Conjunto', pagina: adSet.promoted_object?.page_id ?? raw?.pagina }), ...placementsForAds(adSet.targeting) }
  own(adSet, plan.cuenta)
  const thumbs = await thumbnailsOf(meta, plan, options)
  return { conjunto: adSetId, anuncios: await createAds(meta, plan, adSetId, thumbs, 'PAUSED') }
}
