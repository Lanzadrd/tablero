import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import {
  adNameFrom,
  automaticSummary,
  budgetText,
  campaignName,
  DEFAULT_SETTINGS,
  ENHANCEMENTS,
  GREETING,
  MAX_QUESTIONS,
  metaApi,
  missing,
  money,
  sameSettings,
  settingsOf,
  uploadMedia,
  type AdAccount,
  type AdRow,
  type AdSettings,
  type Copy,
  type Enhancement,
  type Gender,
  type Launch,
  type Media,
  type MetaPage,
  type NewAdSet,
  type Place,
  type Placements,
  type Template,
} from '../ads'
import { formatWhen } from '../dates'
import { cx } from '../util'
import { errorText } from './Ads'
import * as Icon from './Icons'
import { CopyButton } from './AdsCopy'
import { addDrafts, measure, MediaList, snapshot, type Creative, type Draft } from './AdsMedia'
import { AdPreview } from './AdsPreview'
import { Popover } from './Popover'
import { Switch } from './Switch'

/** Lo que admite Meta: imágenes de hasta 30 MB y vídeos de hasta 1 GB (subida simple). */
const MAX_IMAGE = 30 * 1024 * 1024
const MAX_VIDEO = 1024 * 1024 * 1024

type Phase =
  | { kind: 'idle' }
  | { kind: 'uploading'; done: number; total: number }
  | { kind: 'creating' }
  | { kind: 'done'; launch: Launch }

const GENDERS: Array<{ value: Gender; label: string }> = [
  { value: 'todos', label: 'Todos' },
  { value: 'mujeres', label: 'Mujeres' },
  { value: 'hombres', label: 'Hombres' },
]

/** Cómo empieza la persona en el chat: con su mensaje ya escrito o tocando una pregunta. */
const CHAT_STARTS: Array<{ value: AdSettings['tipoMensaje']; label: string }> = [
  { value: 'escrito', label: 'Mensaje ya escrito' },
  { value: 'preguntas', label: 'Preguntas frecuentes' },
]

const PLACEMENTS: Array<{ value: Placements; label: string }> = [
  { value: 'auto', label: 'Automáticas' },
  { value: 'facebook', label: 'Solo Facebook' },
  { value: 'instagram', label: 'Solo Instagram' },
]

/** La plantilla elegida al entrar en la cuenta: la última usada en ella, si sigue existiendo. */
const lastTemplateKey = (account: string) => `tablero.anuncios.plantilla.${account}`

function readLastTemplate(account: string) {
  try {
    return localStorage.getItem(lastTemplateKey(account))
  } catch {
    return null
  }
}

function writeLastTemplate(account: string, id: string | null) {
  try {
    if (id) localStorage.setItem(lastTemplateKey(account), id)
    else localStorage.removeItem(lastTemplateKey(account))
  } catch {
    // Sin almacenamiento: no se recuerda.
  }
}

/** La campaña (que ya existe) en la que se crea un conjunto. */
export interface AdSetTarget {
  id: string
  nombre: string
  /** El suyo, si lo tiene (`reparte`: entonces el conjunto no lleva). */
  presupuesto: AdRow['presupuesto']
  /** La página de sus conjuntos. */
  pagina: string | null
}

/**
 * Nueva campaña de mensajes a WhatsApp en una cuenta publicitaria: las opciones (de una plantilla o a mano),
 * las imágenes o vídeos (uno por anuncio) y «Crear en pausa». Debajo, las últimas creadas en la cuenta.
 * Con `adSetIn`, lo mismo para un conjunto nuevo en esa campaña.
 */
export function AdsComposer({
  account,
  templates: allTemplates,
  launches,
  onTemplates,
  onLaunch,
  adSetIn = null,
  onCancel,
  onAdSet,
}: {
  account: AdAccount
  templates: Template[]
  launches: Launch[]
  onTemplates: (templates: Template[]) => Promise<Template[]>
  onLaunch: (launch: Launch) => void
  adSetIn?: AdSetTarget | null
  onCancel?: () => void
  onAdSet?: (adSet: NewAdSet) => void
}) {
  const ids = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  /** Las opciones de la plantilla; en una campaña, con la página de sus conjuntos (y su Instagram, después). */
  const startFrom = (t: Template | null): AdSettings => {
    const base = { ...(t ? settingsOf(t) : DEFAULT_SETTINGS), cuenta: account.id }
    return adSetIn?.pagina && base.pagina !== adSetIn.pagina ? { ...base, pagina: null, instagram: null } : base
  }
  const shared = adSetIn?.presupuesto?.reparte ? adSetIn.presupuesto : null
  // Las plantillas de esta cuenta y las que no son de ninguna.
  const templates = useMemo(() => allTemplates.filter((t) => !t.cuenta || t.cuenta === account.id), [allTemplates, account.id])
  const [templateId, setTemplateId] = useState<string | null>(() => {
    const last = readLastTemplate(account.id)
    return templates.some((t) => t.id === last) ? last : null
  })
  const template = templates.find((t) => t.id === templateId) ?? null
  const [settings, setSettings] = useState<AdSettings>(() => startFrom(template))
  const [pages, setPages] = useState<MetaPage[] | null>(null)
  const [pagesError, setPagesError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [name, setName] = useState<string | null>(null)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const [saveAs, setSaveAs] = useState<HTMLElement | null>(null)

  const update = useCallback((changes: Partial<AdSettings>) => setSettings((s) => ({ ...s, ...changes })), [])
  const toggleEnhancement = (key: Enhancement, on: boolean) =>
    update({ mejoras: ENHANCEMENTS.map((e) => e.key).filter((k) => (k === key ? on : settings.mejoras.includes(k))) })

  // ── Páginas de la cuenta ──
  const loadPages = useCallback(
    (fresh = false) => {
      setPagesError(null)
      metaApi.pages(account.id, fresh).then(setPages, (err) => setPagesError(errorText(err)))
    },
    [account.id],
  )
  useEffect(() => loadPages(), [loadPages])
  // Al abrir un conjunto nuevo, el foco va a su título.
  useEffect(() => heading.current?.focus(), [])

  // La página de la plantilla, si está en esta cuenta; si no, la de la campaña o la única que haya. Su Instagram,
  // por defecto.
  const preferredPage = adSetIn?.pagina ?? null
  useEffect(() => {
    if (!pages) return
    setSettings((s) => {
      const page =
        pages.find((p) => p.id === s.pagina) ?? pages.find((p) => p.id === preferredPage) ?? (pages.length === 1 ? pages[0] : null)
      const instagram = page && s.instagram && page.instagrams.some((i) => i.id === s.instagram) ? s.instagram : (page?.instagrams[0]?.id ?? null)
      if (page?.id === s.pagina && instagram === s.instagram) return s
      return { ...s, pagina: page?.id ?? null, instagram: s.pagina === page?.id ? s.instagram : instagram }
    })
  }, [pages, preferredPage])

  const page = pages?.find((p) => p.id === settings.pagina) ?? null

  // ── Plantillas ──
  const pickTemplate = (id: string | null) => {
    setTemplateId(id)
    writeLastTemplate(account.id, id)
    setSettings(startFrom(templates.find((t) => t.id === id) ?? null))
    setName(null)
  }
  const dirty = template ? !sameSettings({ ...template, cuenta: account.id }, settings) : false

  const saveTemplate = async () => {
    if (!template) return
    setError(null)
    try {
      await onTemplates(allTemplates.map((t) => (t.id === template.id ? { ...t, ...settings, cuenta: account.id } : t)))
    } catch (err) {
      setError(errorText(err))
    }
  }

  const createTemplate = async (nombre: string) => {
    const created: Template = { ...settings, cuenta: account.id, id: crypto.randomUUID(), nombre }
    await onTemplates([...allTemplates, created])
    setTemplateId(created.id)
    writeLastTemplate(account.id, created.id)
  }

  const deleteTemplate = async () => {
    if (!template) return
    setError(null)
    try {
      await onTemplates(allTemplates.filter((t) => t.id !== template.id))
      setTemplateId(null)
      writeLastTemplate(account.id, null)
    } catch (err) {
      setError(errorText(err))
    }
  }

  // ── Imágenes y vídeos: un anuncio por cada una, o por pareja (la del feed y la vertical) ──
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts
  useEffect(() => () => draftsRef.current.forEach((d) => d.items.forEach((c) => URL.revokeObjectURL(c.preview))), [])
  const creativeCount = drafts.reduce((n, d) => n + d.items.length, 0)

  const addFiles = async (files: FileList | File[]) => {
    const accepted: Array<{ file: File; tipo: Creative['tipo'] }> = []
    const rejected: string[] = []
    for (const file of files) {
      const tipo = file.type.startsWith('image/') ? 'imagen' : file.type.startsWith('video/') ? 'video' : null
      if (!tipo || file.size > (tipo === 'imagen' ? MAX_IMAGE : MAX_VIDEO)) rejected.push(file.name)
      else accepted.push({ file, tipo })
    }
    setError(rejected.length ? `No se pueden usar: ${rejected.join(', ')} (solo imágenes de hasta 30 MB y vídeos de hasta 1 GB).` : null)
    if (phase.kind === 'done') setPhase({ kind: 'idle' })
    // Se mide cada una para saber si es vertical y juntarla con la otra versión de su pieza.
    const added = await Promise.all(
      accepted.map(async ({ file, tipo }): Promise<Draft> => {
        const preview = URL.createObjectURL(file)
        const ratio = await measure(file, tipo, preview)
        return { key: crypto.randomUUID(), nombre: adNameFrom(file.name), items: [{ key: crypto.randomUUID(), file, tipo, preview, medio: null, ratio }] }
      }),
    )
    if (added.length) setDrafts((list) => addDrafts(list, added))
  }

  // ── Textos con Claude ──
  /** Lo que había antes de que escribiera Claude (para deshacerlo). */
  const [undo, setUndo] = useState<Copy | null>(null)
  const copyRequest = async () => ({
    imagenes: (await Promise.all(drafts.slice(0, 6).map((d) => snapshot(d.items[0]))))
      .filter((data): data is string => Boolean(data))
      .map((data) => ({ media_type: 'image/jpeg' as const, data })),
    pagina: page?.nombre ?? '',
    instagram: page?.instagrams.find((i) => i.id === settings.instagram)?.usuario ?? '',
    lugares: settings.lugares.map((l) => [l.nombre, l.detalle].filter(Boolean).join(', ')),
    actuales: { texto: settings.texto, titular: settings.titular, descripcion: settings.descripcion, bienvenida: settings.bienvenida, saludo: settings.saludo, preguntas: settings.preguntas },
  })

  // ── Crear ──
  // Con Advantage+, Meta no admite una edad mínima por encima de 25 (se manda así; anuncios.mjs igual).
  const minAge = settings.advantage ? Math.min(settings.edadMin, 25) : settings.edadMin
  const campaign = name ?? campaignName(template?.nombre ?? null)
  const blocked = missing({ ...settings, presupuesto: shared ? 1 : settings.presupuesto, creatividades: drafts.length })
  const busy = phase.kind === 'uploading' || phase.kind === 'creating'

  const create = async () => {
    if (blocked || busy || !settings.pagina) return
    setError(null)
    try {
      const media = new Map<string, Media>()
      for (const [i, creative] of drafts.flatMap((d) => d.items).entries()) {
        setPhase({ kind: 'uploading', done: i, total: creativeCount })
        const medio = creative.medio ?? (await uploadMedia(account.id, creative.file))
        media.set(creative.key, medio)
        if (!creative.medio) {
          setDrafts((list) => list.map((d) => ({ ...d, items: d.items.map((c) => (c.key === creative.key ? { ...c, medio } : c)) })))
        }
      }
      setPhase({ kind: 'creating' })
      const plan = {
        ...settings,
        cuenta: account.id,
        pagina: settings.pagina,
        nombre: campaign,
        plantilla: template?.nombre ?? null,
        inicio: start || null,
        fin: end || null,
        // Con dos, la primera es la del feed y la segunda la vertical.
        anuncios: drafts.map(({ nombre, items: [main, vertical] }) => ({
          nombre,
          medio: media.get(main.key)!,
          ...(vertical ? { vertical: media.get(vertical.key)! } : {}),
        })),
      }
      if (adSetIn) {
        onAdSet?.(await metaApi.addAdSet({ ...plan, campana: adSetIn.id }))
        return
      }
      const launch = await metaApi.launch(plan)
      onLaunch(launch)
      setPhase({ kind: 'done', launch })
    } catch (err) {
      setError(errorText(err))
      setPhase({ kind: 'idle' })
    }
  }

  const another = () => {
    drafts.forEach((d) => d.items.forEach((c) => URL.revokeObjectURL(c.preview)))
    setDrafts([])
    setName(null)
    setPhase({ kind: 'idle' })
  }

  return (
    <div className="ads-composer-layout">
      <div className="ads-composer">
        {adSetIn && (
          <header className="ads-composer-head">
            <h3 ref={heading} tabIndex={-1}>
              Nuevo conjunto en «{adSetIn.nombre}»
            </h3>
            <button type="button" className="btn" disabled={busy} onClick={onCancel}>
              Cancelar
            </button>
          </header>
        )}
        <section className="ads-card ads-name" aria-labelledby={`${ids}-name-title`}>
          <h4 id={`${ids}-name-title`} className="sr-only">
            Nombre
          </h4>
          <Field label={adSetIn ? 'Conjunto' : 'Campaña'} htmlFor={`${ids}-name`}>
            <input id={`${ids}-name`} className="input ads-wide" value={campaign} disabled={busy} onChange={(e) => setName(e.target.value)} />
          </Field>
        </section>

        <section className="ads-card ads-templates" aria-labelledby={`${ids}-tpl`}>
          <h4 id={`${ids}-tpl`}>Plantilla</h4>
          <div className="ads-chips" role="radiogroup" aria-labelledby={`${ids}-tpl`}>
            <button type="button" role="radio" aria-checked={!template} className={cx('chip', !template && 'is-active')} onClick={() => pickTemplate(null)}>
              Sin plantilla
            </button>
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={t.id === templateId}
                className={cx('chip', t.id === templateId && 'is-active')}
                onClick={() => pickTemplate(t.id)}
              >
                {t.nombre}
              </button>
            ))}
          </div>
          <div className="ads-template-actions">
            {template && dirty && (
              <button type="button" className="btn" onClick={() => void saveTemplate()}>
                Guardar cambios en «{template.nombre}»
              </button>
            )}
            <button type="button" className="link-btn" onClick={(e) => setSaveAs(e.currentTarget)}>
              {template ? 'Guardar como otra plantilla' : 'Guardar como plantilla'}
            </button>
            {template && (
              <button type="button" className="link-btn is-danger" onClick={() => void deleteTemplate()}>
                Eliminar «{template.nombre}»
              </button>
            )}
          </div>
          {saveAs && (
            <SaveTemplate
              anchor={saveAs}
              onClose={() => setSaveAs(null)}
              onSave={async (nombre) => {
                await createTemplate(nombre)
                setSaveAs(null)
              }}
            />
          )}
        </section>

        <section className="ads-card" aria-labelledby={`${ids}-where`}>
          <h4 id={`${ids}-where`}>Quién anuncia</h4>
          <div className="ads-fields">
            <Field label="Página" htmlFor={`${ids}-page`}>
              {pages ? (
                pages.length ? (
                  <select
                    id={`${ids}-page`}
                    className="input"
                    value={settings.pagina ?? ''}
                    onChange={(e) => {
                      const next = pages.find((p) => p.id === e.target.value) ?? null
                      update({ pagina: next?.id ?? null, instagram: next?.instagrams[0]?.id ?? null })
                    }}
                  >
                    {!settings.pagina && <option value="">Elige una página…</option>}
                    {pages.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="ads-note">Esta cuenta no tiene páginas con las que anunciarse.</span>
                )
              ) : pagesError ? (
                <span className="ads-note is-error">
                  {pagesError}{' '}
                  <button type="button" className="link-btn" onClick={() => loadPages(true)}>
                    Reintentar
                  </button>
                </span>
              ) : (
                <span className="ads-note">Cargando páginas…</span>
              )}
            </Field>
            <Field label="Instagram" htmlFor={`${ids}-ig`}>
              <select
                id={`${ids}-ig`}
                className="input"
                value={settings.instagram ?? ''}
                disabled={!page}
                onChange={(e) => update({ instagram: e.target.value || null })}
              >
                {page?.instagrams.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.usuario ? `@${i.usuario}` : `La de tus anuncios anteriores (${i.id})`}
                  </option>
                ))}
                <option value="">{page?.instagrams.length ? 'Sin Instagram (como la página)' : 'La página no tiene Instagram conectado'}</option>
              </select>
            </Field>
            <Field label="WhatsApp">
              <span className="ads-note">
                {page?.whatsapp
                  ? `Los mensajes llegan al ${page.whatsapp}.`
                  : 'Al WhatsApp conectado a la página. Si la página no tiene ninguno, Meta no deja crear el anuncio.'}
              </span>
            </Field>
          </div>
        </section>

        <section className="ads-card" aria-labelledby={`${ids}-budget`}>
          <h4 id={`${ids}-budget`}>Presupuesto y fechas</h4>
          <div className="ads-fields">
            {shared ? (
              <Field label="Presupuesto" note="Es el de la campaña: Meta lo reparte entre sus conjuntos.">
                <span>{budgetText(shared, account.moneda)}</span>
              </Field>
            ) : (
              <Field label="Al día" htmlFor={`${ids}-amount`}>
                <span className="ads-money">
                  <input
                    id={`${ids}-amount`}
                    className="input ads-amount"
                    type="number"
                    inputMode="decimal"
                    min={1}
                    step={0.5}
                    value={Number.isFinite(settings.presupuesto) ? settings.presupuesto : ''}
                    onChange={(e) => update({ presupuesto: e.target.valueAsNumber })}
                  />
                  <span>{account.moneda}</span>
                </span>
              </Field>
            )}
            <Field label="Empieza" htmlFor={`${ids}-start`} note={start ? null : adSetIn ? 'En cuanto lo actives' : 'En cuanto la actives'}>
              <input id={`${ids}-start`} className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Termina" htmlFor={`${ids}-end`} note={end ? null : 'Sin fecha de fin'}>
              <input id={`${ids}-end`} className="input" type="date" min={start || undefined} value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>
        </section>

        <section className="ads-card" aria-labelledby={`${ids}-audience`}>
          <h4 id={`${ids}-audience`}>Público</h4>
          <div className="ads-fields">
            <Field label="Lugares" htmlFor={`${ids}-places`}>
              <PlacePicker id={`${ids}-places`} places={settings.lugares} onChange={(lugares) => update({ lugares })} />
            </Field>
            <Field
              label="Advantage+"
              note={
                settings.advantage
                  ? 'Meta decide la edad máxima y el sexo según dónde encuentre más conversaciones.'
                  : 'Desactivado: la edad y el sexo son límites estrictos.'
              }
            >
              <Switch checked={settings.advantage} label="Público Advantage+" onChange={(advantage) => update({ advantage })} />
            </Field>
            <Field label="Edad" htmlFor={`${ids}-age`} note={settings.advantage ? 'Con Advantage+, la mínima es como mucho 25.' : null}>
              <span className="ads-age">
                <select id={`${ids}-age`} className="input" aria-label="Edad mínima" value={minAge} onChange={(e) => update({ edadMin: Number(e.target.value) })}>
                  {range(18, settings.advantage ? 25 : 65).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                {!settings.advantage && (
                  <>
                    <span aria-hidden="true">–</span>
                    <select className="input" aria-label="Edad máxima" value={settings.edadMax} onChange={(e) => update({ edadMax: Number(e.target.value) })}>
                      {range(Math.max(18, settings.edadMin), 65).map((n) => (
                        <option key={n} value={n}>
                          {n === 65 ? '65+' : n}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </span>
            </Field>
            {!settings.advantage && (
              <Field label="Sexo">
                <Chips label="Sexo" options={GENDERS} value={settings.genero} onChange={(genero) => update({ genero })} />
              </Field>
            )}
            <Field label="Ubicaciones">
              <Chips label="Ubicaciones" options={PLACEMENTS} value={settings.ubicaciones} onChange={(ubicaciones) => update({ ubicaciones })} />
            </Field>
          </div>
        </section>

        <section className="ads-card" aria-labelledby={`${ids}-media`}>
          <h4 id={`${ids}-media`}>
            Imágenes y vídeos <span className="ads-count">{drafts.length ? `· ${adsCount(drafts.length)}` : ''}</span>
          </h4>
          <p className="ads-hint">
            Cada fila es un anuncio, con el mismo texto, en el mismo conjunto. Si subes la versión vertical (9:16) y la del feed
            (4:5 o 1:1) de una pieza, se juntan en un solo anuncio: cada una en sus ubicaciones.
          </p>
          <DropZone onFiles={(files) => void addFiles(files)} disabled={busy} />
          {drafts.length > 0 && <MediaList drafts={drafts} busy={busy} onChange={setDrafts} />}
        </section>

        <section className="ads-card" aria-labelledby={`${ids}-copy`}>
          <div className="ads-card-head">
            <h4 id={`${ids}-copy`}>Texto</h4>
            {undo && (
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  update(undo)
                  setUndo(null)
                }}
              >
                Deshacer
              </button>
            )}
            <CopyButton
              build={copyRequest}
              onCopy={(copy) => {
                setUndo({ texto: settings.texto, titular: settings.titular, descripcion: settings.descripcion, bienvenida: settings.bienvenida, saludo: settings.saludo, preguntas: settings.preguntas })
                update(copy)
              }}
            />
          </div>
          <div className="ads-fields">
            <Field label="Texto principal" htmlFor={`${ids}-text`}>
              <textarea
                id={`${ids}-text`}
                className="input ads-textarea"
                rows={4}
                value={settings.texto}
                placeholder="Lo que se lee encima de la imagen"
                onChange={(e) => update({ texto: e.target.value })}
              />
            </Field>
            <Field label="Título" htmlFor={`${ids}-headline`}>
              <input
                id={`${ids}-headline`}
                className="input ads-wide"
                value={settings.titular}
                placeholder="Opcional: debajo de la imagen, junto al botón"
                onChange={(e) => update({ titular: e.target.value })}
              />
            </Field>
            <Field label="Descripción" htmlFor={`${ids}-description`}>
              <input
                id={`${ids}-description`}
                className="input ads-wide"
                value={settings.descripcion}
                placeholder="Opcional: debajo del título (no sale en todas las ubicaciones)"
                onChange={(e) => update({ descripcion: e.target.value })}
              />
            </Field>
          </div>
        </section>

        <section className="ads-card" aria-labelledby={`${ids}-chat`}>
          <h4 id={`${ids}-chat`}>Chat de WhatsApp</h4>
          <p className="ads-hint">Lo que ve la persona al abrir WhatsApp desde el anuncio.</p>
          <div className="ads-chat">
            <div className="ads-fields">
              <Field label="Vuestro mensaje" htmlFor={`${ids}-welcome`} note="Lo primero que ve, de vuestra parte.">
                <textarea
                  id={`${ids}-welcome`}
                  className="input ads-textarea is-short"
                  rows={2}
                  value={settings.bienvenida}
                  placeholder={GREETING}
                  onChange={(e) => update({ bienvenida: e.target.value })}
                />
              </Field>
              <Field label="Para empezar">
                <Chips label="Para empezar" options={CHAT_STARTS} value={settings.tipoMensaje} onChange={(tipoMensaje) => update({ tipoMensaje })} />
              </Field>
              {settings.tipoMensaje === 'escrito' ? (
                <Field label="Su mensaje" htmlFor={`${ids}-greeting`} note="Aparece ya escrito: lo envía con un toque.">
                  <input id={`${ids}-greeting`} className="input ads-wide" value={settings.saludo} onChange={(e) => update({ saludo: e.target.value })} />
                </Field>
              ) : (
                <Field label="Preguntas" note={`La persona toca una y se envía. Hasta ${MAX_QUESTIONS}.`}>
                  <Questions value={settings.preguntas} onChange={(preguntas) => update({ preguntas })} />
                </Field>
              )}
            </div>
            <ChatPreview settings={settings} />
          </div>
        </section>

        <section className="ads-card" aria-labelledby={`${ids}-auto`}>
          <h4 id={`${ids}-auto`}>
            Mejoras automáticas de Meta <span className="ads-count">· {automaticSummary(settings).replace(/ de Meta/, '')}</span>
          </h4>
          <p className="ads-hint">
            Si no se le dice nada, Meta activa algunas por su cuenta. Tablero se las manda todas: solo van activadas las que
            marques aquí (las de catálogo y web, siempre desactivadas). La música no se añade nunca.
          </p>
          <div className="ads-fields">
            <Field
              label="Multianunciante"
              note={
                settings.multianunciante
                  ? 'El anuncio puede salir junto a anuncios de otras empresas.'
                  : 'El anuncio no sale junto a anuncios de otras empresas.'
              }
            >
              <Switch checked={settings.multianunciante} label="Anuncios multianunciante" onChange={(multianunciante) => update({ multianunciante })} />
            </Field>
          </div>
          <div className="ads-enhancements">
            {(['visual', 'texto'] as const).map((group) => (
              <fieldset key={group} className="ads-enhancement-group">
                <legend>{group === 'visual' ? 'Imagen y vídeo' : 'Texto y extras'}</legend>
                {ENHANCEMENTS.filter((e) => e.group === group).map((e) => (
                  <label key={e.key} className="ads-metric-option">
                    <input type="checkbox" checked={settings.mejoras.includes(e.key)} onChange={(ev) => toggleEnhancement(e.key, ev.target.checked)} />
                    <span>
                      {e.label}
                      <small>{e.note}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          {settings.mejoras.length > 0 && (
            <div className="ads-template-actions">
              <button type="button" className="link-btn" onClick={() => update({ mejoras: [] })}>
                Desactivar todas
              </button>
            </div>
          )}
        </section>

        <section className="ads-card ads-launch" aria-labelledby={`${ids}-launch`}>
          <h4 id={`${ids}-launch`} className="sr-only">
            {adSetIn ? 'Crear el conjunto' : 'Crear la campaña'}
          </h4>
          {phase.kind === 'done' ? (
            <LaunchResult launch={phase.launch} onLaunch={onLaunch} onAnother={another} />
          ) : (
            <>
              <div className="ads-launch-row">
                <p className="ads-launch-note" aria-live="polite">
                  {phase.kind === 'uploading'
                    ? `Subiendo ${phase.done + 1} de ${phase.total}…`
                    : phase.kind === 'creating'
                      ? adSetIn
                        ? 'Creando el conjunto y los anuncios…'
                        : 'Creando la campaña y los anuncios…'
                      : (blocked ??
                        (adSetIn
                          ? `Mensajes a WhatsApp · ${shared ? 'con el presupuesto de la campaña' : `${money(settings.presupuesto, account.moneda)} al día`} · ${adsCount(drafts.length)} · ${automaticSummary(settings)} · el conjunto, en pausa`
                          : `Mensajes a WhatsApp · ${money(settings.presupuesto, account.moneda)} al día · ${adsCount(drafts.length)} · ${automaticSummary(settings)} · todo en pausa`))}
                </p>
                <button type="button" className="btn is-accent" disabled={Boolean(blocked) || busy} onClick={() => void create()}>
                  {busy ? 'Creando…' : 'Crear en pausa'}
                </button>
              </div>
            </>
          )}
          {error && (
            <p className="ads-error" role="alert">
              {error}
            </p>
          )}
        </section>

        {!adSetIn && launches.length > 0 && <RecentLaunches launches={launches} onLaunch={onLaunch} />}
      </div>
      <aside className="ads-preview-column" aria-label="Vista previa del anuncio">
        <AdPreview settings={settings} page={page} drafts={drafts} />
      </aside>
    </div>
  )
}

const adsCount = (n: number) => (n === 1 ? '1 anuncio' : `${n} anuncios`)

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

function Field({ label, htmlFor, note, children }: { label: string; htmlFor?: string; note?: string | null; children: ReactNode }) {
  return (
    <div className="field ads-field">
      {htmlFor ? (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="field-label">{label}</span>
      )}
      <div className="field-controls">
        {children}
        {note && <span className="ads-note">{note}</span>}
      </div>
    </div>
  )
}

function Chips<T extends string>({ label, options, value, onChange }: { label: string; options: Array<{ value: T; label: string }>; value: T; onChange: (value: T) => void }) {
  return (
    <div className="ads-chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={cx('chip', o.value === value && 'is-active')} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Las preguntas frecuentes del chat: una por línea (al menos una a la vista), hasta MAX_QUESTIONS. */
function Questions({ value, onChange }: { value: string[]; onChange: (questions: string[]) => void }) {
  const questions = value.length ? value : ['']
  return (
    <div className="ads-questions">
      {questions.map((q, i) => (
        <div key={i} className="ads-question">
          <input
            className="input ads-wide"
            aria-label={`Pregunta ${i + 1}`}
            maxLength={80}
            value={q}
            placeholder={i === 0 ? 'p. ej. ¿Qué horarios tenéis?' : undefined}
            onChange={(e) => onChange(questions.map((x, j) => (j === i ? e.target.value : x)))}
          />
          {questions.length > 1 && (
            <button type="button" className="icon-btn" aria-label={`Quitar la pregunta ${i + 1}`} onClick={() => onChange(questions.filter((_, j) => j !== i))}>
              <Icon.Close />
            </button>
          )}
        </div>
      ))}
      {questions.length < MAX_QUESTIONS && (
        <button type="button" className="link-btn" onClick={() => onChange([...questions, ''])}>
          Añadir pregunta
        </button>
      )}
    </div>
  )
}

/** Cómo se verá el chat: vuestro mensaje y, abajo, lo de la persona (su mensaje escrito o las preguntas). */
function ChatPreview({ settings }: { settings: AdSettings }) {
  const questions = settings.preguntas.map((q) => q.trim()).filter(Boolean)
  return (
    <div className="ads-chat-preview" aria-hidden="true">
      <span className="ads-chat-title">Vista previa</span>
      <p className="ads-bubble">{settings.bienvenida.trim() || GREETING}</p>
      {settings.tipoMensaje === 'escrito' ? (
        <p className="ads-chat-input">{settings.saludo.trim() || 'Escribe un mensaje'}</p>
      ) : (
        <div className="ads-chat-questions">
          {(questions.length ? questions : ['Pregunta']).map((q, i) => (
            <span key={i}>{q}</span>
          ))}
        </div>
      )}
    </div>
  )
}

/** Países, regiones y ciudades: los elegidos como píldoras y un buscador (el de Meta). */
function PlacePicker({ id, places, onChange }: { id: string; places: Place[]; onChange: (places: Place[]) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [active, setActive] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const listId = `${id}-lista`

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      return
    }
    let stale = false
    const timer = setTimeout(() => {
      metaApi.places(q).then(
        (found) => {
          if (stale) return
          setResults(found.filter((f) => !places.some((p) => p.key === f.key && p.tipo === f.tipo)))
          setActive(0)
          setError(null)
        },
        (err) => !stale && setError(errorText(err)),
      )
    }, 250)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [query, places])

  const add = (place: Place) => {
    onChange([...places, place])
    setQuery('')
    setResults([])
  }

  return (
    <div className="ads-places">
      {places.map((p) => (
        <span key={`${p.tipo}:${p.key}`} className="ads-place">
          {p.nombre}
          <span className="ads-place-kind">{p.detalle}</span>
          <button type="button" aria-label={`Quitar ${p.nombre}`} onClick={() => onChange(places.filter((x) => x !== p))}>
            <Icon.Close />
          </button>
        </span>
      ))}
      <div className="ads-place-search">
        <input
          id={id}
          className="input"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-activedescendant={results.length ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder="Añadir país, región o ciudad"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (!results.length) return
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length)
            } else if (e.key === 'Enter') {
              e.preventDefault()
              add(results[active])
            } else if (e.key === 'Escape') {
              e.stopPropagation()
              setResults([])
            }
          }}
        />
        {results.length > 0 && (
          <ul id={listId} className="ads-place-results" role="listbox">
            {results.map((r, i) => (
              <li
                key={`${r.tipo}:${r.key}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={cx(i === active && 'is-active')}
                onMouseDown={(e) => {
                  e.preventDefault()
                  add(r)
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span>{r.nombre}</span>
                <span className="ads-place-kind">{r.detalle}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <span className="ads-note is-error">{error}</span>}
    </div>
  )
}

function DropZone({ onFiles, disabled }: { onFiles: (files: FileList) => void; disabled: boolean }) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    if (!disabled && e.dataTransfer.files.length) onFiles(e.dataTransfer.files)
  }
  return (
    <div
      className={cx('ads-drop', over && 'is-over', disabled && 'is-disabled')}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <Icon.Image />
      <span>Arrastra aquí imágenes o vídeos, o</span>
      <button type="button" className="link-btn" disabled={disabled} onClick={() => input.current?.click()}>
        elígelos
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}

function SaveTemplate({ anchor, onClose, onSave }: { anchor: HTMLElement; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const id = useId()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <Popover anchor={anchor} placement="below-start" width={280} label="Guardar plantilla" onClose={onClose}>
      <form
        className="ads-save-template"
        onSubmit={(e) => {
          e.preventDefault()
          if (!value.trim()) return
          onSave(value.trim()).catch((err) => setError(errorText(err)))
        }}
      >
        <label htmlFor={id}>Nombre de la plantilla</label>
        <input id={id} className="input" autoFocus value={value} placeholder="p. ej. Captación Madrid" onChange={(e) => setValue(e.target.value)} />
        <p className="ads-note">
          Guarda la página, el presupuesto, el público, las ubicaciones, los textos, el chat de WhatsApp y las mejoras de Meta. Las
          imágenes no.
        </p>
        {error && (
          <p className="ads-error" role="alert">
            {error}
          </p>
        )}
        <div className="ads-form-foot">
          <button type="submit" className="btn is-accent" disabled={!value.trim()}>
            Guardar
          </button>
        </div>
      </form>
    </Popover>
  )
}

/** Tras crear: abrirla en el Administrador de anuncios o activarla ya. */
function LaunchResult({ launch, onLaunch, onAnother }: { launch: Launch; onLaunch: (launch: Launch) => void; onAnother: () => void }) {
  return (
    <div className="ads-result">
      <span className="ads-result-icon" aria-hidden="true">
        <Icon.Check />
      </span>
      <div className="ads-result-text">
        <h5>{launch.estado === 'activa' ? 'Campaña activa' : 'Campaña creada en pausa'}</h5>
        <p>
          {launch.nombre} · {launch.anuncios.length === 1 ? '1 anuncio' : `${launch.anuncios.length} anuncios`}
        </p>
      </div>
      <div className="ads-result-actions">
        <a className="btn" href={launch.enlace} target="_blank" rel="noreferrer">
          <Icon.External />
          Revisar en Meta
        </a>
        {launch.estado === 'pausada' && <ActivateButton launch={launch} onLaunch={onLaunch} />}
        <button type="button" className="link-btn" onClick={onAnother}>
          Crear otra
        </button>
      </div>
    </div>
  )
}

/** «Activar» pide confirmación: desde ese momento la campaña gasta. */
function ActivateButton({ launch, onLaunch }: { launch: Launch; onLaunch: (launch: Launch) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activate = async () => {
    setBusy(true)
    setError(null)
    try {
      onLaunch(await metaApi.activate(launch.id))
      setAnchor(null)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button type="button" className="btn is-accent" aria-expanded={anchor !== null} onClick={(e) => setAnchor(e.currentTarget)}>
        Activar
      </button>
      {anchor && (
        <Popover anchor={anchor} placement="below-end" width={280} label="Activar la campaña" onClose={() => setAnchor(null)}>
          <div className="ads-confirm">
            <p>
              <b>{launch.nombre}</b> empezará a gastar hasta {money(launch.presupuesto, launch.moneda)} al día en cuanto Meta
              apruebe los anuncios.
            </p>
            {error && (
              <p className="ads-error" role="alert">
                {error}
              </p>
            )}
            <div className="ads-form-foot">
              <button type="button" className="link-btn" onClick={() => setAnchor(null)}>
                Cancelar
              </button>
              <button type="button" className="btn is-accent" disabled={busy} onClick={() => void activate()}>
                {busy ? 'Activando…' : 'Activar'}
              </button>
            </div>
          </div>
        </Popover>
      )}
    </>
  )
}

function RecentLaunches({ launches, onLaunch }: { launches: Launch[]; onLaunch: (launch: Launch) => void }) {
  const id = useId()
  return (
    <section className="ads-recent" aria-labelledby={id}>
      <h4 id={id}>Creadas desde Tablero</h4>
      <ul>
        {launches.slice(0, 8).map((l) => (
          <li key={l.id}>
            <div className="ads-recent-text">
              <span className="ads-recent-name">{l.nombre}</span>
              <span className="ads-recent-meta">
                {formatWhen(l.creadoEn)} · {l.anuncios.length === 1 ? '1 anuncio' : `${l.anuncios.length} anuncios`} ·{' '}
                {money(l.presupuesto, l.moneda)} al día
              </span>
            </div>
            <span className={cx('ads-status', `is-${l.estado}`)}>{l.estado === 'activa' ? 'Activa' : 'En pausa'}</span>
            {l.estado === 'pausada' && <ActivateButton launch={l} onLaunch={onLaunch} />}
            <a className="icon-btn" href={l.enlace} target="_blank" rel="noreferrer" aria-label={`Abrir ${l.nombre} en Meta`} title="Abrir en el Administrador de anuncios">
              <Icon.External />
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
