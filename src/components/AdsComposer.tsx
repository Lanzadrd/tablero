import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import {
  adNameFrom,
  campaignName,
  DEFAULT_SETTINGS,
  metaApi,
  missing,
  money,
  sameSettings,
  settingsOf,
  uploadMedia,
  type AdAccount,
  type AdSettings,
  type Gender,
  type Launch,
  type Media,
  type MetaPage,
  type Place,
  type Placements,
  type Template,
} from '../ads'
import { formatWhen } from '../dates'
import { cx } from '../util'
import { errorText } from './Ads'
import * as Icon from './Icons'
import { Popover } from './Popover'
import { Switch } from './Switch'

/** Lo que admite Meta: imágenes de hasta 30 MB y vídeos de hasta 1 GB (subida simple). */
const MAX_IMAGE = 30 * 1024 * 1024
const MAX_VIDEO = 1024 * 1024 * 1024

interface Creative {
  key: string
  file: File
  nombre: string
  tipo: 'imagen' | 'video'
  preview: string
  /** Ya subida a esta cuenta (si algo falla después, no se vuelve a subir). */
  medio: Media | null
}

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

/**
 * Nueva campaña de mensajes a WhatsApp en una cuenta publicitaria: las opciones (de una plantilla o a mano),
 * las imágenes o vídeos (uno por anuncio) y «Crear en pausa». Debajo, las últimas creadas en la cuenta.
 */
export function AdsComposer({
  account,
  templates: allTemplates,
  launches,
  onTemplates,
  onLaunch,
}: {
  account: AdAccount
  templates: Template[]
  launches: Launch[]
  onTemplates: (templates: Template[]) => Promise<Template[]>
  onLaunch: (launch: Launch) => void
}) {
  const ids = useId()
  // Las plantillas de esta cuenta y las que no son de ninguna.
  const templates = useMemo(() => allTemplates.filter((t) => !t.cuenta || t.cuenta === account.id), [allTemplates, account.id])
  const [templateId, setTemplateId] = useState<string | null>(() => {
    const last = readLastTemplate(account.id)
    return templates.some((t) => t.id === last) ? last : null
  })
  const template = templates.find((t) => t.id === templateId) ?? null
  const [settings, setSettings] = useState<AdSettings>(() => ({ ...(template ? settingsOf(template) : DEFAULT_SETTINGS), cuenta: account.id }))
  const [pages, setPages] = useState<MetaPage[] | null>(null)
  const [pagesError, setPagesError] = useState<string | null>(null)
  const [creatives, setCreatives] = useState<Creative[]>([])
  const [name, setName] = useState<string | null>(null)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const [saveAs, setSaveAs] = useState<HTMLElement | null>(null)

  const update = useCallback((changes: Partial<AdSettings>) => setSettings((s) => ({ ...s, ...changes })), [])

  // ── Páginas de la cuenta ──
  const loadPages = useCallback(
    (fresh = false) => {
      setPagesError(null)
      metaApi.pages(account.id, fresh).then(setPages, (err) => setPagesError(errorText(err)))
    },
    [account.id],
  )
  useEffect(() => loadPages(), [loadPages])

  // La página de la plantilla, si está en esta cuenta; si no, la única que haya. Su Instagram, por defecto.
  useEffect(() => {
    if (!pages) return
    setSettings((s) => {
      const page = pages.find((p) => p.id === s.pagina) ?? (pages.length === 1 ? pages[0] : null)
      const instagram = page && s.instagram && s.instagram === page.instagram?.id ? s.instagram : (page?.instagram?.id ?? null)
      if (page?.id === s.pagina && instagram === s.instagram) return s
      return { ...s, pagina: page?.id ?? null, instagram: s.pagina === page?.id ? s.instagram : instagram }
    })
  }, [pages])

  const page = pages?.find((p) => p.id === settings.pagina) ?? null

  // ── Plantillas ──
  const pickTemplate = (id: string | null) => {
    setTemplateId(id)
    writeLastTemplate(account.id, id)
    const next = templates.find((t) => t.id === id)
    setSettings({ ...(next ? settingsOf(next) : DEFAULT_SETTINGS), cuenta: account.id })
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

  // ── Creatividades ──
  const creativesRef = useRef(creatives)
  creativesRef.current = creatives
  useEffect(() => () => creativesRef.current.forEach((c) => URL.revokeObjectURL(c.preview)), [])

  const addFiles = (files: FileList | File[]) => {
    const added: Creative[] = []
    const rejected: string[] = []
    for (const file of files) {
      const tipo = file.type.startsWith('image/') ? 'imagen' : file.type.startsWith('video/') ? 'video' : null
      if (!tipo || file.size > (tipo === 'imagen' ? MAX_IMAGE : MAX_VIDEO)) {
        rejected.push(file.name)
        continue
      }
      added.push({ key: crypto.randomUUID(), file, nombre: adNameFrom(file.name), tipo, preview: URL.createObjectURL(file), medio: null })
    }
    if (added.length) setCreatives((list) => [...list, ...added])
    setError(rejected.length ? `No se pueden usar: ${rejected.join(', ')} (solo imágenes de hasta 30 MB y vídeos de hasta 1 GB).` : null)
    if (phase.kind === 'done') setPhase({ kind: 'idle' })
  }

  const removeCreative = (key: string) => {
    setCreatives((list) => {
      const gone = list.find((c) => c.key === key)
      if (gone) URL.revokeObjectURL(gone.preview)
      return list.filter((c) => c.key !== key)
    })
  }

  // ── Crear ──
  // Con Advantage+, Meta no admite una edad mínima por encima de 25 (se manda así; anuncios.mjs igual).
  const minAge = settings.advantage ? Math.min(settings.edadMin, 25) : settings.edadMin
  const campaign = name ?? campaignName(template?.nombre ?? null)
  const blocked = missing({ ...settings, creatividades: creatives.length })
  const busy = phase.kind === 'uploading' || phase.kind === 'creating'

  const create = async () => {
    if (blocked || busy || !settings.pagina) return
    setError(null)
    try {
      const media: Media[] = []
      for (const [i, creative] of creatives.entries()) {
        setPhase({ kind: 'uploading', done: i, total: creatives.length })
        const medio = creative.medio ?? (await uploadMedia(account.id, creative.file))
        media.push(medio)
        if (!creative.medio) setCreatives((list) => list.map((c) => (c.key === creative.key ? { ...c, medio } : c)))
      }
      setPhase({ kind: 'creating' })
      const launch = await metaApi.launch({
        ...settings,
        cuenta: account.id,
        pagina: settings.pagina,
        nombre: campaign,
        plantilla: template?.nombre ?? null,
        inicio: start || null,
        fin: end || null,
        anuncios: creatives.map((c, i) => ({ nombre: c.nombre, medio: media[i] })),
      })
      onLaunch(launch)
      setPhase({ kind: 'done', launch })
    } catch (err) {
      setError(errorText(err))
      setPhase({ kind: 'idle' })
    }
  }

  const another = () => {
    creatives.forEach((c) => URL.revokeObjectURL(c.preview))
    setCreatives([])
    setName(null)
    setPhase({ kind: 'idle' })
  }

  return (
    <div className="ads-composer">
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
                    update({ pagina: next?.id ?? null, instagram: next?.instagram?.id ?? null })
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
              {page?.instagram && <option value={page.instagram.id}>@{page.instagram.usuario}</option>}
              <option value="">{page?.instagram ? 'Sin Instagram (como la página)' : 'La página no tiene Instagram conectado'}</option>
            </select>
          </Field>
          <Field label="WhatsApp">
            <span className="ads-note">
              {page?.whatsapp
                ? `Los mensajes llegan al ${page.whatsapp}.`
                : 'Al número de WhatsApp conectado a la página (en su configuración, «WhatsApp»).'}
            </span>
          </Field>
        </div>
      </section>

      <section className="ads-card" aria-labelledby={`${ids}-budget`}>
        <h4 id={`${ids}-budget`}>Presupuesto y fechas</h4>
        <div className="ads-fields">
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
          <Field label="Empieza" htmlFor={`${ids}-start`} note={start ? null : 'En cuanto la actives'}>
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

      <section className="ads-card" aria-labelledby={`${ids}-copy`}>
        <h4 id={`${ids}-copy`}>Texto</h4>
        <div className="ads-fields">
          <Field label="Texto" htmlFor={`${ids}-text`}>
            <textarea
              id={`${ids}-text`}
              className="input ads-textarea"
              rows={4}
              value={settings.texto}
              placeholder="Lo que se lee encima de la imagen"
              onChange={(e) => update({ texto: e.target.value })}
            />
          </Field>
          <Field label="Titular" htmlFor={`${ids}-headline`}>
            <input
              id={`${ids}-headline`}
              className="input ads-wide"
              value={settings.titular}
              placeholder="Opcional: debajo de la imagen"
              onChange={(e) => update({ titular: e.target.value })}
            />
          </Field>
          <Field label="Mensaje" htmlFor={`${ids}-greeting`} note="Lo que aparece ya escrito en WhatsApp, listo para enviar.">
            <input id={`${ids}-greeting`} className="input ads-wide" value={settings.saludo} onChange={(e) => update({ saludo: e.target.value })} />
          </Field>
        </div>
      </section>

      <section className="ads-card" aria-labelledby={`${ids}-media`}>
        <h4 id={`${ids}-media`}>
          Imágenes y vídeos <span className="ads-count">{creatives.length ? `· ${creatives.length === 1 ? '1 anuncio' : `${creatives.length} anuncios`}` : ''}</span>
        </h4>
        <p className="ads-hint">Cada una es un anuncio, con el mismo texto, en el mismo conjunto.</p>
        <DropZone onFiles={addFiles} disabled={busy} />
        {creatives.length > 0 && (
          <ul className="ads-creatives">
            {creatives.map((c) => (
              <li key={c.key} className="ads-creative">
                <div className="ads-thumb">
                  {c.tipo === 'imagen' ? <img src={c.preview} alt="" /> : <video src={c.preview} muted preload="metadata" />}
                  <span className="ads-thumb-kind" aria-hidden="true">
                    {c.tipo === 'imagen' ? <Icon.Image /> : <Icon.Video />}
                  </span>
                </div>
                <input
                  className="input ads-creative-name"
                  aria-label={`Nombre del anuncio de ${c.file.name}`}
                  value={c.nombre}
                  disabled={busy}
                  onChange={(e) => setCreatives((list) => list.map((x) => (x.key === c.key ? { ...x, nombre: e.target.value } : x)))}
                />
                <button type="button" className="icon-btn" aria-label={`Quitar ${c.file.name}`} disabled={busy} onClick={() => removeCreative(c.key)}>
                  <Icon.Close />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ads-card ads-launch" aria-labelledby={`${ids}-launch`}>
        <h4 id={`${ids}-launch`} className="sr-only">
          Crear la campaña
        </h4>
        {phase.kind === 'done' ? (
          <LaunchResult launch={phase.launch} onLaunch={onLaunch} onAnother={another} />
        ) : (
          <>
            <Field label="Campaña" htmlFor={`${ids}-name`}>
              <input id={`${ids}-name`} className="input ads-wide" value={campaign} disabled={busy} onChange={(e) => setName(e.target.value)} />
            </Field>
            <div className="ads-launch-row">
              <p className="ads-launch-note" aria-live="polite">
                {phase.kind === 'uploading'
                  ? `Subiendo ${phase.done + 1} de ${phase.total}…`
                  : phase.kind === 'creating'
                    ? 'Creando la campaña y los anuncios…'
                    : (blocked ??
                      `Mensajes a WhatsApp · ${money(settings.presupuesto, account.moneda)} al día · ${creatives.length === 1 ? '1 anuncio' : `${creatives.length} anuncios`} · todo en pausa`)}
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

      {launches.length > 0 && <RecentLaunches launches={launches} onLaunch={onLaunch} />}
    </div>
  )
}

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
        <p className="ads-note">Guarda la página, el presupuesto, el público, las ubicaciones y los textos. Las imágenes no.</p>
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
