import type { SVGProps } from 'react'

const stroke: SVGProps<SVGSVGElement> = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
}

export const Plus = () => (
  <svg {...stroke}>
    <path d="M8 3.25v9.5M3.25 8h9.5" />
  </svg>
)

export const Ellipsis = () => (
  <svg {...stroke} fill="currentColor" stroke="none">
    <circle cx="3.5" cy="8" r="1.35" />
    <circle cx="8" cy="8" r="1.35" />
    <circle cx="12.5" cy="8" r="1.35" />
  </svg>
)

export const Calendar = () => (
  <svg {...stroke}>
    <rect x="2.5" y="3.25" width="11" height="10.25" rx="2.25" />
    <path d="M2.5 6.75h11M5.5 1.75v2.5M10.5 1.75v2.5" />
  </svg>
)

export const Bell = () => (
  <svg {...stroke}>
    <path d="M4 11.25V7.5a4 4 0 0 1 8 0v3.75l1 1.25H3l1-1.25Z" />
    <path d="M6.6 14.25a1.5 1.5 0 0 0 2.8 0" />
  </svg>
)

export const Clock = () => (
  <svg {...stroke}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.75V8l2.25 1.5" />
  </svg>
)

export const Close = () => (
  <svg {...stroke}>
    <path d="m4.5 4.5 7 7m0-7-7 7" />
  </svg>
)

export const Alert = () => (
  <svg {...stroke}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.75V8.5M8 11.1v.01" />
  </svg>
)

export const Chevron = () => (
  <svg {...stroke}>
    <path d="M6 3.5 10.5 8 6 12.5" />
  </svg>
)

export const Check = () => (
  <svg {...stroke}>
    <path d="m3.5 8.5 3 3 6-7" />
  </svg>
)

export const ChevronLeft = () => (
  <svg {...stroke}>
    <path d="M10 3.5 5.5 8l4.5 4.5" />
  </svg>
)

export const Trash = () => (
  <svg {...stroke}>
    <path d="M2.75 4.25h10.5M6.25 4.25v-1.5h3.5v1.5M4 4.25l.6 8.6c.05.65.6 1.15 1.25 1.15h4.3c.65 0 1.2-.5 1.25-1.15l.6-8.6" />
  </svg>
)

export const Keyboard = () => (
  <svg {...stroke}>
    <rect x="1.75" y="3.75" width="12.5" height="8.5" rx="2" />
    <path d="M4.5 6.6h.01M7 6.6h.01M9.5 6.6h.01M12 6.6h.01M5.5 9.4h5" />
  </svg>
)

export const Download = () => (
  <svg {...stroke}>
    <path d="M8 2.5v7.75M4.75 7 8 10.25 11.25 7M3 13.25h10" />
  </svg>
)

export const Columns = () => (
  <svg {...stroke}>
    <rect x="2" y="2.75" width="3.4" height="10.5" rx="1.2" />
    <rect x="6.3" y="2.75" width="3.4" height="7.5" rx="1.2" />
    <rect x="10.6" y="2.75" width="3.4" height="5" rx="1.2" />
  </svg>
)
