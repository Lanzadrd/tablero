// Actualizaciones automáticas.
//
// Cada pocas horas mira si hay una versión nueva publicada en GitHub (npm run publicar).
// Solo la instala si viene firmada con la clave de quien publica Tablero
// (server/clave-publica.pem) y el zip coincide con lo firmado. Las tareas no se tocan.
import { execFile } from 'node:child_process'
import { createHash, createPublicKey, verify } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const REPO = 'Lanzadrd/tablero'
const ORIGIN = process.env.TABLERO_ACTUALIZACIONES ?? `https://github.com/${REPO}/releases/latest/download`
const FIRST_CHECK = 30_000
const EVERY = 6 * 60 * 60_000
const MAX_ATTEMPTS = 3
const LABEL = 'com.tablero.actualizar'

/** «1.10.0» > «1.9.3» */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff) return Math.sign(diff)
  }
  return 0
}

/** Versión instalada (la escribe empaquetar.mjs); null en desarrollo. */
export async function installedVersion(root) {
  try {
    return JSON.parse(await readFile(path.join(root, 'version.json'), 'utf8')).version ?? null
  } catch {
    return null
  }
}

/**
 * Busca e instala una versión nueva. Devuelve la versión instalada o null si no hay nada que hacer.
 * `install` recibe la ruta del instalador ya verificado (se puede sustituir en pruebas).
 */
export async function checkForUpdate({ root, dataDir, origin = ORIGIN, install = installDetached, log = console.log }) {
  const local = await installedVersion(root)
  const keyFile = path.join(root, 'server', 'clave-publica.pem')
  if (!local || !existsSync(keyFile)) return null

  const [manifestRes, signatureRes] = await Promise.all([
    fetch(`${origin}/version.json`, { signal: AbortSignal.timeout(30_000) }),
    fetch(`${origin}/version.json.sig`, { signal: AbortSignal.timeout(30_000) }),
  ])
  if (manifestRes.status === 404) return null // Aún no hay nada publicado.
  if (!manifestRes.ok || !signatureRes.ok) throw new Error(`no se pudo consultar (HTTP ${manifestRes.status})`)

  const raw = Buffer.from(await manifestRes.arrayBuffer())
  const signature = Buffer.from((await signatureRes.text()).trim(), 'base64')
  if (!verify(null, raw, createPublicKey(await readFile(keyFile)), signature)) {
    throw new Error('la versión publicada no lleva una firma válida; se ignora')
  }
  const manifest = JSON.parse(raw.toString('utf8'))
  if (compareVersions(manifest.version, local) <= 0) return null

  // Si una versión falla al instalarse, no se reintenta para siempre.
  const stateFile = path.join(dataDir, 'actualizacion.json')
  const state = await readFile(stateFile, 'utf8').then(JSON.parse).catch(() => ({}))
  const attempts = state.version === manifest.version ? (state.attempts ?? 0) : 0
  if (attempts >= MAX_ATTEMPTS) return null
  await writeFile(stateFile, JSON.stringify({ version: manifest.version, attempts: attempts + 1 }))

  log(`Actualizando de ${local} a ${manifest.version}…`)
  const res = await fetch(manifest.zip, { signal: AbortSignal.timeout(10 * 60_000) })
  if (!res.ok) throw new Error(`no se pudo descargar (HTTP ${res.status})`)
  const zip = Buffer.from(await res.arrayBuffer())
  if (createHash('sha256').update(zip).digest('hex') !== manifest.sha256) {
    throw new Error('el archivo descargado no coincide con el firmado; se descarta')
  }

  const work = path.join(dataDir, 'actualizacion')
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  await writeFile(path.join(work, 'Tablero.zip'), zip)
  await run('ditto', ['-x', '-k', path.join(work, 'Tablero.zip'), work])
  const installer = path.join(work, 'Tablero', 'Instalar Tablero.command')
  if (!existsSync(installer)) throw new Error('el paquete descargado está incompleto')

  await install(installer, { dataDir })
  return manifest.version
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * El instalador para y vuelve a arrancar este servidor, así que se lanza como un
 * trabajo de launchd independiente para que no muera con él.
 */
async function installDetached(installer, { dataDir }) {
  const plist = path.join(dataDir, `${LABEL}.plist`)
  const log = path.join(dataDir, 'actualizaciones.log')
  await writeFile(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${xml(installer)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TABLERO_SIN_ABRIR</key>
    <string>1</string>
    <key>TABLERO_PUERTO</key>
    <string>${xml(process.env.PORT ?? '4747')}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(log)}</string>
</dict>
</plist>
`,
  )
  const domain = `gui/${process.getuid()}`
  await run('launchctl', ['bootout', `${domain}/${LABEL}`]).catch(() => {})
  await run('launchctl', ['bootstrap', domain, plist])
}

/** Arranca las comprobaciones periódicas (solo en una instalación, no en desarrollo). */
export function startUpdates({ root, dataDir, log = console.log }) {
  if (process.env.TABLERO_SIN_ACTUALIZAR) return
  let busy = false
  const check = async () => {
    if (busy) return
    busy = true
    try {
      await checkForUpdate({ root, dataDir, log })
    } catch (err) {
      log(`Actualizaciones: ${err.message}`)
    } finally {
      busy = false
    }
  }
  setTimeout(check, FIRST_CHECK)
  setInterval(check, EVERY)
}
