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

/** Se repite (↻) */
export const Repeat = () => (
  <svg {...stroke}>
    <path d="M2.75 7.25V6.5a2.75 2.75 0 0 1 2.75-2.75h7.25" />
    <path d="m10.5 1.5 2.25 2.25L10.5 6" />
    <path d="M13.25 8.75v.75a2.75 2.75 0 0 1-2.75 2.75H3.25" />
    <path d="M5.5 14.5 3.25 12.25 5.5 10" />
  </svg>
)

export const Link = () => (
  <svg {...stroke}>
    <path d="M6.75 9.25a2.5 2.5 0 0 0 3.54 0l2.5-2.5a2.5 2.5 0 0 0-3.54-3.54l-.75.75" />
    <path d="M9.25 6.75a2.5 2.5 0 0 0-3.54 0l-2.5 2.5a2.5 2.5 0 0 0 3.54 3.54l.75-.75" />
  </svg>
)

/** «Algún día»: una caja donde se aparca */
export const Later = () => (
  <svg {...stroke}>
    <rect x="2" y="3" width="12" height="3.25" rx="1" />
    <path d="M3.25 6.25v6a1.25 1.25 0 0 0 1.25 1.25h7a1.25 1.25 0 0 0 1.25-1.25v-6M6.5 9h3" />
  </svg>
)

/** «Lo primero» del día. El relleno lo pone el CSS cuando está marcada. */
export const Star = () => (
  <svg {...stroke} strokeWidth={1.5}>
    <path d="m8 1.9 1.83 3.86 4.22.53-3.1 2.92.8 4.18L8 11.33l-3.75 2.06.8-4.18-3.1-2.92 4.22-.53L8 1.9Z" />
  </svg>
)

/** Panel lateral (a la derecha) */
export const Sidebar = () => (
  <svg {...stroke}>
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.25" />
    <path d="M10 2.75v10.5" />
  </svg>
)

/** Pasos (checklist) */
export const Steps = () => (
  <svg {...stroke}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="2.75" />
    <path d="m5.5 8.25 1.75 1.75 3.25-4" />
  </svg>
)

/** Lupa (búsqueda) */
export const Search = () => (
  <svg {...stroke}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.4 10.4 3.35 3.35" />
  </svg>
)

/** Archivada: una bandeja donde se guarda */
export const Archive = () => (
  <svg {...stroke}>
    <path d="M8 1.75v5.5M5.75 5 8 7.25 10.25 5" />
    <path d="M2.25 9.25h3l1 1.75h3.5l1-1.75h3" />
    <path d="M2.25 9.25v3.25c0 .55.45 1 1 1h9.5c.55 0 1-.45 1-1V9.25" />
  </svg>
)

/** Copiar (dos hojas) */
export const Copy = () => (
  <svg {...stroke}>
    <rect x="5.25" y="5.25" width="8.5" height="8.5" rx="2" />
    <path d="M10.75 5.25V4a1.75 1.75 0 0 0-1.75-1.75H4A1.75 1.75 0 0 0 2.25 4v5A1.75 1.75 0 0 0 4 10.75h1.25" />
  </svg>
)

/** Carpeta del proyecto (se abre en el Finder) */
export const Folder = () => (
  <svg {...stroke}>
    <path d="M2 4.6c0-.94.76-1.7 1.7-1.7h2.4c.42 0 .82.16 1.13.44l.94.86c.3.28.71.44 1.13.44h2.9c.94 0 1.7.76 1.7 1.7v5.06c0 .94-.76 1.7-1.7 1.7H3.7c-.94 0-1.7-.76-1.7-1.7V4.6Z" />
  </svg>
)

/** Claude Code: una terminal */
export const Terminal = () => (
  <svg {...stroke}>
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.25" />
    <path d="m4.75 6.25 2 1.75-2 1.75M8.75 10h2.5" />
  </svg>
)

/** Repositorio: una rama */
export const Branch = () => (
  <svg {...stroke}>
    <circle cx="4.75" cy="3.75" r="1.5" />
    <circle cx="4.75" cy="12.25" r="1.5" />
    <circle cx="11.25" cy="5.25" r="1.5" />
    <path d="M4.75 5.25v5.5M11.25 6.75c0 2.1-1.6 2.85-3.6 3.1-1.3.17-2.4.5-2.9 1" />
  </svg>
)

/** Producción: la web publicada */
export const Globe = () => (
  <svg {...stroke}>
    <circle cx="8" cy="8" r="6" />
    <path d="M2.25 8h11.5M8 2c1.55 1.65 2.35 3.65 2.35 6S9.55 12.35 8 14C6.45 12.35 5.65 10.35 5.65 8S6.45 3.65 8 2Z" />
  </svg>
)

/** Staging: un matraz (pruebas) */
export const Flask = () => (
  <svg {...stroke}>
    <path d="M6.25 2.25h3.5M6.75 2.25V6.2L3.3 12.2a1.2 1.2 0 0 0 1.04 1.8h7.32a1.2 1.2 0 0 0 1.04-1.8L9.25 6.2V2.25" />
    <path d="M4.75 10.25h6.5" />
  </svg>
)

/** Bandeja de entrada */
export const Inbox = () => (
  <svg {...stroke}>
    <path d="M2.25 9.25h3l1 1.75h3.5l1-1.75h3" />
    <path d="M2.25 9.25 4 3.9c.17-.5.63-.85 1.16-.85h5.68c.53 0 1 .34 1.16.85l1.75 5.35v3.25c0 .55-.45 1-1 1h-9.5c-.55 0-1-.45-1-1V9.25Z" />
  </svg>
)

/** Tarjeta (suscripciones): una tarjeta con su banda */
export const Card = () => (
  <svg {...stroke}>
    <rect x="1.75" y="3.25" width="12.5" height="9.5" rx="2" />
    <path d="M1.75 6.5h12.5M4.5 10h2.5" />
  </svg>
)

/** Enlace que se abre fuera (la web de una suscripción) */
export const External = () => (
  <svg {...stroke}>
    <path d="M9.25 2.75h4v4M13.25 2.75 7.5 8.5" />
    <path d="M11.75 9.5v2.25c0 .83-.67 1.5-1.5 1.5h-6c-.83 0-1.5-.67-1.5-1.5v-6c0-.83.67-1.5 1.5-1.5H6.5" />
  </svg>
)

/** Menú lateral (a la izquierda) */
export const SidebarLeft = () => (
  <svg {...stroke}>
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.25" />
    <path d="M6 2.75v10.5M3.6 5.5h0.9M3.6 7.75h0.9" />
  </svg>
)

/** Megáfono (anuncios) */
export const Megaphone = () => (
  <svg {...stroke}>
    <path d="M2.25 6.6c0-.6.45-1.1 1.05-1.1H5.5l6.25-3v11L5.5 10.5H3.3c-.6 0-1.05-.5-1.05-1.1V6.6Z" />
    <path d="M5.5 10.5 6.6 14h1.6l-.9-3.5" />
  </svg>
)

/** Imagen (creatividad) */
export const Image = () => (
  <svg {...stroke}>
    <rect x="2" y="2.75" width="12" height="10.5" rx="2" />
    <circle cx="5.75" cy="6.25" r="1.1" />
    <path d="m2.5 12 3.75-3.5 2.5 2.25 2-1.75 2.75 2.5" />
  </svg>
)

/** Vídeo (creatividad) */
export const Video = () => (
  <svg {...stroke}>
    <rect x="1.75" y="3.75" width="9" height="8.5" rx="2" />
    <path d="m10.75 7 3.5-2v6l-3.5-2" />
  </svg>
)

/** Recargar (↻ sin repetición: volver a pedir los datos) */
export const Reload = () => (
  <svg {...stroke}>
    <path d="M13 8a5 5 0 1 1-1.6-3.67" />
    <path d="M11.75 1.75v2.9h-2.9" />
  </svg>
)
