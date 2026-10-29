// Anuncios de mensajes a WhatsApp en Meta: lo que se manda para crear la campaña, el conjunto y los anuncios
// (funciones puras, probadas en pruebas/anuncios.test.mjs), cómo se suben las imágenes y los vídeos, y las
// plantillas y campañas creadas, en datos/anuncios.json.
//
// Todo se crea en pausa: Tablero solo activa una campaña cuando se pulsa «Activar».
import { randomUUID } from 'node:crypto'
import { openAsBlob } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DATA_DIR, HttpError, localDay } from './almacen.mjs'

const ADS_FILE = path.join(DATA_DIR, 'anuncios.json')
/** Las últimas campañas creadas que se recuerdan. */
const KEEP_LAUNCHES = 100
const MAX_TEMPLATES = 200

const WHATSAPP_LINK = 'https://api.whatsapp.com/send'
const CTA_TYPE = 'WHATSAPP_MESSAGE'
/** Lo que contesta la empresa en WhatsApp al abrirse la conversación. */
export const GREETING = '¡Hola! ¿En qué podemos ayudarte?'

/** Monedas que Meta cuenta en unidades (sin céntimos); el resto, en céntimos. */
const WHOLE_UNITS = new Set(['CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'JPY', 'KRW', 'PYG', 'TWD', 'VND'])

/** Un vídeo tarda un poco en procesarse en Meta antes de poder usarse en un anuncio. */
const VIDEO_WAIT = 4 * 60_000
const VIDEO_POLL = 3_000

// ── Lo que se manda a Meta ──

/** El presupuesto en la unidad mínima de la moneda («10,5 €» → "1050"). */
export function minorUnits(amount, currency) {
  if (!(Number(amount) > 0)) throw new HttpError(400, 'El presupuesto diario tiene que ser mayor que 0.')
  return String(Math.round(Number(amount) * (WHOLE_UNITS.has(currency) ? 1 : 100)))
}

/** Lo contrario: lo que Meta da en la unidad mínima, en la moneda («1050» → 10,5 €). */
export const majorUnits = (amount, currency) => (Number(amount) || 0) / (WHOLE_UNITS.has(currency) ? 1 : 100)

/** «2026-11-03» a esa hora en la zona del Mac, con su desfase («2026-11-03T00:00:00+01:00»). */
export function localDateTime(day, time) {
  const date = new Date(`${day}T${time}`)
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `Fecha no válida: ${day}`)
  const offset = -date.getTimezoneOffset()
  const sign = offset < 0 ? '-' : '+'
  const abs = Math.abs(offset)
  return `${day}T${time}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

const clamp = (n, min, max) => Math.min(Math.max(Math.round(Number(n) || min), min), max)

export function campaignBody(plan) {
  return {
    name: plan.nombre,
    objective: 'OUTCOME_ENGAGEMENT',
    status: plan.publicar ? 'ACTIVE' : 'PAUSED',
    special_ad_categories: [],
    buying_type: 'AUCTION',
    // El presupuesto va en el conjunto (desde la v24 hay que decir si se comparte entre conjuntos).
    is_adset_budget_sharing_enabled: false,
  }
}

/** Los formatos de las versiones de un anuncio, por su proporción. */
export const FORMATS = ['4:5', '1:1', '9:16', '16:9']
/** La versión que va en el resto de ubicaciones (las que no tienen una propia): la del feed, si la hay. */
const FALLBACK_ORDER = ['4:5', '1:1', '16:9', '9:16']

/**
 * Las ubicaciones que se eligen en Tablero para un anuncio a WhatsApp, con los formatos que les van (el primero, el
 * mejor). `video`: solo admite vídeos. (Los feeds de vídeo de Facebook y el Explorar de Instagram ya no se pueden
 * elegir en esta versión de la API.)
 */
export const PLACEMENTS = {
  fb_feed: { platform: 'facebook', position: 'feed', formats: ['4:5', '1:1'] },
  fb_profile: { platform: 'facebook', position: 'profile_feed', formats: ['4:5', '1:1'] },
  fb_marketplace: { platform: 'facebook', position: 'marketplace', formats: ['1:1', '4:5'] },
  fb_search: { platform: 'facebook', position: 'search', formats: ['1:1', '4:5'] },
  fb_right: { platform: 'facebook', position: 'right_hand_column', formats: ['1:1', '16:9'] },
  fb_notification: { platform: 'facebook', position: 'notification', formats: ['1:1'] },
  fb_story: { platform: 'facebook', position: 'story', formats: ['9:16'] },
  fb_reels: { platform: 'facebook', position: 'facebook_reels', formats: ['9:16'] },
  fb_instream: { platform: 'facebook', position: 'instream_video', formats: ['16:9', '1:1'], video: true },
  ig_feed: { platform: 'instagram', position: 'stream', formats: ['4:5', '1:1'] },
  ig_profile: { platform: 'instagram', position: 'profile_feed', formats: ['4:5', '1:1'] },
  ig_explore_home: { platform: 'instagram', position: 'explore_home', formats: ['1:1', '4:5'] },
  ig_search: { platform: 'instagram', position: 'ig_search', formats: ['4:5', '1:1'] },
  ig_story: { platform: 'instagram', position: 'story', formats: ['9:16'] },
  ig_reels: { platform: 'instagram', position: 'reels', formats: ['9:16'] },
  ig_profile_reels: { platform: 'instagram', position: 'profile_reels', formats: ['9:16'] },
  ms_inbox: { platform: 'messenger', position: 'messenger_home', formats: ['1:1'] },
  ms_story: { platform: 'messenger', position: 'story', formats: ['9:16'] },
  // Meta solo lo deja con Instagram Stories (positionsOf la añade).
  wa_status: { platform: 'whatsapp', position: 'status', formats: ['9:16'] },
}

/** Las ubicaciones elegidas, como las pide Meta: las plataformas y las posiciones de cada una. */
export function positionsOf(keys) {
  const wanted = new Set(keys ?? [])
  // Los Estados de WhatsApp, Meta solo los admite con Instagram Stories.
  if (wanted.has('wa_status')) wanted.add('ig_story')
  const chosen = Object.keys(PLACEMENTS)
    .filter((key) => wanted.has(key))
    .map((key) => PLACEMENTS[key])
  if (!chosen.length) throw new HttpError(400, 'Elige al menos una ubicación (o déjalas automáticas).')
  const spec = { publisher_platforms: [...new Set(chosen.map((p) => p.platform))] }
  for (const platform of spec.publisher_platforms) spec[`${platform}_positions`] = chosen.filter((p) => p.platform === platform).map((p) => p.position)
  return spec
}

/** Las ubicaciones de Tablero que hay en lo que dice Meta; null si hay alguna que Tablero no conoce. */
export function placementKeysOf(targeting) {
  const platforms = targeting?.publisher_platforms
  if (!platforms?.length) return []
  const keys = []
  for (const platform of platforms) {
    const ours = Object.entries(PLACEMENTS).filter(([, p]) => p.platform === platform)
    if (!ours.length) return null
    const positions = targeting[`${platform}_positions`]
    // Sin posiciones, todas las de la plataforma.
    if (!positions?.length) keys.push(...ours.filter(([, p]) => !p.video).map(([key]) => key))
    else
      for (const position of positions) {
        const found = ours.find(([, p]) => p.position === position)
        if (!found) return null
        keys.push(found[0])
      }
  }
  return keys
}

/**
 * Público y ubicaciones. Con Advantage+ (advantage_audience 1), Meta solo admite la edad mínima (18–25) y
 * decide el resto; sin él, la edad y el sexo son límites.
 */
export function targetingOf(plan) {
  const geo = {}
  const of = (tipo) => plan.lugares.filter((p) => p.tipo === tipo)
  if (of('country').length) geo.countries = of('country').map((p) => p.key)
  if (of('region').length) geo.regions = of('region').map((p) => ({ key: p.key }))
  if (of('city').length) geo.cities = of('city').map((p) => ({ key: p.key }))
  if (!Object.keys(geo).length) throw new HttpError(400, 'Añade al menos un lugar al público.')
  const targeting = { geo_locations: geo, targeting_automation: { advantage_audience: plan.advantage ? 1 : 0 } }
  if (plan.advantage) {
    targeting.age_min = clamp(plan.edadMin, 18, 25)
  } else {
    targeting.age_min = clamp(plan.edadMin, 18, 65)
    targeting.age_max = clamp(plan.edadMax, targeting.age_min, 65)
    if (plan.genero === 'hombres') targeting.genders = [1]
    if (plan.genero === 'mujeres') targeting.genders = [2]
  }
  if (plan.ubicaciones === 'manual') Object.assign(targeting, positionsOf(plan.posiciones))
  else if (plan.ubicaciones === 'facebook' || plan.ubicaciones === 'instagram') targeting.publisher_platforms = [plan.ubicaciones]
  return targeting
}

/**
 * El conjunto: mensajes a WhatsApp, con su presupuesto diario (salvo `sharedBudget`: el de la campaña) y, en
 * `promoted`, el número al que llegan si no es el de la página.
 */
export function adSetBody(plan, { campaignId, currency, today = localDay(), sharedBudget = false, promoted = {} }) {
  const body = {
    name: plan.nombre,
    campaign_id: campaignId,
    status: plan.publicar ? 'ACTIVE' : 'PAUSED',
    destination_type: 'WHATSAPP',
    optimization_goal: 'CONVERSATIONS',
    billing_event: 'IMPRESSIONS',
    ...(sharedBudget ? {} : { bid_strategy: 'LOWEST_COST_WITHOUT_CAP', daily_budget: minorUnits(plan.presupuesto, currency) }),
    promoted_object: { page_id: plan.pagina, ...promoted },
    targeting: targetingOf(plan),
  }
  // Sin inicio (o hoy), empieza en cuanto se active.
  if (plan.inicio && plan.inicio > today) body.start_time = localDateTime(plan.inicio, '00:00:00')
  if (plan.fin) {
    if (plan.fin < (plan.inicio ?? today)) throw new HttpError(400, 'La fecha de fin es anterior a la de inicio.')
    body.end_time = localDateTime(plan.fin, '23:59:00')
  }
  return body
}

/** Como mucho, tantas preguntas frecuentes en el chat. */
export const MAX_QUESTIONS = 4

/**
 * Lo que se ve al abrir WhatsApp: vuestro mensaje y, para que la persona empiece, su mensaje ya escrito o unas
 * preguntas que puede tocar. Meta lo pide como JSON en texto. Sin mensaje ni preguntas, null (el de Meta).
 */
export function welcomeMessage(plan) {
  const text = plan.bienvenida?.trim() || GREETING
  const questions = (plan.preguntas ?? []).map((q) => q.trim()).filter(Boolean)
  const format =
    plan.tipoMensaje === 'preguntas'
      ? questions.length && { customer_action_type: 'ice_breakers', message: { text, ice_breakers: questions.map((title) => ({ title })) } }
      : plan.saludo?.trim() && { customer_action_type: 'autofill_message', message: { text, autofill_message: { content: plan.saludo.trim() } } }
  if (!format) return null
  return JSON.stringify({ type: 'VISUAL_EDITOR', version: 2, landing_screen_type: 'welcome_message', media_type: 'text', text_format: format })
}

/**
 * Las mejoras automáticas de Meta (Advantage+ creative) que se eligen en Tablero, cada una con sus nombres en
 * la API (algunas son dos: la de imagen y la de vídeo).
 */
export const ENHANCEMENTS = {
  retoques: ['image_touchups', 'video_auto_crop', 'adapt_to_placement'],
  ampliar: ['image_uncrop', 'video_uncrop'],
  brillo: ['image_brightness_and_contrast'],
  superposiciones: ['image_templates'],
  animacion: ['image_animation'],
  flexibles: ['pac_relaxation'],
  filtros: ['video_filtering'],
  subtitulos: ['ig_video_native_subtitle'],
  stickers: ['creative_stickers'],
  texto: ['text_optimizations'],
  traduccion: ['text_translation', 'image_text_translation'],
  boton: ['enhance_cta'],
  comentarios: ['inline_comment'],
  detalles: ['reveal_details_over_time'],
  destino: ['show_destination_blurbs'],
  resumen: ['show_summary'],
}

/** Las de catálogo, web y las que Meta no explica: en un anuncio a WhatsApp, siempre desactivadas. */
const NEVER = [
  'site_extensions',
  'product_extensions',
  'product_browsing',
  'description_automation',
  'ads_with_benefits',
  'cv_transformation',
  'pac_recomposition',
  'advantage_plus_creative',
]

/** El paquete de antes (hasta la v22) que incluía varias: en los anuncios viejos, cuenta como esas activadas. */
const STANDARD_BUNDLE = ['retoques', 'superposiciones', 'texto', 'comentarios']

/**
 * Todas las mejoras, activadas solo las elegidas. Se mandan todas porque, sin decir nada, Meta activa algunas
 * por su cuenta (adaptar a cada ubicación, por ejemplo).
 */
export function featuresSpec(chosen = []) {
  const spec = {}
  for (const [key, features] of Object.entries(ENHANCEMENTS)) {
    for (const feature of features) spec[feature] = { enroll_status: chosen.includes(key) ? 'OPT_IN' : 'OPT_OUT' }
  }
  for (const feature of NEVER) spec[feature] = { enroll_status: 'OPT_OUT' }
  return spec
}

/** Las mejoras automáticas activas de un anuncio que ya existe, y si puede salir junto a los de otros. */
export function automaticOf(creative) {
  const spec = creative?.degrees_of_freedom_spec?.creative_features_spec ?? {}
  const on = (feature) => spec[feature]?.enroll_status === 'OPT_IN'
  const bundle = on('standard_enhancements')
  return {
    mejoras: Object.keys(ENHANCEMENTS).filter((key) => ENHANCEMENTS[key].some(on) || (bundle && STANDARD_BUNDLE.includes(key))),
    multianunciante: creative?.contextual_multi_ads?.enroll_status === 'OPT_IN',
  }
}

/** Como en el Administrador de anuncios: cada regla lleva la edad entera (la de «todo lo demás», solo eso). */
const ALL_AGES = { age_min: 13, age_max: 65 }

/** Las versiones de un anuncio (1:1, 4:5, 9:16, 16:9): las que trae o, en los de antes, la del feed y la vertical. */
export function versionsOf(ad) {
  if (Array.isArray(ad.versiones) && ad.versiones.length) return ad.versiones
  return [{ formato: '4:5', medio: ad.medio }, ...(ad.vertical ? [{ formato: '9:16', medio: ad.vertical }] : [])]
}

/**
 * Qué versión va en cada ubicación (la primera de sus formatos que haya) y cuál en todas las demás. Las ubicaciones
 * son las elegidas o, con las automáticas, todas las que conoce Tablero (Meta usa además otras: van con la del feed).
 */
export function placementPlan(plan, versions) {
  const video = versions[0].medio.tipo === 'video'
  const available = new Set(versions.map((v) => v.formato))
  const keys = plan.ubicaciones === 'manual' ? (plan.posiciones ?? []) : Object.keys(PLACEMENTS)
  const fallback = FALLBACK_ORDER.find((f) => available.has(f))
  const groups = new Map()
  for (const key of keys) {
    const placement = PLACEMENTS[key]
    if (!placement || (placement.video && !video)) continue
    const formato = placement.formats.find((f) => available.has(f))
    if (!formato || formato === fallback) continue
    groups.set(formato, [...(groups.get(formato) ?? []), key])
  }
  return { fallback, groups }
}

/**
 * Un anuncio con varias versiones (cuadrada, del feed, vertical, horizontal), cada una en sus ubicaciones
 * (asset_feed_spec con reglas por ubicación, como lo hace el Administrador de anuncios); la del feed, en el resto.
 * Las etiquetas unen cada regla con lo que enseña. null si al final solo se usa una versión.
 */
function placementAssets(plan, ad, { thumbs, tag }) {
  const versions = versionsOf(ad)
  const video = versions[0].medio.tipo === 'video'
  const { fallback, groups } = placementPlan(plan, versions)
  const used = versions.filter((v) => v.formato === fallback || groups.has(v.formato))
  if (used.length < 2) return null
  const label = (formato) => `tablero_${formato.replace(':', 'x')}_${tag}`
  const labels = used.map((v) => ({ name: label(v.formato) }))
  const asset = ({ formato, medio }) => {
    if (!video) return { hash: medio.hash, adlabels: [{ name: label(formato) }] }
    if (!thumbs.get(medio.id)) throw new HttpError(500, 'Falta la miniatura del vídeo')
    return { video_id: medio.id, thumbnail_hash: thumbs.get(medio.id), adlabels: [{ name: label(formato) }] }
  }
  const titular = plan.titular?.trim()
  const descripcion = plan.descripcion?.trim()
  const rule = (formato, spec, priority) => ({
    customization_spec: { ...ALL_AGES, ...spec },
    [video ? 'video_label' : 'image_label']: { name: label(formato) },
    body_label: { name: label(formato) },
    link_url_label: { name: label(formato) },
    ...(titular ? { title_label: { name: label(formato) } } : {}),
    ...(descripcion ? { description_label: { name: label(formato) } } : {}),
    priority,
  })
  const rules = [...groups].map(([formato, keys], i) => rule(formato, positionsOf(keys), i + 1))
  rules.push(rule(fallback, {}, rules.length + 1))
  const welcome = welcomeMessage(plan)
  return {
    [video ? 'videos' : 'images']: used.map(asset),
    bodies: [{ text: plan.texto, adlabels: labels }],
    ...(titular ? { titles: [{ text: titular, adlabels: labels }] } : {}),
    ...(descripcion ? { descriptions: [{ text: descripcion, adlabels: labels }] } : {}),
    link_urls: [{ website_url: WHATSAPP_LINK, adlabels: labels }],
    call_to_action_types: [CTA_TYPE],
    call_to_actions: [{ type: CTA_TYPE, value: { app_destination: 'WHATSAPP' } }],
    ad_formats: [video ? 'SINGLE_VIDEO' : 'SINGLE_IMAGE'],
    optimization_type: 'PLACEMENT',
    asset_customization_rules: rules,
    ...(welcome ? { additional_data: { page_welcome_message: welcome } } : {}),
  }
}

/**
 * Un anuncio: con imagen (link_data) o con vídeo (video_data, con su miniatura subida como imagen); con versión
 * vertical, las dos, cada una en sus ubicaciones. `thumbs`: la miniatura (subida) de cada vídeo.
 */
export function creativeBody(plan, ad, { thumbs = new Map(), tag = randomUUID().slice(0, 8) } = {}) {
  const spec = { page_id: plan.pagina }
  if (plan.instagram) spec.instagram_user_id = plan.instagram
  const common = {
    name: ad.nombre,
    object_story_spec: spec,
    degrees_of_freedom_spec: { creative_features_spec: featuresSpec(plan.mejoras) },
    // Si puede salir junto a anuncios de otras empresas (anuncios multianunciante).
    contextual_multi_ads: { enroll_status: plan.multianunciante ? 'OPT_IN' : 'OPT_OUT' },
  }
  // Con varias versiones, todo va en asset_feed_spec; en object_story_spec, solo quién anuncia.
  const versions = versionsOf(ad)
  if (versions.length > 1) {
    const assets = placementAssets(plan, ad, { thumbs, tag })
    if (assets) return { ...common, asset_feed_spec: assets }
  }
  // Una sola (o solo se usa una): la que va en el feed.
  const { fallback } = placementPlan(plan, versions)
  const medio = (versions.find((v) => v.formato === fallback) ?? versions[0]).medio

  const welcome = welcomeMessage(plan)
  const greeting = welcome ? { page_welcome_message: welcome } : {}
  const titular = plan.titular?.trim()
  const descripcion = plan.descripcion?.trim()
  // Con varias opciones de texto (como en el Administrador de anuncios), los textos van todos en asset_feed_spec y
  // Meta enseña la combinación que mejor funciona a cada persona.
  const extra = plan.variantes ?? {}
  const options = (main, more) => [main, ...(more ?? [])].map((t) => t?.trim()).filter(Boolean).map((t) => ({ text: t }))
  if (['textos', 'titulos', 'descripciones'].some((key) => extra[key]?.length)) {
    const titles = options(titular, extra.titulos)
    const descriptions = options(descripcion, extra.descripciones)
    common.asset_feed_spec = {
      bodies: options(plan.texto, extra.textos),
      ...(titles.length ? { titles } : {}),
      ...(descriptions.length ? { descriptions } : {}),
      optimization_type: 'DEGREES_OF_FREEDOM',
    }
  }
  const texts = !common.asset_feed_spec
  if (medio.tipo === 'imagen') {
    spec.link_data = {
      image_hash: medio.hash,
      link: WHATSAPP_LINK,
      ...(texts ? { message: plan.texto } : {}),
      ...(texts && titular ? { name: titular } : {}),
      ...(texts && descripcion ? { description: descripcion } : {}),
      call_to_action: { type: CTA_TYPE, value: { app_destination: 'WHATSAPP' } },
      ...greeting,
    }
  } else {
    const thumbnailHash = thumbs.get(medio.id)
    if (!thumbnailHash) throw new HttpError(500, 'Falta la miniatura del vídeo')
    spec.video_data = {
      video_id: medio.id,
      image_hash: thumbnailHash,
      ...(texts ? { message: plan.texto } : {}),
      ...(texts && titular ? { title: titular } : {}),
      ...(texts && descripcion ? { link_description: descripcion } : {}),
      call_to_action: { type: CTA_TYPE, value: { app_destination: 'WHATSAPP', link: WHATSAPP_LINK } },
      ...greeting,
    }
  }
  return common
}

export const adBody = (ad, { adSetId, creativeId, status = 'PAUSED' }) => ({
  name: ad.nombre,
  adset_id: adSetId,
  creative: { creative_id: creativeId },
  status,
})

/** Cada nivel en el Administrador de anuncios: su pestaña y cómo se selecciona. */
const ADS_MANAGER = {
  campana: ['campaigns', 'selected_campaign_ids'],
  conjunto: ['adsets', 'selected_adset_ids'],
  anuncio: ['ads', 'selected_ad_ids'],
}

/** La campaña (o el conjunto o el anuncio) en el Administrador de anuncios. */
export function adsManagerLink(account, objectId, businessId, level = 'campana') {
  const [tab, param] = ADS_MANAGER[level]
  const url = new URL(`https://adsmanager.facebook.com/adsmanager/manage/${tab}`)
  url.searchParams.set('act', account.replace(/^act_/, ''))
  if (businessId) url.searchParams.set('business_id', businessId)
  url.searchParams.set(param, objectId)
  return url.href
}

// ── Lo que llega de Meta: campañas, conjuntos y anuncios en marcha ──

/** Lo que se pide a Meta de cada fila (y del total) para sacar las métricas de `metricsOf`. */
export const INSIGHT_FIELDS = 'spend,impressions,reach,inline_link_clicks,actions'

/** Las acciones de mensajes que se cuentan (de WhatsApp, y también de Messenger o Instagram). */
const MESSAGING = {
  /** Conversaciones que ha empezado alguien desde el anuncio. */
  conversaciones: 'onsite_conversion.messaging_conversation_started_7d',
  /** Personas que escriben por primera vez. */
  contactos: 'onsite_conversion.messaging_first_reply',
  bloqueos: 'onsite_conversion.messaging_block',
}

/**
 * Las métricas de una fila de insights. Las que son un cociente (coste por conversación, CPM, CTR…) se
 * calculan aquí, igual en las filas que en el total, y son null cuando no hay de qué (no 0 ni infinito).
 */
export function metricsOf(row) {
  const n = (value) => Number(value) || 0
  const action = (type) => n(row?.actions?.find((a) => a.action_type === type)?.value)
  const per = (a, b, scale = 1) => (b ? (a / b) * scale : null)
  const gasto = n(row?.spend)
  const impresiones = n(row?.impressions)
  const alcance = n(row?.reach)
  const clics = n(row?.inline_link_clicks)
  const conversaciones = action(MESSAGING.conversaciones)
  return {
    gasto,
    conversaciones,
    coste: per(gasto, conversaciones),
    contactos: action(MESSAGING.contactos),
    alcance,
    impresiones,
    frecuencia: per(impresiones, alcance),
    cpm: per(gasto, impresiones, 1000),
    clics,
    ctr: per(clics, impresiones, 100),
    cpc: per(gasto, clics),
    bloqueos: action(MESSAGING.bloqueos),
  }
}

const past = (time, now) => Boolean(time) && Date.parse(time) < now
const future = (time, now) => Boolean(time) && Date.parse(time) > now

/** Los conjuntos que gastarían con la campaña activa: activos y sin terminar. */
const liveAdSets = (campaign, now) => (campaign.adsets?.data ?? []).filter((s) => s.status === 'ACTIVE' && !past(s.end_time, now))

/** Cómo se dice en cada nivel (la campaña; el conjunto y el anuncio). */
const DELIVERY_WORDS = {
  campana: { activo: 'Activa', terminado: 'Terminada', programado: 'Programada', hijos: 'Conjuntos en pausa' },
  conjunto: { activo: 'Activo', terminado: 'Terminado', programado: 'Programado', hijos: 'Anuncios en pausa' },
  anuncio: { activo: 'Activo' },
}

/** Lo que Meta dice de por qué algo activo no se entrega. */
const DELIVERY_STATES = {
  PAUSED: { texto: 'En pausa', tono: 'off' },
  CAMPAIGN_PAUSED: { texto: 'Campaña en pausa', tono: 'off' },
  ADSET_PAUSED: { texto: 'Conjunto en pausa', tono: 'off' },
  IN_PROCESS: { texto: 'Procesando', tono: 'off' },
  WITH_ISSUES: { texto: 'Con problemas', tono: 'warning' },
  DISAPPROVED: { texto: 'Rechazado', tono: 'warning' },
  PENDING_BILLING_INFO: { texto: 'Pago pendiente', tono: 'warning' },
  PENDING_REVIEW: { texto: 'En revisión', tono: 'off' },
  PREAPPROVED: { texto: 'En revisión', tono: 'off' },
}

const REVIEWING = ['PENDING_REVIEW', 'IN_PROCESS', 'PREAPPROVED']

/**
 * Lo que pasa de verdad con la campaña, el conjunto o el anuncio (aunque esté activo, puede no estar
 * gastando), en pocas palabras. De la campaña se miran sus conjuntos; del conjunto, sus anuncios.
 */
export function deliveryOf(object, now = Date.now(), level = 'campana') {
  const words = DELIVERY_WORDS[level]
  const state = DELIVERY_STATES[object.effective_status]
  if (state) return state
  if (level === 'anuncio') return { texto: words.activo, tono: 'ok' }
  if (level === 'conjunto') {
    if (past(object.end_time, now)) return { texto: words.terminado, tono: 'off' }
    const ads = object.ads?.data ?? []
    const live = ads.filter((a) => a.status === 'ACTIVE')
    if (ads.length && !live.length) return { texto: words.hijos, tono: 'warning' }
    if (live.some((a) => ['WITH_ISSUES', 'DISAPPROVED'].includes(a.effective_status))) return { texto: 'Con problemas', tono: 'warning' }
    if (future(object.start_time, now)) return { texto: words.programado, tono: 'off' }
    if (live.length && live.every((a) => REVIEWING.includes(a.effective_status))) return { texto: 'En revisión', tono: 'off' }
    return { texto: words.activo, tono: 'ok' }
  }
  const adSets = object.adsets?.data ?? []
  if (past(object.stop_time, now) || (adSets.length && adSets.every((s) => past(s.end_time, now)))) {
    return { texto: words.terminado, tono: 'off' }
  }
  const live = liveAdSets(object, now)
  if (adSets.length && !live.length) return { texto: words.hijos, tono: 'warning' }
  if (live.some((s) => ['WITH_ISSUES', 'DISAPPROVED'].includes(s.effective_status))) return { texto: 'Con problemas', tono: 'warning' }
  if (live.length && live.every((s) => future(s.start_time, now))) return { texto: words.programado, tono: 'off' }
  if (live.length && live.every((s) => REVIEWING.includes(s.effective_status))) return { texto: 'En revisión', tono: 'off' }
  return { texto: words.activo, tono: 'ok' }
}

/**
 * El presupuesto de la campaña (`reparte`: Meta lo reparte entre sus conjuntos) o, si va en los conjuntos, la
 * suma de los que gastarían. El de un conjunto, el suyo (null si va en la campaña). Los anuncios no tienen.
 */
export function budgetOf(object, currency, now = Date.now(), level = 'campana') {
  const amount = (value) => Number(value) || 0
  if (level === 'anuncio') return null
  const shared = level === 'campana' ? { reparte: true } : {}
  if (amount(object.daily_budget)) return { cantidad: majorUnits(object.daily_budget, currency), tipo: 'dia', ...shared }
  if (amount(object.lifetime_budget)) return { cantidad: majorUnits(object.lifetime_budget, currency), tipo: 'total', ...shared }
  if (level === 'conjunto') return null
  const live = liveAdSets(object, now)
  const daily = live.reduce((sum, s) => sum + amount(s.daily_budget), 0)
  if (daily) return { cantidad: majorUnits(daily, currency), tipo: 'dia' }
  const total = live.reduce((sum, s) => sum + amount(s.lifetime_budget), 0)
  return total ? { cantidad: majorUnits(total, currency), tipo: 'total' } : null
}

/**
 * Cuándo termina (ISO), si tiene fin: la campaña, por su fecha de fin o, si no, cuando acaba el último de los
 * conjuntos que gastarían (si todos tienen fin); el conjunto, por la suya. Los anuncios no tienen.
 */
export function endOf(object, now = Date.now(), level = 'campana') {
  const iso = (time) => (time && Number.isFinite(Date.parse(time)) ? new Date(Date.parse(time)).toISOString() : null)
  if (level === 'conjunto') return iso(object.end_time)
  if (level !== 'campana') return null
  if (object.stop_time) return iso(object.stop_time)
  const live = liveAdSets(object, now)
  if (!live.length || live.some((s) => !s.end_time)) return null
  return iso(live.map((s) => s.end_time).sort((a, b) => Date.parse(b) - Date.parse(a))[0])
}

/** El campo de las filas de insights que dice de qué campaña, conjunto o anuncio son. */
const INSIGHT_KEY = { campana: 'campaign_id', conjunto: 'adset_id', anuncio: 'ad_id' }

/** Una campaña, un conjunto o un anuncio como lo enseña «En marcha» (sin métricas: van aparte). */
export function rowOf(object, { level = 'campana', account, currency, businessId = null, now = Date.now() }) {
  const id = String(object.id)
  return {
    id,
    nombre: object.name ?? id,
    estado: object.status === 'ACTIVE' ? 'activa' : 'pausada',
    entrega: deliveryOf(object, now, level),
    presupuesto: budgetOf(object, currency, now, level),
    termina: endOf(object, now, level),
    enlace: adsManagerLink(account, id, businessId, level),
    miniatura: level === 'anuncio' ? (object.creative?.thumbnail_url ?? null) : null,
    automaticas: level === 'anuncio' ? automaticOf(object.creative) : null,
    pagina: level === 'conjunto' ? (object.promoted_object?.page_id ?? null) : null,
    actualizada: object.updated_time ? new Date(Date.parse(object.updated_time)).toISOString() : null,
    // De qué campaña (y conjunto) es: para bajar a él desde la lista de toda la cuenta.
    padres:
      level === 'conjunto'
        ? { campana: refOf(object.campaign) }
        : level === 'anuncio'
          ? { campana: refOf(object.campaign), conjunto: refOf(object.adset) }
          : null,
  }
}

const refOf = (object) => (object?.id ? { id: String(object.id), nombre: object.name ?? String(object.id) } : null)

/**
 * Cada campaña (o conjunto, o anuncio) con sus métricas del periodo, de `insights` (una fila por cada una).
 * Primero las activas, de más a menos gasto; luego las que están en pausa, las más recientes antes.
 */
export function rowsOf(objects, insights, options) {
  const level = options.level ?? 'campana'
  const stats = new Map(insights.map((row) => [String(row[INSIGHT_KEY[level]]), row]))
  const rows = objects.map((object) => ({ ...rowOf(object, options), metricas: metricsOf(stats.get(String(object.id))) }))
  return rows.sort(
    (a, b) =>
      (a.estado === 'pausada') - (b.estado === 'pausada') ||
      (a.estado === 'activa' ? b.metricas.gasto - a.metricas.gasto : 0) ||
      (b.actualizada ?? '').localeCompare(a.actualizada ?? ''),
  )
}

// ── Lo que llega de la app ──

export const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const id = (value) => (typeof value === 'string' && /^[\w.-]{1,64}$/.test(value) ? value : null)
const DAY = /^\d{4}-\d{2}-\d{2}$/

function places(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((p) => p && ['country', 'region', 'city'].includes(p.tipo) && id(String(p.key ?? '')))
    .slice(0, 50)
    .map((p) => ({ key: String(p.key), tipo: p.tipo, nombre: text(p.nombre, 120) || String(p.key), detalle: text(p.detalle, 120) }))
}

/** Las opciones de una campaña (y de una plantilla), sin nada raro. */
export function cleanSettings(raw) {
  return {
    cuenta: id(raw?.cuenta),
    pagina: id(raw?.pagina),
    instagram: id(raw?.instagram),
    presupuesto: Number(raw?.presupuesto) > 0 ? Math.round(Number(raw.presupuesto) * 100) / 100 : 0,
    lugares: places(raw?.lugares),
    edadMin: clamp(raw?.edadMin, 18, 65),
    edadMax: clamp(raw?.edadMax, 18, 65),
    genero: ['todos', 'hombres', 'mujeres'].includes(raw?.genero) ? raw.genero : 'todos',
    advantage: raw?.advantage !== false,
    ubicaciones: ['auto', 'manual', 'facebook', 'instagram'].includes(raw?.ubicaciones) ? raw.ubicaciones : 'auto',
    posiciones: Array.isArray(raw?.posiciones) ? Object.keys(PLACEMENTS).filter((key) => raw.posiciones.includes(key)) : [],
    mejoras: Array.isArray(raw?.mejoras) ? Object.keys(ENHANCEMENTS).filter((key) => raw.mejoras.includes(key)) : [],
    multianunciante: raw?.multianunciante === true,
    texto: text(raw?.texto, 3000),
    titular: text(raw?.titular, 255),
    descripcion: text(raw?.descripcion, 255),
    bienvenida: text(raw?.bienvenida, 500),
    tipoMensaje: raw?.tipoMensaje === 'preguntas' ? 'preguntas' : 'escrito',
    saludo: text(raw?.saludo, 500),
    preguntas: (Array.isArray(raw?.preguntas) ? raw.preguntas : [])
      .map((q) => text(q, 80))
      .filter(Boolean)
      .slice(0, MAX_QUESTIONS),
  }
}

/** Una imagen ya subida (su hash) o un vídeo (su id); null si no es nada de eso. */
export function cleanMedia(medio) {
  if (medio?.tipo === 'imagen' && /^[a-f0-9]{8,64}$/i.test(medio.hash ?? '')) return { tipo: 'imagen', hash: medio.hash }
  if (medio?.tipo === 'video' && id(medio.id)) return { tipo: 'video', id: medio.id }
  return null
}

export function cleanPlan(raw) {
  const plan = {
    ...cleanSettings(raw),
    nombre: text(raw?.nombre, 200),
    plantilla: text(raw?.plantilla, 120) || null,
    // «Publicar ya»: todo se crea activo (gasta en cuanto Meta apruebe los anuncios).
    publicar: raw?.publicar === true,
    inicio: DAY.test(raw?.inicio ?? '') ? raw.inicio : null,
    fin: DAY.test(raw?.fin ?? '') ? raw.fin : null,
    anuncios: (Array.isArray(raw?.anuncios) ? raw.anuncios : []).slice(0, 50).map((ad, i) => {
      // Sus versiones (1:1, 4:5, 9:16, 16:9) o, como antes, la del feed y la vertical.
      const raw = Array.isArray(ad?.versiones) && ad.versiones.length ? ad.versiones : [{ formato: '4:5', medio: ad?.medio }, ...(ad?.vertical ? [{ formato: '9:16', medio: ad.vertical }] : [])]
      const versiones = []
      for (const version of raw.slice(0, FORMATS.length)) {
        const medio = cleanMedia(version?.medio)
        if (!medio) throw new HttpError(400, `Al anuncio ${i + 1} le falta la imagen o el vídeo.`)
        const formato = FORMATS.includes(version?.formato) ? version.formato : '4:5'
        if (versiones.some((v) => v.formato === formato)) throw new HttpError(400, `En el anuncio ${i + 1} hay dos versiones ${formato}.`)
        versiones.push({ formato, medio })
      }
      if (versiones.some((v) => v.medio.tipo !== versiones[0].medio.tipo)) {
        throw new HttpError(400, `En el anuncio ${i + 1}, todas las versiones tienen que ser imágenes o todas vídeos.`)
      }
      return { nombre: text(ad.nombre, 200) || `Anuncio ${i + 1}`, medio: versiones[0].medio, versiones }
    }),
  }
  if (!plan.cuenta?.startsWith('act_')) throw new HttpError(400, 'Falta la cuenta publicitaria.')
  if (!plan.pagina) throw new HttpError(400, 'Falta la página de Facebook.')
  if (!plan.nombre) throw new HttpError(400, 'Falta el nombre de la campaña.')
  if (!plan.texto) throw new HttpError(400, 'Falta el texto del anuncio.')
  if (!plan.anuncios.length) throw new HttpError(400, 'Añade al menos una imagen o un vídeo.')
  return plan
}

export function cleanTemplates(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_TEMPLATES) throw new HttpError(400, 'Plantillas no válidas')
  return raw.map((t) => {
    const nombre = text(t?.nombre, 120)
    if (!nombre) throw new HttpError(400, 'Cada plantilla necesita un nombre.')
    return { id: id(t?.id) ?? randomUUID(), nombre, ...cleanSettings(t) }
  })
}

// ── datos/anuncios.json ──

export async function readAds() {
  let data = null
  try {
    data = JSON.parse(await readFile(ADS_FILE, 'utf8'))
  } catch (err) {
    if (err.code !== 'ENOENT') throw new HttpError(500, `${ADS_FILE} no se puede leer; no se ha modificado.`)
  }
  return {
    plantillas: Array.isArray(data?.plantillas) ? data.plantillas : [],
    lanzamientos: Array.isArray(data?.lanzamientos) ? data.lanzamientos : [],
  }
}

async function writeAds(data) {
  await mkdir(DATA_DIR, { recursive: true })
  const tmp = `${ADS_FILE}.tmp`
  await writeFile(tmp, `${JSON.stringify({ app: 'tablero', version: 1, savedAt: new Date().toISOString(), ...data }, null, 2)}\n`, 'utf8')
  await rename(tmp, ADS_FILE)
}

// Las escrituras van de una en una.
let queue = Promise.resolve()
function changeAds(fn) {
  const run = queue.then(async () => {
    const data = await readAds()
    const result = await fn(data)
    await writeAds(data)
    return result
  })
  queue = run.catch(() => {})
  return run
}

export const saveTemplates = (raw) =>
  changeAds((data) => {
    data.plantillas = cleanTemplates(raw)
    return data.plantillas
  })

// ── En Meta ──

/** Sube a la cuenta una imagen (devuelve su hash) o un vídeo (su id), desde un archivo temporal. */
export async function uploadFile(meta, account, { file, type, name }) {
  if (type.startsWith('image/')) {
    const bytes = (await readFile(file)).toString('base64')
    const res = await meta.graph(`${account}/adimages`, { method: 'POST', body: { bytes } })
    const image = Object.values(res.images ?? {})[0]
    if (!image?.hash) throw new HttpError(502, 'Meta no ha devuelto la imagen subida.')
    return { tipo: 'imagen', hash: image.hash, url: image.url ?? null }
  }
  if (type.startsWith('video/')) {
    const form = new FormData()
    form.set('name', name)
    form.set('source', await openAsBlob(file, { type }), name)
    const res = await meta.graph(`${account}/advideos`, { method: 'POST', body: form })
    if (!res.id) throw new HttpError(502, 'Meta no ha devuelto el vídeo subido.')
    return { tipo: 'video', id: String(res.id) }
  }
  throw new HttpError(415, 'Solo imágenes o vídeos')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Espera a que Meta procese el vídeo y sube su miniatura como imagen de la cuenta (Meta desaconseja usar en un
 * anuncio las direcciones de su propia CDN). Devuelve el hash de la miniatura.
 */
async function videoThumbnail(meta, account, videoId, { wait = VIDEO_WAIT, poll = VIDEO_POLL, fetchImpl = fetch } = {}) {
  const deadline = Date.now() + wait
  for (;;) {
    const { status } = await meta.graph(videoId, { params: { fields: 'status' } })
    if (status?.video_status === 'ready') break
    if (status?.video_status === 'error' || status?.video_status === 'expired') {
      throw new HttpError(502, 'Meta no ha podido procesar uno de los vídeos. Prueba con otro formato (MP4 o MOV).')
    }
    if (Date.now() > deadline) throw new HttpError(504, 'Meta sigue procesando un vídeo. Espera un par de minutos y vuelve a pulsar «Crear en pausa».')
    await sleep(poll)
  }
  const { data } = await meta.graph(`${videoId}/thumbnails`, { params: { fields: 'uri,is_preferred' } })
  const thumb = data?.find((t) => t.is_preferred) ?? data?.[0]
  if (!thumb?.uri) throw new HttpError(502, 'Meta no ha devuelto la miniatura del vídeo.')
  const res = await fetchImpl(thumb.uri).catch(() => null)
  if (!res?.ok) throw new HttpError(502, 'No se ha podido descargar la miniatura del vídeo.')
  const bytes = Buffer.from(await res.arrayBuffer()).toString('base64')
  const uploaded = await meta.graph(`${account}/adimages`, { method: 'POST', body: { bytes } })
  const image = Object.values(uploaded.images ?? {})[0]
  if (!image?.hash) throw new HttpError(502, 'Meta no ha devuelto la miniatura subida.')
  return image.hash
}

/** La miniatura de cada vídeo del plan (Meta la pide aparte, como imagen). */
export async function thumbnailsOf(meta, plan, options) {
  const thumbs = new Map()
  for (const medio of plan.anuncios.flatMap((ad) => versionsOf(ad).map((v) => v.medio))) {
    if (medio.tipo === 'video' && !thumbs.has(medio.id)) {
      thumbs.set(medio.id, await videoThumbnail(meta, plan.cuenta, medio.id, options))
    }
  }
  return thumbs
}

/** Un anuncio por imagen o vídeo en el conjunto; sus identificadores. */
export async function createAds(meta, plan, adSetId, thumbs, status) {
  const ads = []
  for (const ad of plan.anuncios) {
    const creative = await meta.graph(`${plan.cuenta}/adcreatives`, {
      method: 'POST',
      body: creativeBody(plan, ad, { thumbs }),
    })
    const created = await meta.graph(`${plan.cuenta}/ads`, { method: 'POST', body: adBody(ad, { adSetId, creativeId: creative.id, status }) })
    ads.push(String(created.id))
  }
  return ads
}

/** El error de algo que ha fallado a medias: si se ha podido borrar lo creado, o qué ha quedado. */
function halfDone(err, removed, leftover) {
  const why = err?.message ?? String(err)
  return new HttpError(err?.status ?? 502, removed ? `${why} (No se ha creado nada.)` : `${why} (${leftover})`, err?.code)
}

const removeObject = (meta, objectId) =>
  meta.graph(String(objectId), { method: 'DELETE' }).then(
    () => true,
    () => false,
  )

/**
 * Crea la campaña, el conjunto y un anuncio por imagen o vídeo, todo en pausa (o todo activo, con `publicar`), y lo
 * apunta. Si algo falla a medias, borra la campaña recién creada (con lo que cuelga de ella) para no dejar nada a
 * medio hacer.
 */
export async function launch(meta, raw, options = {}) {
  const plan = cleanPlan(raw)
  const account = await meta.graph(plan.cuenta, { params: { fields: 'name,currency,business{id}' } })
  const thumbs = await thumbnailsOf(meta, plan, options)

  const campaign = await meta.graph(`${plan.cuenta}/campaigns`, { method: 'POST', body: campaignBody(plan) })
  try {
    const adSet = await meta.graph(`${plan.cuenta}/adsets`, {
      method: 'POST',
      body: adSetBody(plan, { campaignId: campaign.id, currency: account.currency }),
    })
    const ads = await createAds(meta, plan, adSet.id, thumbs, plan.publicar ? 'ACTIVE' : 'PAUSED')
    const record = {
      id: randomUUID(),
      creadoEn: new Date().toISOString(),
      cuenta: plan.cuenta,
      cuentaNombre: account.name ?? null,
      plantilla: plan.plantilla,
      nombre: plan.nombre,
      campana: String(campaign.id),
      conjunto: String(adSet.id),
      anuncios: ads,
      presupuesto: plan.presupuesto,
      moneda: account.currency,
      estado: plan.publicar ? 'activa' : 'pausada',
      ...(plan.publicar ? { activada: true } : {}),
      enlace: adsManagerLink(plan.cuenta, String(campaign.id), account.business?.id),
    }
    await changeAds((data) => {
      data.lanzamientos = [record, ...data.lanzamientos].slice(0, KEEP_LAUNCHES)
    })
    return record
  } catch (err) {
    const removed = await removeObject(meta, campaign.id)
    throw halfDone(err, removed, `Ha quedado la campaña «${plan.nombre}» ${plan.publicar ? 'activa' : 'en pausa'} y a medias: bórrala en el Administrador de anuncios.`)
  }
}

/** Los objetivos de campaña que admiten conjuntos de mensajes a WhatsApp como los de Tablero. */
const WHATSAPP_OBJECTIVES = new Set(['OUTCOME_ENGAGEMENT', 'OUTCOME_LEADS', 'OUTCOME_SALES'])
/** Lo de un conjunto que dice a qué número de WhatsApp llegan los mensajes (sin él, al de la página). */
const WHATSAPP_NUMBER = ['whats_app_business_phone_number_id', 'whatsapp_phone_number']

/**
 * Un conjunto nuevo, con un anuncio por imagen o vídeo, en una campaña que ya existe. El conjunto se crea en
 * pausa (activo, con `publicar`) y sus anuncios no: se encienden todos con el interruptor del conjunto (y,
 * mientras, Meta los revisa).
 * Si la campaña reparte su presupuesto, el conjunto no lleva; si otro conjunto de la campaña, con la misma
 * página, manda los mensajes a un número concreto, este también. Si algo falla a medias, se borra el conjunto.
 */
export async function addAdSet(meta, raw, options = {}) {
  const campaignId = typeof raw?.campana === 'string' && /^\d{1,32}$/.test(raw.campana) ? raw.campana : null
  if (!campaignId) throw new HttpError(400, 'Campaña no válida')
  if (!text(raw?.nombre, 200)) throw new HttpError(400, 'Falta el nombre del conjunto.')
  const plan = cleanPlan(raw)
  const [account, campaign] = await Promise.all([
    meta.graph(plan.cuenta, { params: { fields: 'currency' } }),
    meta.graph(campaignId, { params: { fields: 'name,account_id,objective,daily_budget,lifetime_budget,adsets.limit(100){promoted_object}' } }),
  ])
  if (`act_${campaign.account_id}` !== plan.cuenta) throw new HttpError(400, 'Esa campaña no es de esta cuenta publicitaria.')
  if (!WHATSAPP_OBJECTIVES.has(campaign.objective)) {
    throw new HttpError(400, `A «${campaign.name}» no se le pueden añadir conjuntos de mensajes a WhatsApp: su objetivo no es interacción, clientes potenciales ni ventas.`)
  }
  const sibling = (campaign.adsets?.data ?? [])
    .map((s) => s.promoted_object ?? {})
    .find((p) => p.page_id === plan.pagina && WHATSAPP_NUMBER.some((key) => p[key]))
  const promoted = Object.fromEntries(WHATSAPP_NUMBER.filter((key) => sibling?.[key]).map((key) => [key, sibling[key]]))
  const sharedBudget = Number(campaign.daily_budget) > 0 || Number(campaign.lifetime_budget) > 0
  const thumbs = await thumbnailsOf(meta, plan, options)

  const adSet = await meta.graph(`${plan.cuenta}/adsets`, {
    method: 'POST',
    body: adSetBody(plan, { campaignId, currency: account.currency, sharedBudget, promoted }),
  })
  try {
    const ads = await createAds(meta, plan, adSet.id, thumbs, 'ACTIVE')
    return { id: String(adSet.id), nombre: plan.nombre, campana: campaignId, anuncios: ads, activo: plan.publicar }
  } catch (err) {
    const removed = await removeObject(meta, adSet.id)
    throw halfDone(err, removed, `Ha quedado el conjunto «${plan.nombre}» ${plan.publicar ? 'activo' : 'en pausa'} y a medias: bórralo en el Administrador de anuncios.`)
  }
}

/** ¿Se ha activado alguna vez? (Las de antes de `activada` solo tenían el estado.) */
const everActivated = (record) => record.activada ?? record.estado === 'activa'

/**
 * Activa una campaña creada desde Tablero. La primera vez, también su conjunto y sus anuncios (se crearon en
 * pausa); después, solo la campaña, para no volver a encender un anuncio que se haya pausado en Meta.
 */
export async function activate(meta, launchId) {
  const { lanzamientos } = await readAds()
  const record = lanzamientos.find((l) => l.id === launchId)
  if (!record) throw new HttpError(404, 'Esa campaña no se creó desde Tablero.')
  const objects = everActivated(record) ? [record.campana] : [record.campana, record.conjunto, ...record.anuncios]
  for (const objectId of objects) {
    await meta.graph(objectId, { method: 'POST', body: { status: 'ACTIVE' } })
  }
  return changeAds((data) => {
    const found = data.lanzamientos.find((l) => l.id === launchId) ?? { ...record }
    found.estado = 'activa'
    found.activada = true
    return found
  })
}

/**
 * Pausa o activa cualquier campaña, conjunto o anuncio de la cuenta (el interruptor de «En marcha»). Si es una
 * campaña creada desde Tablero, se apunta también en su registro.
 */
export async function setStatus(meta, raw) {
  const level = raw?.nivel ?? 'campana'
  if (!Object.hasOwn(INSIGHT_KEY, level)) throw new HttpError(400, 'Nivel no válido')
  const objectId = typeof raw?.id === 'string' && /^\d{1,32}$/.test(raw.id) ? raw.id : null
  if (!objectId) throw new HttpError(400, { campana: 'Campaña no válida', conjunto: 'Conjunto no válido', anuncio: 'Anuncio no válido' }[level])
  if (!['activa', 'pausada'].includes(raw?.estado)) throw new HttpError(400, 'Estado no válido')
  const record = level === 'campana' ? ((await readAds()).lanzamientos.find((l) => l.campana === objectId) ?? null) : null
  if (record && raw.estado === 'activa') return { id: objectId, estado: 'activa', lanzamiento: await activate(meta, record.id) }
  await meta.graph(objectId, { method: 'POST', body: { status: raw.estado === 'activa' ? 'ACTIVE' : 'PAUSED' } })
  if (!record) return { id: objectId, estado: raw.estado, lanzamiento: null }
  const lanzamiento = await changeAds((data) => {
    const found = data.lanzamientos.find((l) => l.id === record.id) ?? { ...record }
    found.estado = 'pausada'
    found.activada = everActivated(found)
    return found
  })
  return { id: objectId, estado: 'pausada', lanzamiento }
}
