// La ficha de una suscripción (se abre al lado de su tarjeta, como el detalle de una tarea) y la de una
// tarjeta (nueva o para editarla: solo un nombre y un color, nunca el número). Todo se guarda al
// momento, con deshacer; una suscripción nueva no se guarda hasta que tiene nombre, y ninguna se
// guarda sin él. «Columna» es la empresa (la columna del tablero) a la que pertenece: la alternativa
// a arrastrarla, también con el teclado.
import { useEffect, useId, useRef, useState } from 'react'
import { useActions, useBoard, useNow, useUI } from '../context'
import { formatDay, formatWhen, todayISO } from '../dates'
import { COLORS, newSubscription, type Card, type ColorKey, type Subscription } from '../model'
import { normalizeUrl, shortUrl } from '../projects'
import {
  CARD_NUMBER_MESSAGE,
  cardNameError,
  cardsOf,
  chargeAfter,
  columnChoices,
  CURRENCIES,
  daysBetween,
  findCard,
  findSubscription,
  isDay,
  parseMoney,
  periodLabel,
  periodUnit,
  PERIODS,
  REMIND_OPTIONS,
  remindLabel,
  reminderColumn,
  type SubscriptionPatch,
} from '../subscriptions'
import { cx, tint } from '../util'
import * as Icon from './Icons'
import { Popover } from './Popover'
import '../styles/suscripciones.css'

const CURRENCY_NAMES: Record<string, string> = { EUR: '€ EUR', USD: '$ USD', GBP: '£ GBP' }

/** El importe tal como se escribe en el campo: «12,99», «1299,00». */
const amountText = (cents: number) =>
  (cents / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** El primer color que no tenga ya otra tarjeta. */
const nextCardColor = (cards: Card[]): ColorKey =>
  COLORS.find((c) => !cards.some((card) => card.color === c.key))?.key ?? COLORS[cards.length % COLORS.length].key

/** El nombre para enseñarlo (una a medio crear puede no tenerlo aún). */
export const displayName = (sub: Subscription) => sub.name.trim() || 'Sin nombre'

/** «hoy», «ayer» o «el 20 sept»: para «Dada de baja …». */
export function onDay(day: string, now: Date) {
  const text = formatDay(day, now)
  return ['Hoy', 'Ayer', 'Mañana'].includes(text) ? text.toLowerCase() : `el ${text}`
}

/**
 * La ficha de una suscripción (o de una nueva, `id` null, que empieza con la tarjeta `cardId` y en la
 * columna `columnId`). Todo se guarda al momento. Al cerrarse, `onClose` recibe el id de la que enseñaba
 * (null si la nueva no se guardó).
 */
/** Valores de los menús que no son una columna ni una tarjeta. */
const NONE = ''
const NEW_CARD = '__nueva'

export function SubscriptionSheet({
  id: initialId,
  cardId: initialCard = null,
  columnId: initialColumn = null,
  anchor,
  onClose,
}: {
  id: string | null
  cardId?: string | null
  columnId?: string | null
  anchor: DOMRect
  onClose: (id: string | null) => void
}) {
  const board = useBoard()
  const actions = useActions()
  const ui = useUI()
  const now = useNow()
  const today = todayISO(now)
  const ids = useId()
  // Cada vez que se abre la ficha, sus ediciones de texto seguidas se agrupan en un paso de deshacer.
  const [session] = useState(() => crypto.randomUUID())
  // Una nueva no se guarda hasta que tiene nombre: hasta entonces, todo va al borrador.
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Subscription>(() =>
    newSubscription(
      {
        cardId: findCard(board, initialCard) ? initialCard : null,
        columnId: board.columns.some((c) => c.id === initialColumn) ? initialColumn : null,
      },
      today,
    ),
  )
  const id = initialId ?? createdId
  const stored = id ? findSubscription(board, id) : null
  const sub = id ? stored : draft
  // Un nombre vacío no se guarda: el campo enseña lo escrito y, mientras, vuelve el de antes (con el que
  // se queda si se cierra así).
  const originalName = useRef(stored?.name ?? '')
  const [blankName, setBlankName] = useState<string | null>(null)
  // «Próximo cobro» se guarda al salir del campo o con Enter, no a cada cifra: Chrome da una fecha
  // completa con cada una (el año 0002 al empezar a escribir 2028, enero al escribir el 1 de 12) y el
  // campo, que enseña el cobro recalculado, saltaría mientras se escribe.
  const [dateDraft, setDateDraft] = useState<string | null>(null)
  const [amount, setAmount] = useState(() => (stored ? amountText(stored.amount) : ''))
  const amountRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState(() => (stored?.url ? shortUrl(stored.url) : ''))
  const [urlDirty, setUrlDirty] = useState(false)
  const [urlTouched, setUrlTouched] = useState(false)
  const [cardEditor, setCardEditor] = useState<HTMLElement | null>(null)

  // Si desaparece (deshacer, otra ventana…), se cierra.
  useEffect(() => {
    if (id && !stored) onClose(id)
  }, [id, stored, onClose])

  // Si el importe cambia por otro lado (deshacer), el campo lo refleja mientras no se esté escribiendo en él.
  const storedAmount = sub?.amount
  useEffect(() => {
    if (storedAmount === undefined || document.activeElement === amountRef.current) return
    setAmount((text) => (text.trim() === '' && storedAmount === 0 ? text : amountText(storedAmount)))
  }, [storedAmount])

  const storedUrl = sub?.url
  useEffect(() => {
    if (!urlDirty) setUrl(storedUrl ? shortUrl(storedUrl) : '')
  }, [storedUrl, urlDirty])

  if (!sub) return null

  const isNew = initialId === null
  const draftMode = id === null
  const cancelled = Boolean(sub.cancelledOn)
  const cards = cardsOf(board)
  const card = findCard(board, sub.cardId)
  const columns = columnChoices(board, sub.columnId)
  const column = columns.find((c) => c.id === sub.columnId)
  // Dónde crea el servidor la tarea de aviso: en su columna (si no está archivada) o en la Bandeja.
  const reminderTarget = reminderColumn(board, sub)
  const reminderWhere = !reminderTarget || reminderTarget.inbox ? 'la Bandeja' : `«${reminderTarget.name}»`

  const update = (patch: SubscriptionPatch, coalesce?: string) => {
    if (id) return actions.updateSubscription(id, patch, coalesce)
    setDraft((d) => {
      const next = { ...d, ...patch } as Record<string, unknown>
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k]
      return next as unknown as Subscription
    })
  }

  // Al escribir la primera letra del nombre, la nueva se guarda con todo lo del borrador; crearla y
  // seguir escribiendo el nombre es un solo paso de deshacer. Si se vuelve a quedar sin nombre, se borra
  // en ese mismo paso y sigue como borrador: nunca hay una guardada sin nombre, ni ⌘Z la devuelve así.
  const nameKey = `sub-name:${session}`
  const setName = (name: string) => {
    if (!name.trim()) {
      if (!id) return setDraft((d) => ({ ...d, name }))
      if (!isNew) {
        setBlankName(name)
        return actions.updateSubscription(id, { name: originalName.current }, nameKey)
      }
      if (stored) setDraft({ ...stored, name })
      setCreatedId(null)
      return actions.deleteSubscription(id, nameKey)
    }
    setBlankName(null)
    if (id) return actions.updateSubscription(id, { name }, nameKey)
    const { id: _id, createdAt: _createdAt, ...input } = { ...draft, name }
    setCreatedId(actions.addSubscription(input, nameKey))
  }

  const parsedAmount = amount.trim() === '' ? 0 : parseMoney(amount)
  const setAmountText = (text: string) => {
    setAmount(text)
    const cents = text.trim() === '' ? 0 : parseMoney(text)
    if (cents !== null) update({ amount: cents }, `sub-amount:${session}`)
  }

  const normalizedUrl = normalizeUrl(url)
  const urlError = urlTouched && normalizedUrl === null
  /** Guarda el enlace escrito, si vale. true si eso ha sido un cambio (un paso de deshacer). */
  const commitUrl = () => {
    setUrlTouched(true)
    if (!urlDirty || normalizedUrl === null) return false
    setUrlDirty(false)
    setUrl(normalizedUrl ? shortUrl(normalizedUrl) : '')
    if ((normalizedUrl || undefined) === sub.url) return false
    update({ url: normalizedUrl || undefined })
    return Boolean(id)
  }

  // El próximo cobro (en una dada de baja, el que tocaría).
  const charge = chargeAfter(cancelled ? { ...sub, cancelledOn: undefined } : sub, today) ?? sub.billingDate
  /** Guarda la fecha escrita, si es un día de verdad (un año a medio escribir, como 0202, no lo es). */
  const commitDate = () => {
    if (dateDraft === null) return
    setDateDraft(null)
    if (isDay(dateDraft) && dateDraft !== charge) update({ billingDate: dateDraft })
  }
  const days = daysBetween(today, charge)
  const chargeNote = (days === 0 ? 'Hoy' : days === 1 ? 'Mañana' : `En ${days} días`) + `, y luego cada ${periodUnit(sub.period)}`
  const remindValue = sub.remind ?? ''
  const remindKnown = REMIND_OPTIONS.some((o) => (o.value ?? '') === remindValue)

  /** Al cerrar se guarda lo que quedaba a medias (enlace, fecha) y al nombre se le quitan los espacios de los lados. */
  const close = () => {
    commitUrl()
    commitDate()
    if (id && stored) {
      const name = stored.name.trim()
      if (name && name !== stored.name) actions.updateSubscription(id, { name }, nameKey)
    }
    onClose(id)
  }

  const toggleCancelled = () => {
    if (!id || !stored) return
    const urlSaved = commitUrl()
    actions.cancelSubscription(id, !cancelled)
    const name = displayName(stored)
    // «Deshacer» solo si ha sido un único paso (con el enlace guardado serían dos).
    ui.toast(cancelled ? `«${name}» reactivada` : `«${name}» dada de baja`, { undo: !urlSaved })
    onClose(id)
  }

  const remove = () => {
    if (!id) return
    actions.deleteSubscription(id)
    ui.toast('Suscripción eliminada', { undo: true })
    onClose(id)
  }

  return (
    <Popover
      anchor={anchor}
      placement="side"
      width={350}
      label={draftMode ? 'Nueva suscripción' : `Suscripción ${displayName(sub)}`}
      className="sheet subs-sheet"
      style={tint(card?.color ?? 'blue')}
      onClose={close}
    >
      <div className="subs-sheet-head">
        <span className={cx('subs-glyph', !card && 'is-empty')} aria-hidden="true" />
        <input
          className="subs-sheet-name"
          data-autofocus
          value={blankName ?? sub.name}
          placeholder={draftMode ? 'Nueva suscripción' : displayName(sub)}
          aria-label="Nombre"
          autoComplete="off"
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              close()
            }
          }}
        />
      </div>
      {cancelled && sub.cancelledOn && (
        <p className="subs-sheet-status">Dada de baja {onDay(sub.cancelledOn, now)}: ya no suma ni avisa.</p>
      )}

      <div className="sheet-fields subs-fields">
        <div className="field">
          <label className="field-label" htmlFor={`${ids}-amount`}>
            <Icon.Card />
            Importe
          </label>
          <div className="field-controls">
            <input
              ref={amountRef}
              id={`${ids}-amount`}
              className="input subs-amount-input"
              value={amount}
              placeholder="0,00"
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={parsedAmount === null || undefined}
              aria-describedby={parsedAmount === null ? `${ids}-amount-error` : undefined}
              onChange={(e) => setAmountText(e.target.value)}
              onBlur={() => parsedAmount !== null && setAmount(amount.trim() === '' ? '' : amountText(sub.amount))}
            />
            <select
              className="input"
              value={sub.currency}
              aria-label="Moneda"
              onChange={(e) => update({ currency: e.target.value })}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {CURRENCY_NAMES[c] ?? c}
                </option>
              ))}
            </select>
            {parsedAmount === null && (
              <span id={`${ids}-amount-error`} className="subs-error">
                Escribe un importe, como 12,99
              </span>
            )}
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor={`${ids}-period`}>
            <Icon.Repeat />
            Periodicidad
          </label>
          <div className="field-controls">
            <select
              id={`${ids}-period`}
              className="input"
              value={sub.period}
              onChange={(e) => update({ period: e.target.value as Subscription['period'] })}
            >
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  {periodLabel(p)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor={`${ids}-charge`}>
            <Icon.Calendar />
            {cancelled ? 'Cobro' : 'Próximo cobro'}
          </label>
          <div className="field-controls">
            <input
              id={`${ids}-charge`}
              type="date"
              className="input"
              value={dateDraft ?? charge}
              aria-describedby={`${ids}-charge-note`}
              onChange={(e) => setDateDraft(e.target.value)}
              onBlur={commitDate}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitDate()
                }
              }}
            />
            <span id={`${ids}-charge-note`} className="subs-note">
              {cancelled ? `Cada ${periodUnit(sub.period)}` : chargeNote}
            </span>
          </div>
        </div>

      </div>

      <div className="sheet-fields subs-fields">
        <div className="field">
          <label className="field-label" htmlFor={`${ids}-column`}>
            <Icon.Columns />
            Columna
          </label>
          <div className="field-controls subs-picker" style={tint(column?.color ?? 'gray')}>
            <span className={cx('subs-chip-dot', !column && 'is-empty')} aria-hidden="true" />
            <select
              id={`${ids}-column`}
              className="input"
              value={sub.columnId ?? NONE}
              onChange={(e) => update({ columnId: e.target.value === NONE ? null : e.target.value })}
            >
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.archived ? `${c.name} (archivada)` : c.name}
                </option>
              ))}
              <option value={NONE}>Sin columna</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor={`${ids}-card`}>
            <Icon.Card />
            Tarjeta
          </label>
          <div className="field-controls subs-picker" style={tint(card?.color ?? 'gray')}>
            <span className={cx('subs-chip-dot', !card && 'is-empty')} aria-hidden="true" />
            <select
              id={`${ids}-card`}
              className="input"
              value={sub.cardId ?? NONE}
              aria-haspopup="dialog"
              aria-expanded={cardEditor !== null}
              onChange={(e) => {
                // «Nueva tarjeta…» no es una tarjeta: abre su editor y el menú sigue en la que había.
                if (e.target.value === NEW_CARD) {
                  e.target.value = sub.cardId ?? NONE
                  setCardEditor(e.currentTarget)
                } else update({ cardId: e.target.value === NONE ? null : e.target.value })
              }}
            >
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value={NONE}>Sin tarjeta</option>
              <option value={NEW_CARD}>Nueva tarjeta…</option>
            </select>
          </div>
        </div>
      </div>

      <div className="sheet-fields subs-fields">
        <div className="field">
          <label className="field-label" htmlFor={`${ids}-remind`}>
            <Icon.Bell />
            Aviso
          </label>
          <div className="field-controls">
            <select
              id={`${ids}-remind`}
              className="input"
              value={remindValue}
              aria-describedby={`${ids}-remind-note`}
              onChange={(e) => update({ remind: e.target.value === '' ? undefined : Number(e.target.value) })}
            >
              {REMIND_OPTIONS.map((o) => (
                <option key={o.label} value={o.value ?? ''}>
                  {o.label}
                </option>
              ))}
              {!remindKnown && <option value={remindValue}>{remindLabel(sub.remind)}</option>}
            </select>
            <span id={`${ids}-remind-note`} className="subs-note">
              Crea una tarea en {reminderWhere} que llega al iPhone
            </span>
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor={`${ids}-url`}>
            <Icon.Link />
            Enlace
          </label>
          <div className="field-controls subs-url">
            <input
              id={`${ids}-url`}
              className="input"
              value={url}
              placeholder="netflix.com/account"
              inputMode="url"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={urlError || undefined}
              aria-describedby={urlError ? `${ids}-url-error` : undefined}
              onChange={(e) => {
                setUrl(e.target.value)
                setUrlDirty(true)
              }}
              onBlur={(e) => !(e.relatedTarget instanceof Element && e.relatedTarget.closest('.sheet-foot')) && commitUrl()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  commitUrl()
                }
              }}
            />
            {sub.url && !urlDirty && (
              <a
                className="icon-btn"
                href={sub.url}
                target="_blank"
                rel="noreferrer"
                aria-label="Abrir el enlace (en una pestaña nueva)"
                title="Abrir"
              >
                <Icon.External />
              </a>
            )}
            {urlError && (
              <span id={`${ids}-url-error`} className="subs-error">
                Dirección no válida (solo http y https)
              </span>
            )}
          </div>
        </div>
      </div>

      <textarea
        className="sheet-notes"
        value={sub.notes ?? ''}
        aria-label="Notas"
        placeholder="Notas: cómo darse de baja, a nombre de quién está…"
        onChange={(e) => update({ notes: e.target.value }, `sub-notes:${session}`)}
      />

      <footer className="sheet-foot">
        <span className="sheet-meta">
          {draftMode ? 'Se guarda al escribir el nombre' : `Creada ${formatWhen(sub.createdAt, now)}`}
        </span>
        {!draftMode && (
          <div className="sheet-foot-actions">
            <button type="button" className={cx('subs-foot-btn', cancelled && 'is-accent')} onClick={toggleCancelled}>
              {cancelled ? 'Reactivar' : 'Dar de baja'}
            </button>
            <button type="button" className="danger-btn" onClick={remove}>
              <Icon.Trash />
              Eliminar
            </button>
          </div>
        )}
      </footer>

      {cardEditor && (
        <CardEditor
          card={null}
          anchor={cardEditor}
          subscriptionId={id ?? undefined}
          onCreated={(cardId) => !id && update({ cardId })}
          onClose={() => setCardEditor(null)}
        />
      )}
    </Popover>
  )
}

// ── Tarjetas ──

/** Nueva tarjeta o editar una: nombre (sin números de tarjeta) y color. */
export function CardEditor({
  card,
  anchor,
  subscriptionId,
  onCreated,
  onDeleted,
  onClose,
}: {
  card: Card | null
  anchor: HTMLElement
  /** Con una suscripción ya guardada, la tarjeta nueva se le pone en el mismo paso de deshacer. */
  subscriptionId?: string
  onCreated?: (id: string) => void
  onDeleted?: (id: string) => void
  onClose: () => void
}) {
  const board = useBoard()
  const actions = useActions()
  const ui = useUI()
  const ids = useId()
  const [session] = useState(() => crypto.randomUUID())
  const [name, setName] = useState(card?.name ?? '')
  const [color, setColor] = useState<ColorKey>(() => card?.color ?? nextCardColor(cardsOf(board)))
  // «Escribe un nombre» sale al intentar guardar; lo del número de tarjeta, en cuanto se escribe.
  const [touched, setTouched] = useState(false)
  const error = cardNameError(name)
  const shownError = error === CARD_NUMBER_MESSAGE || (touched && error) ? error : null
  const current = card ? findCard(board, card.id) : null

  // Si la tarjeta desaparece (deshacer, otra ventana…), se cierra.
  useEffect(() => {
    if (card && !current) onClose()
  }, [card, current, onClose])

  /** Editando: el nombre se guarda al salir del campo o al cerrar, nunca a medio escribir. */
  const commitName = () => {
    if (!card || !current) return
    setTouched(true)
    const clean = name.trim()
    if (!cardNameError(clean) && clean !== current.name) actions.updateCard(card.id, { name: clean }, `card-name:${session}`)
  }

  const submit = () => {
    if (card) {
      commitName()
      if (!cardNameError(name)) onClose()
      return
    }
    setTouched(true)
    if (cardNameError(name)) return
    const id = actions.addCard(name, color, subscriptionId)
    if (!id) return
    onCreated?.(id)
    onClose()
  }

  const close = () => {
    commitName()
    onClose()
  }

  const pickColor = (key: ColorKey) => {
    setColor(key)
    if (card) actions.updateCard(card.id, { color: key })
  }

  return (
    <Popover
      anchor={anchor}
      placement="below-start"
      width={284}
      label={card ? `Editar la tarjeta ${card.name}` : 'Nueva tarjeta'}
      className="card-editor"
      style={tint(color)}
      onClose={close}
    >
      <h3 className="card-editor-title">
        <span className="subs-chip-dot" aria-hidden="true" />
        {card ? 'Editar tarjeta' : 'Nueva tarjeta'}
      </h3>
      <div className="card-editor-field">
        <input
          id={`${ids}-name`}
          className="input card-editor-name"
          data-autofocus
          value={name}
          placeholder="BBVA, Revolut…"
          aria-label="Nombre de la tarjeta"
          autoComplete="off"
          spellCheck={false}
          maxLength={60}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={`${ids}-note`}
          onChange={(e) => setName(e.target.value)}
          onBlur={(e) => !(e.relatedTarget instanceof Element && e.relatedTarget.closest('.danger-btn')) && commitName()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <span id={`${ids}-note`} className={shownError ? 'subs-error' : 'subs-note'} role={shownError ? 'alert' : undefined}>
          {shownError ?? 'Solo un nombre y un color: nunca el número.'}
        </span>
      </div>
      <div className="swatches card-editor-swatches" role="radiogroup" aria-label="Color">
        {COLORS.map((c) => (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={c.key === color}
            aria-label={c.name}
            title={c.name}
            className="swatch"
            style={tint(c.key)}
            onClick={() => pickColor(c.key)}
          />
        ))}
      </div>
      <footer className="card-editor-foot">
        {card ? (
          <button
            type="button"
            className="danger-btn"
            onClick={() => {
              actions.deleteCard(card.id)
              ui.toast('Tarjeta eliminada', { undo: true })
              onDeleted?.(card.id)
              onClose()
            }}
          >
            <Icon.Trash />
            Eliminar
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="btn is-accent card-editor-done" onClick={submit}>
          {card ? 'Hecho' : 'Añadir'}
        </button>
      </footer>
    </Popover>
  )
}
