// Vista «Suscripciones»: cuánto suman al mes y al año (por moneda: nunca se suman monedas distintas),
// con qué tarjeta se paga cada una (solo un nombre y un color, nunca el número) y, debajo, una columna
// por empresa (las columnas del tablero) con lo que suma cada una al mes. Se arrastran de una columna a
// otra como las tareas del tablero; dentro de cada una van por próximo cobro, así que no se ordenan a
// mano. La ficha de cada una se abre al lado, como el detalle de una tarea, y todo se guarda al momento
// (con deshacer; SubscriptionSheet.tsx). El aviso antes del cobro lo crea el servidor en su columna o en
// la Bandeja (server/suscripciones.mjs).
import {
  DragDropContext,
  Draggable,
  Droppable,
  type BeforeCapture,
  type DraggableProvided,
  type DraggableStateSnapshot,
  type DragStart,
  type DragUpdate,
  type DropResult,
  type ResponderProvided,
} from '@hello-pangea/dnd'
import { Fragment, memo, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type Ref } from 'react'
import { useActions, useBoard, useNow, useUI } from '../context'
import { formatDay, todayISO } from '../dates'
import { reducedMotion } from '../keys'
import type { Card, ColorKey, Subscription } from '../model'
import { shortUrl } from '../projects'
import {
  cancelledSubscriptions,
  cardsOf,
  CURRENCIES,
  findCard,
  findSubscription,
  formatMoney,
  hasReminder,
  isAssignable,
  newSubscriptionColumn,
  nextCharge,
  periodUnit,
  remindLabel,
  subscriptionColumns,
  subscriptionsOf,
  subscriptionTotals,
  type CardFilter,
  type SubscriptionGroup,
  type Totals,
  type UpcomingSubscription,
} from '../subscriptions'
import { cx, isTyping, sideWidth, tint, useStoredState } from '../util'
import * as Icon from './Icons'
import { CardEditor, displayName, onDay, SubscriptionSheet } from './SubscriptionSheet'
import '../styles/suscripciones.css'

// ── Textos ──

/** Filtro guardado: todas, las que no tienen tarjeta o el id de una tarjeta. */
const ALL = 'all'
const NONE = 'none'
const toFilter = (key: string): CardFilter => (key === ALL ? undefined : key === NONE ? null : key)

/** La columna «Sin columna» (para soltar ahí y en los atributos de la página). Ningún id de columna es así. */
const NO_COLUMN = 'subs:sin-columna'
/** La lista de las dadas de baja (para moverse con el teclado). */
const CANCELLED_LIST = 'subs:bajas'

/** «hoy», «mañana», «jueves», «15 oct». */
const dayWord = (day: string, now: Date) => formatDay(day, now).toLowerCase()

/** «en 8 días» (de 2 a 60 días; antes basta con «Mañana» o el día de la semana, después con la fecha). */
const inDays = (days: number) => (days >= 2 && days <= 60 ? `en ${days} días` : null)

/** «45,97 €» o, con varias monedas, «45,97 € · 9,99 $» (al mes). */
const monthlyText = (totals: Totals) =>
  CURRENCIES.filter((c) => totals[c])
    .map((c) => formatMoney(totals[c].monthly, c))
    .join(' · ')

/** Lo que el lector de pantalla explica al llegar a una suscripción (dónde se arrastra con el teclado). */
const DRAG_INSTRUCTIONS =
  'Intro abre su ficha, donde también se elige su columna. Para llevarla a otra columna: Espacio para cogerla, flechas izquierda y derecha para elegir la columna y Espacio para soltarla; Esc cancela.'

// ── Vista ──

interface SheetState {
  /** null = «Nueva suscripción» (no se guarda hasta que tiene nombre). */
  id: string | null
  /** La columna de una nueva. */
  columnId: string | null
  anchor: DOMRect
  key: string
}

interface CardEditorState {
  /** null = tarjeta nueva. */
  card: Card | null
  anchor: HTMLElement
}

/** Arrastre en marcha: qué suscripción y desde qué columna (esa no admite soltar: no se ordena a mano). */
interface DragState {
  id: string
  from: string
}

export function SubscriptionsView() {
  const board = useBoard()
  const actions = useActions()
  const ui = useUI()
  const now = useNow()
  const today = todayISO(now)
  const titleId = useId()
  const [filterKey, setFilterKey] = useStoredState<string>('tablero.suscripciones.tarjeta', ALL)
  const [showCancelled, setShowCancelled] = useStoredState('tablero.suscripciones.bajas', false)
  // La última columna en la que se ha añadido o soltado una: ahí van las nuevas de «+ Suscripción» (y N).
  const [lastColumn, setLastColumn] = useStoredState<string | null>('tablero.suscripciones.columna', null)
  const [sheet, setSheet] = useState<SheetState | null>(null)
  const [cardEditor, setCardEditor] = useState<CardEditorState | null>(null)
  const [reveal, setReveal] = useState<string | null>(null)
  const [revealColumn, setRevealColumn] = useState<string | null>(null)
  const [flashColumn, setFlashColumn] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [landed, setLanded] = useState<string | null>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const listsRef = useRef<HTMLDivElement>(null)
  const cardsRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef(drag)
  dragRef.current = drag
  // Durante un arrastre, la última columna sobre la que ha estado (para saber hacia dónde va con el teclado).
  const overRef = useRef<string | null>(null)

  const cards = cardsOf(board)
  const all = subscriptionsOf(board)
  const withoutCard = cards.length > 0 && all.some((s) => s.cardId === null)
  // Un filtro que ya no vale (tarjeta borrada aquí o en otra ventana) vuelve a «Todas».
  const shown = filterKey === ALL || (filterKey === NONE ? withoutCard : cards.some((c) => c.id === filterKey)) ? filterKey : ALL
  const filter = toFilter(shown)
  const filterCard = findCard(board, filter)
  const groups = useMemo(() => subscriptionColumns(board, today, filter), [board, today, filter])
  const cancelled = useMemo(() => cancelledSubscriptions(board, filter), [board, filter])
  const totals = useMemo(() => subscriptionTotals(board, filter), [board, filter])
  const next = useMemo(() => nextCharge(board, today, filter), [board, today, filter])
  const count = groups.reduce((n, g) => n + g.items.length, 0)
  const empty = all.length === 0

  const openRow = useCallback((id: string, el: HTMLElement) => {
    setSheet({ id, columnId: null, anchor: el.getBoundingClientRect(), key: id })
  }, [])
  /** «Nueva suscripción» en la columna `columnId` (por defecto, la última usada o la primera). */
  const openNew = (el: HTMLElement | null, columnId: string | null = newSubscriptionColumn(board, lastColumn)) => {
    const anchor = (el ?? addRef.current)?.getBoundingClientRect() ?? new DOMRect(window.innerWidth / 2 - 180, 96, 0, 0)
    setSheet({ id: null, columnId, anchor, key: `nueva:${crypto.randomUUID()}` })
  }
  const addInColumn = useCallback(
    (el: HTMLElement, columnId: string) => {
      setLastColumn(columnId)
      setSheet({ id: null, columnId, anchor: el.getBoundingClientRect(), key: `nueva:${crypto.randomUUID()}` })
    },
    [setLastColumn],
  )

  /** La tarjeta de una suscripción, si está en pantalla. */
  const rowOf = (id: string | null) =>
    id ? (listsRef.current?.querySelector<HTMLElement>(`[data-subscription-id="${CSS.escape(id)}"]`) ?? null) : null

  /**
   * Al cerrar la ficha, el foco vuelve a su tarjeta (eso ya lo hace el Popover), también si ha cambiado
   * de columna. Si se ha ido de su lista (dada de baja, reactivada, eliminada) o el botón que la abrió ya
   * no está (la nueva, creada desde un «+ Suscripción»), a la vecina de su lista, a la propia tarjeta
   * donde esté ahora o al botón de añadir. Y una nueva con otra tarjeta que la del filtro se ve quitando
   * el filtro.
   */
  const closeSheet = (id: string | null) => {
    const row = rowOf(id)
    const kind = (el: Element | null) => (el?.closest<HTMLElement>('[data-subs-list]')?.dataset.subsList === CANCELLED_LIST ? 'bajas' : 'activas')
    const wasKind = row ? kind(row) : null
    const list = row?.parentElement ?? null
    const siblings = list ? [...list.querySelectorAll<HTMLElement>(':scope > [data-subscription-id]')] : []
    const at = row ? siblings.indexOf(row) : -1
    const neighbours = at < 0 ? [] : [...siblings.slice(at + 1), ...siblings.slice(0, at).reverse()]
    if (sheet?.id === null && id && filter !== undefined && findSubscription(board, id)?.cardId !== filter) setFilterKey(ALL)
    setSheet(null)
    requestAnimationFrame(() => {
      if (hasFocus()) return
      const current = rowOf(id)
      const target = (current && (wasKind === null || kind(current) === wasKind) && current) || neighbours.find((el) => el.isConnected) || current
      const hit = target?.querySelector<HTMLElement>('.subs-hit')
      if (hit) focusStop(hit)
      else addRef.current?.focus()
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

  // Lo pedido desde fuera (N, la búsqueda, «Ver suscripción» en una tarea de aviso, la ficha de un proyecto).
  const request = ui.subscriptionRequest
  useEffect(() => {
    if (!request) return
    ui.clearSubscriptionRequest()
    if ('create' in request) return openNew(null)
    // Una columna, entera: sin filtro, para que se vea lo mismo que se ha contado en su ficha.
    if ('column' in request) {
      if (filter !== undefined) setFilterKey(ALL)
      return setRevealColumn(request.column)
    }
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
      const row = rowOf(reveal)
      const hit = row?.querySelector<HTMLElement>('.subs-hit')
      if (!row || !hit) return
      row.scrollIntoView({ block: 'center', inline: 'nearest' })
      hit.focus({ preventScroll: true })
      openRow(reveal, row)
    })
    return () => cancelAnimationFrame(raf)
  }, [reveal, shown, showCancelled])

  // La columna pedida: a la vista, con el foco en su primera suscripción y un destello para encontrarla.
  useEffect(() => {
    if (!revealColumn) return
    const raf = requestAnimationFrame(() => {
      setRevealColumn(null)
      const section = listsRef.current?.querySelector<HTMLElement>(`[data-subs-column="${CSS.escape(revealColumn)}"]`)
      if (!section) return
      section.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
      section.querySelector<HTMLElement>('.subs-hit, .subs-column-add')?.focus({ preventScroll: true })
      setFlashColumn(revealColumn)
    })
    return () => cancelAnimationFrame(raf)
  }, [revealColumn, shown])

  useEffect(() => {
    if (!flashColumn) return
    const timer = setTimeout(() => setFlashColumn(null), 1400)
    return () => clearTimeout(timer)
  }, [flashColumn])

  // La que se acaba de soltar en otra columna: a la vista y un momento resaltada (está donde le toca por fecha).
  useEffect(() => {
    if (!landed) return
    rowOf(landed)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const timer = setTimeout(() => setLanded(null), 1200)
    return () => clearTimeout(timer)
  }, [landed])

  // ↑↓ (o J/K) recorren su columna y ←→ pasan a la de al lado, como en el tablero. Cuentan también el
  // «+ Suscripción» del pie de cada columna (así se llega a una vacía) y el botón de las dadas de baja; con el
  // foco en uno de ellos, su columna es la de partida. Con el foco fuera de las columnas, empiezan por la
  // primera suscripción. Durante un arrastre con el teclado, las flechas son del arrastre.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return
      const direction = NAV[e.key.length === 1 ? e.key.toLowerCase() : e.key]
      if (!direction || dragRef.current || isTyping(e.target) || document.querySelector('.popover, .search-palette')) return
      const lists = [...(listsRef.current?.querySelectorAll<HTMLElement>('[data-subs-nav]') ?? [])]
        .map((section) => [...section.querySelectorAll<HTMLElement>(STOPS)])
        .filter((stops) => stops.length > 0)
      if (lists.length === 0) return
      const active = document.activeElement
      const current =
        active instanceof HTMLElement ? (active.closest('.subs-card')?.querySelector<HTMLElement>('.subs-hit') ?? active) : null
      const li = current ? lists.findIndex((stops) => stops.includes(current)) : -1
      e.preventDefault()
      if (li === -1) return focusStop(lists.flat().find(isCard) ?? lists[0][0])
      const stops = lists[li]
      const i = stops.indexOf(current!)
      if (direction === 'up' || direction === 'down') {
        const target = stops[i + (direction === 'up' ? -1 : 1)]
        return target && focusStop(target)
      }
      const other = lists[li + (direction === 'left' ? -1 : 1)]
      if (!other) return
      // De una suscripción, a la de la misma altura (o la última); de «+ Suscripción», al de al lado.
      const cards = other.filter(isCard)
      const target = isCard(current!)
        ? (cards[Math.min(stops.filter(isCard).indexOf(current!), cards.length - 1)] ?? other[0])
        : (other.find((el) => el.matches('.subs-column-add')) ?? other.at(-1))
      if (target) focusStop(target)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Arrastrar de una columna a otra ──

  const columnName = (droppableId: string) =>
    droppableId === NO_COLUMN ? 'Sin columna' : (board.columns.find((c) => c.id === droppableId)?.name ?? 'otra columna')
  const nameOf = (id: string) => {
    const sub = findSubscription(board, id)
    return `«${sub ? displayName(sub) : 'Suscripción'}»`
  }

  // La columna de la que sale no admite soltar desde antes de que la librería tome las medidas: así no
  // cambia al empezar (y no se anuncia «Se queda en…» encima de las instrucciones).
  const onBeforeCapture = ({ draggableId }: BeforeCapture) => {
    const home = groups.find((g) => g.items.some((i) => i.subscription.id === draggableId))
    setDrag({ id: draggableId, from: home?.column?.id ?? NO_COLUMN })
  }
  const onDragStart = (start: DragStart, provided: ResponderProvided) => {
    overRef.current = start.source.droppableId
    // Con el teclado, a la vista las vecinas a las que puede ir.
    if (start.mode === 'SNAP') {
      showNextColumn(listsRef.current, start.source.droppableId, 1)
      showNextColumn(listsRef.current, start.source.droppableId, -1)
    }
    provided.announce(
      `${nameOf(start.draggableId)}, en ${columnName(start.source.droppableId)}. Flechas izquierda y derecha para elegir otra columna, Espacio para soltarla, Esc para cancelar.`,
    )
  }
  const onDragUpdate = (update: DragUpdate, provided: ResponderProvided) => {
    const to = update.destination?.droppableId
    // Con el teclado, a la vista también la siguiente columna en esa dirección (la librería solo ofrece las que se ven).
    if (to && to !== overRef.current && update.mode === 'SNAP') {
      showNextColumn(listsRef.current, to, columnIndex(listsRef.current, to) < columnIndex(listsRef.current, overRef.current) ? -1 : 1)
    }
    if (to) overRef.current = to
    provided.announce(to ? `A ${columnName(to)}` : `Se queda en ${columnName(update.source.droppableId)}`)
  }
  const onDragEnd = ({ draggableId, source, destination }: DropResult, provided: ResponderProvided) => {
    setDrag(null)
    overRef.current = null
    if (!destination || destination.droppableId === source.droppableId) {
      provided.announce(`${nameOf(draggableId)} se queda en ${columnName(source.droppableId)}`)
      return
    }
    const columnId = destination.droppableId === NO_COLUMN ? null : destination.droppableId
    actions.updateSubscription(draggableId, { columnId })
    if (columnId) setLastColumn(columnId)
    setLanded(draggableId)
    provided.announce(`${nameOf(draggableId)} pasa a ${columnName(destination.droppableId)}`)
  }

  return (
    <main className={cx('subs', drag && 'is-dragging')} aria-labelledby={titleId}>
      <div className="subs-top">
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
          <EmptyIntro addRef={addRef} onAdd={(el) => openNew(el)} />
        ) : (
          <Summary totals={totals} count={count} next={next} now={now} filterCard={filterCard} noCard={filter === null} />
        )}
      </div>

      <DragDropContext
        onBeforeCapture={onBeforeCapture}
        onDragStart={onDragStart}
        onDragUpdate={onDragUpdate}
        onDragEnd={onDragEnd}
        dragHandleUsageInstructions={DRAG_INSTRUCTIONS}
      >
        <div className="subs-columns" ref={listsRef}>
          {groups.map((group) => {
            const id = group.column?.id ?? NO_COLUMN
            const accepts = !group.column || isAssignable(group.column)
            return (
              <SubscriptionColumn
                key={id}
                id={id}
                group={group}
                now={now}
                dropDisabled={!accepts || drag?.from === id}
                flash={flashColumn === id}
                openId={sheet?.id ?? null}
                landed={landed}
                onOpen={openRow}
                onAdd={accepts && group.column ? addInColumn : undefined}
              />
            )
          })}

          {cancelled.length > 0 && (
            <section className={cx('subs-cancelled', showCancelled && 'is-open')} aria-label="Dadas de baja" data-subs-nav>
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
                <div className="subs-cancelled-list" data-subs-list={CANCELLED_LIST}>
                  {cancelled.map(({ subscription, card }) => (
                    <div key={subscription.id} className="subs-card-wrap" data-subscription-id={subscription.id}>
                      <div
                        className={cx('subs-card', 'is-cancelled', sheet?.id === subscription.id && 'is-open')}
                        style={tint(card?.color ?? 'gray')}
                      >
                        <button
                          type="button"
                          className="subs-hit"
                          aria-label={cardLabel(subscription, card, now)}
                          aria-haspopup="dialog"
                          onClick={(e) => openRow(subscription.id, e.currentTarget)}
                        />
                        <CardBody sub={subscription} card={card} now={now} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </DragDropContext>

      {sheet && (
        <SubscriptionSheet
          key={sheet.key}
          id={sheet.id}
          cardId={sheet.id === null ? (filter ?? null) : undefined}
          columnId={sheet.id === null ? sheet.columnId : undefined}
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

const NAV: Record<string, 'up' | 'down' | 'left' | 'right'> = {
  ArrowUp: 'up',
  k: 'up',
  ArrowDown: 'down',
  j: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}

/** Dónde se para el foco con las flechas: las suscripciones, el «+ Suscripción» de cada columna y el de las bajas. */
const STOPS = '.subs-hit, .subs-column-add, .subs-cancelled-toggle'
const isCard = (el: HTMLElement) => el.matches('.subs-hit')

/** El foco a una suscripción (su tarjeta entera a la vista, también en horizontal) o a otra parada de las flechas. */
function focusStop(el: HTMLElement) {
  el.focus({ preventScroll: true })
  const box = el.closest('.subs-card') ?? el
  box.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

/** El margen de la página a los lados. */
const GUTTER = 26

const columnsIn = (container: HTMLElement | null) => [...(container?.querySelectorAll<HTMLElement>('[data-subs-column]') ?? [])]
const columnIndex = (container: HTMLElement | null, id: string | null) => columnsIn(container).findIndex((c) => c.dataset.subsColumn === id)

/**
 * Con el teclado, la librería de arrastre solo ofrece una columna si se ve (y, si tiene suscripciones, si se
 * ven enteras). Al llegar a la columna `id`, la página se desplaza lo justo para que se vea entera ella y, si
 * cabe, también la siguiente que admite soltar en esa dirección (`step`): así la próxima flecha la encuentra.
 */
function showNextColumn(container: HTMLElement | null, id: string, step: 1 | -1) {
  const columns = columnsIn(container)
  const at = columns.findIndex((c) => c.dataset.subsColumn === id)
  if (at < 0) return
  const next = (step > 0 ? columns.slice(at + 1) : columns.slice(0, at).reverse()).find((c) => c.dataset.subsDrop === 'true')
  const here = columns[at].getBoundingClientRect()
  const there = next?.getBoundingClientRect()
  const width = document.documentElement.clientWidth
  // Lo que queda debajo del menú lateral no se ve.
  const start = sideWidth() + GUTTER
  const dx =
    step > 0
      ? Math.min(Math.max(here.right + GUTTER - width, there ? there.right + GUTTER - width : 0), here.left - start)
      : Math.max(Math.min(here.left - start, there ? there.left - start : 0), here.right + GUTTER - width)
  if (step > 0 ? dx > 0 : dx < 0) window.scrollBy({ left: dx, behavior: 'instant' })
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

/** Sin ninguna suscripción: para qué sirve y cómo empezar (las columnas ya se ven debajo). */
function EmptyIntro({ addRef, onAdd }: { addRef: Ref<HTMLButtonElement>; onAdd: (el: HTMLElement) => void }) {
  const titleId = useId()
  return (
    <section className="subs-intro" aria-labelledby={titleId}>
      <span className="subs-empty-icon" aria-hidden="true">
        <Icon.Card />
      </span>
      <div className="subs-intro-text">
        <h3 id={titleId}>Aún no hay suscripciones</h3>
        <p>
          Apunta lo que pagas cada mes o cada año, cada una en la columna de su empresa: verás cuánto suma cada
          una, cuándo se cobra y con qué tarjeta.
        </p>
      </div>
      <button ref={addRef} type="button" className="btn is-accent" onClick={(e) => onAdd(e.currentTarget)}>
        <Icon.Plus />
        Añadir suscripción
      </button>
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

// ── Columnas ──

/**
 * Una columna: su punto de color, su nombre, cuántas tiene y lo que suman al mes; debajo, sus
 * suscripciones por próximo cobro y «+ Suscripción» (solo en las que admiten suscripciones).
 */
function SubscriptionColumn({
  id,
  group,
  now,
  dropDisabled,
  flash,
  openId,
  landed,
  onOpen,
  onAdd,
}: {
  /** Su id para soltar (el de la columna, o NO_COLUMN). */
  id: string
  group: SubscriptionGroup
  now: Date
  /** No admite soltar: una archivada o la Bandeja, y la de la que sale (no se ordena a mano). */
  dropDisabled: boolean
  /** Recién pedida desde la ficha de su proyecto: un destello para encontrarla. */
  flash: boolean
  openId: string | null
  landed: string | null
  onOpen: (id: string, el: HTMLElement) => void
  onAdd?: (el: HTMLElement, columnId: string) => void
}) {
  const headingId = useId()
  const { column, items } = group
  const name = column?.name ?? 'Sin columna'
  const total = monthlyText(group.totals)
  const count = items.length
  return (
    <section
      className={cx('column', 'subs-column', flash && 'is-flash')}
      // Su color, también para lo de dentro que lleva el de su tarjeta (el destello al soltar una).
      style={{ ...tint(column?.color ?? 'gray'), '--column-tint': `var(--c-${column?.color ?? 'gray'})` } as CSSProperties}
      data-subs-column={id}
      data-subs-nav
      data-subs-drop={!dropDisabled}
      aria-labelledby={headingId}
    >
      <header className="column-header subs-column-header">
        <span className={cx('subs-column-dot', !column && 'is-empty')} aria-hidden="true" />
        <h3 className="column-title" id={headingId}>
          {name}
          <span className="sr-only">
            {`, ${count === 1 ? '1 suscripción' : `${count} suscripciones`}`}
            {total && `, ${total} al mes`}
          </span>
        </h3>
        {column?.archived && (
          <span className="subs-column-tag" title="Columna archivada: los avisos de sus suscripciones van a la Bandeja">
            Archivada
          </span>
        )}
        {count > 0 && (
          <span className="column-count" aria-hidden="true">
            {count}
          </span>
        )}
      </header>
      {total && (
        <p className="subs-column-total" aria-hidden="true">
          {total}
          <span className="subs-unit"> / mes</span>
        </p>
      )}
      <Droppable droppableId={id} isDropDisabled={dropDisabled}>
        {(drop, snapshot) => (
          <div
            ref={drop.innerRef}
            {...drop.droppableProps}
            // La de la que sale, una archivada o la Bandeja no se resaltan: no admiten soltar.
            className={cx('column-body', 'subs-column-body', snapshot.isDraggingOver && !dropDisabled && 'is-over')}
            data-subs-list={id}
          >
            {items.map((item, index) => (
              <SubscriptionCard
                key={item.subscription.id}
                item={item}
                index={index}
                homeId={id}
                now={now}
                open={openId === item.subscription.id}
                landed={landed === item.subscription.id}
                onOpen={onOpen}
              />
            ))}
            {drop.placeholder}
            {onAdd && column && (
              <button type="button" className="subs-column-add" onClick={(e) => onAdd(e.currentTarget, column.id)}>
                <span className="quick-add-icon" aria-hidden="true">
                  <Icon.Plus />
                </span>
                Suscripción
                <span className="sr-only"> en {column.name}</span>
              </button>
            )}
            {!column && <p className="subs-column-hint">Arrástralas a la columna de su empresa o elígela en su ficha.</p>}
          </div>
        )}
      </Droppable>
    </section>
  )
}

/**
 * Durante un arrastre, las demás no se apartan (no se ordenan a mano: van por fecha): la columna de
 * destino se resalta entera. Al soltarla en otra columna, aparece ya en su sitio, sin el vuelo de
 * vuelta a un hueco que no existe; si vuelve a la suya, sí vuelve volando.
 */
function dragStyle(provided: DraggableProvided, snapshot: DraggableStateSnapshot, homeId: string): CSSProperties | undefined {
  const style = provided.draggableProps.style
  if (!snapshot.isDragging) return { ...style, transform: undefined }
  const elsewhere = snapshot.draggingOver !== null && snapshot.draggingOver !== homeId
  if (snapshot.isDropAnimating && (elsewhere || reducedMotion())) return { ...style, transitionDuration: '0.001s' }
  return style
}

const SubscriptionCard = memo(function SubscriptionCard({
  item,
  index,
  homeId,
  now,
  open,
  landed,
  onOpen,
}: {
  item: UpcomingSubscription
  index: number
  homeId: string
  now: Date
  open: boolean
  landed: boolean
  onOpen: (id: string, el: HTMLElement) => void
}) {
  const { subscription: sub, card, charge, days } = item
  return (
    <Draggable draggableId={sub.id} index={index}>
      {(provided, snapshot) => (
        // Fuera, lo que mueve la librería (su transform); dentro, el aspecto (al cogerla, se levanta).
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          style={dragStyle(provided, snapshot, homeId)}
          className="subs-card-wrap"
          data-subscription-id={sub.id}
        >
          <div
            className={cx(
              'subs-card',
              open && 'is-open',
              landed && 'is-landed',
              snapshot.isDragging && !snapshot.isDropAnimating && 'is-lifted',
            )}
            style={tint(card?.color ?? 'gray')}
          >
            {/* La tarjeta entera abre la ficha y se arrastra; el enlace de la web va por encima. */}
            <div
              {...provided.dragHandleProps}
              className="subs-hit"
              aria-label={cardLabel(sub, card, now, charge, days)}
              aria-haspopup="dialog"
              onClick={(e) => onOpen(sub.id, e.currentTarget)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.repeat) {
                  e.preventDefault()
                  onOpen(sub.id, e.currentTarget)
                }
              }}
            />
            <CardBody sub={sub} card={card} now={now} charge={charge} days={days} />
          </div>
        </div>
      )}
    </Draggable>
  )
})

/** Lo que el lector de pantalla dice de una suscripción: nombre, importe, tarjeta, cobro y aviso. */
function cardLabel(sub: Subscription, card: Card | null, now: Date, charge?: string, days = 0) {
  const amount = formatMoney(sub.amount, sub.currency)
  const later = charge ? inDays(days) : null
  const reminder = charge && hasReminder(sub) ? `Aviso ${remindLabel(sub.remind).replace(/^El/, 'el')}.` : ''
  return [
    `${displayName(sub)}, ${amount} cada ${periodUnit(sub.period)}, ${card ? `con ${card.name}` : 'sin tarjeta'}.`,
    charge
      ? `Próximo cobro: ${dayWord(charge, now)}${later ? `, ${later}` : ''}.`
      : `Dada de baja ${sub.cancelledOn ? onDay(sub.cancelledOn, now) : ''}.`,
    reminder,
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * Lo que se ve de una suscripción: la tarjeta en miniatura (de su color), el nombre (con su web, si la
 * tiene), el importe con su periodo y, debajo, el próximo cobro y con qué tarjeta (o la baja), con la
 * campana si avisa.
 */
function CardBody({ sub, card, now, charge, days = 0 }: { sub: Subscription; card: Card | null; now: Date; charge?: string; days?: number }) {
  const name = displayName(sub)
  const reminder = charge !== undefined && hasReminder(sub)
  const remindText = reminder ? remindLabel(sub.remind).replace(/^El/, 'el') : ''
  return (
    <>
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
          <span className="subs-amount" aria-hidden="true">
            {formatMoney(sub.amount, sub.currency)}
            <span className="subs-unit"> / {periodUnit(sub.period)}</span>
          </span>
        </span>
        <span className="subs-meta" aria-hidden="true">
          {charge ? (
            <span className={cx('subs-when', days <= 1 && 'is-soon')} title={inDays(days) ?? undefined}>
              {formatDay(charge, now)}
            </span>
          ) : (
            <span className="subs-when">Baja {sub.cancelledOn ? onDay(sub.cancelledOn, now) : ''}</span>
          )}
          <span className="subs-card-name">{card ? card.name : 'Sin tarjeta'}</span>
          {reminder && (
            <span className="subs-bell" title={`Aviso ${remindText}`}>
              <Icon.Bell />
            </span>
          )}
        </span>
      </span>
    </>
  )
}
