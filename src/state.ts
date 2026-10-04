import type { Board, ColorKey, Task } from './model'
import { insertTask, mapColumn, mapTask, moveColumn, moveTask, newColumn, newTask, removeTask } from './model'

export interface State {
  board: Board | null
  past: Board[]
  future: Board[]
  /** Ediciones de texto seguidas en el mismo campo cuentan como un solo paso de deshacer. */
  coalesce: string | null
  /** Sube con cada paso de deshacer nuevo; sirve para caducar el «Deshacer» de los avisos. */
  seq: number
}

export const initialState: State = { board: null, past: [], future: [], coalesce: null, seq: 0 }

type Edit = (board: Board) => Board

export type Action =
  | { type: 'load'; board: Board }
  | { type: 'apply'; edit: Edit; undoable: boolean; coalesce?: string }
  | { type: 'undo' }
  | { type: 'redo' }

const HISTORY = 100

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'load':
      return { ...initialState, board: action.board, seq: state.seq + 1 }

    case 'apply': {
      if (!state.board) return state
      const board = action.edit(state.board)
      if (board === state.board) return state
      if (!action.undoable) return { ...state, board }
      const merge = action.coalesce !== undefined && action.coalesce === state.coalesce
      return {
        board,
        past: merge ? state.past : [...state.past, state.board].slice(-HISTORY),
        future: [],
        coalesce: action.coalesce ?? null,
        seq: merge ? state.seq : state.seq + 1,
      }
    }

    case 'undo': {
      const previous = state.past.at(-1)
      if (!previous || !state.board) return state
      return {
        board: previous,
        past: state.past.slice(0, -1),
        future: [state.board, ...state.future],
        coalesce: null,
        seq: state.seq + 1,
      }
    }

    case 'redo': {
      const [next, ...future] = state.future
      if (!next || !state.board) return state
      return { board: next, past: [...state.past, state.board], future, coalesce: null, seq: state.seq + 1 }
    }
  }
}

/** Todas las modificaciones del tablero. Los ids se crean aquí, fuera del reducer. */
export function createActions(dispatch: (action: Action) => void) {
  const apply = (edit: Edit, options: { undoable?: boolean; coalesce?: string } = {}) =>
    dispatch({ type: 'apply', edit, undoable: options.undoable ?? true, coalesce: options.coalesce })

  return {
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),

    addColumn(name: string, color: ColorKey) {
      const column = newColumn(name, color)
      apply((b) => ({ ...b, columns: [...b.columns, column] }))
      return column.id
    },
    renameColumn: (id: string, name: string) =>
      apply((b) => mapColumn(b, id, (c) => (c.name === name ? c : { ...c, name }))),
    setColumnColor: (id: string, color: ColorKey) =>
      apply((b) => mapColumn(b, id, (c) => (c.color === color ? c : { ...c, color }))),
    moveColumn: (from: number, to: number) => apply((b) => moveColumn(b, from, to)),
    deleteColumn: (id: string) =>
      apply((b) => (b.columns.some((c) => c.id === id) ? { ...b, columns: b.columns.filter((c) => c.id !== id) } : b)),
    toggleCompleted: (id: string) =>
      apply((b) => mapColumn(b, id, (c) => ({ ...c, showCompleted: !c.showCompleted })), { undoable: false }),
    clearCompleted: (id: string) =>
      apply((b) =>
        mapColumn(b, id, (c) => (c.tasks.some((t) => t.done) ? { ...c, tasks: c.tasks.filter((t) => !t.done) } : c)),
      ),

    addTasks(columnId: string, titles: string[], extra: Partial<Task> = {}) {
      const tasks = titles.map((title) => newTask(title, extra))
      apply((b) => mapColumn(b, columnId, (c) => tasks.reduce((col, task) => insertTask(col, task), c)))
      return tasks.map((t) => t.id)
    },
    updateTask: (id: string, patch: Partial<Task>, coalesce?: string) =>
      apply(
        (b) =>
          mapTask(b, id, (t) =>
            Object.entries(patch).every(([key, value]) => t[key as keyof Task] === value) ? t : { ...t, ...patch },
          ),
        { coalesce },
      ),
    setDone(id: string, done: boolean) {
      const completedAt = done ? new Date().toISOString() : null
      apply((b) => mapTask(b, id, (t) => (t.done === done ? t : { ...t, done, completedAt })))
    },
    deleteTask: (id: string) => apply((b) => removeTask(b, id)),
    moveTask: (id: string, columnId: string, openIndex?: number) =>
      apply((b) => moveTask(b, id, columnId, openIndex)),
  }
}

export type Actions = ReturnType<typeof createActions>
