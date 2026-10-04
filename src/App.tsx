import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { BoardView } from './components/Board'
import { CalendarView } from './components/Calendar'
import { TaskSheet } from './components/TaskSheet'
import { TopBar } from './components/TopBar'
import { ActionsContext, BoardContext, NowContext, UIContext, type UI, type View } from './context'
import { todayISO } from './dates'
import { nextColor, starterBoard } from './model'
import { createActions, initialState, reducer } from './state'
import { Sync, type AvisosStatus, type SyncStatus } from './sync'
import { isTyping, useStoredState } from './util'

interface Toast {
  id: number
  message: string
  /** Paso de deshacer al que corresponde el botón «Deshacer». */
  undoSeq: number | null
}

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
  const actions = useMemo(() => createActions(dispatch), [])
  const now = useClock()
  const [status, setStatus] = useState<SyncStatus>('loading')
  const [view, setView] = useStoredState<View>('tablero.vista', 'board')
  const [toast, setToast] = useState<Toast | null>(null)
  const [avisos, setAvisos] = useState<AvisosStatus | null>(null)
  const [updateReady, setUpdateReady] = useState(false)
  const [renamingColumnId, setRenaming] = useState<string | null>(null)
  const [openTask, setOpenTask] = useState<{ id: string; anchor: DOMRect } | null>(null)

  const boardRef = useRef(state.board)
  boardRef.current = state.board
  const seqRef = useRef(state.seq)
  seqRef.current = state.seq
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

  // El «Deshacer» de un aviso solo vale mientras no se haya hecho nada más.
  useEffect(() => {
    if (toast?.undoSeq != null && state.seq !== toast.undoSeq) setToast(null)
  }, [state.seq, toast])

  // ── Interfaz ──
  const focusQuickAdd = useCallback((columnId?: string) => {
    const columns = boardRef.current?.columns ?? []
    const last = columns.some((c) => c.id === lastColumn.current) ? lastColumn.current : null
    const id = columnId ?? last ?? columns[0]?.id
    const input = id ? quickAdds.current.get(id) : undefined
    if (!input) return
    input.focus({ preventScroll: true })
    input.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
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
    setOpenTask({ id: taskId, anchor: anchor.getBoundingClientRect() })
  }, [])
  const closeTask = useCallback(() => setOpenTask(null), [])

  const ui = useMemo<UI>(
    () => ({
      avisos,
      view,
      setView,
      renamingColumnId,
      setRenaming,
      openTaskId: openTask?.id ?? null,
      openTask: showTask,
      focusQuickAdd,
      registerQuickAdd,
      setLastColumn,
      newColumn,
      toast: showToast,
    }),
    [avisos, view, setView, renamingColumnId, openTask?.id, showTask, focusQuickAdd, registerQuickAdd, setLastColumn, newColumn, showToast],
  )

  // ── Atajos globales ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      const typing = isTyping(e.target)
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'z') {
        if (typing) return // en un campo de texto, ⌘Z deshace el texto
        e.preventDefault()
        if (e.shiftKey) actions.redo()
        else actions.undo()
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.popover')) return
      if (e.key === 't' || e.key === 'c') {
        e.preventDefault()
        setView(e.key === 't' ? 'board' : 'calendar')
      } else if (e.key === 'N') {
        e.preventDefault()
        newColumn()
      } else if (view !== 'board') {
        // El calendario tiene sus propios atajos.
      } else if (e.key === 'n') {
        e.preventDefault()
        focusQuickAdd()
      } else if (/^[1-9]$/.test(e.key)) {
        const column = boardRef.current?.columns[Number(e.key) - 1]
        if (!column) return
        e.preventDefault()
        focusQuickAdd(column.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [actions, focusQuickAdd, newColumn, view, setView])

  if (!state.board) return <Splash status={status} onRetry={() => void sync.current?.start()} />

  return (
    <ActionsContext.Provider value={actions}>
      <BoardContext.Provider value={state.board}>
        <UIContext.Provider value={ui}>
          <NowContext.Provider value={now}>
            <TopBar />
            {view === 'board' ? <BoardView /> : <CalendarView />}
            {openTask && <TaskSheet key={openTask.id} taskId={openTask.id} anchor={openTask.anchor} onClose={closeTask} />}
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
