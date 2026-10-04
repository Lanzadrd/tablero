// Prepara build/Tablero: una carpeta autocontenida (incluye Node) que se puede
// instalar en cualquier Mac con «Instalar Tablero.command».
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PAQUETE = path.join(ROOT, 'build', 'Tablero')
const APP = path.join(PAQUETE, 'app')

const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' })
const quiet = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'ignore' })

/**
 * «Tablero Avisos.app»: el ayudante que copia las tareas con hora a Recordatorios.
 * Se compila universal (Apple Silicon e Intel) y solo cuando cambia su código: cada
 * compilación nueva hace que macOS vuelva a pedir permiso para Recordatorios.
 */
function buildAvisos() {
  const sources = ['avisos/Avisos.swift', 'avisos/Info.plist', 'assets/icono-1024.png'].map((f) => path.join(ROOT, f))
  const hash = createHash('sha256')
  for (const file of sources) hash.update(readFileSync(file))
  const app = path.join(ROOT, 'build', 'cache', `avisos-${hash.digest('hex').slice(0, 12)}`, 'Tablero Avisos.app')
  if (existsSync(app)) return app

  console.log('Compilando Tablero Avisos…')
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'tablero-avisos-'))
  try {
    const binaries = ['arm64', 'x86_64'].map((arch) => {
      const out = path.join(tmp, arch)
      run('swiftc', ['-O', '-parse-as-library', '-swift-version', '5', '-target', `${arch}-apple-macos14.0`, '-o', out, sources[0]])
      return out
    })
    const contents = path.join(app, 'Contents')
    mkdirSync(path.join(contents, 'MacOS'), { recursive: true })
    mkdirSync(path.join(contents, 'Resources'), { recursive: true })
    run('lipo', ['-create', '-output', path.join(contents, 'MacOS', 'Tablero Avisos'), ...binaries])
    copyFileSync(sources[1], path.join(contents, 'Info.plist'))

    const iconset = path.join(tmp, 'AppIcon.iconset')
    mkdirSync(iconset)
    for (const size of [16, 32, 128, 256, 512]) {
      for (const [scale, suffix] of [[1, ''], [2, '@2x']]) {
        const px = String(size * scale)
        quiet('sips', ['-z', px, px, sources[2], '--out', path.join(iconset, `icon_${size}x${size}${suffix}.png`)])
      }
    }
    run('iconutil', ['-c', 'icns', iconset, '-o', path.join(contents, 'Resources', 'AppIcon.icns')])
    run('codesign', ['--force', '--sign', '-', '--identifier', 'com.tablero.avisos', app])
  } catch (err) {
    rmSync(path.dirname(app), { recursive: true, force: true })
    throw err
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  return app
}

run('npm', ['run', 'build'])

rmSync(PAQUETE, { recursive: true, force: true })
mkdirSync(path.join(APP, 'bin'), { recursive: true })

cpSync(path.join(ROOT, 'server'), path.join(APP, 'server'), { recursive: true })
const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
writeFileSync(path.join(APP, 'version.json'), `${JSON.stringify({ version }, null, 2)}\n`)
cpSync(path.join(ROOT, 'dist'), path.join(APP, 'dist'), { recursive: true })

// El mismo Node con el que se ejecuta este script (en APFS se clona sin ocupar espacio).
const node = path.join(APP, 'bin', 'node')
copyFileSync(process.execPath, node, constants.COPYFILE_FICLONE)
chmodSync(node, 0o755)

let avisos = false
try {
  execFileSync('ditto', [buildAvisos(), path.join(APP, 'Tablero Avisos.app')])
  avisos = true
} catch (err) {
  console.warn(`\n⚠︎  Sin avisos en el iPhone: no se pudo compilar el ayudante (${err.message.split('\n')[0]}).`)
  console.warn('   Hacen falta las Command Line Tools de Xcode: xcode-select --install\n')
}

for (const script of ['Instalar Tablero.command', 'Desinstalar Tablero.command']) {
  const target = path.join(PAQUETE, script)
  copyFileSync(path.join(ROOT, 'scripts', script), target)
  chmodSync(target, 0o755)
}

writeFileSync(
  path.join(PAQUETE, 'LEEME.txt'),
  `Tablero — tareas en columnas, calendario y avisos en el iPhone

PARA INSTALAR (o actualizar sin perder tus tareas)

  1. Haz doble clic en «Instalar Tablero.command».
     Si macOS dice que no puede verificarlo: abre Ajustes del Sistema ›
     Privacidad y seguridad, baja hasta el final y pulsa «Abrir igualmente».
     Vuelve a abrir el instalador y confirma.
  2. Se abre la Terminal (si pregunta si puede acceder a Descargas, pulsa
     «Permitir»), instala Tablero y luego lo abre en Chrome.
     Pulsa «Instalar» (arriba a la derecha) para tenerlo en el Dock.
  3. Si macOS pregunta si «Tablero Avisos» puede acceder a Recordatorios,
     pulsa «Permitir»: así las tareas con fecha te avisan en el iPhone.
     También puede avisarte de que se han añadido elementos que se ejecutan
     en segundo plano («node» y «Tablero Avisos»): es Tablero, déjalos activados.

REQUISITOS

  · macOS 14 (Sonoma) o posterior, con chip Apple (M1, M2…).
    Lo ves en  › Acerca de este Mac.
  · Google Chrome.

Tus tareas se quedan en tu Mac (~/Library/Application Support/Tablero/datos);
las que tienen fecha se copian a la lista «Tablero» de Recordatorios.
Para quitarlo: «Desinstalar Tablero.command» (tus tareas no se borran).
`,
)

console.log(`\nPaquete ${version} listo en ${path.relative(ROOT, PAQUETE)}/ (Node ${process.version}, ${process.arch}${avisos ? ', con avisos' : ''})`)
