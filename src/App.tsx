import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { collapsed } from './collapsed'
import { createTaskCommands } from './commands'
import { BoardView } from './components/Board'
import { CalendarView } from './components/Calendar'
import { AdsView } from './components/Ads'
import { GoogleAdsView } from './components/Google'
import { SummariesView } from './components/Summaries'
import { Palette, type CommandId } from './components/Palette'
import { SelectionBar } from './components/SelectionBar'
import { Sidebar } from './components/Sidebar'
import { SubscriptionsView } from './components/Subscriptions'
import { TaskSheet } from './components/TaskSheet'
import { TODAY_ADD, TodayView } from './components/Today'
import { TopBar } from './components/TopBar'
import { ActionsContext, BoardContext, NowContext, UIContext, type SubscriptionRequest, type UI, type View } from './context'
import { formatDay, formatWhen, todayISO } from './dates'
import { useAppBadge, useLaunch } from './dock'
import { focusTask, revealQuickAdd, useSelectionClicks, useShortcuts, whenTaskShown } from './keys'
import { findTask, nextColor, starterBoard } from './model'
import { needsInbox } from './projects'
import type { ArchivedTask } from './search'
import { selection, setRevealed } from './selection'
import { createActions, initialState, reducer } from './state'
import { setTheme } from './theme'
import { Sync, type AvisosStatus, type SyncStatus } from './sync'
import { activeColumns } from './today'
import { useStoredState } from './util'

interface Toast {
  id: number
  message: string
  /** Paso de deshacer al que corresponde el botón «Deshacer». */
  undoSeq: number | null
}

/** Lo que hay que enseñar en el tablero cuando esté en pantalla (búsqueda, enlace, 1–9 desde otra vista). */
type Pending = { task: string; open: boolean } | { column: string; add: boolean }

/** Ancla para el detalle de una tarea que no está a la vista: centrado arriba. */
const centerAnchor = () => new DOMRect(Math.max(12, window.innerWidth / 2 - 178), 96, 0, 0)

/** «Archivada el 3 oct en Trabajo». */
const archivedMessage = (task: ArchivedTask) =>
  `Archivada${task.archivedAt ? ` ${formatWhen(task.archivedAt)}` : ''} en ${task.columnName || 'su columna'}`

/** La hora actual, refrescada cada minuto (para «Hoy», vencidas…). */
function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      timer = setTimeout(() => {
        setNow(new Date())
        schedule()
      }, 60_000 - (Date.now() % 60_000) + 50)
    }
    schedule()
    const onFocus = () => setNow(new Date())
    window.addEventListener('focus', onFocus)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [])
  return now
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  // Las acciones leen el tablero en pantalla y avisan de la siguiente repetición (boardRef y showToast, más abajo).
  const actions = useMemo(
    () =>
      createActions(dispatch, {
        board: () => boardRef.current,
        repeated: (due) => showToast(`Siguiente: ${formatDay(due).toLowerCase()}`, { undo: true }),
      }),
    [],
  )
  const now = useClock()
  const [status, setStatus] = useState<SyncStatus>('loading')
  const [view, setView] = useStoredState<View>('tablero.vista', 'board')
  const [sidebarOpen, setSidebarOpen] = useStoredState('tablero.lateral', true)
  const [toast, setToast] = useState<Toast | null>(null)
  const [avisos, setAvisos] = useState<AvisosStatus | null>(null)
  const [updateReady, setUpdateReady] = useState(false)
  const [renamingColumnId, setRenaming] = useState<string | null>(null)
  const [openTask, setOpenTask] = useState<{ id: string; anchor: DOMRect } | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [avisosOpen, setAvisosOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [linkedTask, setLinkedTask] = useState<string | null>(null)
  const [subscriptionRequest, setSubscriptionRequest] = useState<SubscriptionRequest | null>(null)

  const boardRef = useRef(state.board)
  boardRef.current = state.board
  const seqRef = useRef(state.seq)
  seqRef.current = state.seq
  const paletteRef = useRef(paletteOpen)
  paletteRef.current = paletteOpen
  const sync = useRef<Sync | null>(null)
  const quickAdds = useRef(new Map<string, HTMLInputElement>())
  const lastColumn = useRef<string | null>(null)

  const showToast = useCallback((message: string, options: { undo?: boolean } = {}) => {
    // La acción que provoca el aviso se aplica en este mismo render: su paso de deshacer es el siguiente.
    setToast({ id: Date.now(), message, undoSeq: options.undo ? seqRef.current + 1 : null })
  }, [])

  // ── Datos: data/board.json a través del servidor local ──
  useEffect(() => {
    const s = new Sync({
      load: (board) => dispatch({ type: 'load', board }),
      status: setStatus,
      empty: () => starterBoard(todayISO()),
      avisos: setAvisos,
      update: () => setUpdateReady(true),
    })
    sync.current = s
    void s.start()
    const onFocus = () => void s.refresh()
    const onHide = () => s.flushOnExit()
    window.addEventListener('focus', onFocus)
    window.addEventListener('pagehide', onHide)
    return () => {
      s.stop()
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pagehide', onHide)
    }
  }, [showToast])

  useEffect(() => {
    if (state.board) sync.current?.update(state.board)
  }, [state.board])

  // Siempre hay una Bandeja (donde llega lo de Siri y la captura rápida): si falta, se crea la primera.
  useEffect(() => {
    if (state.board && needsInbox(state.board)) actions.ensureInbox()
  }, [state.board, actions])

  // El «Deshacer» de un aviso solo vale mientras no se haya hecho nada más.
  useEffect(() => {
    if (toast?.undoSeq != null && state.seq !== toast.undoSeq) setToast(null)
  }, [state.seq, toast])

  // ── Interfaz ──
  // El ancho del menú (--side-w) desplaza todas las vistas: va en <html>, que es lo que se desplaza.
  useEffect(() => {
    document.documentElement.classList.toggle('has-sidebar', sidebarOpen)
  }, [sidebarOpen])
  const toggleSidebar = useCallback(() => setSidebarOpen(!sidebarOpen), [sidebarOpen, setSidebarOpen])

  const focusQuickAdd = useCallback((columnId?: string) => {
    const columns = boardRef.current ? activeColumns(boardRef.current) : []
    const last = columns.some((c) => c.id === lastColumn.current) ? lastColumn.current : null
    const id = columnId ?? last ?? columns[0]?.id
    if (!id) return
    // Una columna contraída se expande; su campo aparece en el siguiente fotograma.
    collapsed.set(id, false)
    let frames = 0
    const focus = () => {
      const input = quickAdds.current.get(id)
      if (!input) {
        if (frames++ < 10) requestAnimationFrame(focus)
        return
      }
      input.focus({ preventScroll: true })
      revealQuickAdd(input)
    }
    focus()
  }, [])

  const registerQuickAdd = useCallback((columnId: string, input: HTMLInputElement | null) => {
    if (input) quickAdds.current.set(columnId, input)
    else quickAdds.current.delete(columnId)
  }, [])

  const setLastColumn = useCallback((columnId: string) => {
    lastColumn.current = columnId
  }, [])

  const newColumn = useCallback(() => {
    const board = boardRef.current
    if (!board) return
    setView('board')
    setRenaming(actions.addColumn('Nueva columna', nextColor(board)))
  }, [actions, setView])

  const showTask = useCallback((taskId: string, anchor: HTMLElement) => {
    // El foco pasa antes a la fila (con el ratón no lo tiene): al cerrar el detalle vuelve a ella y
    // las teclas siguen actuando sobre la tarea que se acaba de editar.
    const row = anchor.closest<HTMLElement>('[data-task-id]')
    if (row && row.tabIndex >= 0 && !row.contains(document.activeElement)) row.focus({ preventScroll: true })
    setOpenTask({ id: taskId, anchor: anchor.getBoundingClientRect() })
  }, [])
  const closeTask = useCallback(() => setOpenTask(null), [])
  const openSearch = useCallback(() => setPaletteOpen(true), [])
  const saveNow = useCallback(() => sync.current?.saveNow() ?? Promise.resolve(false), [])
  const refresh = useCallback(() => void sync.current?.refresh(), [])

  // ── Suscripciones: la vista abre la ficha pedida (o «Nueva suscripción») en cuanto está en pantalla ──
  const openSubscription = useCallback(
    (id: string) => {
      setOpenTask(null)
      setView('subscriptions')
      setSubscriptionRequest({ id })
    },
    [setView],
  )
  const newSubscription = useCallback(() => {
    setView('subscriptions')
    setSubscriptionRequest({ create: true })
  }, [setView])
  const openSubscriptionColumn = useCallback(
    (columnId: string) => {
      setView('subscriptions')
      setSubscriptionRequest({ column: columnId })
    },
    [setView],
  )
  const clearSubscriptionRequest = useCallback(() => setSubscriptionRequest(null), [])

  // ── Enseñar una tarea o una columna en el tablero (búsqueda, enlaces /t/<id>, 1–9) ──
  const revealTask = useCallback(
    (taskId: string, open = true) => {
      const board = boardRef.current
      const found = board ? findTask(board, taskId) : null
      if (!found) return false
      // Una completada solo se ve con las completadas de su columna a la vista.
      if (found.task.done && !found.column.showCompleted) actions.toggleCompleted(found.column.id)
      selection.clear()
      setRevealed(taskId)
      setOpenTask(null)
      setView('board')
      setPending({ task: taskId, open })
      return true
    },
    [actions, setView],
  )

  const goToColumn = useCallback(
    (columnId: string, add = false) => {
      setView('board')
      setPending({ column: columnId, add })
    },
    [setView],
  )

  useEffect(() => {
    if (!pending || view !== 'board' || !state.board) return
    if ('task' in pending) {
      return whenTaskShown(pending.task, (el) => {
        setPending(null)
        setRevealed(null)
        if (el) focusTask(el, { center: true })
        if (!pending.open) return
        if (el) showTask(pending.task, el)
        else setOpenTask({ id: pending.task, anchor: centerAnchor() }) // p. ej. en una columna archivada
      })
    }
    const raf = requestAnimationFrame(() => {
      setPending(null)
      const section = document.querySelector<HTMLElement>(`[data-column-id="${CSS.escape(pending.column)}"]`)
      section?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      const first = section?.querySelector<HTMLElement>('[data-task-id]')
      if (first && !pending.add) focusTask(first)
      else focusQuickAdd(pending.column)
    })
    return () => cancelAnimationFrame(raf)
  }, [pending, view, state.board, showTask, focusQuickAdd])

  const ui = useMemo<UI>(
    () => ({
      avisos,
      view,
      setView,
      sidebarOpen,
      toggleSidebar,
      renamingColumnId,
      setRenaming,
      openTaskId: openTask?.id ?? null,
      openTask: showTask,
      focusQuickAdd,
      registerQuickAdd,
      setLastColumn,
      newColumn,
      toast: showToast,
      shortcutsOpen,
      setShortcutsOpen,
      avisosOpen,
      setAvisosOpen,
      openSearch,
      revealTask,
      saveNow,
      refresh,
      openSubscription,
      newSubscription,
      openSubscriptionColumn,
      subscriptionRequest,
      clearSubscriptionRequest,
    }),
    [
      avisos,
      view,
      setView,
      sidebarOpen,
      toggleSidebar,
      renamingColumnId,
      openTask?.id,
      showTask,
      focusQuickAdd,
      registerQuickAdd,
      setLastColumn,
      newColumn,
      showToast,
      shortcutsOpen,
      avisosOpen,
      openSearch,
      revealTask,
      saveNow,
      refresh,
      openSubscription,
      newSubscription,
      openSubscriptionColumn,
      subscriptionRequest,
      clearSubscriptionRequest,
    ],
  )

  // ── Teclado y selección (src/keys.ts) ──
  const commands = useMemo(() => createTaskCommands({ actions, board: () => boardRef.current, toast: showToast }), [actions, showToast])

  useShortcuts({
    view,
    board: () => boardRef.current,
    actions,
    commands,
    blocked: () => paletteRef.current,
    setView,
    toggleSidebar,
    newTask: () => {
      // En el calendario, N la atiende el propio calendario (nueva tarea para hoy).
      if (view === 'today') focusQuickAdd(TODAY_ADD)
      else if (view === 'board') focusQuickAdd()
      else if (view === 'subscriptions') newSubscription()
    },
    newColumn,
    addInColumn: (columnId) => (view === 'board' ? focusQuickAdd(columnId) : goToColumn(columnId, true)),
    openSearch,
    openShortcuts: () => setShortcutsOpen(true),
    openTask: showTask,
  })
  useSelectionClicks()

  // La selección es de la vista abierta, y solo de tareas que existen.
  useEffect(() => selection.clear(), [view])
  useEffect(() => {
    const board = state.board
    if (board) selection.retain((id) => findTask(board, id) !== null)
  }, [state.board])

  // «Nueva tarea» (búsqueda, Dock) es N en la vista abierta; en Suscripciones y en los anuncios no hay tareas: va al tablero.
  // La vista se lee de viewRef: el Dock puede haberla cambiado en esa misma llamada (a «Hoy», la primera
  // vez del día), antes de que se pinte.
  const viewRef = useRef(view)
  viewRef.current = view
  const newTaskHere = () => {
    if (['subscriptions', 'ads', 'google', 'summaries'].includes(viewRef.current)) setView('board')
    setNewTaskPending(true)
  }

  const runCommand = (id: CommandId) => {
    if (id === 'new-task') newTaskHere()
    else if (id === 'new-column') newColumn()
    else if (id === 'new-subscription') newSubscription()
    else if (id === 'shortcuts') setShortcutsOpen(true)
    else if (id === 'avisos') setAvisosOpen(true)
    else if (id === 'theme-light') setTheme('light')
    else if (id === 'theme-dark') setTheme('dark')
    else if (id === 'theme-system') setTheme('system')
    else if (id === 'sidebar') toggleSidebar()
    else setView(id)
  }

  // ── Dock: número de pendientes, «Hoy» la primera vez de cada día y atajos del icono ──
  useAppBadge(state.board, todayISO(now))
  const [newTaskPending, setNewTaskPending] = useState(false)
  useLaunch((launch) => {
    if (launch.view) {
      viewRef.current = launch.view
      setView(launch.view)
    }
    if (launch.newTask && !launch.view) newTaskHere()
    else if (launch.newTask) setNewTaskPending(true)
    if (launch.task) setLinkedTask(launch.task)
  })
  // «Nueva tarea» del Dock = pulsar N en la vista abierta, cuando ya está en pantalla.
  useEffect(() => {
    if (!newTaskPending || !state.board) return
    setNewTaskPending(false)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }))
  }, [newTaskPending, state.board])

  // Enlace a una tarea (/t/<id>): en cuanto hay tablero, se enseña con su detalle abierto.
  useEffect(() => {
    if (!linkedTask || !state.board) return
    setLinkedTask(null)
    if (revealTask(linkedTask)) return
    // Ya no está en el tablero: quizá se archivó.
    void fetch('/api/archivo', { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<{ tareas?: ArchivedTask[] }>) : null))
      .then((data) => {
        const archived = data?.tareas?.find((t) => t?.id === linkedTask)
        showToast(archived ? archivedMessage(archived) : 'Esa tarea ya no existe')
      })
      .catch(() => showToast('Esa tarea ya no existe'))
  }, [linkedTask, state.board, revealTask, showToast])

  if (!state.board) return <Splash status={status} onRetry={() => void sync.current?.start()} />

  return (
    <ActionsContext.Provider value={actions}>
      <BoardContext.Provider value={state.board}>
        <UIContext.Provider value={ui}>
          <NowContext.Provider value={now}>
            <TopBar />
            {sidebarOpen && <Sidebar />}
            {view === 'today' ? (
              <TodayView />
            ) : view === 'board' ? (
              <BoardView />
            ) : view === 'calendar' ? (
              <CalendarView />
            ) : view === 'ads' ? (
              <AdsView />
            ) : view === 'google' ? (
              <GoogleAdsView />
            ) : view === 'summaries' ? (
              <SummariesView />
            ) : (
              <SubscriptionsView />
            )}
            {openTask && <TaskSheet key={openTask.id} taskId={openTask.id} anchor={openTask.anchor} onClose={closeTask} />}
            <SelectionBar commands={commands} />
            {paletteOpen && (
              <Palette
                onClose={() => setPaletteOpen(false)}
                onTask={(id) => revealTask(id)}
                onArchived={(task) => showToast(archivedMessage(task))}
                onColumn={(id) => goToColumn(id)}
                onCommand={runCommand}
              />
            )}
            {toast && (
              <ToastView
                key={toast.id}
                message={toast.message}
                canUndo={toast.undoSeq === state.seq}
                onUndo={() => {
                  actions.undo()
                  setToast(null)
                }}
                onDone={() => setToast(null)}
              />
            )}
            {updateReady && (
              <div className="toast is-update" role="status">
                <span>Hay una versión nueva de Tablero</span>
                <button type="button" onClick={() => location.reload()}>
                  Recargar
                </button>
              </div>
            )}
            {status === 'offline' && (
              <div className="status-pill" role="status">
                Sin conexión con el servidor local · reintentando…
              </div>
            )}
          </NowContext.Provider>
        </UIContext.Provider>
      </BoardContext.Provider>
    </ActionsContext.Provider>
  )
}

function ToastView({
  message,
  canUndo,
  onUndo,
  onDone,
}: {
  message: string
  canUndo: boolean
  onUndo: () => void
  onDone: () => void
}) {
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  useEffect(() => {
    const timer = setTimeout(() => doneRef.current(), 5000)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="toast" role="status" aria-live="polite">
      <span>{message}</span>
      {canUndo && (
        <button type="button" onClick={onUndo}>
          Deshacer
        </button>
      )}
    </div>
  )
}

function Splash({ status, onRetry }: { status: SyncStatus; onRetry: () => void }) {
  if (status === 'unreadable') {
    return (
      <div className="splash">
        <div>
          <h2>No se han podido leer tus datos</h2>
          <p>
            El archivo <code>data/board.json</code> parece dañado y no se ha modificado.
            <br />
            Hay copias diarias en <code>data/copias/</code>.
          </p>
          <button type="button" className="btn" onClick={onRetry}>
            Reintentar
          </button>
        </div>
      </div>
    )
  }
  if (status === 'offline') {
    return (
      <div className="splash">
        <div>
          <h2>Tablero no está en marcha</h2>
          <p>
            Arranca el servidor local con <code>npm run abrir</code>.
            <br />
            Reintentando…
          </p>
        </div>
      </div>
    )
  }
  return <div className="splash" aria-busy="true" />
}
