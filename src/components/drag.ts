// Arrastre nativo de tareas a días (calendario y panel «Sin fecha»).
import { useRef, useState, type DragEvent } from 'react'

/** Tipo propio para arrastrar tareas entre días (no se confunde con texto). */
export const TASK_MIME = 'application/x-tablero-tarea'

export const startDrag = (taskId: string) => (e: DragEvent) => {
  e.dataTransfer.setData(TASK_MIME, taskId)
  e.dataTransfer.effectAllowed = 'move'
}

/** Un sitio (un día, el panel «Sin fecha») que acepta tareas soltadas encima. */
export function useDropTarget(onDropTask: (taskId: string) => void) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(TASK_MIME)
  return {
    over,
    handlers: {
      onDragEnter: (e: DragEvent) => {
        if (!accepts(e)) return
        depth.current += 1
        setOver(true)
      },
      onDragOver: (e: DragEvent) => {
        if (!accepts(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      },
      onDragLeave: (e: DragEvent) => {
        if (!accepts(e)) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setOver(false)
      },
      onDrop: (e: DragEvent) => {
        if (!accepts(e)) return
        e.preventDefault()
        depth.current = 0
        setOver(false)
        const id = e.dataTransfer.getData(TASK_MIME)
        if (id) onDropTask(id)
      },
    },
  }
}
