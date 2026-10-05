// Dónde y cómo se guardan los datos: el tablero (board.json) y el archivo de tareas
// completadas (archivo.json). Escrituras atómicas (archivo temporal + rename) y de una en una.
import { copyFile, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DATA_DIR = process.env.TABLERO_DATA_DIR
  ? path.resolve(process.env.TABLERO_DATA_DIR)
  : path.join(ROOT, 'data')
const BOARD_FILE = path.join(DATA_DIR, 'board.json')
const ARCHIVE_FILE = path.join(DATA_DIR, 'archivo.json')
const BACKUP_DIR = path.join(DATA_DIR, 'copias')
const KEEP_BACKUPS = 30

/** Error con su código HTTP. `code` (opcional) es un identificador estable para la app. */
export class HttpError extends Error {
  constructor(status, message, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** 'AAAA-MM-DD' en hora local. */
export const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** 'HH:MM' en hora local. */
export const localTime = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/** Lee un JSON; null si no existe. Si no se puede leer, error (y nunca se sobrescribe). */
async function readJsonFile(file) {
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
  try {
    return JSON.parse(raw)
  } catch {
    throw new HttpError(500, `${file} no es un JSON válido; no se ha modificado.`)
  }
}

async function writeAtomic(file, data) {
  await mkdir(DATA_DIR, { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
}

export async function readStore() {
  const data = await readJsonFile(BOARD_FILE)
  if (!data) return { rev: 0, board: null }
  return { rev: Number.isInteger(data.rev) ? data.rev : 0, board: data.board ?? null }
}

/** Antes del primer guardado de cada día, copia el estado anterior a copias/. */
async function dailyBackup() {
  const target = path.join(BACKUP_DIR, `board-${localDay()}.json`)
  try {
    await mkdir(BACKUP_DIR, { recursive: true })
    await copyFile(BOARD_FILE, target, 1 /* COPYFILE_EXCL: no pisa la copia del día */)
  } catch (err) {
    if (err.code === 'EEXIST' || err.code === 'ENOENT') return
    throw err
  }
  const old = (await readdir(BACKUP_DIR)).filter((f) => /^board-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
  for (const file of old.slice(0, -KEEP_BACKUPS)) await unlink(path.join(BACKUP_DIR, file))
}

export async function writeStore(rev, board) {
  await mkdir(DATA_DIR, { recursive: true })
  await dailyBackup()
  await writeAtomic(BOARD_FILE, { app: 'tablero', version: 1, rev, savedAt: new Date().toISOString(), board })
}

/** Tareas archivadas: {...tarea, columnId, columnName, archivedAt}. */
export async function readArchive() {
  const data = await readJsonFile(ARCHIVE_FILE)
  return Array.isArray(data?.tareas) ? data.tareas : []
}

export async function writeArchive(tareas) {
  await writeAtomic(ARCHIVE_FILE, { app: 'tablero', version: 1, savedAt: new Date().toISOString(), tareas })
}

// Las escrituras van de una en una.
let queue = Promise.resolve()
export function exclusive(fn) {
  const run = queue.then(fn)
  queue = run.catch(() => {})
  return run
}
