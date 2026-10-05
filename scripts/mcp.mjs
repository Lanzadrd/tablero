// Imprime cómo registrar el MCP de Tablero en Claude Code (no registra nada).
// Apunta a la app instalada (npm run instalar), que se actualiza sola.
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const APP = path.join(os.homedir(), 'Library', 'Application Support', 'Tablero', 'app')
const node = path.join(APP, 'bin', 'node')
const server = path.join(APP, 'server', 'mcp.mjs')
const quote = (s) => `'${s.replace(/'/g, `'\\''`)}'`
const config = { mcpServers: { tablero: { type: 'stdio', command: node, args: [server] } } }

console.log(`Tablero para Claude Code (MCP)

Herramientas: tablero_listar, tablero_anadir, tablero_completar, tablero_buscar.
Hablan con Tablero en http://127.0.0.1:4747, que tiene que estar en marcha.

Para registrarlo en todos tus proyectos, ejecuta una vez:

  claude mcp add --scope user tablero -- ${quote(node)} ${quote(server)}

O añádelo a mano a una configuración de MCP (p. ej. .mcp.json de un proyecto):

${JSON.stringify(config, null, 2)}
`)

if (!existsSync(server)) {
  console.log('Ojo: la app instalada aún no incluye el MCP. Instálala antes con «npm run instalar».\n')
}
