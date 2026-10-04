import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { clamp, cx } from '../util'

type Placement = 'side' | 'below-start' | 'below-end'

interface PopoverProps {
  /** Elemento o rectángulo del que nace el popover. */
  anchor: HTMLElement | DOMRect
  placement?: Placement
  width?: number
  label: string
  role?: 'dialog' | 'menu'
  className?: string
  style?: CSSProperties
  onClose: () => void
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  children: ReactNode
}

const MARGIN = 12
const GAP = 8

/** Popovers abiertos, de abajo arriba: Esc y los clics fuera solo afectan a los de encima. */
const stack: HTMLElement[] = []

/** Panel flotante anclado a un elemento. Se cierra con Esc o al pulsar fuera. */
export function Popover({
  anchor,
  placement = 'below-start',
  width,
  label,
  role = 'dialog',
  className,
  style,
  onClose,
  onKeyDown,
  children,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  const place = useCallback(() => {
    const el = ref.current
    if (!el) return
    const a = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor
    const w = el.offsetWidth
    const h = el.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left: number
    let top: number
    let origin: string

    if (placement === 'side') {
      // A la derecha del ancla si cabe; si no, a la izquierda.
      let side = 'center'
      if (a.right + GAP + w <= vw - MARGIN) {
        left = a.right + GAP
        side = 'left'
      } else if (a.left - GAP - w >= MARGIN) {
        left = a.left - GAP - w
        side = 'right'
      } else {
        left = clamp(a.left + a.width / 2 - w / 2, MARGIN, vw - w - MARGIN)
      }
      top = clamp(a.top - 10, MARGIN, vh - h - MARGIN)
      origin = `${side} ${clamp(a.top + a.height / 2 - top, 0, h)}px`
    } else {
      left = clamp(placement === 'below-end' ? a.right - w : a.left, MARGIN, vw - w - MARGIN)
      top = a.bottom + 6
      const above = top + h > vh - MARGIN && a.top - 6 - h >= MARGIN
      if (above) top = a.top - 6 - h
      origin = `${clamp(a.left + a.width / 2 - left, 0, w)}px ${above ? 'bottom' : 'top'}`
    }

    // Directamente en el DOM y antes de pintar: así el panel nunca está oculto ni fuera de sitio.
    el.style.left = `${left}px`
    el.style.top = `${top}px`
    el.style.transformOrigin = origin
  }, [anchor, placement])

  useLayoutEffect(() => {
    place()
    const observer = new ResizeObserver(place)
    if (ref.current) observer.observe(ref.current)
    window.addEventListener('resize', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [place])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // Ya colocado y visible: foco al campo marcado con data-autofocus, o al propio panel.
    const auto = el.querySelector<HTMLElement>('[data-autofocus]')
    if (auto) auto.focus({ preventScroll: true })
    else if (!el.contains(document.activeElement)) el.focus({ preventScroll: true })
    stack.push(el)

    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || stack.at(-1) !== el) return
      e.preventDefault()
      e.stopPropagation()
      closeRef.current()
    }
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node
      if (el.contains(target)) return
      if (anchor instanceof HTMLElement && anchor.contains(target)) return
      // Un clic dentro de un popover abierto encima de este (p. ej. un menú) no lo cierra.
      if (stack.slice(stack.indexOf(el) + 1).some((child) => child.contains(target))) return
      closeRef.current()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onPointer, true)
    return () => {
      stack.splice(stack.indexOf(el), 1)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onPointer, true)
      // Devuelve el foco a donde estaba, salvo que ya lo tenga otro elemento.
      if (document.activeElement === document.body || el.contains(document.activeElement)) {
        previous?.focus({ preventScroll: true })
      }
    }
  }, [anchor])

  return createPortal(
    <div
      ref={ref}
      role={role}
      aria-label={label}
      tabIndex={-1}
      className={cx('popover', className)}
      onKeyDown={onKeyDown}
      style={{ ...style, width }}
    >
      {children}
    </div>,
    document.body,
  )
}

export type MenuItem =
  | { label: string; run: () => void; disabled?: boolean; danger?: boolean; hint?: string }
  | 'separator'

/** Menú desplegable al estilo macOS. */
export function Menu({
  anchor,
  items,
  label,
  onClose,
}: {
  anchor: HTMLElement
  items: MenuItem[]
  label: string
  onClose: () => void
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      e.key === 'ArrowDown' ? (current + 1) % buttons.length : current <= 0 ? buttons.length - 1 : current - 1
    buttons[next]?.focus()
  }

  return (
    <Popover anchor={anchor} placement="below-end" width={232} label={label} role="menu" className="menu" onClose={onClose} onKeyDown={onKeyDown}>
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={`sep-${i}`} className="menu-sep" role="separator" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={cx('menu-item', item.danger && 'is-danger')}
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.run()
            }}
          >
            <span>{item.label}</span>
            {item.hint && <kbd>{item.hint}</kbd>}
          </button>
        ),
      )}
    </Popover>
  )
}
