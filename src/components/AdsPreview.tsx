import { useState } from 'react'
import { GREETING, type AdSettings, type MetaPage } from '../ads'
import { versionFor, type Formato } from '../placements'
import { Avatar } from './Ads'
import { formatOfCreative, type Creative, type Draft } from './AdsMedia'
import { chosenKeys, type PlacementMode } from './AdsPlacements'
import * as Icon from './Icons'

type Kind = 'facebook' | 'instagram' | 'story' | 'wide'

/** Cada vista previa: dónde sale, el marco que tiene y los formatos que le van (el mejor primero). */
const MOCKS: Array<{
  kind: Kind
  title: string
  where: string
  frame: Formato
  formats: Formato[]
  places: string[]
}> = [
  {
    kind: 'facebook',
    title: 'Feed de Facebook',
    where: 'También perfil, Marketplace y búsqueda',
    frame: '4:5',
    formats: ['4:5', '1:1'],
    places: ['fb_feed', 'fb_profile', 'fb_marketplace', 'fb_search', 'fb_notification'],
  },
  {
    kind: 'instagram',
    title: 'Feed de Instagram',
    where: 'También perfil, Explorar y búsqueda',
    frame: '4:5',
    formats: ['4:5', '1:1'],
    places: ['ig_feed', 'ig_profile', 'ig_explore_home', 'ig_search'],
  },
  {
    kind: 'story',
    title: 'Stories y Reels',
    where: 'Facebook, Instagram, Messenger y Estados de WhatsApp',
    frame: '9:16',
    formats: ['9:16'],
    places: ['fb_story', 'fb_reels', 'ig_story', 'ig_reels', 'ig_profile_reels', 'ms_story', 'wa_status'],
  },
  {
    kind: 'wide',
    title: 'Horizontal',
    where: 'Vídeos in-stream y columna derecha de Facebook',
    frame: '16:9',
    formats: ['16:9', '1:1'],
    places: ['fb_instream', 'fb_right'],
  },
]

const RATIO: Record<Formato, number> = {
  '4:5': 4 / 5,
  '1:1': 1,
  '9:16': 9 / 16,
  '16:9': 16 / 9,
}

/**
 * Cómo se verá el anuncio en el feed de Facebook, en el de Instagram, en Stories y Reels y en horizontal, todas a la
 * vez, con lo escrito y la versión que le toca a cada sitio. Con ubicaciones elegidas, solo las que salen.
 * Aproximada: Meta cambia detalles según el móvil.
 */
export function AdPreview({
  settings,
  page,
  drafts,
  placements,
}: {
  settings: AdSettings
  page: MetaPage | null
  drafts: Draft[]
  placements?: { ubicaciones: PlacementMode; posiciones: string[] } | null
}) {
  const [chosen, setChosen] = useState<string | null>(null)
  const draft = drafts.find((d) => d.key === chosen) ?? drafts[0] ?? null
  const name = page?.nombre ?? 'Tu página'
  const instagram = page?.instagrams.find((i) => i.id === settings.instagram)?.usuario ?? name
  const text = settings.texto.trim() || 'Aquí va el texto principal.'
  const title = settings.titular.trim()
  const description = settings.descripcion.trim()

  const mode = placements?.ubicaciones ?? settings.ubicaciones
  const selected = mode === 'auto' || mode === 'meta' ? null : new Set(chosenKeys(mode, placements?.posiciones ?? settings.posiciones))
  const video = draft?.items[0]?.tipo === 'video'
  // Las de solo vídeo no cuentan con imágenes.
  const mocks = MOCKS.filter((m) => !selected || m.places.some((p) => selected.has(p) && (video || p !== 'fb_instream')))

  const formats = draft?.items.map(formatOfCreative) ?? []
  const versionIn = (m: (typeof MOCKS)[number]) => {
    const formato = versionFor({ formats: m.formats }, formats)
    return {
      formato,
      creative: draft?.items.find((c) => formatOfCreative(c) === formato),
    }
  }

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

      {mocks.length === 0 ? (
        <p className="ads-note">Elige alguna ubicación para ver cómo queda.</p>
      ) : (
        <div className="ads-preview-grid">
          {mocks.map((m) => {
            const { formato, creative } = versionIn(m)
            const own = formato !== null && m.formats.includes(formato)
            return (
              <figure key={m.kind} className="ads-preview-item">
                <figcaption>
                  <span className="ads-preview-title">
                    {m.title} <span className="ads-format">{m.frame}</span>
                  </span>
                  <span className="ads-preview-where">{m.where}</span>
                  {creative && (
                    <span className={own ? 'ads-preview-fit is-ok' : 'ads-preview-fit'}>
                      {own ? (
                        <>
                          <Icon.Check /> Usa la {formato}
                        </>
                      ) : (
                        `Sin versión ${m.formats.join(' ni ')}: Meta adapta la ${formato}`
                      )}
                    </span>
                  )}
                </figcaption>

                {m.kind === 'facebook' && (
                  <article className="ads-mock ads-mock-feed">
                    <MockHeader name={name} photo={page?.foto ?? null} />
                    <p className="ads-mock-text is-clamped">{text}</p>
                    <MockMedia creative={creative} ratio={feedRatio(creative)} />
                    <CtaBar title={title} description={description} />
                  </article>
                )}

                {m.kind === 'instagram' && (
                  <article className="ads-mock ads-mock-feed">
                    <MockHeader name={instagram} photo={page?.foto ?? null} />
                    <MockMedia creative={creative} ratio={feedRatio(creative)} />
                    <div className="ads-mock-ig-cta">
                      Enviar mensaje de WhatsApp <span aria-hidden="true">›</span>
                    </div>
                    <p className="ads-mock-text is-clamped-2">
                      <strong>{instagram}</strong> {text}
                    </p>
                  </article>
                )}

                {m.kind === 'story' && (
                  <article className="ads-mock ads-mock-story">
                    <MockMedia creative={creative} ratio={RATIO['9:16']} fit={!own} />
                    <div className="ads-mock-story-top">
                      <MockHeader name={instagram} photo={page?.foto ?? null} />
                    </div>
                    <div className="ads-mock-story-bottom">
                      <p className="ads-mock-text is-clamped-2">{text}</p>
                      <span className="ads-mock-button is-wide">Enviar mensaje de WhatsApp</span>
                    </div>
                  </article>
                )}

                {m.kind === 'wide' && (
                  <article className="ads-mock ads-mock-feed">
                    <MockHeader name={name} photo={page?.foto ?? null} />
                    <p className="ads-mock-text is-clamped-2">{text}</p>
                    <MockMedia creative={creative} ratio={RATIO['16:9']} fit={!own || formato !== '16:9'} />
                    <CtaBar title={title} description={description} />
                  </article>
                )}
              </figure>
            )
          })}
        </div>
      )}

      <p className="ads-mock-chat">
        <span>Al tocar, WhatsApp abre con:</span> «{settings.bienvenida.trim() || GREETING}»
      </p>
      <p className="ads-note">Aproximada: Meta ajusta el diseño según el móvil y la ubicación.</p>
    </div>
  )
}

/** En el feed, Meta enseña de 4:5 (la vertical, recortada) a 1,91:1. */
const feedRatio = (c: Creative | undefined) => Math.min(Math.max(c?.ratio ?? 4 / 5, 0.8), 1.91)

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

function CtaBar({ title, description }: { title: string; description: string }) {
  return (
    <div className="ads-mock-cta-bar">
      <div className="ads-mock-cta-text">
        <span className="ads-mock-domain">WhatsApp</span>
        {title && <strong>{title}</strong>}
        {description && <span>{description}</span>}
      </div>
      <span className="ads-mock-button">Enviar mensaje</span>
    </div>
  )
}

/**
 * La imagen o el vídeo en un marco con la proporción de la ubicación. `fit`: si no es de ese formato, va entera en el
 * centro sobre ella misma desenfocada (como hace Meta en Stories y Reels).
 */
function MockMedia({ creative, ratio, fit = false }: { creative: Creative | undefined; ratio: number; fit?: boolean }) {
  if (!creative) {
    return (
      <div className="ads-mock-media is-empty" style={{ aspectRatio: ratio }}>
        Sube una imagen o un vídeo
      </div>
    )
  }
  const media = (className?: string) =>
    creative.tipo === 'imagen' ? (
      <img className={className} src={creative.preview} alt="" referrerPolicy="no-referrer" />
    ) : (
      <video className={className} src={creative.preview} muted loop playsInline autoPlay />
    )
  return (
    <div className="ads-mock-media" style={{ aspectRatio: ratio }}>
      {fit && media('is-backdrop')}
      {media(fit ? 'is-contained' : undefined)}
    </div>
  )
}
