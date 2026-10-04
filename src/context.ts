import { createContext, useContext } from 'react'
import type { Board } from './model'
import type { Actions } from './state'
import type { AvisosStatus } from './sync'

export type View = 'board' | 'calendar'

export interface UI {
  /** Estado de los avisos en el iPhone (null hasta saberlo). */
  avisos: AvisosStatus | null
  view: View
  setView: (view: View) => void
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
