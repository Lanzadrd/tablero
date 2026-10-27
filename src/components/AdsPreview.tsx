import { useState } from 'react'
import { GREETING, type AdSettings, type MetaPage } from '../ads'
import { Avatar } from './Ads'
import { isVertical, type Creative, type Draft } from './AdsMedia'
import { Segmented } from './Segmented'

type Format = 'facebook' | 'instagram' | 'vertical'
const FORMATS: Array<{ value: Format; label: string }> = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'vertical', label: 'Stories y Reels' },
]

/** En el feed, Meta enseña de 4:5 (la vertical, recortada) a 1,91:1. */
const feedRatio = (c: Creative | undefined) => Math.min(Math.max(c?.ratio ?? 1, 0.8), 1.91)

/**
 * Cómo se verá el anuncio en el feed de Facebook, en el de Instagram y en Stories y Reels, con lo escrito y las
 * imágenes elegidas (en cada sitio, la versión que le toca). Aproximada: Meta cambia detalles según el móvil.
 */
export function AdPreview({ settings, page, drafts }: { settings: AdSettings; page: MetaPage | null; drafts: Draft[] }) {
  const [format, setFormat] = useState<Format>('facebook')
  const [chosen, setChosen] = useState<string | null>(null)
  const draft = drafts.find((d) => d.key === chosen) ?? drafts[0] ?? null
  const feed = draft?.items[0]
  const vertical = draft?.items.find(isVertical) ?? feed
  const name = page?.nombre ?? 'Tu página'
  const instagram = page?.instagrams.find((i) => i.id === settings.instagram)?.usuario ?? name
  const text = settings.texto.trim() || 'Aquí va el texto principal.'
  const title = settings.titular.trim()
  const description = settings.descripcion.trim()

  return (
    <div className="ads-preview">
      <div className="ads-preview-head">
        <h4>Vista previa</h4>
        {drafts.length > 1 && (
          <select className="input" aria-label="Anuncio de la vista previa" value={draft?.key ?? ''} onChange={(e) => setChosen(e.target.value)}>
            {drafts.map((d) => (
              <option key={d.key} value={d.key}>
                {d.nombre}
              </option>
            ))}
          </select>
        )}
      </div>
      <Segmented value={format} options={FORMATS} label="Formato de la vista previa" onChange={setFormat} />

      {format === 'facebook' && (
        <article className="ads-mock ads-mock-feed">
          <MockHeader name={name} photo={page?.foto ?? null} />
          <p className="ads-mock-text is-clamped">{text}</p>
          <MockMedia creative={feed} ratio={feedRatio(feed)} />
          <div className="ads-mock-cta-bar">
            <div className="ads-mock-cta-text">
              <span className="ads-mock-domain">WhatsApp</span>
              {title && <strong>{title}</strong>}
              {description && <span>{description}</span>}
            </div>
            <span className="ads-mock-button">Enviar mensaje</span>
          </div>
        </article>
      )}

      {format === 'instagram' && (
        <article className="ads-mock ads-mock-feed">
          <MockHeader name={instagram} photo={page?.foto ?? null} />
          <MockMedia creative={feed} ratio={feedRatio(feed)} />
          <div className="ads-mock-ig-cta">
            Enviar mensaje de WhatsApp <span aria-hidden="true">›</span>
          </div>
          <p className="ads-mock-text is-clamped-2">
            <strong>{instagram}</strong> {text}
          </p>
        </article>
      )}

      {format === 'vertical' && (
        <article className="ads-mock ads-mock-story">
          <MockMedia creative={vertical} ratio={9 / 16} fill />
          <div className="ads-mock-story-top">
            <MockHeader name={instagram} photo={page?.foto ?? null} />
          </div>
          <div className="ads-mock-story-bottom">
            <p className="ads-mock-text is-clamped-2">{text}</p>
            <span className="ads-mock-button is-wide">Enviar mensaje de WhatsApp</span>
          </div>
        </article>
      )}

      <p className="ads-mock-chat">
        <span>Al tocar, WhatsApp abre con:</span> «{settings.bienvenida.trim() || GREETING}»
      </p>
      <p className="ads-note">Aproximada: Meta ajusta el diseño según el móvil y la ubicación.</p>
    </div>
  )
}

function MockHeader({ name, photo }: { name: string; photo: string | null }) {
  return (
    <div className="ads-mock-header">
      <Avatar name={name} src={photo} />
      <div>
        <strong>{name}</strong>
        <span>Publicidad</span>
      </div>
    </div>
  )
}

/**
 * La imagen o el vídeo en un marco con la proporción de la ubicación. `fill`: en Stories y Reels, si no es vertical,
 * va entera en el centro sobre ella misma desenfocada (como hace Meta).
 */
function MockMedia({ creative, ratio, fill = false }: { creative: Creative | undefined; ratio: number; fill?: boolean }) {
  if (!creative) {
    return (
      <div className="ads-mock-media is-empty" style={{ aspectRatio: ratio }}>
        Sube una imagen o un vídeo
      </div>
    )
  }
  const contain = fill && !isVertical(creative)
  const media = (className?: string) =>
    creative.tipo === 'imagen' ? (
      <img className={className} src={creative.preview} alt="" />
    ) : (
      <video className={className} src={creative.preview} muted loop playsInline autoPlay />
    )
  return (
    <div className="ads-mock-media" style={{ aspectRatio: ratio }}>
      {contain && media('is-backdrop')}
      {media(contain ? 'is-contained' : undefined)}
    </div>
  )
}
