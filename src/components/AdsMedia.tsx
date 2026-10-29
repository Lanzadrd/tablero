import { adNameFrom, type Media } from '../ads'
import { formatOf, type Formato } from '../placements'
import * as Icon from './Icons'

/** Una imagen o un vídeo elegido para los anuncios. */
export interface Creative {
  key: string
  file: File
  tipo: 'imagen' | 'video'
  preview: string
  /** Ya subida a esta cuenta (si algo falla después, no se vuelve a subir). */
  medio: Media | null
  /** Ancho entre alto; null si no se ha podido medir. */
  ratio: number | null
}

/** Un anuncio: una imagen o un vídeo, o varias versiones de la misma pieza (1:1, 4:5, 9:16, 16:9), cada una en sus ubicaciones. */
export interface Draft {
  key: string
  nombre: string
  /** De una a cuatro, cada una de un formato; la del feed (la que va en el resto de ubicaciones) primero. */
  items: Creative[]
}

/** El formato de una versión (si no se ha podido medir, el del feed). */
export const formatOfCreative = (c: Creative): Formato => formatOf(c.ratio) ?? '4:5'
const ORDER: Formato[] = ['4:5', '1:1', '9:16', '16:9']
const byFormat = (a: Creative, b: Creative) => ORDER.indexOf(formatOfCreative(a)) - ORDER.indexOf(formatOfCreative(b))

/** Más estrecha que esto (9:16 y parecidas) es vertical: la de Stories, Reels y Estados. */
const VERTICAL = 0.7
export const isVertical = (c: Creative) => c.ratio !== null && c.ratio < VERTICAL

const RATIOS: Array<[string, number]> = [
  ['9:16', 9 / 16],
  ['4:5', 4 / 5],
  ['1:1', 1],
  ['16:9', 16 / 9],
  ['1,91:1', 1.91],
]

/** «9:16», «4:5»… (el formato estándar más cercano), o null si no se parece a ninguno. */
export function ratioLabel(ratio: number | null) {
  if (ratio === null) return null
  const [label, value] = RATIOS.reduce((best, r) => (Math.abs(r[1] - ratio) < Math.abs(best[1] - ratio) ? r : best))
  return Math.abs(value - ratio) / value < 0.06 ? label : null
}

/** Ancho entre alto de una imagen o un vídeo (null si el navegador no sabe abrirlo). */
export async function measure(file: File, tipo: Creative['tipo'], preview: string): Promise<number | null> {
  try {
    if (tipo === 'imagen') {
      const bitmap = await createImageBitmap(file)
      const ratio = bitmap.width / bitmap.height
      bitmap.close()
      return ratio
    }
    return await new Promise<number | null>((resolve) => {
      const video = document.createElement('video')
      const done = (value: number | null) => {
        clearTimeout(timer)
        video.removeAttribute('src')
        resolve(value)
      }
      const timer = setTimeout(() => done(null), 8000)
      video.preload = 'metadata'
      video.onloadedmetadata = () => done(video.videoHeight ? video.videoWidth / video.videoHeight : null)
      video.onerror = () => done(null)
      video.src = preview
    })
  } catch {
    return null
  }
}

/**
 * Una imagen pequeña (JPEG de hasta 1024 px, en base64) de una imagen o del primer segundo de un vídeo, para que
 * Claude vea el anuncio; null si el navegador no sabe abrirla.
 */
export async function snapshot(c: Creative): Promise<string | null> {
  try {
    const source: CanvasImageSource =
      c.tipo === 'imagen'
        ? await createImageBitmap(c.file)
        : await new Promise<HTMLVideoElement>((resolve, reject) => {
            const video = document.createElement('video')
            video.muted = true
            video.preload = 'auto'
            video.onloadedmetadata = () => {
              video.currentTime = Math.min(1, (video.duration || 0) / 2)
            }
            video.onseeked = () => resolve(video)
            video.onerror = () => reject(new Error('vídeo'))
            video.src = c.preview
          })
    const [w, h] = source instanceof HTMLVideoElement ? [source.videoWidth, source.videoHeight] : [(source as ImageBitmap).width, (source as ImageBitmap).height]
    const scale = Math.min(1, 1024 / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height)
    if (source instanceof ImageBitmap) source.close()
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1] ?? null
  } catch {
    return null
  }
}

// Lo que dice el formato en el nombre del archivo («2_9_16», «verano-story», «1080x1920», «(1)»).
const SEP = '[\\s_x×:-]*'
const RATIO_IN_NAME = new RegExp(
  `(?<!\\d)(?:9${SEP}16|4${SEP}5|1${SEP}1|16${SEP}9|2${SEP}3|1[.,]91${SEP}1|\\d{3,4}\\s*[x×]\\s*\\d{3,4})(?!\\d)`,
  'gi',
)
const FORMAT_WORDS = /\b(?:stor(?:y|ies)|historias?|reels?|feed|vertical|cuadrad[oa]|square|post)\b/gi

/** El nombre sin lo que dice del formato: «2_9_16» y «2_4_5 (1)» → «2». */
export function baseName(name: string) {
  return name
    .replace(/\(\d+\)/g, ' ')
    .replace(RATIO_IN_NAME, ' ')
    .replace(FORMAT_WORDS, ' ')
    .replace(/[\s_.-]+/g, ' ')
    .trim()
}

/** ¿Pueden ser versiones de la misma pieza? Del mismo tipo, medidas, y sin repetir formato (como mucho cuatro). */
export function fits(a: Draft, b: Draft) {
  const all = [...a.items, ...b.items]
  if (all.length > ORDER.length || all.some((c) => c.ratio === null || c.tipo !== all[0].tipo)) return false
  return new Set(all.map(formatOfCreative)).size === all.length
}

/** Todas en un anuncio, la del feed primero, con el nombre sin el formato. */
function join(a: Draft, b: Draft): Draft {
  return { key: a.key, nombre: baseName(a.nombre) || a.nombre, items: [...a.items, ...b.items].sort(byFormat) }
}

/** Junta `b` con `a` en el sitio del que va antes en la lista. */
export function joinIn(list: Draft[], a: Draft, b: Draft) {
  const [first, second] = list.indexOf(a) <= list.indexOf(b) ? [a, b] : [b, a]
  return list.flatMap((d) => (d === first ? [join(first, second)] : d === second ? [] : [d]))
}

/**
 * Los anuncios con los nuevos al final. Cada nuevo se junta con las otras versiones de su pieza (las del mismo
 * nombre sin el formato); y si al final solo quedan dos sueltos que encajan, también (lo normal: subir las dos).
 */
export function addDrafts(list: Draft[], added: Draft[]) {
  let all = [...list, ...added]
  for (const draft of added) {
    const current = all.find((d) => d.key === draft.key)
    const name = baseName(draft.nombre).toLowerCase()
    if (!current || !name) continue
    const partner = all.find((d) => d !== current && fits(d, current) && baseName(d.nombre).toLowerCase() === name)
    if (partner) all = joinIn(all, partner, current)
  }
  const loose = all.filter((d) => d.items.length === 1)
  const isNew = new Set(added.map((d) => d.key))
  if (loose.length === 2 && fits(loose[0], loose[1]) && loose.some((d) => isNew.has(d.key))) all = joinIn(all, loose[0], loose[1])
  return all
}

/** Separa las versiones en anuncios sueltos, cada uno con el nombre de su archivo. */
export const split = (list: Draft[], draft: Draft) =>
  list.flatMap((d) => (d === draft ? d.items.map((c) => ({ key: crypto.randomUUID(), nombre: adNameFrom(c.file.name), items: [c] })) : [d]))

/** Las imágenes y vídeos elegidos, un anuncio por fila: con sus formatos al lado del nombre. */
export function MediaList({ drafts, busy, onChange }: { drafts: Draft[]; busy: boolean; onChange: (drafts: Draft[]) => void }) {
  const remove = (draft: Draft) => {
    draft.items.forEach((c) => URL.revokeObjectURL(c.preview))
    onChange(drafts.filter((d) => d !== draft))
  }
  return (
    <ul className="ads-creatives">
      {drafts.map((d) => {
        const partners = drafts.filter((o) => o !== d && fits(o, d))
        const formats = d.items.map(formatOfCreative)
        return (
          <li key={d.key} className="ads-creative">
            <div className="ads-creative-media">
              {d.items.map((c) => (
                <Thumb key={c.key} creative={c} />
              ))}
            </div>
            <div className="ads-creative-body">
              <span className="ads-creative-title">
                <input
                  className="input ads-creative-name"
                  aria-label={`Nombre del anuncio de ${d.items.map((c) => c.file.name).join(', ')}`}
                  value={d.nombre}
                  disabled={busy}
                  onChange={(e) => onChange(drafts.map((x) => (x === d ? { ...x, nombre: e.target.value } : x)))}
                />
                <span className="ads-formats" aria-label={`Formatos: ${formats.join(', ')}`}>
                  {formats.map((f) => (
                    <span key={f} className="ads-format">
                      {f}
                    </span>
                  ))}
                </span>
              </span>
              <p className="ads-creative-note">
                {d.items.length > 1 ? (
                  <>
                    Cada versión va en sus ubicaciones; la {formats[0]}, en las demás.
                    <button type="button" className="link-btn" disabled={busy} onClick={() => onChange(split(drafts, d))}>
                      Separar
                    </button>
                  </>
                ) : d.items[0].ratio === null ? (
                  'No se ha podido ver su formato: sale igual en todas las ubicaciones.'
                ) : (
                  'Sale en todas las ubicaciones (Meta la recorta donde no encaje). Sube otros formatos de la misma pieza para cada sitio.'
                )}
                {partners.length > 0 && (
                  <select
                    className="input ads-join"
                    aria-label={`Juntar «${d.nombre}» con otra versión de la misma pieza`}
                    value=""
                    disabled={busy}
                    onChange={(e) => {
                      const partner = partners.find((p) => p.key === e.target.value)
                      if (partner) onChange(joinIn(drafts, d, partner))
                    }}
                  >
                    <option value="">Juntar con otra versión…</option>
                    {partners.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.nombre} ({p.items.map(formatOfCreative).join(', ')})
                      </option>
                    ))}
                  </select>
                )}
              </p>
            </div>
            <button type="button" className="icon-btn" aria-label={`Quitar «${d.nombre}»`} disabled={busy} onClick={() => remove(d)}>
              <Icon.Close />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Thumb({ creative: c }: { creative: Creative }) {
  const label = ratioLabel(c.ratio)
  return (
    <div className="ads-thumb">
      {c.tipo === 'imagen' ? <img src={c.preview} alt="" /> : <video src={c.preview} muted preload="metadata" />}
      <span className="ads-thumb-kind" aria-hidden="true">
        {c.tipo === 'imagen' ? <Icon.Image /> : <Icon.Video />}
      </span>
      {label && <span className="ads-thumb-ratio">{label}</span>}
    </div>
  )
}
