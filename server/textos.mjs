// Los textos de un anuncio escritos por Claude: texto principal, título, descripción y el chat de WhatsApp, a
// partir de las imágenes, la página, el público y lo que se le cuente. La clave de la API de Claude se guarda en
// datos/claude.json (solo en este Mac, permisos 600); sin ella, la del entorno (ANTHROPIC_API_KEY) o la de
// «ant auth login».
import Anthropic from '@anthropic-ai/sdk'
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DATA_DIR, HttpError } from './almacen.mjs'
import { MAX_QUESTIONS } from './anuncios.mjs'

const CLAUDE_FILE = path.join(DATA_DIR, 'claude.json')
const MODEL = 'claude-opus-5-5'
const MAX_IMAGES = 6
/** Cada imagen, en base64 (el navegador las manda ya reducidas). */
const MAX_IMAGE_CHARS = 2_000_000

/** Lo que Claude tiene que devolver, campo a campo (los límites de largo se piden en el texto). */
const COPY = betaJSONSchemaOutputFormat({
  type: 'object',
  properties: {
    texto: { type: 'string', description: 'Texto principal: lo que se lee encima de la imagen.' },
    titular: { type: 'string', description: 'Título: debajo de la imagen, junto al botón. Muy corto.' },
    descripcion: { type: 'string', description: 'Descripción: debajo del título. Muy corta.' },
    bienvenida: { type: 'string', description: 'Mensaje de la empresa: lo primero que ve la persona en el chat de WhatsApp.' },
    saludo: { type: 'string', description: 'Mensaje de la persona, ya escrito en WhatsApp para que lo envíe.' },
    preguntas: { type: 'array', items: { type: 'string' }, description: 'Preguntas frecuentes que la persona puede tocar para enviarlas.' },
  },
  required: ['texto', 'titular', 'descripcion', 'bienvenida', 'saludo', 'preguntas'],
  additionalProperties: false,
})

const SYSTEM = `Escribes los textos de anuncios de Meta (Facebook e Instagram) que llevan a una conversación de WhatsApp con la empresa.

Escribe en el español de donde se anuncia: en Paraguay, Argentina y Uruguay, con voseo («escribinos», «reservá», «sumate»); en España, con tuteo. Si los textos que ya hay usan otra variante, sigue esa.

- Texto principal: empieza con una primera línea que enganche (es lo que se ve antes de «Ver más»), luego lo esencial de la oferta y una llamada a escribir por WhatsApp. Entre 1 y 4 frases cortas; puede ir en líneas separadas. Emojis con moderación (como mucho tres).
- Título: hasta 40 caracteres. Descripción: hasta 30 caracteres.
- Chat de WhatsApp: el mensaje de la empresa es un saludo breve y cálido que invita a preguntar (hasta 200 caracteres). El mensaje de la persona va en primera persona, natural y corto (hasta 80 caracteres), como lo escribiría alguien interesado. Las preguntas frecuentes, de 3 a ${MAX_QUESTIONS}, también en boca de la persona y de hasta 80 caracteres.

No inventes precios, fechas, horarios, direcciones, porcentajes ni promesas que no estén en las imágenes, en las indicaciones o en los textos que ya hay. Si falta un dato, escribe sin él. Nada de hashtags.`

// ── La clave ──

async function readKey() {
  try {
    return JSON.parse(await readFile(CLAUDE_FILE, 'utf8')).clave ?? null
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw new HttpError(500, `${CLAUDE_FILE} no se puede leer.`)
  }
}

/** Si hay con qué llamar a Claude (la clave guardada o una del entorno). */
export async function claudeStatus() {
  return { clave: Boolean((await readKey()) || process.env.ANTHROPIC_API_KEY) }
}

/** Guarda la clave de la API (o la borra, con una vacía). Nunca vuelve a la web. */
export async function saveClaudeKey(raw) {
  const key = typeof raw === 'string' ? raw.trim() : ''
  if (key && !/^sk-ant-[\w-]{20,}$/.test(key)) throw new HttpError(400, 'Eso no parece una clave de la API de Claude (empieza por «sk-ant-»).')
  await mkdir(DATA_DIR, { recursive: true })
  const tmp = `${CLAUDE_FILE}.tmp`
  await writeFile(tmp, `${JSON.stringify(key ? { clave: key } : {}, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await chmod(tmp, 0o600)
  await rename(tmp, CLAUDE_FILE)
  return claudeStatus()
}

/** El cliente: con la clave guardada o, sin ella, con lo que haya en el entorno. */
async function defaultClient() {
  const key = await readKey()
  try {
    return key ? new Anthropic({ apiKey: key }) : new Anthropic()
  } catch {
    throw new HttpError(400, 'Falta la clave de la API de Claude.', 'claude-sin-clave')
  }
}

// ── Lo que llega de la app ──

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

function cleanRequest(raw) {
  const images = (Array.isArray(raw?.imagenes) ? raw.imagenes : [])
    .filter((i) => i?.media_type === 'image/jpeg' && typeof i.data === 'string' && i.data.length <= MAX_IMAGE_CHARS && /^[A-Za-z0-9+/=]+$/.test(i.data))
    .slice(0, MAX_IMAGES)
  const lugares = (Array.isArray(raw?.lugares) ? raw.lugares : []).map((l) => text(l, 120)).filter(Boolean).slice(0, 20)
  const request = {
    images,
    indicaciones: text(raw?.indicaciones, 2000),
    pagina: text(raw?.pagina, 200),
    instagram: text(raw?.instagram, 100),
    lugares,
    actuales: {
      texto: text(raw?.actuales?.texto, 3000),
      titular: text(raw?.actuales?.titular, 255),
      descripcion: text(raw?.actuales?.descripcion, 255),
      bienvenida: text(raw?.actuales?.bienvenida, 500),
      saludo: text(raw?.actuales?.saludo, 500),
      preguntas: (Array.isArray(raw?.actuales?.preguntas) ? raw.actuales.preguntas : []).map((q) => text(q, 80)).filter(Boolean),
    },
  }
  const hasText = Object.values(request.actuales).some((v) => (Array.isArray(v) ? v.length : v))
  if (!images.length && !request.indicaciones && !hasText) {
    throw new HttpError(400, 'Sube una imagen o cuenta de qué va el anuncio para que Claude tenga de dónde sacar los textos.')
  }
  return request
}

/** Lo que se le cuenta a Claude, en texto, después de las imágenes. */
function brief(r) {
  const lines = [
    r.pagina && `Página que anuncia: ${r.pagina}${r.instagram ? ` (Instagram @${r.instagram})` : ''}`,
    r.lugares.length && `Se anuncia en: ${r.lugares.join('; ')}`,
    r.indicaciones && `Indicaciones:\n${r.indicaciones}`,
  ]
  const now = Object.entries(r.actuales).filter(([, v]) => (Array.isArray(v) ? v.length : v))
  if (now.length) {
    lines.push(`Lo que ya hay escrito (mejóralo y respeta sus datos):\n${now.map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(' | ') : v}`).join('\n')}`)
  }
  lines.push(r.images.length ? `Las imágenes de arriba son las del anuncio (${r.images.length}).` : 'No hay imágenes: escribe a partir de lo anterior.')
  return lines.filter(Boolean).join('\n\n')
}

const clip = (value, max) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value)

// ── Escribir ──

/**
 * Pide los textos a Claude Opus 5.5 con salida JSON validada. Si sus filtros de seguridad lo rechazaran, la API lo
 * reintenta con el modelo que recomienda Anthropic (`fallbacks: "default"`). `options.claude`: el cliente (en las
 * pruebas, uno de mentira).
 */
export async function writeCopy(raw, options = {}) {
  const request = cleanRequest(raw)
  const client = options.claude ?? (await defaultClient())
  let response
  try {
    response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: COPY },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            ...request.images.map((image) => ({ type: 'image', source: { type: 'base64', media_type: image.media_type, data: image.data } })),
            { type: 'text', text: brief(request) },
          ],
        },
      ],
    })
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new HttpError(400, 'La clave de la API de Claude no vale (¿caducada o borrada?). Pon otra.', 'claude-clave')
    }
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, 'Claude está saturado ahora mismo: prueba en un momento.')
    if (err instanceof Anthropic.APIConnectionError) throw new HttpError(502, 'No se ha podido hablar con Claude. ¿Hay conexión a internet?')
    if (err instanceof Anthropic.APIError) throw new HttpError(502, `Claude ha dado un error: ${err.message}`)
    if (err instanceof Anthropic.AnthropicError) throw new HttpError(400, 'Falta la clave de la API de Claude.', 'claude-sin-clave')
    throw err
  }
  if (response.stop_reason === 'refusal') throw new HttpError(422, 'Claude no ha querido escribir este anuncio. Cambia las indicaciones y prueba otra vez.')
  const copy = response.parsed_output
  if (!copy) throw new HttpError(502, 'Claude no ha devuelto los textos completos. Prueba otra vez.')
  return {
    texto: clip(copy.texto.trim(), 3000),
    titular: clip(copy.titular.trim(), 255),
    descripcion: clip(copy.descripcion.trim(), 255),
    bienvenida: clip(copy.bienvenida.trim(), 500),
    saludo: clip(copy.saludo.trim(), 500),
    preguntas: copy.preguntas.map((q) => clip(q.trim(), 80)).filter(Boolean).slice(0, MAX_QUESTIONS),
  }
}
