import { todayISO } from './dates'
import type { Board, Card, ColorKey, NewSubscription, Project, Task } from './model'
import { insertTask, mapColumn, mapTask, moveColumn, moveTask, newColumn, newSubscription, newTask, removeTask } from './model'
import { duplicateTasks, mapTasks, moveTasksTo, removeTasks, scheduleTask, undateTask } from './batch'
import { columnSlot, deleteColumn, ensureInbox, setArchived, withProject } from './projects'
import { completeTask, upcomingDue } from './repeat'
import {
  cardNameError,
  changeCard,
  changeSubscription,
  insertCard,
  insertSubscription,
  removeCard,
  removeSubscription,
  setCancelled,
  type SubscriptionPatch,
} from './subscriptions'
import { rescheduleTasks, setFirstOn, withSomeday } from './today'

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
  | {
      type: 'apply'
      edit: Edit
      undoable: boolean
      coalesce?: string
      /** Si el paso agrupado acaba como empezó (crear y borrar), se quita del historial. */
      settle?: boolean
    }
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
      const before = state.past.at(-1)
      if (merge && action.settle && before && JSON.stringify(board) === JSON.stringify(before)) {
        return { board: before, past: state.past.slice(0, -1), future: [], coalesce: null, seq: state.seq + 1 }
      }
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

/** Lo que las acciones necesitan saber o avisar fuera del reducer. */
export interface ActionHooks {
  /** El tablero en pantalla (para saber, antes de completarla, si una tarea se repite). */
  board?: () => Board | null
  /** Se ha completado una tarea que se repite: la siguiente es el día `due`. */
  repeated?: (due: string) => void
}

/** Una tarea nueva en su columna (para añadir varias de golpe). */
export interface NewTask {
  columnId: string
  title: string
  extra?: Partial<Task>
}

/** Todas las modificaciones del tablero. Los ids se crean aquí, fuera del reducer. */
export function createActions(dispatch: (action: Action) => void, hooks: ActionHooks = {}) {
  const apply = (edit: Edit, options: { undoable?: boolean; coalesce?: string; settle?: boolean } = {}) =>
    dispatch({ type: 'apply', edit, undoable: options.undoable ?? true, coalesce: options.coalesce, settle: options.settle })

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
    /** Lleva la columna `id` al sitio de `toId` (con columnas archivadas, los índices en pantalla no valen). */
    moveColumnTo: (id: string, toId: string) => apply((b) => moveColumn(b, ...columnSlot(b, id, toId))),
    /** La Bandeja no se borra. */
    deleteColumn: (id: string) => apply((b) => deleteColumn(b, id)),
    /** Archivar o restaurar una columna (la Bandeja no se archiva). */
    setColumnArchived: (id: string, archived: boolean) => apply((b) => setArchived(b, id, archived)),
    /**
     * Ficha del proyecto. Las ediciones de una misma vez que se abre la ficha (`session`) son un solo
     * paso de deshacer; las de otra vez, otro.
     */
    setProject: (id: string, project: Project | undefined, session = '') =>
      apply((b) => withProject(b, id, project), { coalesce: `project:${id}:${session}` }),
    /** Crea la Bandeja si falta (no es un paso de deshacer: tiene que existir siempre). */
    ensureInbox() {
      const spareId = crypto.randomUUID()
      apply((b) => ensureInbox(b, spareId), { undoable: false })
    },
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
    /** Varias tareas, cada una en su columna, en un solo paso de deshacer. */
    addTaskList(items: NewTask[]) {
      const tasks = items.map((item) => ({ columnId: item.columnId, task: newTask(item.title, item.extra) }))
      apply((b) => tasks.reduce((board, { columnId, task }) => mapColumn(board, columnId, (c) => insertTask(c, task)), b))
      return tasks.map((t) => t.task.id)
    },
    /** Pone el título que llega más tarde (el de una página web) si nadie lo ha cambiado. No es un paso de deshacer. */
    replaceTitle: (id: string, from: string, title: string) =>
      apply((b) => mapTask(b, id, (t) => (t.title === from && title !== from ? { ...t, title } : t)), { undoable: false }),
    /** Completar una que se repite crea la siguiente en el mismo paso (src/repeat.ts). */
    setDone(id: string, done: boolean) {
      const completedAt = done ? new Date().toISOString() : null
      const doneOn = todayISO()
      const next = done ? upcomingDue(hooks.board?.() ?? null, id, doneOn) : null
      const spareId = crypto.randomUUID()
      apply((b) => completeTask(b, id, done, { completedAt, doneOn, spareId }))
      if (next) hooks.repeated?.(next)
    },
    /** «Lo primero» del día (por defecto hoy): solo una por día; `null` la quita. */
    setFirst: (id: string | null, day: string = todayISO()) => apply((b) => setFirstOn(b, id, day)),
    /** Varias tareas al día `due` en un solo paso de deshacer («Pasar todas a hoy»). */
    rescheduleMany: (ids: string[], due: string) => apply((b) => rescheduleTasks(b, ids, due)),
    /** «Algún día»: sin fecha, hora, avisos ni repetición, al pie de su columna. */
    setSomeday: (id: string, on: boolean) => apply((b) => mapTask(b, id, (t) => withSomeday(t, on))),
    deleteTask: (id: string) => apply((b) => removeTask(b, id)),
    moveTask: (id: string, columnId: string, openIndex?: number) =>
      apply((b) => moveTask(b, id, columnId, openIndex)),

    // ── Varias tareas a la vez (teclado, barra de selección): cada una es un solo paso de deshacer ──

    /** Cualquier cambio a varias tareas: `change` devuelve la tarea cambiada (o la misma). */
    updateTasks: (ids: string[], change: (task: Task) => Task) => apply((b) => mapTasks(b, ids, change)),
    /** Al día `due`, con su hora; dejan de ser «algún día» (y «Lo primero» si se van de hoy). */
    scheduleTasks: (ids: string[], due: string, today: string = todayISO()) =>
      apply((b) => mapTasks(b, ids, (t) => scheduleTask(t, due, today))),
    /** Sin fecha, hora, avisos ni repetición. */
    undateTasks: (ids: string[]) => apply((b) => mapTasks(b, ids, undateTask)),
    setSomedayMany: (ids: string[], on: boolean) => apply((b) => mapTasks(b, ids, (t) => withSomeday(t, on))),
    /** Como setDone, para varias: las que se repiten crean su siguiente en el mismo paso. */
    setDoneMany(ids: string[], done: boolean) {
      const completedAt = done ? new Date().toISOString() : null
      const doneOn = todayISO()
      const spareIds = ids.map(() => crypto.randomUUID())
      apply((b) => ids.reduce((board, id, i) => completeTask(board, id, done, { completedAt, doneOn, spareId: spareIds[i] }), b))
    },
    /** Al final de las pendientes de otra columna. */
    moveTasks: (ids: string[], columnId: string) => apply((b) => moveTasksTo(b, ids, columnId)),
    deleteTasks: (ids: string[]) => apply((b) => removeTasks(b, ids)),
    /** Una copia de cada una justo detrás; devuelve los ids de las copias. */
    duplicateTasks(ids: string[]) {
      const copyIds = ids.map(() => crypto.randomUUID())
      const createdAt = new Date().toISOString()
      apply((b) => duplicateTasks(b, ids, copyIds, createdAt))
      return copyIds
    },

    // ── Suscripciones y tarjetas (src/subscriptions.ts). El aviso antes del cobro lo crea el servidor ──

    /**
     * Una tarjeta nueva: solo nombre y color. Devuelve su id, o null si el nombre está vacío o lleva un
     * número de tarjeta (cardNameError dice qué enseñar). Con `subscriptionId` («Nueva tarjeta…» en la
     * ficha), se le pone a esa suscripción en el mismo paso de deshacer.
     */
    addCard(name: string, color: ColorKey, subscriptionId?: string) {
      if (cardNameError(name)) return null
      const card: Card = { id: crypto.randomUUID(), name: name.trim().slice(0, 60), color }
      apply((b) => {
        const added = insertCard(b, card)
        return subscriptionId ? changeSubscription(added, subscriptionId, { cardId: card.id }) : added
      })
      return card.id
    },
    /** Nombre o color. Un nombre vacío o con número de tarjeta no se guarda (la interfaz avisa). */
    updateCard: (id: string, patch: { name?: string; color?: ColorKey }, coalesce?: string) =>
      apply((b) => changeCard(b, id, patch), { coalesce }),
    /** Las suscripciones que la usaban se quedan sin tarjeta, en el mismo paso de deshacer. */
    deleteCard: (id: string) => apply((b) => removeCard(b, id)),
    /**
     * Una suscripción nueva (lo que falte: mensual, en euros, cobro hoy, sin tarjeta). Devuelve su id.
     * Con `coalesce`, crearla y seguir escribiendo su nombre con la misma clave es un solo paso de deshacer.
     */
    addSubscription(input: NewSubscription = {}, coalesce?: string) {
      const sub = newSubscription(input, todayISO())
      apply((b) => insertSubscription(b, sub), { coalesce })
      return sub.id
    },
    /**
     * Cambia campos (`undefined` en url, notes o remind los quita). Las ediciones de texto seguidas con el
     * mismo `coalesce` (p. ej. `sub:<id>:name`) son un solo paso de deshacer. Si cambia algo del aviso,
     * su tarea pendiente se quita en el mismo paso y el servidor crea otra.
     */
    updateSubscription: (id: string, patch: SubscriptionPatch, coalesce?: string) =>
      apply((b) => changeSubscription(b, id, patch), { coalesce }),
    /** Dar de baja hoy (`on`) o reactivar. */
    cancelSubscription(id: string, on: boolean) {
      const today = todayISO()
      apply((b) => setCancelled(b, id, on, today))
    },
    /**
     * Con `coalesce`, va en el mismo paso de deshacer que lo anterior con esa clave: una nueva que se
     * borra al quedarse sin nombre no deja rastro (ni un paso que, al deshacerlo, la devuelva a medias).
     */
    deleteSubscription: (id: string, coalesce?: string) =>
      apply((b) => removeSubscription(b, id), { coalesce, settle: coalesce !== undefined }),
  }
}

export type Actions = ReturnType<typeof createActions>
