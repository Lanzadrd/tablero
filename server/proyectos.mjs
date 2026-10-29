// Carpetas de proyecto: abrirlas en el Finder o empezar en ellas una sesión de Claude Code.
// La carpeta sale siempre del tablero guardado, nunca de la petición.
import { execFile } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { HttpError } from './almacen.mjs'

const run = promisify(execFile)
const MAX_PROMPT = 4000
// Son carpetas, pero «open» las ejecutaría o instalaría en vez de mostrarlas.
const BUNDLE = /\.(app|appex|prefpane|saver|workflow|action|pkg|mpkg|kext|xpc|qlgenerator|mdimporter)\/?$/i

/** Ruta absoluta y comprobada de la carpeta del proyecto de la columna. */
export async function projectFolder(column) {
  const raw = typeof column?.project?.folder === 'string' ? column.project.folder.trim() : ''
  if (!raw) throw new HttpError(400, 'Esta columna no tiene carpeta de proyecto', 'sin-carpeta')
  const home = os.homedir()
  const expanded = raw === '~' ? home : raw.startsWith('~/') ? path.join(home, raw.slice(2)) : raw
  if (!path.isAbsolute(expanded)) {
    throw new HttpError(400, `La carpeta debe ser una ruta completa: ${raw}`, 'carpeta-no-valida')
  }
  const folder = path.resolve(expanded)
  let real
  try {
    real = await realpath(folder)
  } catch {
    throw new HttpError(404, `No existe la carpeta ${folder}`, 'carpeta-no-existe')
  }
  if (!(await stat(real)).isDirectory()) throw new HttpError(400, `No es una carpeta: ${folder}`, 'no-es-carpeta')
  if (BUNDLE.test(folder) || BUNDLE.test(real)) {
    throw new HttpError(400, `Es una aplicación o paquete, no una carpeta: ${folder}`, 'no-es-carpeta')
  }
  return folder
}

/** El texto con el que empieza la sesión de Claude Code para una tarea. */
export function taskPrompt(task, column) {
  const parts = [task?.title, task?.notes].map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean)
  parts.push(`Proyecto: ${column.name}`)
  return parts.join('\n\n')
}

/** Enlace que abre Claude Code (app de escritorio) en una sesión nueva en esa carpeta. */
export function claudeUrl(folder, prompt = '') {
  // Por caracteres (no parte un emoji) y sin sustitutos sueltos, que encodeURIComponent rechaza.
  const text = Array.from(prompt.toWellFormed()).slice(0, MAX_PROMPT).join('')
  const url = `claude://code/new?folder=${encodeURIComponent(folder)}`
  return text ? `${url}&q=${encodeURIComponent(text)}` : url
}

/**
 * Abre una ruta o un enlace con «open» de macOS (sin shell). Con TABLERO_SIMULAR_ABRIR=1
 * solo lo anota en el registro: para probar sin abrir ventanas.
 */
export async function openOnMac(target) {
  if (process.env.TABLERO_SIMULAR_ABRIR) {
    console.log(`[simulado] open ${target}`)
    return { simulado: true }
  }
  try {
    await run('open', [target], { timeout: 10_000 })
  } catch (err) {
    const detail = String(err.stderr || err.message).trim().split('\n')[0]
    throw new HttpError(500, `No se pudo abrir: ${detail}`, 'no-se-pudo-abrir')
  }
  return {}
}
