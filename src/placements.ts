// Los formatos de las versiones de un anuncio y las ubicaciones que se eligen en Tablero, con el tamaño que les va
// (como server/anuncios.mjs, que dice a Meta qué versión va en cada una).

/** El formato de una versión, por su proporción. */
export type Formato = '4:5' | '1:1' | '9:16' | '16:9'

export const FORMATOS: Array<{ value: Formato; label: string; size: string; where: string }> = [
  { value: '4:5', label: 'Feed', size: '1080 × 1350', where: 'Feeds de Facebook e Instagram' },
  { value: '1:1', label: 'Cuadrada', size: '1080 × 1080', where: 'Marketplace, búsqueda, columna derecha, Messenger' },
  { value: '9:16', label: 'Vertical', size: '1080 × 1920', where: 'Stories y Reels' },
  { value: '16:9', label: 'Horizontal', size: '1920 × 1080', where: 'Vídeos in-stream y columna derecha' },
]

/** La versión que va en el resto de ubicaciones: la del feed, si la hay. */
const FALLBACK: Formato[] = ['4:5', '1:1', '16:9', '9:16']

/** El formato más cercano a una proporción (ancho entre alto); null si no se sabe. */
export function formatOf(ratio: number | null): Formato | null {
  if (!ratio) return null
  return ratio < 0.7 ? '9:16' : ratio < 0.9 ? '4:5' : ratio < 1.25 ? '1:1' : '16:9'
}

export interface Placement {
  key: string
  label: string
  /** Los que le van, el mejor primero. */
  formats: Formato[]
  /** Solo admite vídeos. */
  video?: boolean
  /** La que Meta pide junto a esta (los Estados de WhatsApp, con Instagram Stories). */
  needs?: string
}

/** Las ubicaciones que se pueden elegir en un anuncio a WhatsApp (las mismas claves que el servidor). */
export const PLACEMENT_GROUPS: Array<{ label: string; items: Placement[] }> = [
  {
    label: 'Facebook',
    items: [
      { key: 'fb_feed', label: 'Feed', formats: ['4:5', '1:1'] },
      { key: 'fb_profile', label: 'Perfil', formats: ['4:5', '1:1'] },
      { key: 'fb_marketplace', label: 'Marketplace', formats: ['1:1', '4:5'] },
      { key: 'fb_search', label: 'Resultados de búsqueda', formats: ['1:1', '4:5'] },
      { key: 'fb_right', label: 'Columna derecha', formats: ['1:1', '16:9'] },
      { key: 'fb_notification', label: 'Notificaciones', formats: ['1:1'] },
      { key: 'fb_story', label: 'Stories', formats: ['9:16'] },
      { key: 'fb_reels', label: 'Reels', formats: ['9:16'] },
      { key: 'fb_instream', label: 'Vídeos in-stream', formats: ['16:9', '1:1'], video: true },
    ],
  },
  {
    label: 'Instagram',
    items: [
      { key: 'ig_feed', label: 'Feed', formats: ['4:5', '1:1'] },
      { key: 'ig_profile', label: 'Perfil', formats: ['4:5', '1:1'] },
      { key: 'ig_explore_home', label: 'Explorar', formats: ['1:1', '4:5'] },
      { key: 'ig_search', label: 'Resultados de búsqueda', formats: ['4:5', '1:1'] },
      { key: 'ig_story', label: 'Stories', formats: ['9:16'] },
      { key: 'ig_reels', label: 'Reels', formats: ['9:16'] },
      { key: 'ig_profile_reels', label: 'Reels del perfil', formats: ['9:16'] },
    ],
  },
  {
    label: 'Messenger',
    items: [
      { key: 'ms_inbox', label: 'Bandeja de entrada', formats: ['1:1'] },
      { key: 'ms_story', label: 'Stories', formats: ['9:16'] },
    ],
  },
  {
    label: 'WhatsApp',
    items: [{ key: 'wa_status', label: 'Estados', formats: ['9:16'], needs: 'ig_story' }],
  },
]

export const ALL_PLACEMENTS = PLACEMENT_GROUPS.flatMap((g) => g.items)

/** La versión que va en una ubicación (la primera de sus formatos que haya); si ninguna, la del resto. */
export function versionFor(placement: Pick<Placement, 'formats'>, available: Formato[]): Formato | null {
  return placement.formats.find((f) => available.includes(f)) ?? FALLBACK.find((f) => available.includes(f)) ?? null
}

/** ¿Tiene una versión hecha para esta ubicación? */
export const fits = (placement: Placement, available: Formato[]) => placement.formats.some((f) => available.includes(f))

/** «4:5 o 1:1». */
export const formatsText = (formats: Formato[]) => formats.join(' o ')
