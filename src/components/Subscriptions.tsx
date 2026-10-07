// Vista «Suscripciones»: cuánto suman al mes y al año (por moneda: nunca se suman monedas distintas),
// con qué tarjeta se paga cada una (solo un nombre y un color, nunca el número) y la lista por próximo
// cobro. La ficha de cada una se abre al lado, como el detalle de una tarea, y todo se guarda al momento
// (con deshacer; SubscriptionSheet.tsx). El aviso antes del cobro lo crea el servidor en la Bandeja
// (server/suscripciones.mjs).
import { Fragment, useEffect, useId, useMemo, useRef, useState, type MouseEvent, type Ref } from 'react'
import { useBoard, useNow, useUI } from '../context'
import { formatDay, todayISO } from '../dates'
import type { Card, ColorKey, Subscription } from '../model'
import { shortUrl } from '../projects'
import {
  activeSubscriptions,
  cancelledSubscriptions,
  cardsOf,
  CURRENCIES,
  findCard,
  findSubscription,
  formatMoney,
  hasReminder,
  periodLabel,
  periodUnit,
  remindLabel,
  subscriptionsOf,
  subscriptionTotals,
  type CardFilter,
  type Totals,
} from '../subscriptions'
import { cx, isTyping, tint, useStoredState } from '../util'
import * as Icon from './Icons'
import { CardEditor, displayName, onDay, SubscriptionSheet } from './SubscriptionSheet'
import '../styles/suscripciones.css'

// ── Textos ──

/** Filtro guardado: todas, las que no tienen tarjeta o el id de una tarjeta. */
const ALL = 'all'
const NONE = 'none'
const toFilter = (key: string): CardFilter => (key === ALL ? undefined : key === NONE ? null : key)

/** «hoy», «mañana», «jueves», «15 oct». */
const dayWord = (day: string, now: Date) => formatDay(day, now).toLowerCase()

/** «en 8 días» (de 2 a 60 días; antes basta con «Mañana» o el día de la semana, después con la fecha). */
const inDays = (days: number) => (days >= 2 && days <= 60 ? `en ${days} días` : null)

/** «45,97 €» o, con varias monedas, «45,97 € · 9,99 $» (al mes). */
const monthlyText = (totals: Totals) =>
  CURRENCIES.filter((c) => totals[c])
    .map((c) => formatMoney(totals[c].monthly, c))
    .join(' · ')

// ── Vista ──

interface SheetState {
  /** null = «Nueva suscripción» (no se guarda hasta que tiene nombre). */
  id: string | null
  anchor: DOMRect
  key: string
}

interface CardEditorState {
  /** null = tarjeta nueva. */
  card: Card | null
  anchor: HTMLElement
}

export function SubscriptionsView() {
  const board = useBoard()
  const ui = useUI()
  const now = useNow()
  const today = todayISO(now)
  const titleId = useId()
  const upcomingId = useId()
  const [filterKey, setFilterKey] = useStoredState<string>('tablero.suscripciones.tarjeta', ALL)
  const [showCancelled, setShowCancelled] = useStoredState('tablero.suscripciones.bajas', false)
  const [sheet, setSheet] = useState<SheetState | null>(null)
  const [cardEditor, setCardEditor] = useState<CardEditorState | null>(null)
  const [reveal, setReveal] = useState<string | null>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const listsRef = useRef<HTMLDivElement>(null)
  const cardsRef = useRef<HTMLDivElement>(null)

  const cards = cardsOf(board)
  const all = subscriptionsOf(board)
  const withoutCard = cards.length > 0 && all.some((s) => s.cardId === null)
  // Un filtro que ya no vale (tarjeta borrada aquí o en otra ventana) vuelve a «Todas».
  const shown = filterKey === ALL || (filterKey === NONE ? withoutCard : cards.some((c) => c.id === filterKey)) ? filterKey : ALL
  const filter = toFilter(shown)
  const filterCard = findCard(board, filter)
  const active = useMemo(() => activeSubscriptions(board, today, filter), [board, today, filter])
  const cancelled = useMemo(() => cancelledSubscriptions(board, filter), [board, filter])
  const totals = useMemo(() => subscriptionTotals(board, filter), [board, filter])

  const openRow = (id: string, el: HTMLElement) => setSheet({ id, anchor: el.getBoundingClientRect(), key: id })
  const openNew = (el: HTMLElement | null) => {
    const anchor = (el ?? addRef.current)?.getBoundingClientRect() ?? new DOMRect(window.innerWidth / 2 - 180, 96, 0, 0)
    setSheet({ id: null, anchor, key: `nueva:${crypto.randomUUID()}` })
  }

  /** La fila de una suscripción, si está en pantalla. */
  const rowOf = (id: string | null) =>
    id ? (listsRef.current?.querySelector<HTMLElement>(`[data-subscription-id="${CSS.escape(id)}"]`) ?? null) : null

  /**
   * Al cerrar la ficha, el foco vuelve a su fila (eso ya lo hace el Popover). Si la fila se ha ido de su
   * lista (dada de baja, reactivada, eliminada) o el botón que la abrió ya no está (la primera, creada
   * desde «Añadir suscripción»), a la vecina de su lista, a la propia fila donde esté ahora o al botón de
   * añadir. Y una nueva con otra tarjeta que la del filtro se ve quitando el filtro.
   */
  const closeSheet = (id: string | null) => {
    const row = rowOf(id)
    const list = row?.parentElement ?? null
    const siblings = list ? [...list.children] : []
    const at = row ? siblings.indexOf(row) : -1
    const neighbours = at < 0 ? [] : [...siblings.slice(at + 1), ...siblings.slice(0, at).reverse()]
    if (sheet?.id === null && id && filter !== undefined && findSubscription(board, id)?.cardId !== filter) setFilterKey(ALL)
    setSheet(null)
    requestAnimationFrame(() => {
      if (hasFocus()) return
      const current = rowOf(id)
      const target =
        (current && current.parentElement === list && current) || neighbours.find((el) => el.isConnected) || current
      const hit = target?.querySelector<HTMLElement>('.subs-hit')
      if (hit) {
        hit.focus({ preventScroll: true })
        target!.scrollIntoView({ block: 'nearest' })
      } else addRef.current?.focus()
    })
  }

  /**
   * Tras borrar una tarjeta, su chip ya no está: el foco pasa a «Todas» (o a «Tarjeta» si no queda
   * ninguna; sin tarjetas ni suscripciones, a «Añadir suscripción»).
   */
  const closeCardEditor = () => {
    setCardEditor(null)
    requestAnimationFrame(() => {
      if (hasFocus()) return
      const target = cardsRef.current?.querySelector<HTMLElement>('.subs-chip-main, .subs-add-card') ?? addRef.current
      target?.focus()
    })
  }

  // Lo pedido desde fuera (N, la búsqueda, «Ver suscripción» en una tarea de aviso).
  const request = ui.subscriptionRequest
  useEffect(() => {
    if (!request) return
    ui.clearSubscriptionRequest()
    if ('create' in request) return openNew(null)
    const sub = findSubscription(board, request.id)
    if (!sub) return ui.toast('Esa suscripción ya no existe')
    // A la vista: sin un filtro que la esconda y, si está de baja, con las bajas desplegadas.
    if (filter !== undefined && sub.cardId !== filter) setFilterKey(ALL)
    if (sub.cancelledOn) setShowCancelled(true)
    setReveal(sub.id)
    // Solo cuando llega una petición nueva.
  }, [request])

  useEffect(() => {
    if (!reveal) return
    const raf = requestAnimationFrame(() => {
      setReveal(null)
      const row = listsRef.current?.querySelector<HTMLElement>(`[data-subscription-id="${CSS.escape(reveal)}"]`)
      const hit = row?.querySelector<HTMLElement>('.subs-hit')
      if (!row || !hit) return
      row.scrollIntoView({ block: 'center' })
      hit.focus({ preventScroll: true })
      openRow(reveal, row)
    })
    return () => cancelAnimationFrame(raf)
  }, [reveal, shown, showCancelled])

  // ↑↓ (o J/K) recorren las filas; sin ninguna con el foco, empiezan por la primera.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      const delta = k === 'ArrowDown' || k === 'j' ? 1 : k === 'ArrowUp' || k === 'k' ? -1 : 0
      if (!delta || isTyping(e.target) || document.querySelector('.popover, .search-palette')) return
      const hits = [...(listsRef.current?.querySelectorAll<HTMLElement>('.subs-hit') ?? [])]
      if (hits.length === 0) return
      const active = document.activeElement
      const current = active instanceof HTMLElement ? active.closest('.subs-row')?.querySelector<HTMLElement>('.subs-hit') : null
      const i = current ? hits.indexOf(current) : -1
      const next = i === -1 ? hits[0] : hits[i + delta]
      e.preventDefault()
      if (!next) return
      next.focus({ preventScroll: true })
      next.closest('.subs-row')?.scrollIntoView({ block: 'nearest' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const next = active[0] ?? null
  const count = active.length
  const empty = all.length === 0

  return (
    <main className="subs" aria-labelledby={titleId}>
      <div className="subs-page">
        <header className="subs-head">
          <h2 id={titleId}>Suscripciones</h2>
          {!empty && (
            <button
              ref={addRef}
              type="button"
              className="btn"
              title="Nueva suscripción (N)"
              aria-keyshortcuts="N"
              onClick={(e) => openNew(e.currentTarget)}
            >
              <Icon.Plus />
              Suscripción
            </button>
          )}
        </header>

        {(!empty || cards.length > 0) && (
          <CardFilters
            ref={cardsRef}
            filterKey={shown}
            withoutCard={withoutCard}
            onFilter={setFilterKey}
            onAdd={(anchor) => setCardEditor({ card: null, anchor })}
            onEdit={(card, anchor) => setCardEditor({ card, anchor })}
            hint={cards.length === 0}
          />
        )}

        {empty ? (
          <div className="subs-empty">
            <span className="subs-empty-icon" aria-hidden="true">
              <Icon.Card />
            </span>
            <h3>Aún no hay suscripciones</h3>
            <p>Apunta lo que pagas cada mes o cada año: verás cuánto suma, cuándo se cobra cada una y con qué tarjeta.</p>
            <button ref={addRef} type="button" className="btn is-accent" onClick={(e) => openNew(e.currentTarget)}>
              <Icon.Plus />
              Añadir suscripción
            </button>
          </div>
        ) : (
          <>
            <Summary totals={totals} count={count} next={next} now={now} filterCard={filterCard} noCard={filter === null} />

            <div className="subs-lists" ref={listsRef}>
              <section className="subs-section" aria-labelledby={upcomingId}>
                <h3 id={upcomingId} className="subs-label">
                  Próximos cobros
                </h3>
                {active.length > 0 ? (
                  <ul className="subs-list">
                    {active.map(({ subscription, card, charge, days }) => (
                      <SubscriptionRow
                        key={subscription.id}
                        sub={subscription}
                        card={card}
                        charge={charge}
                        days={days}
                        now={now}
                        open={sheet?.id === subscription.id}
                        onOpen={openRow}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="subs-none">
                    {filterCard
                      ? `Ninguna activa con ${filterCard.name}.`
                      : filter === null
                        ? 'Ninguna activa sin tarjeta.'
                        : 'Ninguna activa: todas están dadas de baja.'}
                  </p>
                )}
              </section>

              {cancelled.length > 0 && (
                <section className="subs-section" aria-label="Dadas de baja">
                  <button
                    type="button"
                    className="completed-toggle subs-cancelled-toggle"
                    aria-expanded={showCancelled}
                    onClick={() => setShowCancelled(!showCancelled)}
                  >
                    <Icon.Chevron />
                    Dadas de baja
                    <span className="completed-count">{cancelled.length}</span>
                  </button>
                  {showCancelled && (
                    <ul className="subs-list">
                      {cancelled.map(({ subscription, card }) => (
                        <SubscriptionRow
                          key={subscription.id}
                          sub={subscription}
                          card={card}
                          now={now}
                          open={sheet?.id === subscription.id}
                          onOpen={openRow}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </div>
          </>
        )}
      </div>

      {sheet && (
        <SubscriptionSheet
          key={sheet.key}
          id={sheet.id}
          cardId={sheet.id === null ? (filter ?? null) : undefined}
          anchor={sheet.anchor}
          onClose={closeSheet}
        />
      )}
      {cardEditor && (
        <CardEditor
          card={cardEditor.card}
          anchor={cardEditor.anchor}
          onClose={closeCardEditor}
          onDeleted={(id) => id === filterKey && setFilterKey(ALL)}
        />
      )}
    </main>
  )
}

/** ¿Tiene el foco algo de la página? (Tras quitar el elemento que lo tenía, se queda en <body>.) */
const hasFocus = () => {
  const active = document.activeElement
  return active instanceof HTMLElement && active !== document.body && active.isConnected
}

// ── Resumen ──

function Summary({
  totals,
  count,
  next,
  now,
  filterCard,
  noCard,
}: {
  totals: Totals
  count: number
  next: { subscription: Subscription; charge: string; days: number } | null
  now: Date
  filterCard: Card | null
  noCard: boolean
}) {
  const currencies = CURRENCIES.filter((c) => totals[c])
  const rows = currencies.length > 0 ? currencies : ['EUR']
  const zero = currencies.length === 0
  const where = filterCard ? ` con ${filterCard.name}` : noCard ? ' sin tarjeta' : ''
  return (
    <section className="subs-summary" aria-label={`Resumen${where}`}>
      <div className={cx('subs-totals', rows.length > 1 && 'is-multi', zero && 'is-zero')}>
        <span className="subs-totals-label" aria-hidden="true">
          Al mes
        </span>
        <span className="subs-totals-label" aria-hidden="true">
          Al año
        </span>
        {rows.map((c) => (
          <Fragment key={c}>
            <span className="subs-month">
              <span className="sr-only">Al mes: </span>
              {formatMoney(totals[c]?.monthly ?? 0, c)}
            </span>
            <span className="subs-year">
              <span className="sr-only">Al año: </span>
              {formatMoney(totals[c]?.yearly ?? 0, c)}
            </span>
          </Fragment>
        ))}
      </div>
      <p className="subs-summary-foot">
        <span>
          {count === 1 ? '1 activa' : `${count} activas`}
          {where}
        </span>
        {next && (
          <span className="subs-next">
            Próximo cobro: <b>{displayName(next.subscription)}</b> ·{' '}
            <span className={cx(next.days <= 1 && 'is-soon')}>{dayWord(next.charge, now)}</span> ·{' '}
            {formatMoney(next.subscription.amount, next.subscription.currency)}
          </span>
        )}
      </p>
    </section>
  )
}

// ── Tarjetas ──

function CardFilters({
  ref,
  filterKey,
  withoutCard,
  hint,
  onFilter,
  onAdd,
  onEdit,
}: {
  ref: Ref<HTMLDivElement>
  filterKey: string
  withoutCard: boolean
  /** Aún no hay tarjetas: se explica para qué sirven. */
  hint: boolean
  onFilter: (key: string) => void
  onAdd: (anchor: HTMLElement) => void
  onEdit: (card: Card, anchor: HTMLElement) => void
}) {
  const board = useBoard()
  const cards = cardsOf(board)
  return (
    <div ref={ref} className="subs-cards" role="group" aria-label="Tarjetas">
      {cards.length > 0 && <FilterChip label="Todas" pressed={filterKey === ALL} onPress={() => onFilter(ALL)} />}
      {cards.map((card) => {
        const total = monthlyText(subscriptionTotals(board, card.id))
        return (
          <FilterChip
            key={card.id}
            label={card.name}
            color={card.color}
            total={total}
            pressed={filterKey === card.id}
            onPress={() => onFilter(filterKey === card.id ? ALL : card.id)}
            onEdit={(anchor) => onEdit(card, anchor)}
          />
        )
      })}
      {withoutCard && (
        <FilterChip
          label="Sin tarjeta"
          empty
          total={monthlyText(subscriptionTotals(board, null))}
          pressed={filterKey === NONE}
          onPress={() => onFilter(filterKey === NONE ? ALL : NONE)}
        />
      )}
      <button
        type="button"
        className="subs-add-card"
        aria-haspopup="dialog"
        title="Nueva tarjeta: solo un nombre y un color"
        onClick={(e) => onAdd(e.currentTarget)}
      >
        <Icon.Plus />
        Tarjeta
      </button>
      {hint && <span className="subs-cards-hint">Con qué pagas cada una: solo un nombre, nunca el número</span>}
    </div>
  )
}

function FilterChip({
  label,
  color,
  empty = false,
  total,
  pressed,
  onPress,
  onEdit,
}: {
  label: string
  color?: ColorKey
  /** «Sin tarjeta»: el punto hueco. */
  empty?: boolean
  /** Lo que suma al mes. */
  total?: string
  pressed: boolean
  onPress: () => void
  onEdit?: (anchor: HTMLElement) => void
}) {
  // Se edita con «···» (en la elegida), con doble clic o con el botón derecho.
  const ref = useRef<HTMLSpanElement>(null)
  const more = Boolean(onEdit) && pressed
  const edit = (e: MouseEvent) => {
    if (!onEdit || !ref.current) return
    e.preventDefault()
    onEdit(ref.current)
  }
  return (
    <span
      ref={ref}
      className={cx('subs-chip', pressed && 'is-active', more && 'has-more')}
      style={color ? tint(color) : undefined}
      onDoubleClick={edit}
      onContextMenu={edit}
    >
      <button
        type="button"
        className="subs-chip-main"
        aria-pressed={pressed}
        aria-label={total ? `${label}, ${total} al mes` : label}
        title={onEdit ? 'Doble clic para editar la tarjeta' : undefined}
        onClick={onPress}
      >
        {(color || empty) && <span className={cx('subs-chip-dot', empty && 'is-empty')} aria-hidden="true" />}
        <span className="subs-chip-name">{label}</span>
        {total && <span className="subs-chip-total">{total}</span>}
      </button>
      {more && onEdit && (
        <button
          type="button"
          className="subs-chip-more"
          aria-label={`Editar la tarjeta ${label}`}
          title="Editar la tarjeta"
          aria-haspopup="dialog"
          onClick={() => ref.current && onEdit(ref.current)}
        >
          <Icon.Ellipsis />
        </button>
      )}
    </span>
  )
}

// ── Filas ──

function SubscriptionRow({
  sub,
  card,
  charge,
  days = 0,
  now,
  open,
  onOpen,
}: {
  sub: Subscription
  card: Card | null
  /** Próximo cobro; sin él, es una dada de baja. */
  charge?: string
  days?: number
  now: Date
  open: boolean
  onOpen: (id: string, el: HTMLElement) => void
}) {
  const name = displayName(sub)
  const amount = formatMoney(sub.amount, sub.currency)
  const unit = periodUnit(sub.period)
  const cancelled = !charge
  const reminder = !cancelled && hasReminder(sub)
  const when = charge ? formatDay(charge, now) : ''
  const soon = !cancelled && days <= 1
  const later = charge ? inDays(days) : null
  const cancelledText = sub.cancelledOn ? onDay(sub.cancelledOn, now) : ''
  // «1 día antes», «el mismo día»: con qué antelación avisa, a la vista (sin tener que abrir la ficha).
  const remindText = reminder ? remindLabel(sub.remind).replace(/^El/, 'el') : ''
  const label = [
    `${name}, ${amount} cada ${unit}, ${card ? `con ${card.name}` : 'sin tarjeta'}.`,
    cancelled ? `Dada de baja ${cancelledText}.` : `Próximo cobro: ${when.toLowerCase()}${later ? `, ${later}` : ''}.`,
    reminder ? `Aviso ${remindText}.` : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <li
      className={cx('subs-row', soon && 'is-soon', cancelled && 'is-cancelled', open && 'is-open')}
      style={tint(card?.color ?? 'gray')}
      data-subscription-id={sub.id}
    >
      <button
        type="button"
        className="subs-hit"
        aria-label={label}
        aria-haspopup="dialog"
        onClick={(e) => onOpen(sub.id, e.currentTarget)}
      />
      <span className={cx('subs-glyph', !card && 'is-empty')} aria-hidden="true" />
      <span className="subs-text">
        <span className="subs-name-line">
          <span className="subs-name" aria-hidden="true">
            {name}
          </span>
          {sub.url && (
            <a
              className="subs-link"
              href={sub.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Abrir la web de ${name} (en una pestaña nueva)`}
              title={shortUrl(sub.url)}
            >
              <Icon.External />
            </a>
          )}
        </span>
        <span className="subs-meta" aria-hidden="true">
          {periodLabel(sub.period)} · {card ? card.name : 'Sin tarjeta'}
          {reminder && (
            <>
              {' · '}
              <span className="subs-bell">
                <Icon.Bell />
              </span>
              {remindText}
            </>
          )}
        </span>
      </span>
      <span className="subs-end" aria-hidden="true">
        <span className="subs-amount">
          {amount}
          <span className="subs-unit"> / {unit}</span>
        </span>
        <span className="subs-when">
          {cancelled ? `Baja ${cancelledText}` : when}
          {later && <span className="subs-in"> · {later}</span>}
        </span>
      </span>
    </li>
  )
}
