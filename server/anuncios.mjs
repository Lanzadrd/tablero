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
const GREETING = '¡Hola! ¿En qué podemos ayudarte?'

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
    status: 'PAUSED',
    special_ad_categories: [],
    buying_type: 'AUCTION',
    // El presupuesto va en el conjunto (desde la v24 hay que decir si se comparte entre conjuntos).
    is_adset_budget_sharing_enabled: false,
  }
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
  if (plan.ubicaciones === 'facebook' || plan.ubicaciones === 'instagram') targeting.publisher_platforms = [plan.ubicaciones]
  return targeting
}

export function adSetBody(plan, { campaignId, currency, today = localDay() }) {
  const body = {
    name: plan.nombre,
    campaign_id: campaignId,
    status: 'PAUSED',
    destination_type: 'WHATSAPP',
    optimization_goal: 'CONVERSATIONS',
    billing_event: 'IMPRESSIONS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    daily_budget: minorUnits(plan.presupuesto, currency),
    promoted_object: { page_id: plan.pagina },
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

/** Lo que aparece ya escrito en WhatsApp para que la persona lo envíe (Meta lo pide como JSON en texto). */
export function welcomeMessage(autofill) {
  return JSON.stringify({
    type: 'VISUAL_EDITOR',
    version: 2,
    landing_screen_type: 'welcome_message',
    media_type: 'text',
    text_format: {
      customer_action_type: 'autofill_message',
      message: { text: GREETING, autofill_message: { content: autofill } },
    },
  })
}

/** Un anuncio: con imagen (link_data) o con vídeo (video_data, con su miniatura subida como imagen). */
export function creativeBody(plan, ad, { thumbnailHash } = {}) {
  const greeting = plan.saludo?.trim() ? { page_welcome_message: welcomeMessage(plan.saludo.trim()) } : {}
  const spec = { page_id: plan.pagina }
  if (plan.instagram) spec.instagram_user_id = plan.instagram
  if (ad.medio.tipo === 'imagen') {
    spec.link_data = {
      image_hash: ad.medio.hash,
      link: WHATSAPP_LINK,
      message: plan.texto,
      ...(plan.titular?.trim() ? { name: plan.titular.trim() } : {}),
      call_to_action: { type: CTA_TYPE, value: { app_destination: 'WHATSAPP' } },
      ...greeting,
    }
  } else {
    if (!thumbnailHash) throw new HttpError(500, 'Falta la miniatura del vídeo')
    spec.video_data = {
      video_id: ad.medio.id,
      image_hash: thumbnailHash,
      message: plan.texto,
      ...(plan.titular?.trim() ? { title: plan.titular.trim() } : {}),
      call_to_action: { type: CTA_TYPE, value: { app_destination: 'WHATSAPP', link: WHATSAPP_LINK } },
      ...greeting,
    }
  }
  return {
    name: ad.nombre,
    object_story_spec: spec,
    // Que no salga junto a anuncios de otros (anuncios multianunciante).
    contextual_multi_ads: { enroll_status: 'OPT_OUT' },
  }
}

export const adBody = (ad, { adSetId, creativeId }) => ({
  name: ad.nombre,
  adset_id: adSetId,
  creative: { creative_id: creativeId },
  status: 'PAUSED',
})

/** La campaña en el Administrador de anuncios. */
export function adsManagerLink(account, campaignId, businessId) {
  const url = new URL('https://adsmanager.facebook.com/adsmanager/manage/campaigns')
  url.searchParams.set('act', account.replace(/^act_/, ''))
  if (businessId) url.searchParams.set('business_id', businessId)
  url.searchParams.set('selected_campaign_ids', campaignId)
  return url.href
}

// ── Lo que llega de Meta: las campañas en marcha ──

/** Las conversaciones de WhatsApp (y de Messenger o Instagram) que ha empezado alguien desde el anuncio. */
const CONVERSATIONS = 'onsite_conversion.messaging_conversation_started_7d'

const past = (time, now) => Boolean(time) && Date.parse(time) < now
const future = (time, now) => Boolean(time) && Date.parse(time) > now

/** Los conjuntos que gastarían con la campaña activa: activos y sin terminar. */
const liveAdSets = (campaign, now) => (campaign.adsets?.data ?? []).filter((s) => s.status === 'ACTIVE' && !past(s.end_time, now))

/** Lo que pasa de verdad con la campaña (aunque esté activa, puede no estar gastando), en pocas palabras. */
export function deliveryOf(campaign, now = Date.now()) {
  if (campaign.effective_status === 'PAUSED') return { texto: 'En pausa', tono: 'off' }
  if (campaign.effective_status === 'IN_PROCESS') return { texto: 'Procesando', tono: 'off' }
  if (campaign.effective_status === 'WITH_ISSUES') return { texto: 'Con problemas', tono: 'warning' }
  const adSets = campaign.adsets?.data ?? []
  if (past(campaign.stop_time, now) || (adSets.length && adSets.every((s) => past(s.end_time, now)))) {
    return { texto: 'Terminada', tono: 'off' }
  }
  const live = liveAdSets(campaign, now)
  if (adSets.length && !live.length) return { texto: 'Conjuntos en pausa', tono: 'warning' }
  if (live.some((s) => ['WITH_ISSUES', 'DISAPPROVED'].includes(s.effective_status))) return { texto: 'Con problemas', tono: 'warning' }
  if (live.length && live.every((s) => future(s.start_time, now))) return { texto: 'Programada', tono: 'off' }
  if (live.length && live.every((s) => ['PENDING_REVIEW', 'IN_PROCESS', 'PREAPPROVED'].includes(s.effective_status))) {
    return { texto: 'En revisión', tono: 'off' }
  }
  return { texto: 'Activa', tono: 'ok' }
}

/** El presupuesto de la campaña o, si va en los conjuntos, la suma de los que gastarían. */
export function budgetOf(campaign, currency, now = Date.now()) {
  const amount = (value) => Number(value) || 0
  if (amount(campaign.daily_budget)) return { cantidad: majorUnits(campaign.daily_budget, currency), tipo: 'dia' }
  if (amount(campaign.lifetime_budget)) return { cantidad: majorUnits(campaign.lifetime_budget, currency), tipo: 'total' }
  const live = liveAdSets(campaign, now)
  const daily = live.reduce((sum, s) => sum + amount(s.daily_budget), 0)
  if (daily) return { cantidad: majorUnits(daily, currency), tipo: 'dia' }
  const total = live.reduce((sum, s) => sum + amount(s.lifetime_budget), 0)
  return total ? { cantidad: majorUnits(total, currency), tipo: 'total' } : null
}

/**
 * Cada campaña con lo que ha gastado y las conversaciones que ha traído en el periodo (de `insights`, por
 * campaña). Primero las activas, de más a menos gasto; luego las que están en pausa, las más recientes antes.
 */
export function campaignRows(campaigns, insights, { account, currency, businessId = null, now = Date.now() }) {
  const stats = new Map(insights.map((row) => [String(row.campaign_id), row]))
  const rows = campaigns.map((campaign) => {
    const row = stats.get(String(campaign.id))
    const gasto = Number(row?.spend) || 0
    const conversaciones = Number(row?.actions?.find((a) => a.action_type === CONVERSATIONS)?.value) || 0
    return {
      id: String(campaign.id),
      nombre: campaign.name ?? String(campaign.id),
      estado: campaign.status === 'ACTIVE' ? 'activa' : 'pausada',
      entrega: deliveryOf(campaign, now),
      presupuesto: budgetOf(campaign, currency, now),
      gasto,
      conversaciones,
      coste: conversaciones ? gasto / conversaciones : null,
      enlace: adsManagerLink(account, String(campaign.id), businessId),
      actualizada: campaign.updated_time ? new Date(Date.parse(campaign.updated_time)).toISOString() : null,
    }
  })
  return rows.sort(
    (a, b) =>
      (a.estado === 'pausada') - (b.estado === 'pausada') ||
      (a.estado === 'activa' ? b.gasto - a.gasto : 0) ||
      (b.actualizada ?? '').localeCompare(a.actualizada ?? ''),
  )
}

// ── Lo que llega de la app ──

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
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
    ubicaciones: ['auto', 'facebook', 'instagram'].includes(raw?.ubicaciones) ? raw.ubicaciones : 'auto',
    texto: text(raw?.texto, 3000),
    titular: text(raw?.titular, 255),
    saludo: text(raw?.saludo, 500),
  }
}

export function cleanPlan(raw) {
  const plan = {
    ...cleanSettings(raw),
    nombre: text(raw?.nombre, 200),
    plantilla: text(raw?.plantilla, 120) || null,
    inicio: DAY.test(raw?.inicio ?? '') ? raw.inicio : null,
    fin: DAY.test(raw?.fin ?? '') ? raw.fin : null,
    anuncios: (Array.isArray(raw?.anuncios) ? raw.anuncios : []).slice(0, 50).map((ad, i) => {
      const medio = ad?.medio
      const clean =
        medio?.tipo === 'imagen' && /^[a-f0-9]{8,64}$/i.test(medio.hash ?? '')
          ? { tipo: 'imagen', hash: medio.hash }
          : medio?.tipo === 'video' && id(medio.id)
            ? { tipo: 'video', id: medio.id }
            : null
      if (!clean) throw new HttpError(400, `Al anuncio ${i + 1} le falta la imagen o el vídeo.`)
      return { nombre: text(ad.nombre, 200) || `Anuncio ${i + 1}`, medio: clean }
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

/**
 * Crea la campaña, el conjunto y un anuncio por imagen o vídeo, todo en pausa, y lo apunta. Si algo falla a
 * medias, borra la campaña recién creada (con lo que cuelga de ella) para no dejar nada a medio hacer.
 */
export async function launch(meta, raw, options = {}) {
  const plan = cleanPlan(raw)
  const account = await meta.graph(plan.cuenta, { params: { fields: 'name,currency,business{id}' } })
  const thumbs = new Map()
  for (const ad of plan.anuncios) {
    if (ad.medio.tipo === 'video' && !thumbs.has(ad.medio.id)) {
      thumbs.set(ad.medio.id, await videoThumbnail(meta, plan.cuenta, ad.medio.id, options))
    }
  }

  const campaign = await meta.graph(`${plan.cuenta}/campaigns`, { method: 'POST', body: campaignBody(plan) })
  try {
    const adSet = await meta.graph(`${plan.cuenta}/adsets`, {
      method: 'POST',
      body: adSetBody(plan, { campaignId: campaign.id, currency: account.currency }),
    })
    const ads = []
    for (const ad of plan.anuncios) {
      const creative = await meta.graph(`${plan.cuenta}/adcreatives`, {
        method: 'POST',
        body: creativeBody(plan, ad, { thumbnailHash: thumbs.get(ad.medio.id) }),
      })
      const created = await meta.graph(`${plan.cuenta}/ads`, { method: 'POST', body: adBody(ad, { adSetId: adSet.id, creativeId: creative.id }) })
      ads.push(String(created.id))
    }
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
      estado: 'pausada',
      enlace: adsManagerLink(plan.cuenta, String(campaign.id), account.business?.id),
    }
    await changeAds((data) => {
      data.lanzamientos = [record, ...data.lanzamientos].slice(0, KEEP_LAUNCHES)
    })
    return record
  } catch (err) {
    const removed = await meta.graph(String(campaign.id), { method: 'DELETE' }).then(
      () => true,
      () => false,
    )
    const why = err?.message ?? String(err)
    throw new HttpError(
      err?.status ?? 502,
      removed
        ? `${why} (No se ha creado nada.)`
        : `${why} (Ha quedado la campaña «${plan.nombre}» en pausa y a medias: bórrala en el Administrador de anuncios.)`,
      err?.code,
    )
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
 * Pausa o activa cualquier campaña de la cuenta (el interruptor de «En marcha»). Si se creó desde Tablero, se
 * apunta también en su registro.
 */
export async function setCampaignStatus(meta, raw) {
  const campaignId = typeof raw?.id === 'string' && /^\d{1,32}$/.test(raw.id) ? raw.id : null
  if (!campaignId) throw new HttpError(400, 'Campaña no válida')
  if (!['activa', 'pausada'].includes(raw?.estado)) throw new HttpError(400, 'Estado no válido')
  const record = (await readAds()).lanzamientos.find((l) => l.campana === campaignId) ?? null
  if (record && raw.estado === 'activa') return { id: campaignId, estado: 'activa', lanzamiento: await activate(meta, record.id) }
  await meta.graph(campaignId, { method: 'POST', body: { status: raw.estado === 'activa' ? 'ACTIVE' : 'PAUSED' } })
  if (!record) return { id: campaignId, estado: raw.estado, lanzamiento: null }
  const lanzamiento = await changeAds((data) => {
    const found = data.lanzamientos.find((l) => l.id === record.id) ?? { ...record }
    found.estado = 'pausada'
    found.activada = everActivated(found)
    return found
  })
  return { id: campaignId, estado: 'pausada', lanzamiento }
}
