// npm run instalar: prepara el paquete y lo instala (o actualiza) en este Mac.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT ?? 4747)
const DATOS = path.join(os.homedir(), 'Library', 'Application Support', 'Tablero', 'datos')
const DATOS_DEV = path.join(ROOT, 'data')

execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'empaquetar.mjs')], { stdio: 'inherit' })

// La primera vez, se lleva las tareas que hubiera en la carpeta del proyecto.
// Antes para el servidor arrancado con «npm run abrir», para que no se pierda nada a medio copiar.
if (!existsSync(path.join(DATOS, 'board.json')) && existsSync(path.join(DATOS_DEV, 'board.json'))) {
  await stopManualServer()
  mkdirSync(DATOS, { recursive: true })
  cpSync(path.join(DATOS_DEV, 'board.json'), path.join(DATOS, 'board.json'))
  if (existsSync(path.join(DATOS_DEV, 'copias'))) {
    cpSync(path.join(DATOS_DEV, 'copias'), path.join(DATOS, 'copias'), { recursive: true })
  }
  console.log(`Tareas copiadas a ${DATOS}`)
}

execFileSync(path.join(ROOT, 'build', 'Tablero', 'Instalar Tablero.command'), { stdio: 'inherit' })

async function stopManualServer() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(1000) })
    if ((await res.json()).app !== 'tablero') return
  } catch {
    return
  }
  const pids = execFileSync('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' })
  for (const pid of pids.split('\n').filter(Boolean)) process.kill(Number(pid))
  await new Promise((resolve) => setTimeout(resolve, 500))
}
