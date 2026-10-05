import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import zlib from 'node:zlib'
import { decodeEntities, extractTitle, findGh, githubRef, isPublicAddress, pageTitle } from '../titulo.mjs'

test('direcciones: solo las públicas', () => {
  const casos = {
    '8.8.8.8': true,
    '1.1.1.1': true,
    '100.128.0.1': true,
    '172.32.0.1': true,
    '2606:4700:4700::1111': true,
    '::ffff:8.8.8.8': true,
    '64:ff9b::808:808': true,
    '0.0.0.0': false,
    '10.0.0.1': false,
    '100.64.0.1': false, // CGNAT
    '127.0.0.1': false,
    '127.255.255.254': false,
    '169.254.169.254': false, // metadatos de nubes
    '172.16.5.4': false,
    '192.168.1.1': false,
    '198.18.0.1': false,
    '224.0.0.251': false, // multicast
    '239.255.255.250': false,
    '255.255.255.255': false,
    '::': false,
    '::1': false,
    '[::1]': false,
    '::ffff:127.0.0.1': false, // IPv4 mapeada
    '::ffff:7f00:1': false,
    '::ffff:10.0.0.1': false,
    '::ffff:169.254.169.254': false,
    '::127.0.0.1': false,
    '64:ff9b::a00:1': false, // NAT64 de 10.0.0.1
    'fe80::1': false,
    'fe80::1%en0': false,
    'fc00::1': false,
    'fd00:1234::1': false,
    'ff02::1': false,
    '2001:db8::1': false,
    '2002:a00:1::1': false,
    'localhost': false,
    '': false,
  }
  for (const [ip, esperado] of Object.entries(casos)) assert.equal(isPublicAddress(ip), esperado, ip)
})

test('entidades HTML', () => {
  assert.equal(decodeEntities('A &amp; B &lt;i&gt; &quot;x&quot; &#39;y&#39; &#x1F600; &#8212;'), 'A & B <i> "x" \'y\' 😀 —')
  assert.equal(decodeEntities('Canci&oacute;n de Espa&ntilde;a &Aacute;&Uuml; &laquo;hola&raquo; &hellip;'), 'Canción de España ÁÜ «hola» …')
  assert.equal(decodeEntities('AT&T &amp &nada; &#0; &#xD800;'), 'AT&T &amp &nada; &#0; &#xD800;')
})

test('título: og:title, luego twitter:title, luego <title>', () => {
  const head = (s) => `<!doctype html><html><head>${s}</head><body></body></html>`
  assert.equal(
    extractTitle(head('<title>Normal</title><meta name="twitter:title" content="Tw"><meta property="og:title" content="Og &amp; más">')),
    'Og & más',
  )
  assert.equal(extractTitle(head(`<meta content='Al revés' property='og:title' />`)), 'Al revés')
  assert.equal(extractTitle(head('<title>Normal</title><meta name="twitter:title" content="Tw">')), 'Tw')
  assert.equal(extractTitle(head('<TITLE lang="es">\n  Mi   página\n</TITLE>')), 'Mi página')
  assert.equal(extractTitle(head('<meta property="og:title" content="  "><title>Respaldo</title>')), 'Respaldo')
  assert.equal(extractTitle(head('<!-- <title>Comentado</title> --><script>"<title>js</title>"</script><title>Bueno</title>')), 'Bueno')
  assert.equal(extractTitle(head('')), null)
  const largo = extractTitle(head(`<title>${'a'.repeat(500)}</title>`))
  assert.equal(Array.from(largo).length, 300)
  assert.ok(largo.endsWith('…'))
})

test('enlaces de GitHub', () => {
  const ref = (s) => githubRef(new URL(s))
  assert.deepEqual(ref('https://github.com/org/repo/pull/12'), { kind: 'pr', owner: 'org', repo: 'repo', number: 12 })
  assert.deepEqual(ref('https://github.com/org/repo/pull/12/files'), { kind: 'pr', owner: 'org', repo: 'repo', number: 12 })
  assert.deepEqual(ref('https://www.github.com/org/re.po/issues/7'), { kind: 'issue', owner: 'org', repo: 're.po', number: 7 })
  assert.deepEqual(ref('https://github.com/org/repo.git'), { kind: 'repo', owner: 'org', repo: 'repo' })
  assert.equal(ref('https://github.com/org'), null)
  assert.equal(ref('https://github.com/org/repo/tree/main'), null)
  assert.equal(ref('https://github.com/org/../x'), null)
  assert.equal(ref('https://gist.github.com/org/repo'), null)
  assert.equal(ref('https://example.com/org/repo/pull/1'), null)
})

// ── Contra un servidor local (las pruebas permiten 127.0.0.1; lo normal es rechazarlo) ──

let server
let port
let dir
let hits = 0
const memo = () => new Map()

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'tablero-titulo-'))
  server = http.createServer((req, res) => {
    hits++
    const html = (body, headers = {}) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...headers })
      res.end(body)
    }
    const redirect = (to) => {
      res.writeHead(302, { location: to })
      res.end()
    }
    const m = req.url.match(/^\/r(\d)$/)
    if (m) return redirect(Number(m[1]) > 1 ? `/r${Number(m[1]) - 1}` : '/pagina')
    switch (req.url) {
      case '/pagina':
        return html('<html><head><title>Página &amp; prueba</title></head></html>')
      case '/gzip':
        return html(zlib.gzipSync('<html><head><meta property="og:title" content="Comprimida"></head></html>'), { 'content-encoding': 'gzip' })
      case '/latin1':
        res.writeHead(200, { 'content-type': 'text/html; charset=iso-8859-1' })
        return res.end(Buffer.from('<title>Canción</title>', 'latin1'))
      case '/meta-charset':
        res.writeHead(200, { 'content-type': 'text/html' })
        // «Año “nuevo”» en windows-1252: ñ = F1, comillas = 93 y 94.
        return res.end(Buffer.from('<meta charset="windows-1252"><title>A\xf1o \x93nuevo\x94</title>', 'latin1'))
      case '/enorme': {
        // El título está pasado el primer MB: no se llega a leer.
        res.writeHead(200, { 'content-type': 'text/html' })
        res.write(`<html><body>${'x'.repeat(1024 * 1024 + 10)}`)
        return res.end('<title>Demasiado lejos</title></body></html>')
      }
      case '/pdf':
        res.writeHead(200, { 'content-type': 'application/pdf' })
        return res.end('%PDF-1.4')
      case '/lenta':
        return setTimeout(() => html('<title>Tarde</title>'), 2000).unref()
      case '/error':
        res.writeHead(500)
        return res.end()
      case '/a-privada':
        return redirect('http://interno.test/')
      case '/a-fichero':
        return redirect('file:///etc/passwd')
      default:
        res.writeHead(404)
        return res.end()
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = server.address().port
})

after(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(dir, { recursive: true, force: true })
})

/** DNS de mentira: pagina.test → 127.0.0.1, interno.test → 10.0.0.1, doble.test → pública y privada. */
function fakeLookup(hostname, options, callback) {
  const table = {
    'pagina.test': ['127.0.0.1'],
    'interno.test': ['10.0.0.1'],
    'doble.test': ['93.184.216.34', '192.168.1.10'],
    'metadatos.test': ['::ffff:169.254.169.254'],
  }
  const list = (table[hostname] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
  if (!list.length) return callback(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }))
  if (options.all) callback(null, list)
  else callback(null, list[0].address, list[0].family)
}
const local = { lookup: fakeLookup, allow: (ip) => ip === '127.0.0.1', gh: async () => null }
const at = (p) => `http://pagina.test:${port}${p}`

test('lee el título y decodifica', async () => {
  assert.equal(await pageTitle(at('/pagina'), { ...local, memo: memo() }), 'Página & prueba')
  assert.equal(await pageTitle(at('/gzip'), { ...local, memo: memo() }), 'Comprimida')
  assert.equal(await pageTitle(at('/latin1'), { ...local, memo: memo() }), 'Canción')
  assert.equal(await pageTitle(at('/meta-charset'), { ...local, memo: memo() }), 'Año “nuevo”')
})

test('sigue hasta 3 redirecciones, no más', async () => {
  assert.equal(await pageTitle(at('/r3'), { ...local, memo: memo() }), 'Página & prueba')
  await assert.rejects(pageTitle(at('/r4'), { ...local, memo: memo() }), { code: 'demasiadas-redirecciones' })
})

test('vuelve a comprobar el destino de cada redirección', async () => {
  await assert.rejects(pageTitle(at('/a-privada'), { ...local, memo: memo() }), { code: 'direccion-no-permitida' })
  await assert.rejects(pageTitle(at('/a-fichero'), { ...local, memo: memo() }), { code: 'url-no-valida' })
})

test('lee como mucho 1 MB y solo HTML', async () => {
  assert.equal(await pageTitle(at('/enorme'), { ...local, memo: memo() }), null)
  // Es el límite lo que lo impide: con más margen sí se encuentra.
  assert.equal(await pageTitle(at('/enorme'), { ...local, maxBytes: 2 * 1024 * 1024, memo: memo() }), 'Demasiado lejos')
  assert.equal(await pageTitle(at('/pdf'), { ...local, memo: memo() }), null)
  await assert.rejects(pageTitle(at('/error'), { ...local, memo: memo() }), { code: 'no-se-pudo-leer' })
})

test('se rinde a los 3 s (aquí, 300 ms)', async () => {
  const start = Date.now()
  await assert.rejects(pageTitle(at('/lenta'), { ...local, timeout: 300, memo: memo() }), { code: 'tiempo-agotado' })
  assert.ok(Date.now() - start < 1500)
})

test('guarda en caché los títulos', async () => {
  const cache = memo()
  const before = hits
  await pageTitle(at('/pagina'), { ...local, memo: cache })
  await pageTitle(`${at('/pagina')}#otra-parte`, { ...local, memo: cache })
  assert.equal(hits, before + 1)
})

test('SSRF: rechaza direcciones locales y privadas sin conectar', async () => {
  const before = hits
  const opts = { lookup: fakeLookup, gh: async () => null, memo: memo() } // allow por defecto
  for (const url of [
    `http://127.0.0.1:${port}/pagina`,
    `http://[::1]:${port}/pagina`,
    `http://[::ffff:127.0.0.1]:${port}/pagina`,
    `http://2130706433:${port}/pagina`, // 127.0.0.1 en decimal
    `http://0x7f.1:${port}/pagina`,
    `http://pagina.test:${port}/pagina`,
    'http://interno.test/',
    'http://doble.test/', // si alguna dirección es privada, no
    'http://metadatos.test/',
    'http://169.254.169.254/latest/meta-data/',
  ]) {
    await assert.rejects(pageTitle(url, opts), { code: 'direccion-no-permitida' }, url)
  }
  // Con el DNS de verdad: localhost resuelve a loopback.
  await assert.rejects(pageTitle(`http://localhost:${port}/pagina`, { gh: async () => null, memo: memo() }), { code: 'direccion-no-permitida' })
  assert.equal(hits, before)
})

test('solo http y https, sin credenciales', async () => {
  for (const url of ['ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'no es un enlace', '', 'http://user:pw@example.com/']) {
    await assert.rejects(pageTitle(url, { ...local, memo: memo() }), { code: 'url-no-valida' }, url)
  }
  await assert.rejects(pageTitle(undefined, local), { code: 'url-no-valida' })
})

test('GitHub con gh: PR, issue y repo; si gh falla, se lee la página', async () => {
  const gh = path.join(dir, 'gh')
  await writeFile(
    gh,
    `#!/bin/sh
[ "$1" = "api" ] || exit 2
case "$2" in
  repos/org/repo/pulls/12) echo '{"number":12,"title":"Arreglar login"}' ;;
  repos/org/repo/issues/7) echo '{"number":7,"title":"Falla  el &amp; menú"}' ;;
  repos/org/repo/issues/8) echo '{"number":8,"title":"En realidad es un PR","pull_request":{}}' ;;
  repos/org/repo) echo '{"full_name":"org/repo","description":"Un repo de prueba"}' ;;
  repos/org/vacio) echo '{"full_name":"org/vacio","description":null}' ;;
  *) echo 'HTTP 404: Not Found' >&2; exit 1 ;;
esac
`,
  )
  await chmod(gh, 0o755)
  const opts = { gh: async () => gh, lookup: fakeLookup, memo: memo() }
  assert.equal(await pageTitle('https://github.com/org/repo/pull/12', opts), 'PR #12 · Arreglar login (org/repo)')
  assert.equal(await pageTitle('https://github.com/org/repo/issues/7', opts), 'Issue #7 · Falla el &amp; menú (org/repo)')
  assert.equal(await pageTitle('https://github.com/org/repo/issues/8', opts), 'PR #8 · En realidad es un PR (org/repo)')
  assert.equal(await pageTitle('https://github.com/org/repo', opts), 'org/repo · Un repo de prueba')
  assert.equal(await pageTitle('https://github.com/org/vacio', opts), 'org/vacio')
  // gh no lo encuentra: se intenta la página (aquí github.com «resuelve» a nada → no se pudo leer).
  await assert.rejects(pageTitle('https://github.com/org/otro/pull/1', opts), { code: 'no-se-pudo-leer' })
})

test('busca gh en las carpetas indicadas', async () => {
  assert.equal(await findGh([path.join(dir, 'no-existe'), dir]), path.join(dir, 'gh'))
  assert.equal(await findGh([path.join(dir, 'no-existe')]), null)
})
