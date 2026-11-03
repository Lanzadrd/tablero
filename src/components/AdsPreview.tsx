import { useEffect, useRef, useState, type ReactNode } from 'react'
import { buttonLabel, GREETING, hostOf, type AdSettings, type MetaPage } from '../ads'
import { versionFor, type Formato } from '../placements'
import { useStoredState } from '../util'
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

/** Quien pide menos movimiento los ve parados hasta que los ponga en marcha. */
const LESS_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Lo que comparten los vídeos de las vistas previas: si están parados y si suena este (solo uno, o se oirían a la vez). */
interface Player {
  paused: boolean
  sound: boolean
  onPause: () => void
  onSound: () => void
}

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
  const [paused, setPaused] = useStoredState('tablero.anuncios.vista.parada', LESS_MOTION)
  const [sounding, setSounding] = useState<Kind | null>(null)
  const draft = drafts.find((d) => d.key === chosen) ?? drafts[0] ?? null
  const name = page?.nombre ?? 'Tu página'
  const instagram = page?.instagrams.find((i) => i.id === settings.instagram)?.usuario ?? name
  const text = settings.texto.trim() || 'Aquí va el texto principal.'
  const title = settings.titular.trim()
  const description = settings.descripcion.trim()
  // Lo que se lee en el botón y de dónde: la web o WhatsApp.
  const web = settings.destino === 'web'
  const button = web ? buttonLabel(settings.boton) : 'Enviar mensaje de WhatsApp'
  const bar = web ? { domain: hostOf(settings.url) || 'tu-web.com', button: buttonLabel(settings.boton) } : { domain: 'WhatsApp', button: 'Enviar mensaje' }

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
            const player: Player = {
              paused,
              sound: sounding === m.kind,
              onPause: () => setPaused(!paused),
              // Para oírlo tiene que estar en marcha.
              onSound: () => {
                setSounding(sounding === m.kind ? null : m.kind)
                if (sounding !== m.kind) setPaused(false)
              },
            }
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
                    <MockMedia creative={creative} ratio={feedRatio(creative)} player={player} />
                    <CtaBar title={title} description={description} {...bar} />
                  </article>
                )}

                {m.kind === 'instagram' && (
                  <article className="ads-mock ads-mock-feed">
                    <MockHeader name={instagram} photo={page?.foto ?? null} />
                    <MockMedia creative={creative} ratio={feedRatio(creative)} player={player} />
                    <div className="ads-mock-ig-cta">
                      {button} <span aria-hidden="true">›</span>
                    </div>
                    <p className="ads-mock-text is-clamped-2">
                      <strong>{instagram}</strong> {text}
                    </p>
                  </article>
                )}

                {m.kind === 'story' && (
                  <article className="ads-mock ads-mock-story">
                    <MockMedia creative={creative} ratio={RATIO['9:16']} fit={!own} player={player} />
                    <div className="ads-mock-story-top">
                      <MockHeader name={instagram} photo={page?.foto ?? null} />
                    </div>
                    <div className="ads-mock-story-bottom">
                      <p className="ads-mock-text is-clamped-2">{text}</p>
                      <span className="ads-mock-button is-wide">{button}</span>
                    </div>
                  </article>
                )}

                {m.kind === 'wide' && (
                  <article className="ads-mock ads-mock-feed">
                    <MockHeader name={name} photo={page?.foto ?? null} />
                    <p className="ads-mock-text is-clamped-2">{text}</p>
                    <MockMedia creative={creative} ratio={RATIO['16:9']} fit={!own || formato !== '16:9'} player={player} />
                    <CtaBar title={title} description={description} {...bar} />
                  </article>
                )}
              </figure>
            )
          })}
        </div>
      )}

      {web ? (
        <p className="ads-mock-chat">
          <span>Al tocar, se abre:</span> {settings.url.trim() || 'tu web'}
        </p>
      ) : (
        <p className="ads-mock-chat">
          <span>Al tocar, WhatsApp abre con:</span> «{settings.bienvenida.trim() || GREETING}»
        </p>
      )}
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

function CtaBar({ title, description, domain, button }: { title: string; description: string; domain: string; button: string }) {
  return (
    <div className="ads-mock-cta-bar">
      <div className="ads-mock-cta-text">
        <span className="ads-mock-domain">{domain}</span>
        {title && <strong>{title}</strong>}
        {description && <span>{description}</span>}
      </div>
      <span className="ads-mock-button">{button}</span>
    </div>
  )
}

/**
 * La imagen o el vídeo en un marco con la proporción de la ubicación. `fit`: si no es de ese formato, va entera en el
 * centro sobre ella misma desenfocada (como hace Meta en Stories y Reels).
 */
function MockMedia({ creative, ratio, fit = false, player }: { creative: Creative | undefined; ratio: number; fit?: boolean; player: Player }) {
  if (!creative) {
    return (
      <div className="ads-mock-media is-empty" style={{ aspectRatio: ratio }}>
        Sube una imagen o un vídeo
      </div>
    )
  }
  const media = (className?: string, sound = false) =>
    creative.tipo === 'imagen' ? (
      <img className={className} src={creative.preview} alt="" referrerPolicy="no-referrer" />
    ) : (
      <MockVideo className={className} src={creative.preview} paused={player.paused} sound={sound} />
    )
  return (
    <div className="ads-mock-media" style={{ aspectRatio: ratio }}>
      {fit && media('is-backdrop')}
      {media(fit ? 'is-contained' : undefined, player.sound)}
      {creative.tipo === 'video' && (
        <div className="ads-video-controls">
          <VideoButton label={player.paused ? 'Poner los vídeos en marcha' : 'Parar los vídeos'} onClick={player.onPause}>
            {player.paused ? <Icon.Play /> : <Icon.Pause />}
          </VideoButton>
          <VideoButton label={player.sound ? 'Quitar el sonido' : 'Poner el sonido'} onClick={player.onSound}>
            {player.sound ? <Icon.SoundOn /> : <Icon.SoundOff />}
          </VideoButton>
        </div>
      )}
    </div>
  )
}

function VideoButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="ads-video-btn" aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  )
}

/** Un vídeo que va o se para con los demás. Si no se ve (más abajo, o con el formulario oculto), se para y deja de sonar. */
function MockVideo({ src, className, paused, sound }: { src: string; className?: string; paused: boolean; sound: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [seen, setSeen] = useState(true)

  useEffect(() => {
    if (!ref.current) return
    const observer = new IntersectionObserver(([entry]) => setSeen(entry.isIntersecting))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const video = ref.current
    if (!video) return
    if (paused || !seen) video.pause()
    // Si no llega a arrancar, se queda en su primer fotograma.
    else video.play().catch(() => {})
  }, [paused, seen, src])

  return <video ref={ref} className={className} src={src} muted={!sound} loop playsInline preload="metadata" />
}
