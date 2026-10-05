// Lo que la app le pide al servidor local para los proyectos: abrir su carpeta, Claude Code, archivar
// las completadas y leer el archivo. Los errores vuelven como texto para enseñarlo en un aviso.
import type { ArchivedTask } from './search'

export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: string | null; message: string }

const MESSAGES: Record<string, string> = {
  'sin-carpeta': 'Falta la carpeta del proyecto: ponla en su ficha',
  'columna-no-existe': 'Esa columna ya no existe',
  'tarea-no-existe': 'Esa tarea ya no existe',
}

async function call<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, { cache: 'no-store', ...init })
    const data = (await res.json().catch(() => null)) as (T & { error?: string; mensaje?: string }) | null
    if (res.ok && data) return { ok: true, data }
    // Con código: {error: '<código>', mensaje}; sin código: {error: '<texto>'}.
    const code = data?.mensaje ? (data.error ?? null) : null
    const message = (code && MESSAGES[code]) || data?.mensaje || data?.error || `El servidor ha respondido ${res.status}`
    return { ok: false, code, message }
  } catch {
    return { ok: false, code: null, message: init.signal?.aborted ? 'Cancelado' : 'Sin conexión con el servidor local' }
  }
}

const post = <T>(path: string, body: unknown) =>
  call<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

/** Abre la carpeta del proyecto de la columna en el Finder. */
export const openFolder = (columnId: string) => post<{ ok: true }>('/api/abrir', { columnId })

/** Sesión nueva de Claude Code en la carpeta del proyecto (con la tarea escrita, si es de una tarea). */
export const openClaude = (target: { taskId: string } | { columnId: string }) => post<{ ok: true }>('/api/claude', target)

/** Pasa las completadas de la columna al archivo. */
export const archiveDone = (columnId: string) => post<{ rev: number; archivadas: number }>('/api/archivar', { columnId })

/** Las archivadas de una columna. */
export const archivedOf = (columnId: string, signal?: AbortSignal) =>
  call<{ tareas?: ArchivedTask[] }>(`/api/archivo?columna=${encodeURIComponent(columnId)}`, { signal })
