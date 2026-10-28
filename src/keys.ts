// Teclado y ratón sobre las tareas, en un solo sitio: el mapa de atajos (lo que enseña «?») y los
// manejadores globales. Las teclas de tarea actúan sobre el destino: las seleccionadas; si no, la
// que tiene el foco; si no, la que está bajo el ratón (esto último solo en Hoy y Tablero).
//
// Las filas de tarea llevan data-task-id y van dentro de una lista con data-task-list (una columna,
// un día, la página de Hoy…): ↑↓ se mueven dentro de la lista y ←→ saltan a la lista vecina.
import { useEffect, useRef } from 'react'
import type { TaskCommands, When } from './commands'
import type { View } from './context'
import type { Board } from './model'
import { selection } from './selection'
import type { Actions } from './state'
import { activeColumns } from './today'
import { isTyping } from './util'

// ── Mapa de atajos ──

/** Cada atajo: sus combinaciones alternativas («⌘K» o «/») y qué hace. */
export interface Shortcut {
  keys: string[][]
  label: string
}

export interface ShortcutSection {
  title: string
  note?: string
  items: Shortcut[]
}

/** En la ayuda van en dos columnas: General, Calendario y Suscripciones; Tareas y Selección. */
export const SHORTCUTS: ShortcutSection[] = [
  {
    title: 'General',
    items: [
      { keys: [['D']], label: 'Hoy' },
      { keys: [['T']], label: 'Tablero' },
      { keys: [['C']], label: 'Calendario' },
      { keys: [['U']], label: 'Suscripciones' },
      { keys: [['P']], label: 'Meta Ads' },
      { keys: [['G']], label: 'Google Ads' },
      { keys: [['⌃', '⌘', 'S']], label: 'Mostrar u ocultar el menú lateral' },
      { keys: [['N']], label: 'Nueva tarea' },
      { keys: [['1', '…', '9']], label: 'Nueva tarea en esa columna' },
      { keys: [['⇧', 'N']], label: 'Nueva columna' },
      { keys: [['⌘', 'K'], ['/']], label: 'Buscar' },
      { keys: [['?']], label: 'Atajos' },
      { keys: [['⌘', 'Z']], label: 'Deshacer' },
      { keys: [['⇧', '⌘', 'Z']], label: 'Rehacer' },
    ],
  },
  {
    title: 'Calendario',
    note: 'Con una tarea con el foco o seleccionada, H, M y ← → actúan sobre ella.',
    items: [
      { keys: [['N']], label: 'Nueva tarea para hoy' },
      { keys: [['←', '→']], label: 'Anterior / siguiente' },
      { keys: [['H']], label: 'Hoy' },
      { keys: [['S']], label: 'Semana' },
      { keys: [['M']], label: 'Mes' },
    ],
  },
  {
    title: 'Suscripciones',
    items: [
      { keys: [['N']], label: 'Nueva suscripción' },
      { keys: [['↑', '↓'], ['←', '→']], label: 'Moverse por la columna y entre columnas' },
      { keys: [['↩']], label: 'Abrir su ficha' },
      { keys: [['Espacio']], label: 'Llevarla a otra columna (con ← →)' },
    ],
  },
  {
    title: 'Tareas',
    note: 'Actúan sobre las seleccionadas, la que tiene el foco o la que está bajo el ratón.',
    items: [
      { keys: [['↑', '↓'], ['J', 'K']], label: 'Moverse' },
      { keys: [['←', '→']], label: 'Cambiar de columna' },
      { keys: [['↩']], label: 'Abrir' },
      { keys: [['X']], label: 'Completar' },
      { keys: [['H']], label: 'Para hoy' },
      { keys: [['M']], label: 'Para mañana' },
      { keys: [['L']], label: 'Para la próxima semana' },
      { keys: [['0']], label: 'Quitar la fecha' },
      { keys: [['A']], label: 'Algún día' },
      { keys: [['F']], label: 'Lo primero de hoy' },
      { keys: [['⌥', '1', '…', '9']], label: 'Mover a esa columna' },
      { keys: [['⌘', 'D']], label: 'Duplicar' },
      { keys: [['⌫']], label: 'Eliminar' },
      { keys: [['Espacio']], label: 'Arrastrar con el teclado' },
      { keys: [['Esc']], label: 'Soltar la selección' },
    ],
  },
  {
    title: 'Selección',
    items: [
      { keys: [['⌘', 'clic']], label: 'Añadir o quitar' },
      { keys: [['⇧', 'clic']], label: 'Seleccionar un tramo' },
      { keys: [['⇧', '↑', '↓']], label: 'Ampliar la selección' },
    ],
  },
]

// ── Filas de tarea en pantalla ──

const TASK = '[data-task-id]'
const LIST = '[data-task-list]'

/** La vista abierta. Las filas de los popovers (p. ej. el de un día del mes) no cuentan. */
const viewRoot = () => document.querySelector<HTMLElement>('main')

export const idOf = (el: HTMLElement) => el.dataset.taskId ?? ''

export function taskElement(id: string): HTMLElement | null {
  return viewRoot()?.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(id)}"]`) ?? null
}

/** La fila con el foco (o con el foco en uno de sus botones). */
export function focusedTask(): HTMLElement | null {
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return null
  const el = active.closest<HTMLElement>(TASK)
  return el && viewRoot()?.contains(el) ? el : null
}

export const hoveredTask = () => viewRoot()?.querySelector<HTMLElement>(`${TASK}:hover`) ?? null

export const listOf = (el: HTMLElement) => el.closest<HTMLElement>(LIST)

export const itemsIn = (list: Element) => [...list.querySelectorAll<HTMLElement>(TASK)]

/** ¿Hay una tarea elegida (con el foco o seleccionada)? En el calendario, entonces H, M, ←→ son suyas. */
export const hasTaskTarget = () => selection.size() > 0 || focusedTask() !== null

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function focusTask(el: HTMLElement, { center = false, smooth = false } = {}) {
  el.focus({ preventScroll: true })
  el.scrollIntoView({
    block: center ? 'center' : 'nearest',
    inline: 'nearest',
    behavior: smooth && !reducedMotion() ? 'smooth' : 'auto',
  })
}

/** Desplaza `scroller` lo justo para que `el` (con su scroll-margin) se vea entero. */
function scrollWithin(scroller: HTMLElement, el: HTMLElement, behavior: ScrollBehavior) {
  const margin = getComputedStyle(el)
  const s = scroller.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  const above = r.top - (parseFloat(margin.scrollMarginTop) || 0) - s.top
  const below = r.bottom + (parseFloat(margin.scrollMarginBottom) || 0) - s.bottom
  const delta = above < 0 ? above : below > 0 ? Math.min(below, above) : 0
  if (delta) scroller.scrollBy({ top: delta, behavior })
}

/**
 * Enseña un campo «Nueva tarea» con su vista previa: en el tablero, la columna entera (con su «…»);
 * en su lista, el campo y lo que haya que dejar libre debajo (scroll-margin).
 */
export function revealQuickAdd(input: HTMLElement) {
  const behavior: ScrollBehavior = reducedMotion() ? 'auto' : 'smooth'
  const box = input.closest<HTMLElement>('.quick-add') ?? input
  input.closest<HTMLElement>('.column')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior })
  const scroller = box.closest<HTMLElement>('.column-body, .today')
  if (scroller) scrollWithin(scroller, box, behavior)
}

/** Espera a que una fila aparezca (tras un cambio de vista o de tablero) y la entrega. */
export function whenTaskShown(id: string, then: (el: HTMLElement | null) => void, frames = 12) {
  let left = frames
  let raf = 0
  const tick = () => {
    const el = taskElement(id)
    if (el || --left <= 0) then(el)
    else raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(raf)
}

type Direction = 'up' | 'down' | 'left' | 'right'

/** ↑↓ dentro de la lista; ←→ a la lista vecina con tareas, en la misma posición (o la última). */
function step(from: HTMLElement, direction: Direction): HTMLElement | null {
  const lists = [...(viewRoot()?.querySelectorAll<HTMLElement>(LIST) ?? [])].map(itemsIn).filter((items) => items.length > 0)
  const li = lists.findIndex((items) => items.includes(from))
  if (li === -1) return lists[0]?.[0] ?? null
  const items = lists[li]
  const i = items.indexOf(from)
  if (direction === 'up') return items[i - 1] ?? null
  if (direction === 'down') return items[i + 1] ?? null
  const next = lists[li + (direction === 'left' ? -1 : 1)]
  return next ? next[Math.min(i, next.length - 1)] : null
}

const firstTask = () => {
  const root = viewRoot()
  const list = root && [...root.querySelectorAll<HTMLElement>(LIST)].find((l) => l.querySelector(TASK))
  return list ? itemsIn(list)[0] : null
}

/** El rescate de foco pendiente: lo cancela la siguiente tecla o clic (ya no hace falta). */
let cancelRescue = () => {}

/**
 * Si la fila con el foco desaparece (completada, borrada, movida…), el foco pasa a la misma
 * tarea en su sitio nuevo (`follow`) o a su vecina, para seguir con el teclado sin perderse.
 * Solo vigila un momento (`wait`): lo justo para que se aplique el cambio.
 */
export function keepFocus(el: HTMLElement, follow: boolean, wait = 400) {
  cancelRescue()
  const id = idOf(el)
  const list = listOf(el)
  const items = list ? itemsIn(list) : [el]
  const i = Math.max(0, items.indexOf(el))
  const neighbors = [...items.slice(i + 1), ...items.slice(0, i).reverse()].map(idOf)
  let timer: ReturnType<typeof setTimeout> | undefined
  const observer = new MutationObserver(() => {
    if (el.isConnected) return
    stop()
    const active = document.activeElement
    if (active && active !== document.body && active.isConnected) return
    const target = (follow ? taskElement(id) : null) ?? neighbors.map(taskElement).find((e) => e !== null) ?? null
    if (target) focusTask(target)
  })
  const stop = () => {
    observer.disconnect()
    clearTimeout(timer)
    cancelRescue = () => {}
  }
  observer.observe(document.body, { childList: true, subtree: true })
  timer = setTimeout(stop, wait)
  cancelRescue = stop
}

interface Target {
  ids: string[]
  /** Una fila para abrir el detalle o la animación de completar. */
  el: HTMLElement | null
  /** La fila con el foco, si es parte del destino (para que el foco no se pierda). */
  focused: HTMLElement | null
}

function resolveTarget(view: View): Target | null {
  const focused = focusedTask()
  const ids = selection.ids()
  if (ids.length > 0) {
    const inside = focused && ids.includes(idOf(focused)) ? focused : null
    return { ids, el: inside ?? taskElement(ids[0]), focused: inside }
  }
  if (focused) return { ids: [idOf(focused)], el: focused, focused }
  const hovered = view === 'board' || view === 'today' ? hoveredTask() : null
  return hovered ? { ids: [idOf(hovered)], el: hovered, focused: null } : null
}

const popoverOpen = () => document.querySelector('.popover') !== null
/** Arrastre con hello-pangea en marcha, en el tablero o en Suscripciones (con teclado, las flechas son suyas). */
const dragging = () => document.querySelector('.board[class*="is-dragging"], .subs.is-dragging') !== null

// ── Manejadores ──

export interface KeyContext {
  view: View
  board: () => Board | null
  actions: Actions
  commands: TaskCommands
  /** La paleta de búsqueda está abierta: las teclas son suyas. */
  blocked: () => boolean
  setView: (view: View) => void
  toggleSidebar: () => void
  /** N en la vista abierta (el calendario atiende la suya; en Suscripciones, «Nueva suscripción»). */
  newTask: () => void
  newColumn: () => void
  /** 1–9: «Nueva tarea» de esa columna en el tablero. */
  addInColumn: (columnId: string) => void
  openSearch: () => void
  openShortcuts: () => void
  openTask: (id: string, anchor: HTMLElement) => void
}

const VIEW_KEYS: Record<string, View> = { d: 'today', t: 'board', c: 'calendar', u: 'subscriptions', p: 'ads', g: 'google' }
const NAV_KEYS: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', k: 'up', j: 'down' }
const WHEN_KEYS: Record<string, When> = { h: 'today', m: 'tomorrow', l: 'nextWeek' }

function onKey(e: KeyboardEvent, c: KeyContext) {
  // Cualquier otra tecla deja sin efecto un rescate de foco pendiente.
  if (!e.repeat) cancelRescue()
  if (e.defaultPrevented || e.isComposing || c.blocked()) return
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  const cmd = e.metaKey || e.ctrlKey
  const typing = isTyping(e.target)
  const run = (fn: () => void) => {
    e.preventDefault()
    fn()
  }

  if (cmd && !e.altKey && key === 'z') {
    if (typing) return // en un campo de texto, ⌘Z deshace el texto
    return run(e.shiftKey ? c.actions.redo : c.actions.undo)
  }
  // Nada con un campo de texto activo ni con un popover abierto (Esc ya lo cierra el popover).
  if (typing || popoverOpen() || dragging()) return
  // El calendario atiende su N y, sin tarea elegida, ←→ (su manejador puede ir antes o después que este).
  if (c.view === 'calendar' && !cmd && !e.altKey && !e.shiftKey) {
    if (key === 'n' || ((key === 'ArrowLeft' || key === 'ArrowRight') && !hasTaskTarget())) return
  }

  if (cmd) {
    if (e.altKey || e.shiftKey) return
    // ⌃⌘S, como en Finder y Notas.
    if (e.metaKey && e.ctrlKey) return key === 's' ? run(c.toggleSidebar) : undefined
    if (key === 'k') return run(c.openSearch)
    if (key === 'd') {
      // En Chrome, ⌘D es «añadir a marcadores»: solo se le quita si hay tarea que duplicar.
      const target = resolveTarget(c.view)
      if (target) run(() => duplicate(target, c))
    }
    return
  }

  if (e.altKey) {
    // ⌥1–9 (con e.code: con ⌥, e.key es «¡», «™»…).
    const digit = /^Digit([1-9])$/.exec(e.code)
    const board = c.board()
    const column = digit && board ? activeColumns(board)[Number(digit[1]) - 1] : undefined
    const target = column ? resolveTarget(c.view) : null
    if (!column || !target) return
    return run(() => {
      if (target.focused) keepFocus(target.focused, true)
      c.commands.moveTo(target.ids, column.id)
    })
  }

  if (key === '/') return run(c.openSearch)
  if (key === '?') return run(c.openShortcuts)
  if (key === 'n') return run(e.shiftKey ? c.newColumn : c.newTask)

  const direction = NAV_KEYS[e.key.length === 1 && !e.shiftKey ? key : e.key]
  if (direction) return navigate(e, c, direction)

  if (key === 'Escape') {
    const active = document.activeElement
    if (selection.size() === 0 && !focusedTask()) return
    return run(() => {
      selection.clear()
      if (active instanceof HTMLElement) active.blur()
    })
  }

  if (key === 'Enter') {
    // Un botón o un enlace con el foco hacen lo suyo con ↩.
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body && !active.matches(TASK)) return
    const target = resolveTarget(c.view)
    if (target?.el) run(() => c.openTask(idOf(target.el!), target.el!))
    return
  }

  if (e.shiftKey) return

  if (/^[1-9]$/.test(key)) {
    const board = c.board()
    const column = board ? activeColumns(board)[Number(key) - 1] : undefined
    if (column) run(() => c.addInColumn(column.id))
    return
  }
  const view = VIEW_KEYS[key]
  if (view) return run(() => c.setView(view))

  const isTaskKey = key in WHEN_KEYS || ['x', '0', 'a', 'f', 'Backspace', 'Delete'].includes(key)
  const target = isTaskKey ? resolveTarget(c.view) : null
  if (!target) return
  e.preventDefault()
  const { ids, focused } = target
  const when = WHEN_KEYS[key]
  if (when) {
    if (focused) keepFocus(focused, true)
    c.commands.schedule(ids, when)
  } else if (key === 'x') {
    complete(target, c)
  } else if (key === '0') {
    if (focused) keepFocus(focused, true)
    c.commands.undate(ids)
  } else if (key === 'a') {
    if (focused) keepFocus(focused, true)
    c.commands.someday(ids)
  } else if (key === 'f') {
    c.commands.first(ids)
  } else {
    if (focused) keepFocus(focused, false)
    c.commands.remove(ids)
    selection.clear()
  }
}

/** ↑↓ J K y ←→. Sin nada con el foco, empieza por la tarea bajo el ratón o por la primera. */
function navigate(e: KeyboardEvent, c: KeyContext, direction: Direction) {
  const from = focusedTask()
  if (!from) {
    const start = ((c.view === 'board' || c.view === 'today') && hoveredTask()) || firstTask()
    if (!start) return
    e.preventDefault()
    focusTask(start)
    return
  }
  e.preventDefault()
  const to = step(from, direction)
  if (!to) return
  // ⇧↑↓: la de partida y la de llegada pasan a la selección.
  if (e.shiftKey && (direction === 'up' || direction === 'down')) selection.add([idOf(from), idOf(to)], selection.anchor() ?? idOf(from))
  focusTask(to)
}

/** X: con una sola tarea en pantalla, su propio círculo (con la animación); con varias, de golpe. */
function complete({ ids, el, focused }: Target, c: KeyContext) {
  const check = ids.length === 1 ? el?.querySelector<HTMLButtonElement>('button.check') : null
  // Con su círculo, la fila tarda casi un segundo en irse (la pausa y la animación).
  if (focused) keepFocus(focused, false, check ? 1600 : 400)
  if (check) check.click()
  else c.commands.complete(ids)
  selection.clear()
}

/** ⌘D. Con una tarea con el foco, el foco pasa a la copia. */
function duplicate({ ids, focused }: Target, c: KeyContext) {
  const copies = c.commands.duplicate(ids)
  if (focused && copies.length === 1) whenTaskShown(copies[0], (el) => el && focusTask(el))
}

export function useShortcuts(context: KeyContext) {
  const ref = useRef(context)
  ref.current = context
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e, ref.current)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
}

/**
 * ⌘clic alterna una tarea en la selección; ⇧clic selecciona el tramo dentro de la misma lista
 * (columna, día, Hoy). Un clic normal en una tarea, o fuera de las tareas, suelta la selección.
 */
export function useSelectionClicks() {
  useEffect(() => {
    // La tarea con el foco antes del clic: el ancla de un ⇧clic si no hay otra.
    let before: string | null = null

    const onPointerDown = (e: PointerEvent) => {
      cancelRescue()
      const focused = focusedTask()
      before = focused ? idOf(focused) : null
      const target = e.target instanceof Element ? e.target : null
      if (selection.size() > 0 && !target?.closest(`${TASK}, .selection-bar, .popover, .toast, .search-palette`)) selection.clear()
    }

    const onClick = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null
      const el = target?.closest<HTMLElement>(TASK)
      if (!el || !viewRoot()?.contains(el) || target?.closest('a')) return
      if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
        // Clic normal: abre la tarea (lo hace la fila) y suelta la selección.
        selection.clear()
        return
      }
      e.preventDefault()
      e.stopPropagation()
      const id = idOf(el)
      const anchorId = e.shiftKey ? (selection.anchor() ?? before) : null
      const anchorEl = anchorId ? taskElement(anchorId) : null
      const list = listOf(el)
      if (anchorEl && list && listOf(anchorEl) === list) {
        const items = itemsIn(list)
        const [a, b] = [items.indexOf(anchorEl), items.indexOf(el)].sort((x, y) => x - y)
        selection.add(items.slice(a, b + 1).map(idOf), anchorId)
      } else {
        selection.toggle(id)
      }
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [])
}
