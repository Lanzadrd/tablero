import type { Task } from './model'

// Avisos de una tarea, en minutos:
//  · con hora: respecto a la hora de inicio (0 = a la hora, -15 = 15 min antes)
//  · sin hora: respecto a las 0:00 del día (540 = ese día a las 9:00, -900 = el día antes a las 9:00)
// La hora es la local del Mac de cada uno.

export const DEFAULT_TIMED_ALERTS = [0]
export const DEFAULT_DAY_ALERTS = [9 * 60]

export const TIMED_ALERT_OPTIONS = [0, -5, -10, -15, -30, -60, -120, -1440, -2880]
export const DAY_ALERT_OPTIONS = [9 * 60, -4 * 60, -15 * 60, -39 * 60, -159 * 60]

/** Los avisos de la tarea, o los de por defecto si no se han tocado. */
export const alertsOf = (task: Task) => task.alerts ?? (task.time ? DEFAULT_TIMED_ALERTS : DEFAULT_DAY_ALERTS)

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`)

/** «A la hora», «15 min antes», «1 día antes»… o «El mismo día, 9:00», «El día antes, 20:00»… */
export function alertLabel(offset: number, timed: boolean) {
  if (timed) {
    if (offset === 0) return 'A la hora'
    const m = Math.abs(offset)
    const amount =
      m % 10080 === 0
        ? plural(m / 10080, 'semana', 'semanas')
        : m % 1440 === 0
          ? plural(m / 1440, 'día', 'días')
          : m % 60 === 0
            ? plural(m / 60, 'hora', 'horas')
            : `${m} min`
    return `${amount} ${offset < 0 ? 'antes' : 'después'}`
  }
  const days = offset >= 0 ? 0 : Math.ceil(-offset / 1440)
  const minutes = offset + days * 1440
  const time = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
  const when =
    days === 0 ? 'El mismo día' : days === 1 ? 'El día antes' : days === 7 ? 'Una semana antes' : `${days} días antes`
  return `${when}, ${time}`
}
