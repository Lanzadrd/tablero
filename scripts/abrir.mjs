// Abre Tablero. Si está instalado (npm run instalar) usa ese servidor;
// si no, arranca uno desde la carpeta del proyecto con los datos de data/.
import { execFile, execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT ?? 4747)
const URL_APP = `http://127.0.0.1:${PORT}/`
const LABEL = 'com.tablero.servidor'
const INSTALADO = existsSync(path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`))
const APP_CHROME = path.join(os.homedir(), 'Applications', 'Chrome Apps.localized', 'Tablero.app')
const DATA_DIR = process.env.TABLERO_DATA_DIR ? path.resolve(process.env.TABLERO_DATA_DIR) : path.join(ROOT, 'data')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function isRunning() {
  try {
    const res = await fetch(`${URL_APP}api/health`, { signal: AbortSignal.timeout(1000) })
    return (await res.json()).app === 'tablero'
  } catch {
    return false
  }
}

async function waitUntilRunning() {
  for (let i = 0; i < 50; i++) {
    if (await isRunning()) return true
    await sleep(100)
  }
  return false
}

if (!(await isRunning())) {
  if (INSTALADO) {
    execFileSync('launchctl', ['kickstart', `gui/${os.userInfo().uid}/${LABEL}`])
  } else {
    if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) {
      console.log('Compilando Tablero…')
      execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
    }
    mkdirSync(DATA_DIR, { recursive: true })
    const log = openSync(path.join(DATA_DIR, 'servidor.log'), 'a')
    spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], {
      cwd: ROOT,
      detached: true,
      stdio: ['ignore', log, log],
    }).unref()
  }
  if (!(await waitUntilRunning())) {
    console.error('No se pudo arrancar el servidor de Tablero.')
    process.exit(1)
  }
}

if (existsSync(APP_CHROME)) {
  // La app instalada desde Chrome, con su propio icono en el Dock.
  execFile('open', [APP_CHROME])
} else {
  // -n hace que Chrome reciba --app aunque ya esté abierto.
  execFile('open', ['-na', 'Google Chrome', '--args', `--app=${URL_APP}`], (err) => {
    if (err) execFile('open', [URL_APP])
  })
}
console.log(`Tablero → ${URL_APP}`)
