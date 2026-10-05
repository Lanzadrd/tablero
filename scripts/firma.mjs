// npm run firma
//
// Crea (una sola vez) la identidad de firma de código «Tablero (firma propia)» y la deja en
// el llavero. Con ella el ayudante «Tablero Avisos» se firma siempre con el mismo
// certificado y macOS recuerda el permiso de Recordatorios entre versiones: firmado ad hoc,
// cada compilación es «otra app» y lo vuelve a pedir.
//
// - Certificado autofirmado: RSA 2048, 10 años, solo firma de código. No hace falta marcarlo
//   como de confianza: codesign firma igual y el requisito designado queda ligado al
//   certificado (identifier "com.tablero.avisos" and certificate leaf = H"…"), no al código.
// - La clave privada solo la puede usar /usr/bin/codesign (sin preguntar) y no se puede
//   exportar del llavero. Copia de seguridad en ~/.config/tablero/firma-codigo.p12, con su
//   contraseña aleatoria en firma-codigo.clave (los dos con permisos 600). Si falta la
//   identidad en el llavero pero está la copia, se restaura desde ella: así se conserva el
//   mismo certificado (y los permisos ya concedidos) en un Mac nuevo.
//
// Variables (para probar sin tocar el llavero real):
//   TABLERO_LLAVERO     ruta del llavero (por defecto, el de inicio de sesión). codesign solo
//                       encuentra identidades de llaveros que están en la lista de búsqueda
//                       (security list-keychains), aunque se le pase --keychain.
//   TABLERO_CONFIG_DIR  carpeta de la copia de seguridad (por defecto ~/.config/tablero).
import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const NOMBRE_FIRMA = 'Tablero (firma propia)'

const CONFIG = process.env.TABLERO_CONFIG_DIR ? path.resolve(process.env.TABLERO_CONFIG_DIR) : path.join(os.homedir(), '.config', 'tablero')
const COPIA = path.join(CONFIG, 'firma-codigo.p12')
const CLAVE_COPIA = path.join(CONFIG, 'firma-codigo.clave')
// La de macOS (LibreSSL) exporta .p12 que `security import` entiende; la de Homebrew (OpenSSL 3) no sin -legacy.
const OPENSSL = existsSync('/usr/bin/openssl') ? '/usr/bin/openssl' : 'openssl'

/** Llavero elegido con TABLERO_LLAVERO, o null para la lista de búsqueda normal. */
export function llaveroDeFirma() {
  return process.env.TABLERO_LLAVERO ? path.resolve(process.env.TABLERO_LLAVERO) : null
}

/**
 * Busca la identidad «Tablero (firma propia)» (certificado + clave privada) para firmar código.
 * Devuelve { sha1, llavero } o null. Vale aunque el certificado no sea «de confianza».
 */
export function buscarIdentidad(llavero = llaveroDeFirma()) {
  let salida
  try {
    salida = execFileSync('security', ['find-identity', '-p', 'codesigning', ...(llavero ? [llavero] : [])], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null
  }
  for (const linea of salida.split('\n')) {
    const m = linea.match(/^\s*\d+\)\s+([0-9A-F]{40})\s+"(.*)"(.*)$/)
    if (m && m[2] === NOMBRE_FIRMA && !/EXPIRED|REVOKED/.test(m[3])) return { sha1: m[1], llavero }
  }
  return null
}

const ejecutar = (cmd, args, opciones = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opciones })

function llaveroDestino() {
  const elegido = llaveroDeFirma()
  if (elegido) return elegido
  const login = path.join(os.homedir(), 'Library', 'Keychains', 'login.keychain-db')
  if (existsSync(login)) return login
  return ejecutar('security', ['default-keychain', '-d', 'user']).trim().replace(/^"|"$/g, '')
}

/**
 * La copia (.p12 y su contraseña) vale tanto como la clave privada: con los dos archivos se firma
 * como el ayudante. Si ~/.config está en un repositorio de dotfiles, un .gitignore «*» evita
 * subirla sin querer (tampoco debe ir en carpetas sincronizadas: lo dice el README).
 */
function protegerCarpeta() {
  const ignorar = path.join(CONFIG, '.gitignore')
  if (!existsSync(ignorar)) writeFileSync(ignorar, '# Claves de Tablero: nunca a un repositorio.\n*\n', { mode: 0o600 })
}

/** Genera el certificado y su clave, y los empaqueta en un .p12 con contraseña aleatoria. */
function crearCopia() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'tablero-firma-'))
  try {
    const cnf = path.join(tmp, 'certificado.cnf')
    writeFileSync(
      cnf,
      `[ req ]
distinguished_name = dn
x509_extensions = ext
prompt = no
[ dn ]
CN = ${NOMBRE_FIRMA}
[ ext ]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
`,
    )
    const clave = path.join(tmp, 'clave.pem')
    const certificado = path.join(tmp, 'certificado.pem')
    const p12 = path.join(tmp, 'firma.p12')
    // Número de serie aleatorio y positivo.
    const serie = `0x${(randomBytes(8)[0] & 0x7f).toString(16).padStart(2, '0')}${randomBytes(7).toString('hex')}`
    ejecutar(OPENSSL, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '3650', '-set_serial', serie,
      '-config', cnf, '-keyout', clave, '-out', certificado])
    const contrasena = randomBytes(24).toString('base64url')
    ejecutar(OPENSSL, ['pkcs12', '-export', '-name', NOMBRE_FIRMA, '-inkey', clave, '-in', certificado, '-out', p12,
      '-passout', 'env:TABLERO_P12_CLAVE'], { env: { ...process.env, TABLERO_P12_CLAVE: contrasena } })

    mkdirSync(CONFIG, { recursive: true, mode: 0o700 })
    protegerCarpeta()
    copyFileSync(p12, COPIA)
    chmodSync(COPIA, 0o600)
    writeFileSync(CLAVE_COPIA, `${contrasena}\n`, { mode: 0o600 })
    chmodSync(CLAVE_COPIA, 0o600)
    console.log(`Certificado nuevo «${NOMBRE_FIRMA}» (válido 10 años). Copia en ${COPIA}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function importarCopia(llavero) {
  const contrasena = readFileSync(CLAVE_COPIA, 'utf8').trim()
  try {
    // -T: solo codesign puede usar la clave sin preguntar. -x: la clave no se puede exportar del llavero.
    ejecutar('security', ['import', COPIA, '-k', llavero, '-f', 'pkcs12', '-x', '-P', contrasena, '-T', '/usr/bin/codesign'])
  } catch (err) {
    const detalle = `${err.stderr ?? ''}`.trim() || err.message
    console.error(`No se pudo importar la identidad en ${llavero}: ${detalle}`)
    if (/interaction|locked|bloquead/i.test(detalle)) console.error(`Desbloquea el llavero y vuelve a probar: security unlock-keychain "${llavero}"`)
    process.exit(1)
  }
}

/** Firma una copia de /usr/bin/true para comprobar que codesign ve la identidad y qué requisito sale. */
function comprobar(identidad) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'tablero-firma-'))
  try {
    const prueba = path.join(tmp, 'prueba')
    copyFileSync('/usr/bin/true', prueba)
    const llavero = llaveroDeFirma()
    try {
      ejecutar('codesign', ['--force', '--sign', identidad.sha1, '--timestamp=none', '--identifier', 'com.tablero.prueba',
        ...(llavero ? ['--keychain', llavero] : []), prueba])
    } catch (err) {
      console.error(`codesign no ha podido firmar con la identidad: ${`${err.stderr ?? ''}`.trim() || err.message}`)
      if (llavero) console.error('¿Está ese llavero en la lista de búsqueda? (security list-keychains -d user)')
      return false
    }
    // codesign escribe el requisito en la salida normal o en la de errores según la versión.
    const r = spawnSync('codesign', ['-d', '-r-', prueba], { encoding: 'utf8' })
    const requisito = `${r.stdout}\n${r.stderr}`.split('\n').find((l) => l.includes('designated')) ?? ''
    const porCertificado = requisito.toLowerCase().includes(`h"${identidad.sha1.toLowerCase()}"`)
    console.log(`Requisito designado de prueba: ${requisito.replace(/^#?\s*designated\s*=>\s*/, '')}`)
    if (!porCertificado) console.warn('⚠︎  El requisito no depende del certificado: macOS volvería a pedir permisos en cada versión.')
    return porCertificado
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function principal() {
  if (process.platform !== 'darwin') {
    console.error('La firma de código solo existe en macOS.')
    process.exit(1)
  }
  if (existsSync(CONFIG)) protegerCarpeta()
  const llavero = llaveroDestino()
  let identidad = buscarIdentidad(llavero)
  if (identidad) {
    console.log(`La identidad «${NOMBRE_FIRMA}» ya está en ${llavero} (SHA-1 ${identidad.sha1}).`)
    if (!existsSync(COPIA)) console.warn(`⚠︎  No hay copia de seguridad en ${COPIA}: si se pierde el llavero, macOS volverá a pedir los permisos una vez.`)
  } else {
    if (existsSync(COPIA) && existsSync(CLAVE_COPIA)) {
      console.log(`Restaurando «${NOMBRE_FIRMA}» desde la copia ${COPIA}…`)
    } else {
      crearCopia()
    }
    importarCopia(llavero)
    identidad = buscarIdentidad(llavero)
    if (!identidad) {
      console.error(`Se importó, pero «${NOMBRE_FIRMA}» no aparece como identidad de firma en ${llavero}.`)
      process.exit(1)
    }
    console.log(`Identidad lista en ${llavero} (SHA-1 ${identidad.sha1}).`)
  }

  console.log('Comprobando que codesign puede usarla (si macOS pregunta, pulsa «Permitir siempre»)…')
  if (!comprobar(identidad)) process.exit(1)
  console.log('✓ Listo. «npm run instalar» firmará el ayudante con esta identidad. La primera vez macOS')
  console.log('  pedirá otra vez el permiso de Recordatorios; desde entonces lo recordará entre versiones.')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) principal()
