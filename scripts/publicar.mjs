// npm run publicar [-- --menor] [-- "Qué hay de nuevo"]
//
// Publica una versión nueva en GitHub. Los Tablero instalados (el tuyo y los que hayas
// compartido) la descargan y se actualizan solos en unas horas; este Mac, al momento.
// Deja también Tablero.zip en el Escritorio, para instalarlo en un Mac nuevo.
import { execFileSync } from 'node:child_process'
import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPO } from '../server/actualizador.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BUILD = path.join(ROOT, 'build')
const PRIVATE_KEY = path.join(os.homedir(), '.config', 'tablero', 'clave-privada.pem')
const PUBLIC_KEY = path.join(ROOT, 'server', 'clave-publica.pem')

const args = process.argv.slice(2)
const bump = args.includes('--mayor') ? 0 : args.includes('--menor') ? 1 : 2
const notes = args.filter((a) => !a.startsWith('--')).join(' ') || 'Mejoras y correcciones.'

const sh = (cmd, cmdArgs, options = {}) => execFileSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', ...options })
const quiet = (cmd, cmdArgs) => {
  try {
    return sh(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

// 1. Clave de firma: los Tablero instalados solo aceptan versiones firmadas con ella.
if (!existsSync(PRIVATE_KEY)) {
  if (existsSync(PUBLIC_KEY)) {
    console.error(`Falta la clave de firma (${PRIVATE_KEY}).`)
    console.error('Sin ella, los Tablero ya instalados no aceptarán la versión nueva: recupérala de tu copia de seguridad.')
    process.exit(1)
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  mkdirSync(path.dirname(PRIVATE_KEY), { recursive: true, mode: 0o700 })
  writeFileSync(PRIVATE_KEY, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  writeFileSync(PUBLIC_KEY, publicKey.export({ type: 'spki', format: 'pem' }))
  console.log(`Clave de firma creada en ${PRIVATE_KEY}. Guarda una copia: sin ella no podrás publicar actualizaciones.`)
}

// 2. Versión nueva.
const pkgFile = path.join(ROOT, 'package.json')
const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
const parts = pkg.version.split('.').map(Number)
parts[bump] += 1
for (let i = bump + 1; i < 3; i++) parts[i] = 0
const version = parts.join('.')
pkg.version = version
writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`)
console.log(`Publicando Tablero ${version}…`)

// 3. Paquete, zip firmado y manifiesto.
execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'empaquetar.mjs')], { stdio: 'inherit' })
const zip = path.join(BUILD, 'Tablero.zip')
rmSync(zip, { force: true })
sh('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', path.join(BUILD, 'Tablero'), zip])
const manifest = Buffer.from(
  `${JSON.stringify(
    {
      version,
      zip: `https://github.com/${REPO}/releases/download/v${version}/Tablero.zip`,
      sha256: createHash('sha256').update(readFileSync(zip)).digest('hex'),
      fecha: new Date().toISOString(),
      notas: notes,
    },
    null,
    2,
  )}\n`,
)
writeFileSync(path.join(BUILD, 'version.json'), manifest)
writeFileSync(path.join(BUILD, 'version.json.sig'), sign(null, manifest, createPrivateKey(readFileSync(PRIVATE_KEY))).toString('base64'))

// 4. Código a GitHub (la primera vez crea el repositorio público).
if (!existsSync(path.join(ROOT, '.git'))) sh('git', ['init', '-b', 'main'])
sh('git', ['add', '-A'])
const trailer = process.env.TABLERO_COMMIT_TRAILER ? ['--trailer', process.env.TABLERO_COMMIT_TRAILER] : []
sh('git', ['commit', '-q', '-m', `Tablero ${version}`, '-m', notes, ...trailer])
sh('git', ['tag', `v${version}`])
if (quiet('git', ['remote', 'get-url', 'origin'])) {
  sh('git', ['push', '-q', 'origin', 'HEAD', '--tags'], { stdio: 'inherit' })
} else {
  sh('gh', ['repo', 'create', REPO, '--public', '--source', ROOT, '--remote', 'origin', '--description', 'Tareas en columnas, calendario y avisos en el iPhone. Local, en tu Mac.'], { stdio: 'inherit' })
  sh('git', ['push', '-q', '-u', 'origin', 'HEAD', '--tags'], { stdio: 'inherit' })
}

// 5. La publicación: los Tablero instalados buscan aquí la última versión.
sh('gh', ['release', 'create', `v${version}`, zip, path.join(BUILD, 'version.json'), path.join(BUILD, 'version.json.sig'), '--repo', REPO, '--title', `Tablero ${version}`, '--notes', notes], { stdio: 'inherit' })

// 6. Este Mac, al día ya; y el zip en el Escritorio para instalaciones nuevas.
execFileSync(path.join(BUILD, 'Tablero', 'Instalar Tablero.command'), { stdio: 'inherit', env: { ...process.env, TABLERO_SIN_ABRIR: '1' } })
copyFileSync(zip, path.join(os.homedir(), 'Desktop', 'Tablero.zip'))
console.log(`\n✓ Tablero ${version} publicado: https://github.com/${REPO}/releases/tag/v${version}`)
console.log('  Los demás Mac se actualizarán solos en unas horas. Tablero.zip (para un Mac nuevo) está en el Escritorio.')
