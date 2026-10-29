import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  budgetText,
  DEFAULT_SETTINGS,
  ENHANCEMENTS,
  MAX_QUESTIONS,
  metaApi,
  uploadMedia,
  type AdAccount,
  type AdContent,
  type AdSettings,
  type AdVersion,
  type Audience,
  type Bid,
  type EditChanges,
  type EditDetails,
  type Enhancement,
  type Level,
  type MediaPreview,
  type MetaPage,
  type Variants,
} from '../ads'
import { formatOf, FORMATOS, type Formato } from '../placements'
import { cx } from '../util'
import { errorText } from './Ads'
import { CHAT_STARTS, ChatPreview, Chips, Field, GENDERS, PlacePicker, Questions, range } from './AdsComposer'
import { measure, type Creative } from './AdsMedia'
import { PlacementPicker, type PlacementMode } from './AdsPlacements'
import { AdPreview } from './AdsPreview'
import type { AdderProps, EditorProps } from './AdsRunning'
import * as Icon from './Icons'
import { Switch } from './Switch'

const BIDS: Array<{ value: Exclude<Bid, 'otra'>; label: string }> = [
  { value: 'volumen', label: 'Volumen máximo' },
  { value: 'coste', label: 'Objetivo de coste' },
  { value: 'puja', label: 'Límite de puja' },
]
const BID_NOTES: Record<Bid, string> = {
  volumen: 'Meta consigue todos los resultados que pueda con el presupuesto.',
  coste: 'Meta intenta que cada resultado cueste, de media, lo que pongas.',
  puja: 'Meta no puja más de lo que pongas en cada subasta.',
  otra: 'Otra estrategia elegida en Meta: se mantiene si no eliges otra.',
}
const OPTIMIZATION: Record<string, string> = {
  CONVERSATIONS: 'Conversaciones',
  LINK_CLICKS: 'Clics en el enlace',
  REACH: 'Alcance',
  IMPRESSIONS: 'Impresiones',
  LEAD_GENERATION: 'Clientes potenciales',
  OFFSITE_CONVERSIONS: 'Conversiones',
  THRUPLAY: 'Reproducciones',
}
/** Meta admite 5 de cada texto: el principal y 4 opciones más. */
const MAX_VARIANTS = 4
const NO_VARIANTS: Variants = { textos: [], titulos: [], descripciones: [] }

const WORDS: Record<Level, { el: string; saved: string }> = {
  campana: { el: 'la campaña', saved: 'guardada' },
  conjunto: { el: 'el conjunto', saved: 'guardado' },
  anuncio: { el: 'el anuncio', saved: 'guardado' },
}

/**
 * Editar una campaña, un conjunto o un anuncio de Meta que ya está publicado, sin pasar por el Administrador de
 * anuncios. Cada formulario manda solo lo que se ha cambiado.
 */
export function MetaEditor({ account, level, row, onCancel, onSaved }: EditorProps) {
  const heading = useRef<HTMLHeadingElement>(null)
  const [data, setData] = useState<EditDetails | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    metaApi.details(account.id, level, row.id).then(setData, (err) => setError(errorText(err)))
  }, [account.id, level, row.id])
  useEffect(load, [load])
  useEffect(() => heading.current?.focus(), [])

  const save = async (cambios: EditChanges) => {
    const saved = await metaApi.update(account.id, level, row.id, cambios)
    const review = cambios.contenido || cambios.versiones ? ' Meta lo vuelve a revisar antes de enseñar los cambios.' : ''
    onSaved(`${capitalize(WORDS[level].el)} «${saved.nombre}», ${WORDS[level].saved}.${review}`)
  }

  return (
    <div className="ads-edit">
      <header className="ads-composer-head">
        <h3 ref={heading} tabIndex={-1}>
          Editar {WORDS[level].el} «{row.nombre}»
        </h3>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </header>
      {!data ? (
        error ? (
          <div className="ads-error-box" role="alert">
            <p>{error}</p>
            <button type="button" className="btn" onClick={load}>
              Reintentar
            </button>
          </div>
        ) : (
          <p className="ads-loading" aria-busy="true">
            Leyendo cómo está en Meta…
          </p>
        )
      ) : level === 'campana' ? (
        <CampaignForm data={data} account={account} onSave={save} />
      ) : level === 'conjunto' ? (
        <AdSetForm data={data} account={account} onSave={save} />
      ) : (
        <AdForm data={data} account={account} onSave={save} />
      )}
    </div>
  )
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

interface FormProps {
  data: EditDetails
  account: AdAccount
  onSave: (cambios: EditChanges) => Promise<void>
}

/** Guardar: con lo que hay pendiente dicho al lado, y el error si Meta (o Google) no lo acepta. */
export function useSave<T>(onSave: (cambios: T) => Promise<void>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (build: () => T | Promise<T>) => {
    setBusy(true)
    setError(null)
    try {
      await onSave(await build())
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }
  return { busy, error, run }
}

export function SaveBar({
  changed,
  busy,
  error,
  note,
  label = 'Guardar',
  onSave,
}: {
  changed: boolean
  busy: boolean
  error: string | null
  note?: ReactNode
  label?: string
  onSave: () => void
}) {
  return (
    <section className="ads-card ads-launch" aria-label="Guardar">
      <div className="ads-launch-row">
        <p className="ads-launch-note" aria-live="polite">
          {busy ? 'Guardando…' : (note ?? (changed ? 'Hay cambios sin guardar.' : 'Sin cambios.'))}
        </p>
        <button type="button" className="btn is-accent" disabled={!changed || busy} onClick={onSave}>
          {busy ? 'Guardando…' : label}
        </button>
      </div>
      {error && (
        <p className="ads-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

/** Un importe en la moneda de la cuenta. */
export function MoneyInput({ id, value, currency, onChange }: { id: string; value: number; currency: string; onChange: (value: number) => void }) {
  return (
    <span className="ads-money">
      <input
        id={id}
        className="input ads-amount"
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
      <span>{currency}</span>
    </span>
  )
}

export function NameCard({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <section className="ads-card ads-name" aria-label="Nombre">
      <Field label={label} htmlFor={id}>
        <input id={id} className="input ads-wide" value={value} onChange={(e) => onChange(e.target.value)} />
      </Field>
    </section>
  )
}

// ── Campaña ──

function CampaignForm({ data, onSave }: FormProps) {
  const ids = useId()
  const c = data.campana!
  const { busy, error, run } = useSave<EditChanges>(onSave)
  const [name, setName] = useState(data.nombre)
  const [amount, setAmount] = useState(c.presupuesto?.cantidad ?? Number.NaN)
  const [bid, setBid] = useState<Bid>(c.puja)
  const [capOn, setCapOn] = useState(c.limiteGasto !== null)
  const [cap, setCap] = useState(c.limiteGasto ?? Number.NaN)

  const changes: EditChanges = {}
  if (name.trim() !== data.nombre) changes.nombre = name.trim()
  if (c.presupuesto && amount !== c.presupuesto.cantidad) changes.presupuesto = amount
  if (c.presupuesto && bid !== c.puja && bid !== 'otra') changes.puja = bid
  if (capOn !== (c.limiteGasto !== null) || (capOn && cap !== c.limiteGasto)) changes.limiteGasto = capOn ? cap : null
  const changed = Object.keys(changes).length > 0

  return (
    <>
      <NameCard id={`${ids}-name`} label="Campaña" value={name} onChange={setName} />
      <section className="ads-card" aria-labelledby={`${ids}-budget`}>
        <h4 id={`${ids}-budget`}>Presupuesto y puja</h4>
        <div className="ads-fields">
          {c.presupuesto ? (
            <>
              <Field label={c.presupuesto.tipo === 'dia' ? 'Al día' : 'En total'} htmlFor={`${ids}-amount`} note="Meta lo reparte entre los conjuntos de la campaña.">
                <MoneyInput id={`${ids}-amount`} value={amount} currency={data.moneda} onChange={setAmount} />
              </Field>
              <Field label="Puja" note={BID_NOTES[bid] + (bid === 'coste' || bid === 'puja' ? ' El importe se pone en cada conjunto.' : '')}>
                <Chips label="Estrategia de puja" options={BIDS} value={bid === 'otra' ? ('' as Exclude<Bid, 'otra'>) : bid} onChange={setBid} />
              </Field>
            </>
          ) : (
            <Field label="Presupuesto">
              <span className="ads-note">Esta campaña no reparte presupuesto: va en cada conjunto, igual que la puja.</span>
            </Field>
          )}
        </div>
      </section>
      <section className="ads-card" aria-labelledby={`${ids}-cap`}>
        <h4 id={`${ids}-cap`}>Límite de gasto</h4>
        <div className="ads-fields">
          <Field label="Con límite" note="Cuando la campaña llega a esta cantidad en total, deja de gastar. Meta pide al menos unos 100 USD.">
            <Switch checked={capOn} label="Límite de gasto de la campaña" onChange={setCapOn} />
          </Field>
          {capOn && (
            <Field label="Hasta" htmlFor={`${ids}-capamount`}>
              <MoneyInput id={`${ids}-capamount`} value={cap} currency={data.moneda} onChange={setCap} />
            </Field>
          )}
        </div>
      </section>
      <SaveBar changed={changed} busy={busy} error={error} onSave={() => void run(() => changes)} />
    </>
  )
}

// ── Conjunto ──

function AdSetForm({ data, onSave }: FormProps) {
  const ids = useId()
  const s = data.conjunto!
  const { busy, error, run } = useSave<EditChanges>(onSave)
  const [name, setName] = useState(data.nombre)
  const [amount, setAmount] = useState(s.presupuesto?.cantidad ?? Number.NaN)
  const [start, setStart] = useState(s.inicio ?? '')
  const [noEnd, setNoEnd] = useState(s.fin === null)
  const [end, setEnd] = useState(s.fin ?? '')
  const [bid, setBid] = useState<Bid>(s.puja)
  const [bidAmount, setBidAmount] = useState(s.importePuja ?? Number.NaN)
  const [audience, setAudience] = useState<Audience>(s.publico)
  const update = (changes: Partial<Audience>) => setAudience((a) => ({ ...a, ...changes }))
  const withAmount = bid === 'coste' || bid === 'puja'
  const minAge = audience.advantage ? Math.min(audience.edadMin, 25) : audience.edadMin

  const changes: EditChanges = {}
  if (name.trim() !== data.nombre) changes.nombre = name.trim()
  if (s.presupuesto && amount !== s.presupuesto.cantidad) changes.presupuesto = amount
  if (!s.empezado && start !== (s.inicio ?? '')) changes.inicio = start || null
  if (noEnd !== (s.fin === null) || (!noEnd && end !== (s.fin ?? ''))) changes.fin = noEnd ? null : end
  if (!s.pujaEnCampana && bid !== s.puja && bid !== 'otra') changes.puja = bid
  if (withAmount && (bidAmount !== s.importePuja || changes.puja)) changes.importePuja = bidAmount
  if (JSON.stringify({ ...audience, edadMin: minAge }) !== JSON.stringify(s.publico)) changes.publico = { ...audience, edadMin: minAge }
  const changed = Object.keys(changes).length > 0

  return (
    <>
      <NameCard id={`${ids}-name`} label="Conjunto" value={name} onChange={setName} />
      <section className="ads-card" aria-labelledby={`${ids}-budget`}>
        <h4 id={`${ids}-budget`}>Presupuesto, fechas y puja</h4>
        <div className="ads-fields">
          {s.presupuesto ? (
            <Field label={s.presupuesto.tipo === 'dia' ? 'Al día' : 'En total'} htmlFor={`${ids}-amount`} note="Si lo bajas, Meta pide que siga siendo algo más de lo ya gastado.">
              <MoneyInput id={`${ids}-amount`} value={amount} currency={data.moneda} onChange={setAmount} />
            </Field>
          ) : (
            <Field label="Presupuesto">
              <span className="ads-note">
                Usa el de la campaña
                {s.presupuestoCampana ? ` (${budgetText(s.presupuestoCampana, data.moneda)})` : ''}: se cambia editando la campaña.
              </span>
            </Field>
          )}
          <Field label="Empieza" htmlFor={`${ids}-start`} note={s.empezado ? 'Ya ha empezado: no se puede cambiar.' : start ? null : 'En cuanto lo actives'}>
            {s.empezado ? (
              <span>{s.inicio ? formatDay(s.inicio) : 'Desde que se activó'}</span>
            ) : (
              <input id={`${ids}-start`} className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            )}
          </Field>
          <Field label="Termina" htmlFor={`${ids}-end`} note={s.presupuesto?.tipo === 'total' ? 'Con presupuesto total hace falta una fecha de fin.' : null}>
            <span className="ads-end">
              {!noEnd && <input id={`${ids}-end`} className="input" type="date" min={start || undefined} value={end} onChange={(e) => setEnd(e.target.value)} />}
              {s.presupuesto?.tipo !== 'total' && (
                <label className="ads-check">
                  <input
                    type="checkbox"
                    checked={noEnd}
                    onChange={(e) => {
                      setNoEnd(e.target.checked)
                      if (!e.target.checked && !end) setEnd(s.fin ?? '')
                    }}
                  />
                  Sin fecha de fin
                </label>
              )}
            </span>
          </Field>
          <Field label="Puja" note={s.pujaEnCampana ? `${BID_NOTES[bid]} La estrategia es la de la campaña.` : BID_NOTES[bid]}>
            {s.pujaEnCampana ? (
              <span>{BIDS.find((b) => b.value === bid)?.label ?? 'Otra (la de Meta)'}</span>
            ) : (
              <Chips label="Estrategia de puja" options={BIDS} value={bid === 'otra' ? ('' as Exclude<Bid, 'otra'>) : bid} onChange={setBid} />
            )}
          </Field>
          {withAmount && (
            <Field label={bid === 'coste' ? 'Coste por resultado' : 'Puja máxima'} htmlFor={`${ids}-bid`}>
              <MoneyInput id={`${ids}-bid`} value={bidAmount} currency={data.moneda} onChange={setBidAmount} />
            </Field>
          )}
        </div>
      </section>

      <section className="ads-card" aria-labelledby={`${ids}-audience`}>
        <h4 id={`${ids}-audience`}>Público</h4>
        {audience.extras.length > 0 && <p className="ads-hint">También tiene {joinWords(audience.extras)}, que no se ven aquí: se quedan como están.</p>}
        <div className="ads-fields">
          <Field label="Lugares" htmlFor={`${ids}-places`}>
            <PlacePicker id={`${ids}-places`} places={audience.lugares} onChange={(lugares) => update({ lugares })} />
          </Field>
          <Field
            label="Advantage+"
            note={audience.advantage ? 'Meta decide la edad máxima y el sexo según dónde encuentre más resultados.' : 'Desactivado: la edad y el sexo son límites estrictos.'}
          >
            <Switch checked={audience.advantage} label="Público Advantage+" onChange={(advantage) => update({ advantage })} />
          </Field>
          <Field label="Edad" htmlFor={`${ids}-age`} note={audience.advantage ? 'Con Advantage+, la mínima es como mucho 25.' : null}>
            <span className="ads-age">
              <select id={`${ids}-age`} className="input" aria-label="Edad mínima" value={minAge} onChange={(e) => update({ edadMin: Number(e.target.value) })}>
                {range(18, audience.advantage ? 25 : 65).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              {!audience.advantage && (
                <>
                  <span aria-hidden="true">–</span>
                  <select className="input" aria-label="Edad máxima" value={audience.edadMax} onChange={(e) => update({ edadMax: Number(e.target.value) })}>
                    {range(Math.max(18, audience.edadMin), 65).map((n) => (
                      <option key={n} value={n}>
                        {n === 65 ? '65+' : n}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </span>
          </Field>
          {!audience.advantage && (
            <Field label="Sexo">
              <Chips label="Sexo" options={GENDERS} value={audience.genero} onChange={(genero) => update({ genero })} />
            </Field>
          )}
        </div>
      </section>

      <section className="ads-card" aria-labelledby={`${ids}-placements`}>
        <h4 id={`${ids}-placements`}>Ubicaciones</h4>
        <PlacementPicker mode={audience.ubicaciones} chosen={audience.posiciones} onChange={(ubicaciones, posiciones) => update({ ubicaciones, posiciones })} />
      </section>

      <section className="ads-card" aria-labelledby={`${ids}-fixed`}>
        <h4 id={`${ids}-fixed`}>Lo que Meta no deja cambiar</h4>
        <p className="ads-hint">
          Optimización: {OPTIMIZATION[s.optimizacion ?? ''] ?? s.optimizacion ?? '—'}
          {s.destino === 'WHATSAPP' ? ' · a WhatsApp' : ''}
          {s.whatsapp ? ` (${s.whatsapp})` : ''}. Para cambiarlo, duplica el conjunto en otra campaña o crea uno nuevo.
        </p>
      </section>
      <SaveBar changed={changed} busy={busy} error={error} onSave={() => void run(() => changes)} />
    </>
  )
}

const joinWords = (list: string[]) => (list.length < 2 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} y ${list.at(-1)}`)
const formatDay = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

// ── Anuncio ──

function AdForm({ data, account, onSave }: FormProps) {
  const ids = useId()
  const a = data.anuncio!
  const { busy, error, run } = useSave<EditChanges>(onSave)
  const [name, setName] = useState(data.nombre)

  if (!a.editable || !a.contenido) {
    const changed = name.trim() !== data.nombre
    return (
      <>
        <NameCard id={`${ids}-name`} label="Anuncio" value={name} onChange={setName} />
        <section className="ads-card">
          <p className="ads-hint">{a.motivo}</p>
        </section>
        <SaveBar changed={changed} busy={busy} error={error} onSave={() => void run(() => ({ nombre: name.trim() }))} />
      </>
    )
  }
  return (
    <AdContentEditor
      account={account}
      name={data.nombre}
      initial={a.contenido}
      versions={a.versiones}
      placements={a.ubicaciones}
      mode="edit"
      busy={busy}
      error={error}
      onSubmit={(result) =>
        void run(() => {
          const changes: EditChanges = {}
          if (result.nombre !== data.nombre) changes.nombre = result.nombre
          if (result.contentChanged) changes.contenido = result.contenido
          if (result.versiones) changes.versiones = result.versiones
          return changes
        })
      }
    />
  )
}

/** Un hueco de imagen o vídeo de un formato: el que ya tiene el anuncio (`medio`) o uno nuevo (que se sube al guardar). */
interface Slot {
  tipo: 'imagen' | 'video'
  preview: string | null
  ratio: number | null
  file: File | null
  medio: MediaPreview | null
}

type Slots = Partial<Record<Formato, Slot>>

const slotsOf = (versions: Array<{ formato: Formato; medio: MediaPreview }>): Slots =>
  Object.fromEntries(
    versions.map((v) => [
      v.formato,
      {
        tipo: v.medio.tipo,
        preview: v.medio.url,
        ratio: v.medio.ratio,
        file: null,
        medio: v.medio,
      },
    ]),
  )

/** La proporción de cada formato (para las que no se han podido medir). */
const RATIO: Record<Formato, number> = {
  '4:5': 4 / 5,
  '1:1': 1,
  '9:16': 9 / 16,
  '16:9': 16 / 9,
}

/** Las ubicaciones de un conjunto, como llegan de Meta. */
type AdSetPlacements = { ubicaciones: PlacementMode; posiciones: string[] }

interface ContentResult {
  nombre: string
  contenido: AdContent
  contentChanged: boolean
  /** Todas las versiones, solo si se ha cambiado alguna. */
  versiones?: AdVersion[]
}

/**
 * El contenido de un anuncio (uno que se edita o uno nuevo en el conjunto): una imagen o un vídeo por formato (cada
 * uno va en sus ubicaciones, que son las del conjunto), los textos (con sus otras opciones, como en el Administrador
 * de anuncios), el Instagram, el chat de WhatsApp y las mejoras; con la vista previa al lado.
 */
function AdContentEditor({
  account,
  name: initialName,
  initial,
  versions,
  placements,
  mode,
  busy,
  error,
  submitLabel = 'Guardar',
  onSubmit,
}: {
  account: AdAccount
  name: string
  initial: AdContent
  versions: Array<{ formato: Formato; medio: MediaPreview }>
  placements: AdSetPlacements | null
  mode: 'edit' | 'new'
  busy: boolean
  error: string | null
  submitLabel?: string
  onSubmit: (result: ContentResult) => void
}) {
  const ids = useId()
  const [name, setName] = useState(initialName)
  const [content, setContent] = useState<AdContent>(initial)
  const [slots, setSlots] = useState<Slots>(() => slotsOf(versions))
  const [pages, setPages] = useState<MetaPage[] | null>(null)
  const [uploading, setUploading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const update = (changes: Partial<AdContent>) => setContent((c) => ({ ...c, ...changes }))
  const setVariants = (changes: Partial<Variants>) => setContent((c) => ({ ...c, variantes: { ...c.variantes, ...changes } }))

  useEffect(() => {
    metaApi.pages(account.id).then(setPages, () => setPages([]))
  }, [account.id])
  // Las vistas previas de los archivos nuevos se liberan al salir.
  const slotsRef = useRef(slots)
  slotsRef.current = slots
  useEffect(() => () => Object.values(slotsRef.current).forEach((slot) => slot?.file && slot.preview && URL.revokeObjectURL(slot.preview)), [])

  const page = pages?.find((p) => p.id === content.pagina) ?? null
  const filled = FORMATOS.filter((f) => slots[f.value]).map((f) => f.value)
  const single = filled.length <= 1
  const hasVariants = Object.values(content.variantes).some((list) => list.length)
  const versionsChanged =
    filled.some((f) => slots[f]?.file) ||
    filled.join() !==
      versions
        .map((v) => v.formato)
        .sort(byOrder)
        .join()
  const contentChanged = JSON.stringify(content) !== JSON.stringify(initial)
  const changed = mode === 'new' || name.trim() !== initialName || contentChanged || versionsChanged
  const blocked = !content.texto.trim()
    ? 'Falta el texto principal.'
    : !filled.length
      ? 'Falta la imagen o el vídeo.'
      : !single && hasVariants
        ? 'Con varias versiones, cada texto va uno solo: quita las otras opciones o deja una versión.'
        : null

  const pick = async (file: File | undefined, formato: Formato) => {
    if (!file) return
    const tipo = file.type.startsWith('image/') ? 'imagen' : file.type.startsWith('video/') ? 'video' : null
    if (!tipo) return setLocalError('Solo imágenes o vídeos.')
    const others = filled.filter((f) => f !== formato).map((f) => slots[f]!)
    if (others.some((o) => o.tipo !== tipo)) return setLocalError('Todas las versiones tienen que ser imágenes o todas vídeos.')
    setLocalError(null)
    const preview = URL.createObjectURL(file)
    const ratio = await measure(file, tipo, preview)
    setSlots((current) => {
      const old = current[formato]
      if (old?.file && old.preview) URL.revokeObjectURL(old.preview)
      return {
        ...current,
        [formato]: { tipo, preview, ratio, file, medio: null },
      }
    })
  }

  const removeSlot = (formato: Formato) =>
    setSlots((current) => {
      const old = current[formato]
      if (old?.file && old.preview) URL.revokeObjectURL(old.preview)
      const next = { ...current }
      delete next[formato]
      return next
    })

  const submit = async () => {
    if (blocked) return
    setUploading(true)
    setLocalError(null)
    try {
      let versiones: AdVersion[] | undefined
      if (versionsChanged || mode === 'new') {
        versiones = []
        for (const formato of filled) {
          const slot = slots[formato]!
          versiones.push({
            formato,
            medio: slot.file ? await uploadMedia(account.id, slot.file) : slot.medio!,
          })
        }
      }
      setUploading(false)
      onSubmit({
        nombre: name.trim() || initialName,
        contenido: content,
        contentChanged: contentChanged || mode === 'new',
        versiones,
      })
    } catch (err) {
      setUploading(false)
      setLocalError(errorText(err))
    }
  }

  // La vista previa: lo que hay ahora en cada hueco (las que no se pueden ver, fuera). De un vídeo que ya tiene el
  // anuncio solo hay su fotograma: se enseña como imagen, con la proporción de su formato.
  const previewSettings: AdSettings = {
    ...DEFAULT_SETTINGS,
    ...content,
    cuenta: account.id,
  }
  const items = filled
    .filter((f) => slots[f]?.preview)
    .map((f): Creative => {
      const slot = slots[f]!
      return {
        key: f,
        file: slot.file as File,
        tipo: slot.file ? slot.tipo : 'imagen',
        preview: slot.preview!,
        medio: null,
        ratio: slot.file ? slot.ratio : RATIO[f],
      }
    })
  const drafts = items.length ? [{ key: 'anuncio', nombre: name, items }] : []
  const video = filled.length ? slots[filled[0]]!.tipo === 'video' : null

  return (
    <div className="ads-composer-layout">
      <div className="ads-composer">
        <NameCard id={`${ids}-name`} label="Anuncio" value={name} onChange={setName} />

        <section className="ads-card" aria-labelledby={`${ids}-media`}>
          <h4 id={`${ids}-media`}>Imagen o vídeo</h4>
          <p className="ads-hint">Una por formato, todas de la misma pieza. Cada una va en las ubicaciones que le tocan; la primera que haya (4:5, si la hay), en las demás.</p>
          <div className="ads-slots">
            {FORMATOS.map((f) => (
              <MediaSlot
                key={f.value}
                id={`${ids}-${f.value.replace(':', 'x')}`}
                format={f}
                slot={slots[f.value] ?? null}
                disabled={busy || uploading}
                onPick={(file) => void pick(file, f.value)}
                onRemove={() => removeSlot(f.value)}
              />
            ))}
          </div>
          <h5 className="ads-subtitle">Ubicaciones del conjunto</h5>
          {placements ? (
            <PlacementPicker
              mode={placements.ubicaciones}
              chosen={placements.posiciones}
              pieces={[filled]}
              video={video}
              readOnly
              note={
                placements.ubicaciones === 'auto'
                  ? 'Automáticas: Meta lo enseña en todas las que pueda. Se cambian editando el conjunto.'
                  : placements.ubicaciones === 'meta'
                    ? 'Elegidas en Meta, con alguna que Tablero no conoce. Se cambian editando el conjunto.'
                    : 'Las elegidas en el conjunto. Se cambian editando el conjunto.'
              }
            />
          ) : (
            <p className="ads-note">Leyendo las ubicaciones del conjunto…</p>
          )}
        </section>

        <section className="ads-card" aria-labelledby={`${ids}-copy`}>
          <h4 id={`${ids}-copy`}>Texto</h4>
          <div className="ads-fields">
            <Field label="Texto principal" htmlFor={`${ids}-text`}>
              <textarea id={`${ids}-text`} className="input ads-textarea" rows={4} value={content.texto} onChange={(e) => update({ texto: e.target.value })} />
            </Field>
            {mode === 'edit' && single && (
              <VariantList label="Otras opciones del texto" values={content.variantes.textos} multiline onChange={(textos) => setVariants({ textos })} />
            )}
            <Field label="Título" htmlFor={`${ids}-headline`}>
              <input id={`${ids}-headline`} className="input ads-wide" value={content.titular} placeholder="Opcional" onChange={(e) => update({ titular: e.target.value })} />
            </Field>
            {mode === 'edit' && single && <VariantList label="Otras opciones del título" values={content.variantes.titulos} onChange={(titulos) => setVariants({ titulos })} />}
            <Field label="Descripción" htmlFor={`${ids}-description`}>
              <input
                id={`${ids}-description`}
                className="input ads-wide"
                value={content.descripcion}
                placeholder="Opcional"
                onChange={(e) => update({ descripcion: e.target.value })}
              />
            </Field>
            {mode === 'edit' && single && (
              <VariantList label="Otras opciones de la descripción" values={content.variantes.descripciones} onChange={(descripciones) => setVariants({ descripciones })} />
            )}
            {page && (
              <Field label="Instagram" htmlFor={`${ids}-ig`}>
                <select id={`${ids}-ig`} className="input" value={content.instagram ?? ''} onChange={(e) => update({ instagram: e.target.value || null })}>
                  {page.instagrams.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.usuario ? `@${i.usuario}` : `La de tus anuncios anteriores (${i.id})`}
                    </option>
                  ))}
                  {content.instagram && !page.instagrams.some((i) => i.id === content.instagram) && (
                    <option value={content.instagram}>La que tiene ahora ({content.instagram})</option>
                  )}
                  <option value="">Sin Instagram (como la página)</option>
                </select>
              </Field>
            )}
          </div>
        </section>

        <section className="ads-card" aria-labelledby={`${ids}-chat`}>
          <h4 id={`${ids}-chat`}>Chat de WhatsApp</h4>
          <div className="ads-chat">
            <div className="ads-fields">
              <Field label="Vuestro mensaje" htmlFor={`${ids}-welcome`}>
                <textarea
                  id={`${ids}-welcome`}
                  className="input ads-textarea is-short"
                  rows={2}
                  value={content.bienvenida}
                  onChange={(e) => update({ bienvenida: e.target.value })}
                />
              </Field>
              <Field label="Para empezar">
                <Chips label="Para empezar" options={CHAT_STARTS} value={content.tipoMensaje} onChange={(tipoMensaje) => update({ tipoMensaje })} />
              </Field>
              {content.tipoMensaje === 'escrito' ? (
                <Field label="Su mensaje" htmlFor={`${ids}-greeting`}>
                  <input id={`${ids}-greeting`} className="input ads-wide" value={content.saludo} onChange={(e) => update({ saludo: e.target.value })} />
                </Field>
              ) : (
                <Field label="Preguntas" note={`Hasta ${MAX_QUESTIONS}.`}>
                  <Questions value={content.preguntas} onChange={(preguntas) => update({ preguntas })} />
                </Field>
              )}
            </div>
            <ChatPreview settings={previewSettings} page={page} />
          </div>
        </section>

        <section className="ads-card" aria-labelledby={`${ids}-auto`}>
          <h4 id={`${ids}-auto`}>Mejoras automáticas de Meta</h4>
          <div className="ads-fields">
            <Field label="Multianunciante" note={content.multianunciante ? 'Puede salir junto a anuncios de otras empresas.' : 'No sale junto a anuncios de otras empresas.'}>
              <Switch checked={content.multianunciante} label="Anuncios multianunciante" onChange={(multianunciante) => update({ multianunciante })} />
            </Field>
          </div>
          <div className="ads-enhancements">
            {(['visual', 'texto'] as const).map((group) => (
              <fieldset key={group} className="ads-enhancement-group">
                <legend>{group === 'visual' ? 'Imagen y vídeo' : 'Texto y extras'}</legend>
                {ENHANCEMENTS.filter((e) => e.group === group).map((e) => (
                  <label key={e.key} className="ads-metric-option">
                    <input
                      type="checkbox"
                      checked={content.mejoras.includes(e.key)}
                      onChange={(ev) =>
                        update({
                          mejoras: ENHANCEMENTS.map((x) => x.key).filter((k): k is Enhancement => (k === e.key ? ev.target.checked : content.mejoras.includes(k))),
                        })
                      }
                    />
                    <span>
                      {e.label}
                      <small>{e.note}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
        </section>

        <SaveBar
          changed={changed && !blocked}
          busy={busy || uploading}
          error={localError ?? error}
          label={submitLabel}
          note={
            uploading
              ? 'Subiendo la imagen o el vídeo…'
              : (blocked ??
                (mode === 'new'
                  ? 'Se crea en pausa: enciéndelo con su interruptor.'
                  : changed
                    ? 'Al guardar, Meta vuelve a revisar el anuncio (conserva sus métricas).'
                    : 'Sin cambios.'))
          }
          onSave={() => void submit()}
        />
      </div>
      <aside className="ads-preview-column" aria-label="Vista previa del anuncio">
        <AdPreview settings={previewSettings} page={page} drafts={drafts} placements={placements} />
      </aside>
    </div>
  )
}

const ORDER = FORMATOS.map((f) => f.value)
const byOrder = (a: Formato, b: Formato) => ORDER.indexOf(a) - ORDER.indexOf(b)

function MediaSlot({
  id,
  format,
  slot,
  disabled,
  onPick,
  onRemove,
}: {
  id: string
  format: (typeof FORMATOS)[number]
  slot: Slot | null
  disabled: boolean
  onPick: (file: File | undefined) => void
  onRemove: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  // Una nueva de otra proporción: Meta la recorta para este formato.
  const measured = slot?.file ? formatOf(slot.ratio) : null
  return (
    <div className={cx('ads-slot', !slot && 'is-empty')}>
      <div className="ads-slot-frame">
        <div
          className="ads-slot-media"
          style={{
            aspectRatio: RATIO[format.value],
            [RATIO[format.value] >= 1 ? 'width' : 'height']: '100%',
          }}
        >
          {slot?.preview ? (
            slot.tipo === 'video' && slot.file ? (
              <video src={slot.preview} muted playsInline />
            ) : (
              <img src={slot.preview} alt="" referrerPolicy="no-referrer" />
            )
          ) : slot ? (
            <Icon.Video />
          ) : (
            <span className="ads-slot-ratio" aria-hidden="true">
              {format.value}
            </span>
          )}
          {slot?.tipo === 'video' && <span className="ads-slot-badge">Vídeo</span>}
        </div>
      </div>
      <div className="ads-slot-text">
        <strong>
          {format.label} <span className="ads-format">{format.value}</span>
        </strong>
        <span className="ads-note">
          {format.size} · {format.where}
        </span>
        <span className={cx('ads-note', measured && measured !== format.value && 'is-warning')}>
          {slot
            ? slot.file
              ? measured && measured !== format.value
                ? `Nueva, pero es ${measured}: Meta la recortará.`
                : `Nueva: ${slot.file.name}`
              : 'La que tiene ahora'
            : 'Opcional'}
        </span>
        <span className="ads-slot-actions">
          <input
            ref={input}
            id={id}
            type="file"
            accept="image/*,video/*"
            className="sr-only"
            disabled={disabled}
            onChange={(e) => {
              onPick(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <button type="button" className="btn" disabled={disabled} aria-label={`${slot ? 'Cambiar' : 'Elegir'} la ${format.value}`} onClick={() => input.current?.click()}>
            {slot ? 'Cambiar…' : 'Elegir…'}
          </button>
          {slot && (
            <button type="button" className="link-btn" disabled={disabled} aria-label={`Quitar la ${format.value}`} onClick={onRemove}>
              Quitar
            </button>
          )}
        </span>
      </div>
    </div>
  )
}

/** Las otras opciones de un texto (hasta 4): Meta enseña la combinación que mejor funcione. */
function VariantList({ label, values, multiline = false, onChange }: { label: string; values: string[]; multiline?: boolean; onChange: (values: string[]) => void }) {
  const set = (i: number, value: string) => onChange(values.map((v, j) => (j === i ? value : v)))
  return (
    <div className="field ads-field ads-variants">
      <span className="field-label">{label}</span>
      <div className="field-controls">
        {values.map((value, i) => (
          <span key={i} className="ads-variant">
            {multiline ? (
              <textarea className="input ads-textarea is-short" rows={2} aria-label={`${label} ${i + 1}`} value={value} onChange={(e) => set(i, e.target.value)} />
            ) : (
              <input className="input ads-wide" aria-label={`${label} ${i + 1}`} value={value} onChange={(e) => set(i, e.target.value)} />
            )}
            <button type="button" className="icon-btn" aria-label={`Quitar la opción ${i + 1}`} title="Quitar" onClick={() => onChange(values.filter((_, j) => j !== i))}>
              <Icon.Close />
            </button>
          </span>
        ))}
        {values.length < MAX_VARIANTS && (
          <button type="button" className="link-btn ads-variant-add" onClick={() => onChange([...values, ''])}>
            <Icon.Plus />
            Añadir otra opción
          </button>
        )}
      </div>
    </div>
  )
}

// ── Anuncio nuevo en un conjunto ──

/**
 * Un anuncio nuevo en el conjunto que se está viendo, con la página del conjunto y, para empezar, los textos y el
 * chat de uno de sus anuncios. Se crea en pausa.
 */
export function MetaAdder({ account, adSet, template, onCancel, onSaved }: AdderProps) {
  const heading = useRef<HTMLHeadingElement>(null)
  const [start, setStart] = useState<AdContent | null>(null)
  const [placements, setPlacements] = useState<AdSetPlacements | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => heading.current?.focus(), [])
  useEffect(() => {
    const blank = (pagina: string | null): AdContent => ({
      pagina,
      instagram: null,
      texto: '',
      titular: '',
      descripcion: '',
      bienvenida: DEFAULT_SETTINGS.bienvenida,
      tipoMensaje: DEFAULT_SETTINGS.tipoMensaje,
      saludo: DEFAULT_SETTINGS.saludo,
      preguntas: DEFAULT_SETTINGS.preguntas,
      mejoras: [],
      multianunciante: false,
      variantes: NO_VARIANTS,
    })
    Promise.all([metaApi.details(account.id, 'conjunto', adSet.id), template ? metaApi.details(account.id, 'anuncio', template.id).catch(() => null) : null]).then(
      ([set, ad]) => {
        const pagina = set.conjunto?.pagina ?? null
        if (set.conjunto)
          setPlacements({
            ubicaciones: set.conjunto.publico.ubicaciones,
            posiciones: set.conjunto.publico.posiciones,
          })
        const copied = ad?.anuncio?.editable && ad.anuncio.contenido ? { ...ad.anuncio.contenido, pagina, variantes: NO_VARIANTS } : null
        setStart(copied ?? blank(pagina))
      },
      (err) => setError(errorText(err)),
    )
  }, [account.id, adSet.id, template])

  const create = async (result: ContentResult) => {
    if (!result.versiones?.length) return
    setBusy(true)
    setSaveError(null)
    try {
      await metaApi.addAds({
        ...result.contenido,
        cuenta: account.id,
        conjunto: adSet.id,
        anuncios: [{ nombre: result.nombre, versiones: result.versiones }],
      })
      onSaved(`Anuncio «${result.nombre}» creado en pausa en «${adSet.nombre}». Enciéndelo con su interruptor cuando quieras.`)
    } catch (err) {
      setSaveError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <div className="ads-edit">
      <header className="ads-composer-head">
        <h3 ref={heading} tabIndex={-1}>
          Nuevo anuncio en «{adSet.nombre}»
        </h3>
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
      </header>
      {!start ? (
        error ? (
          <p className="ads-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="ads-loading" aria-busy="true">
            Preparando el anuncio…
          </p>
        )
      ) : (
        <>
          {template && <p className="ads-hint ads-edit-lead">Empieza con los textos y el chat de «{template.nombre}»: cámbialos si quieres.</p>}
          <AdContentEditor
            account={account}
            name="Anuncio nuevo"
            initial={start}
            versions={[]}
            placements={placements}
            mode="new"
            busy={busy}
            error={saveError}
            submitLabel="Crear en pausa"
            onSubmit={(result) => void create(result)}
          />
        </>
      )}
    </div>
  )
}
