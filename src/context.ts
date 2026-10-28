import { createContext, useContext } from 'react'
import type { Board } from './model'
import type { Actions } from './state'
import type { AvisosStatus } from './sync'

export type View = 'today' | 'board' | 'calendar' | 'subscriptions' | 'ads' | 'google'

/**
 * Lo que la vista Suscripciones abre en cuanto está en pantalla: la ficha de una, «Nueva suscripción» o
 * una columna (desde la ficha de su proyecto).
 */
export type SubscriptionRequest = { id: string } | { create: true } | { column: string }

export interface UI {
  /** Estado de los avisos en el iPhone (null hasta saberlo). */
  avisos: AvisosStatus | null
  view: View
  setView: (view: View) => void
  /** Menú lateral con las vistas (⌃⌘S lo muestra u oculta). */
  sidebarOpen: boolean
  toggleSidebar: () => void
  renamingColumnId: string | null
  setRenaming: (columnId: string | null) => void
  openTaskId: string | null
  openTask: (taskId: string, anchor: HTMLElement) => void
  /** Pone el cursor en «Nueva tarea» de una columna (por defecto, la última usada). */
  focusQuickAdd: (columnId?: string) => void
  registerQuickAdd: (columnId: string, input: HTMLInputElement | null) => void
  setLastColumn: (columnId: string) => void
  newColumn: () => void
  toast: (message: string, options?: { undo?: boolean }) => void
  /** Ayuda de atajos de teclado (tecla ?). */
  shortcutsOpen: boolean
  setShortcutsOpen: (open: boolean) => void
  /** El estado de los avisos en el iPhone (desde la búsqueda). */
  avisosOpen: boolean
  setAvisosOpen: (open: boolean) => void
  /** Búsqueda (⌘K, /). */
  openSearch: () => void
  /** Va al tablero, enseña la tarea con el foco y, si `open`, abre su detalle. false si no existe. */
  revealTask: (taskId: string, open?: boolean) => boolean
  /** Guarda ya los cambios pendientes (antes de pedir algo al servidor sobre el tablero guardado). */
  saveNow: () => Promise<boolean>
  /** Trae lo guardado (tras un cambio hecho en el servidor, como archivar). */
  refresh: () => void
  /** Va a Suscripciones y abre la ficha de esa suscripción («Ver suscripción» en una tarea de aviso). */
  openSubscription: (id: string) => void
  /** Va a Suscripciones y abre «Nueva suscripción» (N en esa vista, la búsqueda). */
  newSubscription: () => void
  /** Va a Suscripciones con esa columna a la vista (desde la ficha de su proyecto). */
  openSubscriptionColumn: (columnId: string) => void
  /** Lo pedido con openSubscription o newSubscription, hasta que la vista lo atiende. */
  subscriptionRequest: SubscriptionRequest | null
  clearSubscriptionRequest: () => void
}

export const BoardContext = createContext<Board | null>(null)
export const ActionsContext = createContext<Actions | null>(null)
export const UIContext = createContext<UI | null>(null)
export const NowContext = createContext<Date>(new Date())

function required<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`${name} fuera de su proveedor`)
  return value
}

export const useBoard = () => required(useContext(BoardContext), 'BoardContext')
export const useActions = () => required(useContext(ActionsContext), 'ActionsContext')
export const useUI = () => required(useContext(UIContext), 'UIContext')
export const useNow = () => useContext(NowContext)
