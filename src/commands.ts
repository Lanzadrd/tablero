// Lo que se puede hacer con una o varias tareas a la vez, igual desde el teclado que desde la
// barra de selección: cada orden es un solo paso de deshacer y avisa con «Deshacer».
import { scheduleTask, undateTask } from './batch'
import { addDays, formatDay, nextMonday, todayISO } from './dates'
import { findTask, type Board, type Column, type Task } from './model'
import type { Actions } from './state'
import { isSomeday } from './today'

export type When = 'today' | 'tomorrow' | 'nextWeek'

interface Deps {
  actions: Actions
  board: () => Board | null
  toast: (message: string, options?: { undo?: boolean }) => void
}

/** «hoy», «mañana», «el lunes», «el 12 oct». */
function dayLabel(due: string, now: Date) {
  const day = formatDay(due, now)
  return day === 'Hoy' || day === 'Mañana' ? day.toLowerCase() : `el ${day.toLowerCase()}`
}

export const dueFor = (when: When, now = new Date()) => {
  const today = todayISO(now)
  return when === 'today' ? today : when === 'tomorrow' ? addDays(today, 1) : nextMonday(now)
}

export function createTaskCommands({ actions, board, toast }: Deps) {
  const found = (ids: string[]): Array<{ task: Task; column: Column }> => {
    const b = board()
    if (!b) return []
    return ids.flatMap((id) => findTask(b, id) ?? [])
  }
  const idsOf = (list: Array<{ task: Task }>) => list.map((f) => f.task.id)
  const say = (n: number, one: string, many: string) => toast(n === 1 ? one : many.replace('#', String(n)), { undo: true })

  return {
    /** H, M, L: hoy, mañana o el próximo lunes (con la hora que tuvieran). */
    schedule(ids: string[], when: When) {
      const now = new Date()
      const today = todayISO(now)
      const due = dueFor(when, now)
      const changing = found(ids).filter(({ task }) => scheduleTask(task, due, today) !== task)
      if (changing.length === 0) return
      actions.scheduleTasks(idsOf(changing), due, today)
      const label = dayLabel(due, now)
      say(changing.length, `Para ${label}`, `# tareas para ${label}`)
    },

    /** 0: sin fecha (ni hora, avisos o repetición). */
    undate(ids: string[]) {
      const changing = found(ids).filter(({ task }) => undateTask(task) !== task)
      if (changing.length === 0) return
      actions.undateTasks(idsOf(changing))
      say(changing.length, 'Sin fecha', '# tareas sin fecha')
    },

    /** A: a «algún día»; si ya lo eran todas, al revés. */
    someday(ids: string[]) {
      const list = found(ids).filter(({ task }) => !task.done)
      if (list.length === 0) return
      const on = !list.every(({ task }) => isSomeday(task))
      actions.setSomedayMany(idsOf(list), on)
      if (on) say(list.length, 'Para algún día', '# tareas para algún día')
      else say(list.length, 'Ya no es para algún día', '# tareas ya no son para algún día')
    },

    /** F: «Lo primero» de hoy (solo una; con varias, la primera). Otra vez la quita. */
    first(ids: string[]) {
      const target = found(ids).find(({ task }) => !task.done)
      if (!target) return
      const today = todayISO()
      if (target.task.firstOn === today) {
        actions.setFirst(null, today)
        say(1, 'Ya no es «Lo primero»', '')
      } else {
        actions.setFirst(target.task.id, today)
        say(1, 'Lo primero de hoy', '')
      }
    },

    /** X con varias: las completa; si ya lo estaban todas, las devuelve a pendientes. */
    complete(ids: string[]) {
      const list = found(ids)
      if (list.length === 0) return
      const reopen = list.every(({ task }) => task.done)
      const changing = list.filter(({ task }) => task.done === reopen)
      actions.setDoneMany(idsOf(changing), !reopen)
      if (reopen) say(changing.length, 'Marcada como pendiente', '# marcadas como pendientes')
      else say(changing.length, 'Completada', '# completadas')
    },

    /** ⌥1–9 y «Mover a…». */
    moveTo(ids: string[], columnId: string) {
      const column = board()?.columns.find((c) => c.id === columnId)
      const changing = found(ids).filter((f) => f.column.id !== columnId)
      if (!column || changing.length === 0) return
      actions.moveTasks(idsOf(changing), columnId)
      say(changing.length, `Movida a ${column.name}`, `# movidas a ${column.name}`)
    },

    /** ⌘D. Devuelve los ids de las copias (en el mismo orden). */
    duplicate(ids: string[]) {
      const list = idsOf(found(ids))
      if (list.length === 0) return []
      const copies = actions.duplicateTasks(list)
      say(list.length, 'Duplicada', '# duplicadas')
      return copies
    },

    /** ⌫ */
    remove(ids: string[]) {
      const list = idsOf(found(ids))
      if (list.length === 0) return
      actions.deleteTasks(list)
      say(list.length, 'Tarea eliminada', '# tareas eliminadas')
    },
  }
}

export type TaskCommands = ReturnType<typeof createTaskCommands>
