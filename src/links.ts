// Enlaces dentro del texto de las tareas. Solo http y https: nunca javascript:, data:,
// file: ni otros esquemas. Sin dependencias, para poder probarlo con Node tal cual.

export interface Link {
  /** Dirección normalizada (segura para un href). */
  url: string
  /** El texto tal cual estaba escrito. */
  raw: string
  /** Dominio sin «www.»: «github.com». */
  domain: string
}

export type Segment = { text: string; link?: undefined } | { text: string; link: Link }

/** Candidatos: desde «http(s)://» hasta un espacio o algo que no puede ir en una URL. */
const CANDIDATE = /\bhttps?:\/\/[^\s<>"'`«»]+/gi
const CLOSING: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
const PUNCTUATION = '.,;:!?…\'"’”'

const count = (text: string, ch: string) => text.split(ch).length - 1

/** Quita la puntuación de detrás («…mira https://x.com.»), salvo paréntesis que abren dentro. */
function trimEnd(raw: string) {
  let end = raw.length
  while (end > 0) {
    const ch = raw[end - 1]
    const open = CLOSING[ch]
    if (open) {
      const body = raw.slice(0, end)
      if (count(body, open) >= count(body, ch)) break
    } else if (!PUNCTUATION.includes(ch)) break
    end--
  }
  return raw.slice(0, end)
}

/** Un enlace válido a partir de un texto, o null. */
export function toLink(raw: string): Link | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null
  return { url: url.href, raw, domain: url.hostname.replace(/^www\./i, '') }
}

/** Parte un texto en trozos de texto y enlaces, en orden. */
export function splitLinks(text: string): Segment[] {
  const segments: Segment[] = []
  let last = 0
  for (const match of text.matchAll(CANDIDATE)) {
    const raw = trimEnd(match[0])
    const link = toLink(raw)
    if (!link) continue
    const start = match.index ?? 0
    if (start > last) segments.push({ text: text.slice(last, start) })
    segments.push({ text: raw, link })
    last = start + raw.length
  }
  if (last < text.length) segments.push({ text: text.slice(last) })
  return segments
}

/** Los enlaces de uno o varios textos, sin repetir. */
export function findLinks(...texts: string[]): Link[] {
  const seen = new Map<string, Link>()
  for (const text of texts)
    for (const segment of splitLinks(text)) if (segment.link && !seen.has(segment.link.url)) seen.set(segment.link.url, segment.link)
  return [...seen.values()]
}

/** El texto sin los enlaces (para donde no caben las píldoras). */
export const withoutLinks = (text: string) =>
  splitLinks(text)
    .filter((s) => !s.link)
    .map((s) => s.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()

/** Si el texto es solo una URL, ese enlace. */
export function onlyLink(text: string): Link | null {
  const trimmed = text.trim()
  const segments = splitLinks(trimmed)
  return segments.length === 1 && segments[0].link && segments[0].text === trimmed ? segments[0].link : null
}

function safeDecode(text: string) {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** «github.com/org/repo/pull/12»: dominio y ruta, recortado a `max` caracteres. */
export function linkText(link: Link, max = 80) {
  const path = safeDecode(new URL(link.url).pathname).replace(/\/+$/, '')
  const text = `${link.domain}${path}`
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
