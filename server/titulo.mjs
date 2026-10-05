// Título de la página de un enlace pegado en una tarea.
//
// El servidor pide la página en nombre de la app, así que se protege contra SSRF: solo
// http/https y solo direcciones públicas (se comprueba la IP a la que de verdad se conecta,
// también en cada redirección), como mucho 3 redirecciones, 3 s y 1 MB. Los enlaces de
// GitHub se leen con la CLI «gh» si está instalada (así sirven también los repos privados).
import { execFile } from 'node:child_process'
import { lookup as dnsLookup } from 'node:dns'
import { access, constants } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream'
import { promisify } from 'node:util'
import zlib from 'node:zlib'

const run = promisify(execFile)
const TIMEOUT = 3000
const MAX_BYTES = 1024 * 1024
const MAX_REDIRECTS = 3
const GH_TIMEOUT = 5000
const CACHE_SIZE = 200
const MAX_TITLE = 300

/** code: 'url-no-valida' | 'direccion-no-permitida' | 'demasiadas-redirecciones' | 'tiempo-agotado' | 'no-se-pudo-leer' */
export class TitleError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

// ── Direcciones permitidas ──

const v4Bytes = (ip) => ip.split('.').map(Number)

function v6Bytes(ip) {
  // La IPv4 del final («::ffff:1.2.3.4») pasa a dos grupos hexadecimales.
  const text = ip.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/, (_, a, b, c, d) => `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`)
  const [head, tail] = text.split('::')
  const h = head ? head.split(':') : []
  const t = tail === undefined ? null : tail ? tail.split(':') : []
  const groups = t === null ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t]
  return groups.flatMap((g) => {
    const n = parseInt(g, 16)
    return [n >> 8, n & 0xff]
  })
}

function cidr(text) {
  const [ip, bits] = text.split('/')
  return { bytes: net.isIPv4(ip) ? v4Bytes(ip) : v6Bytes(ip), bits: Number(bits) }
}

function inRange(bytes, { bytes: base, bits }) {
  for (let i = 0; i < bits; i += 8) {
    const take = Math.min(8, bits - i)
    const mask = (0xff << (8 - take)) & 0xff
    if ((bytes[i / 8] & mask) !== (base[i / 8] & mask)) return false
  }
  return true
}

const V4_BLOCKED = [
  '0.0.0.0/8', // «esta red»
  '10.0.0.0/8', // privada
  '100.64.0.0/10', // CGNAT
  '127.0.0.0/8', // loopback
  '169.254.0.0/16', // link-local
  '172.16.0.0/12', // privada
  '192.0.0.0/24', // asignaciones del IETF
  '192.0.2.0/24', // documentación
  '192.88.99.0/24', // relé 6to4
  '192.168.0.0/16', // privada
  '198.18.0.0/15', // pruebas de rendimiento
  '198.51.100.0/24', // documentación
  '203.0.113.0/24', // documentación
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reservada y difusión
].map(cidr)

const V6_BLOCKED = [
  '::/8', // sin especificar, loopback, IPv4 compatibles y traducidas
  '64:ff9b:1::/48', // NAT64 local
  '100::/64', // descarte
  '2001::/23', // asignaciones del IETF (Teredo…)
  '2001:db8::/32', // documentación
  '2002::/16', // 6to4
  '3fff::/20', // documentación
  'fc00::/7', // locales únicas
  'fe80::/10', // link-local
  'fec0::/10', // site-local
  'ff00::/8', // multicast
].map(cidr)
const MAPPED = cidr('::ffff:0:0/96')
const NAT64 = cidr('64:ff9b::/96')

/** ¿Es una IP pública a la que se puede llamar? (IPv4 e IPv6, incluidas las IPv4 dentro de IPv6) */
export function isPublicAddress(ip) {
  const clean = String(ip).replace(/^\[|\]$/g, '').replace(/%.*$/, '')
  const kind = net.isIP(clean)
  if (kind === 4) {
    const bytes = v4Bytes(clean)
    return !V4_BLOCKED.some((range) => inRange(bytes, range))
  }
  if (kind !== 6) return false
  const bytes = v6Bytes(clean)
  if (inRange(bytes, MAPPED) || inRange(bytes, NAT64)) return isPublicAddress(bytes.slice(12).join('.'))
  return !V6_BLOCKED.some((range) => inRange(bytes, range))
}

/** Un `lookup` para http.request que solo deja conectar a direcciones permitidas. */
function guardedLookup(lookup, allow) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') [callback, options] = [options, {}]
    lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err)
      const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: net.isIP(addresses) }]
      if (!list.length || !list.every((a) => allow(a.address))) {
        return callback(new TitleError('direccion-no-permitida', `${hostname} apunta a una dirección no permitida`))
      }
      if (options.all) callback(null, list)
      else callback(null, list[0].address, list[0].family)
    })
  }
}

// ── Página web ──

function parseUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2048) throw new TitleError('url-no-valida', 'Enlace no válido')
  let url
  try {
    url = new URL(raw.trim())
  } catch {
    throw new TitleError('url-no-valida', 'Enlace no válido')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TitleError('url-no-valida', 'Solo enlaces http o https')
  if (url.username || url.password) throw new TitleError('url-no-valida', 'Enlace con usuario o contraseña')
  url.hash = ''
  return url
}

const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Tablero',
  accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
  'accept-language': 'es-ES,es;q=0.9,en;q=0.8',
  'accept-encoding': 'gzip, deflate, br',
}

function request(url, { lookup, allow, signal }) {
  const host = url.hostname.replace(/^\[|\]$/g, '')
  // Una IP escrita en el enlace no pasa por `lookup`: se comprueba aquí.
  if (net.isIP(host) && !allow(host)) {
    return Promise.reject(new TitleError('direccion-no-permitida', `${host} es una dirección no permitida`))
  }
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http
    const req = client.request(url, { agent: false, headers: HEADERS, lookup: guardedLookup(lookup, allow), signal })
    req.on('response', resolve)
    req.on('error', reject)
    req.end()
  })
}

function decompressor(encoding) {
  if (encoding === 'gzip' || encoding === 'x-gzip') return zlib.createGunzip()
  if (encoding === 'deflate') return zlib.createInflate()
  if (encoding === 'br') return zlib.createBrotliDecompress()
  return null
}

/**
 * Lee como mucho `max` bytes (ya descomprimidos), o hasta el final de <head>. Con pipeline (y no
 * pipe), si la respuesta se corta o se aborta por tiempo, el descompresor también, y la lectura
 * termina en vez de quedarse esperando para siempre.
 */
async function readBody(res, max) {
  const unzip = decompressor(String(res.headers['content-encoding'] ?? '').trim().toLowerCase())
  const stream = unzip ? pipeline(res, unzip, () => {}) : res
  const chunks = []
  let size = 0
  try {
    for await (const chunk of stream) {
      chunks.push(chunk)
      size += chunk.length
      if (size >= max || /<\/head\s*>/i.test(chunk.toString('latin1'))) break
    }
  } catch (err) {
    if (!size) throw err // Si se corta a medias, vale lo leído.
  } finally {
    res.destroy()
    if (stream !== res) stream.destroy()
  }
  return Buffer.concat(chunks).subarray(0, max)
}

function decode(buffer, contentType) {
  const charset =
    /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(buffer.subarray(0, 4096).toString('latin1'))?.[1]
  try {
    return new TextDecoder(charset || 'utf-8').decode(buffer)
  } catch {
    return new TextDecoder('utf-8').decode(buffer)
  }
}

async function htmlTitle(start, { lookup, allow, timeout, maxBytes }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    let url = start
    for (let redirects = 0; ; redirects++) {
      const res = await request(url, { lookup, allow, signal: controller.signal })
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.destroy()
        if (redirects >= MAX_REDIRECTS) throw new TitleError('demasiadas-redirecciones', 'Demasiadas redirecciones')
        url = parseUrl(new URL(res.headers.location, url).href)
        continue
      }
      if (status < 200 || status >= 300) {
        res.destroy()
        throw new TitleError('no-se-pudo-leer', `La página responde ${status}`)
      }
      const type = String(res.headers['content-type'] ?? '')
      if (type && !/html|xml/i.test(type)) {
        res.destroy()
        return null
      }
      return extractTitle(decode(await readBody(res, maxBytes), type))
    }
  } catch (err) {
    if (err instanceof TitleError) throw err
    if (controller.signal.aborted) throw new TitleError('tiempo-agotado', 'La página tarda demasiado')
    throw new TitleError('no-se-pudo-leer', `No se pudo leer la página (${err.code ?? err.message})`)
  } finally {
    clearTimeout(timer)
  }
}

// ── Extraer el título ──

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  middot: '·', bull: '•', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', yen: '¥', cent: '¢',
  iexcl: '¡', iquest: '¿', ordf: 'ª', ordm: 'º', deg: '°', times: '×', divide: '÷', sect: '§', para: '¶',
  szlig: 'ß', aring: 'å', Aring: 'Å', aelig: 'æ', AElig: 'Æ', oslash: 'ø', Oslash: 'Ø', ccedil: 'ç', Ccedil: 'Ç',
}
const ACCENTS = { acute: '́', grave: '̀', circ: '̂', uml: '̈', tilde: '̃' }
for (const letter of 'aeiouyAEIOUYnN') {
  for (const [name, mark] of Object.entries(ACCENTS)) {
    const composed = (letter + mark).normalize('NFC')
    if (composed.length === 1) NAMED[letter + name] = composed
  }
}

/** Decodifica entidades HTML: con nombre (las habituales) y numéricas. */
export function decodeEntities(text) {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z][a-z0-9]*));?/gi, (match, dec, hex, name) => {
    if (name) return match.endsWith(';') ? (NAMED[name] ?? match) : match
    const code = dec ? parseInt(dec, 10) : parseInt(hex, 16)
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : match
  })
}

/** Una línea, sin espacios de más y no demasiado larga. */
function squash(text) {
  if (typeof text !== 'string') return null
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return null
  const chars = Array.from(clean)
  return chars.length > MAX_TITLE ? `${chars.slice(0, MAX_TITLE - 1).join('').trimEnd()}…` : clean
}

// El HTML llega de cualquier web: todo lo que sigue es lineal (ninguna expresión vuelve a recorrer
// el resto del texto desde cada «<» sin cerrar, que con 1 MB de «<!--» bloquearía el servidor).

/** Una etiqueta <meta> más larga que esto no es un título: se salta. */
const MAX_TAG = 8 * 1024

/** Atributos de una etiqueta: nombre (sin mayúsculas) → valor. El primero de cada nombre gana. */
function attributes(tag) {
  const out = {}
  // Cada vuelta consume al menos el nombre, y el valor entre comillas acaba en la comilla siguiente.
  for (const m of tag.matchAll(/([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = m[1].toLowerCase()
    if (!(name in out)) out[name] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return out
}

/** El HTML con las letras ASCII en minúsculas, para buscar etiquetas (mismas posiciones que el original). */
const lowered = (html) => html.replace(/[A-Z]+/g, (m) => m.toLowerCase())

const HIDDEN = [
  ['<!--', '-->'],
  ['<script', '</script'],
  ['<style', '</style'],
]

/**
 * Sin comentarios ni <script>/<style>; lo que queda abierto sin cerrar se corta ahí. Cada
 * apertura y cada cierre se buscan una sola vez hacia delante.
 */
function stripHidden(html) {
  const text = lowered(html)
  const next = HIDDEN.map(([open]) => text.indexOf(open))
  const parts = []
  let pos = 0
  for (;;) {
    let k = -1
    for (let i = 0; i < HIDDEN.length; i++) {
      if (next[i] !== -1 && next[i] < pos) next[i] = text.indexOf(HIDDEN[i][0], pos)
      if (next[i] !== -1 && (k === -1 || next[i] < next[k])) k = i
    }
    if (k === -1) break
    const start = next[k]
    const [open, close] = HIDDEN[k]
    // «<scripts>» no es «<script>».
    if (k > 0 && !/[\s/>]/.test(text[start + open.length] ?? '')) {
      next[k] = text.indexOf(open, start + 1)
      continue
    }
    parts.push(html.slice(pos, start))
    const end = text.indexOf(close, start + open.length)
    const gt = end === -1 ? -1 : k === 0 ? end + close.length - 1 : text.indexOf('>', end)
    if (gt === -1) return parts.join('') // sin cerrar: el resto no cuenta
    pos = gt + 1
  }
  parts.push(html.slice(pos))
  return parts.join('')
}

/** og:title, twitter:title o <title>, el primero que haya. */
export function extractTitle(html) {
  const page = stripHidden(html)
  const text = lowered(page)
  let og = null
  let twitter = null
  for (let pos = text.indexOf('<meta'); pos !== -1; ) {
    const end = text.indexOf('>', pos)
    if (end === -1) break // sin cerrar: no hay más etiquetas
    if (end - pos <= MAX_TAG && /[\s/>]/.test(text[pos + 5])) {
      const attrs = attributes(page.slice(pos + 5, end))
      const key = String(attrs.property ?? attrs.name ?? '').toLowerCase()
      if (key === 'og:title') og ??= attrs.content ?? null
      else if (key === 'twitter:title') twitter ??= attrs.content ?? null
    }
    pos = text.indexOf('<meta', end + 1)
  }
  let title = null
  const open = text.search(/<title[\s>]/)
  const start = open === -1 ? -1 : text.indexOf('>', open)
  const end = start === -1 ? -1 : text.indexOf('</title', start)
  if (end !== -1) title = page.slice(start + 1, end)
  for (const candidate of [og, twitter, title]) {
    const clean = candidate === null ? null : squash(decodeEntities(candidate))
    if (clean) return clean
  }
  return null
}

// ── GitHub ──

/** {kind: 'pr'|'issue'|'repo', owner, repo, number?} para enlaces de GitHub; si no, null. */
export function githubRef(url) {
  if (!/^(www\.)?github\.com$/i.test(url.hostname)) return null
  const [owner, repo, kind, number] = url.pathname.split('/').filter(Boolean)
  if (!owner || !repo || !/^[A-Za-z0-9-]+$/.test(owner) || !/^[\w.-]+$/.test(repo) || /^\.+$/.test(repo)) return null
  const name = repo.replace(/\.git$/i, '')
  if (kind === 'pull' && /^\d+$/.test(number ?? '')) return { kind: 'pr', owner, repo: name, number: Number(number) }
  if (kind === 'issues' && /^\d+$/.test(number ?? '')) return { kind: 'issue', owner, repo: name, number: Number(number) }
  if (!kind) return { kind: 'repo', owner, repo: name }
  return null
}

const ghDirs = () => [
  ...(process.env.PATH ?? '').split(path.delimiter).filter((dir) => path.isAbsolute(dir)),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  path.join(os.homedir(), '.local', 'bin'),
]

/** Ruta de la CLI de GitHub, o null. (Bajo launchd el PATH es mínimo: se mira también donde suele instalarse.) */
export async function findGh(dirs = ghDirs()) {
  for (const dir of dirs) {
    const file = path.join(dir, 'gh')
    try {
      await access(file, constants.X_OK)
      return file
    } catch {}
  }
  return null
}

async function githubTitle(ref, gh) {
  const bin = await gh()
  if (!bin) return null
  const base = `repos/${ref.owner}/${ref.repo}`
  const endpoint = ref.kind === 'repo' ? base : `${base}/${ref.kind === 'pr' ? 'pulls' : 'issues'}/${ref.number}`
  const { stdout } = await run(bin, ['api', endpoint], {
    timeout: GH_TIMEOUT,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' },
  })
  const data = JSON.parse(stdout)
  if (ref.kind === 'repo') {
    const name = squash(data.full_name) ?? `${ref.owner}/${ref.repo}`
    const about = squash(data.description)
    return about ? `${name} · ${about}` : name
  }
  const title = squash(data.title)
  if (!title) return null
  const label = ref.kind === 'pr' || data.pull_request ? 'PR' : 'Issue'
  return `${label} #${ref.number} · ${title} (${ref.owner}/${ref.repo})`
}

// ── Todo junto, con caché ──

const cache = new Map()

/**
 * Título del enlace (o null si la página no tiene). Lanza TitleError si no se puede leer.
 * Las opciones solo hacen falta en las pruebas.
 */
export async function pageTitle(
  raw,
  { lookup = dnsLookup, allow = isPublicAddress, gh = findGh, timeout = TIMEOUT, maxBytes = MAX_BYTES, memo = cache } = {},
) {
  const url = parseUrl(raw)
  const key = url.href
  if (memo.has(key)) {
    const title = memo.get(key)
    memo.delete(key)
    memo.set(key, title)
    return title
  }
  const ref = githubRef(url)
  const title = (ref && (await githubTitle(ref, gh).catch(() => null))) || (await htmlTitle(url, { lookup, allow, timeout, maxBytes }))
  if (title) {
    memo.set(key, title)
    while (memo.size > CACHE_SIZE) memo.delete(memo.keys().next().value)
  }
  return title
}
