import { mergeBoards } from './merge'
import { normalizeBoard, type Board } from './model'

export type SyncStatus = 'loading' | 'ready' | 'offline' | 'unreadable'

/** Estado del ayudante que copia las tareas con hora a Recordatorios. */
export interface AvisosStatus {
  conectado: boolean
  estado?: 'iniciando' | 'activo' | 'sin-permiso' | 'error'
  mensaje?: string
  cuenta?: string
  icloud?: boolean
  /** Listas de Recordatorios (una por columna). */
  listas?: number
  /** Tareas pendientes con aviso. */
  programados?: number
  ultimaSync?: string
}

interface Stored {
  rev: number
  board: unknown
}

interface Handlers {
  load: (board: Board) => void
  status: (status: SyncStatus) => void
  /** Tablero inicial cuando todavía no hay datos guardados. */
  empty: () => Board
  avisos: (status: AvisosStatus) => void
  /** Se ha instalado una versión nueva de la web. */
  update: () => void
}

const SAVE_DELAY = 300
const RETRY_DELAY = 3000
const JSON_HEADERS = { 'content-type': 'application/json' }

/**
 * Mantiene data/board.json al día a través del servidor local y escucha sus
 * cambios en vivo. Cada guardado lleva la revisión de la que parte; si alguien
 * guardó entre medias (otra ventana, el iPhone…), se fusionan ambos cambios.
 */
export class Sync {
  private rev = 0
  private saved: Board | null = null
  private latest: Board | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private saving = false
  private started = false
  private stopped = false
  private events: EventSource | null = null
  private version: string | null = null

  constructor(private readonly on: Handlers) {}

  async start() {
    clearTimeout(this.timer)
    this.on.status('loading')
    try {
      const res = await fetch('/api/board', { cache: 'no-store' })
      if (this.stopped) return
      if (res.status >= 500) return this.on.status('unreadable')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as Stored
      if (this.stopped) return
      if (data.board) {
        this.adopt(data)
      } else {
        this.rev = data.rev
        this.latest = this.on.empty()
        this.on.load(this.latest)
      }
      this.started = true
      this.on.status('ready')
      this.listen()
    } catch {
      if (this.stopped) return
      this.on.status('offline')
      this.timer = setTimeout(() => void this.start(), RETRY_DELAY)
    }
  }

  /** Llamar con cada versión nueva del tablero. */
  update(board: Board) {
    this.latest = board
    if (this.started && board !== this.saved) this.schedule(SAVE_DELAY)
  }

  /** Trae lo guardado desde fuera, si no hay cambios locales pendientes. */
  async refresh() {
    if (!this.started || this.saving || this.latest !== this.saved) return
    try {
      const res = await fetch('/api/board', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as Stored
      if (!this.stopped && !this.saving && this.latest === this.saved && data.board && data.rev !== this.rev) {
        this.adopt(data)
      }
    } catch {
      // Sin conexión: el siguiente guardado lo reintentará.
    }
  }

  /** Último intento de guardar al cerrar la ventana. */
  flushOnExit() {
    if (!this.latest || this.latest === this.saved) return
    fetch('/api/board', {
      method: 'PUT',
      keepalive: true,
      headers: JSON_HEADERS,
      body: JSON.stringify({ baseRev: this.rev, board: this.latest }),
    }).catch(() => {})
  }

  stop() {
    this.stopped = true
    clearTimeout(this.timer)
    this.events?.close()
  }

  private listen() {
    if (this.events || this.stopped) return
    const events = new EventSource('/api/eventos')
    this.events = events
    const data = (e: Event) => JSON.parse((e as MessageEvent<string>).data)
    events.addEventListener('hola', (e) => {
      const { rev, version } = data(e) as { rev: number; version: string }
      if (this.version && version !== this.version) this.on.update()
      this.version = version
      this.on.status('ready')
      if (rev !== this.rev) void this.refresh()
    })
    events.addEventListener('rev', (e) => {
      if ((data(e) as { rev: number }).rev !== this.rev) void this.refresh()
    })
    events.addEventListener('avisos', (e) => this.on.avisos(data(e) as AvisosStatus))
    fetch('/api/avisos', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((status: AvisosStatus | null) => status && this.on.avisos(status))
      .catch(() => {})
    // EventSource reintenta solo; mientras tanto, se avisa de que no hay conexión.
    events.onerror = () => {
      if (!this.stopped) this.on.status('offline')
    }
  }

  private schedule(ms: number) {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), ms)
  }

  private async flush() {
    const board = this.latest
    if (this.stopped || this.saving || !board || board === this.saved) return
    this.saving = true
    let failed = false
    try {
      const res = await fetch('/api/board', {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify({ baseRev: this.rev, board }),
      })
      if (res.status === 409) {
        this.mergeWith((await res.json()) as Stored)
      } else if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      } else {
        this.rev = ((await res.json()) as { rev: number }).rev
        this.saved = board
        this.on.status('ready')
      }
    } catch {
      failed = true
      this.on.status('offline')
    } finally {
      this.saving = false
    }
    if (this.latest !== this.saved) this.schedule(failed ? RETRY_DELAY : 0)
  }

  /** Alguien guardó antes: se combinan sus cambios con los locales y se vuelve a guardar. */
  private mergeWith(data: Stored) {
    const theirs = normalizeBoard(data.board)
    const merged = this.saved && this.latest ? mergeBoards(this.saved, this.latest, theirs) : theirs
    this.rev = data.rev
    this.saved = theirs
    this.latest = merged
    this.on.load(merged)
  }

  private adopt(data: Stored) {
    const board = normalizeBoard(data.board)
    this.rev = data.rev
    this.saved = board
    this.latest = board
    this.on.load(board)
  }
}
