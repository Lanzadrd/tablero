// Las empresas de «Hoy»: las cuentas publicitarias de Meta y de Google Ads juntas por empresa, y lo que se enseña
// de cada cuenta (sus campañas que cuentan, lo gastado y lo conseguido).

/** Sin tildes, mayúsculas ni signos: para comparar nombres. */
const plain = (name) =>
  String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Las que pueden anunciar: ni desactivadas ni de prueba. */
const usable = (account) => account.activa && !account.prueba

/** Los grupos de las cuentas sueltas (sin portfolio de Meta, sin cuenta de administrador de Google Ads). */
const LOOSE = new Set(['sin-portfolio', 'sin-administrador'])

const entry = (plataforma, account) => ({ plataforma, id: account.id, nombre: account.nombre, moneda: account.moneda })

/** «Acme» y «Acme Studio»: uno empieza por el otro, por palabras enteras. */
const sameStart = (a, b) => a.length > 0 && b.length > 0 && (a.startsWith(`${b} `) || b.startsWith(`${a} `))

/**
 * Las empresas: cada portfolio de Meta con sus cuentas y, con ellas, las de Google Ads que son suyas. Una cuenta de
 * Google Ads es de la empresa con la que comparte resumen diario (`summaries`), de la que se llama igual (o tiene
 * una cuenta de Meta que se llama igual) o, si no, de su cuenta de administrador; sin nada de eso, va sola. Las
 * cuentas sin portfolio, al final.
 */
export function companiesOf({ meta = [], google = [], summaries = [] } = {}) {
  const companies = meta.map((p) => ({
    id: p.id,
    nombre: String(p.nombre ?? '').trim(),
    foto: p.foto ?? null,
    suelta: LOOSE.has(p.id),
    cuentas: p.cuentas.filter(usable).map((c) => entry('meta', c)),
  }))
  const real = () => companies.filter((c) => !c.suelta)
  const add = (company) => {
    companies.push(company)
    return company
  }

  const linked = (account) => {
    for (const summary of summaries) {
      if (!summary.google?.includes(account.id)) continue
      const found = companies.find((c) => c.cuentas.some((a) => a.plataforma === 'meta' && summary.meta?.includes(a.id)))
      if (found) return found
    }
    return null
  }
  const named = (name) => {
    const wanted = plain(name)
    if (!wanted) return null
    return (
      real().find((c) => plain(c.nombre) === wanted) ??
      companies.find((c) => c.cuentas.some((a) => a.plataforma === 'meta' && plain(a.nombre) === wanted)) ??
      real().find((c) => sameStart(plain(c.nombre), wanted)) ??
      null
    )
  }
  const ofManager = (group) => {
    if (LOOSE.has(group.id)) return null
    return companies.find((c) => c.id === `google-${group.id}`) ?? named(group.nombre) ?? add({ id: `google-${group.id}`, nombre: group.nombre, foto: null, suelta: false, cuentas: [] })
  }

  for (const group of google) {
    for (const account of group.cuentas.filter(usable)) {
      const company =
        linked(account) ??
        named(account.nombre) ??
        ofManager(group) ??
        add({ id: `google-${account.id}`, nombre: account.nombre, foto: null, suelta: false, cuentas: [] })
      company.cuentas.push(entry('google', account))
    }
  }

  return companies
    .filter((c) => c.cuentas.length)
    .sort((a, b) => Number(a.suelta) - Number(b.suelta))
    .map(({ suelta: _, ...company }) => company)
}

/** Lo que busca una fila y lo que ha conseguido: conversaciones o clientes potenciales (Meta), conversiones (Google Ads). */
function resultOf(metrics, tipo) {
  const [count, cost] = tipo === 'leads' ? ['leads', 'costeLead'] : tipo === 'conversiones' ? ['conversiones', 'coste'] : ['conversaciones', 'coste']
  return { tipo, cantidad: metrics?.[count] ?? 0, coste: metrics?.[cost] ?? null }
}

const kindOf = (row, plataforma) => (plataforma === 'google' ? 'conversiones' : row.resultado === 'leads' ? 'leads' : 'conversaciones')

/**
 * Lo que se enseña de una cuenta: sus campañas activas o con gasto en el periodo (primero lo que hay que mirar y lo
 * que más gasta), lo gastado en total y lo conseguido de cada cosa que buscan.
 */
export function accountView(rows, plataforma) {
  const campanas = rows.filas
    .filter((r) => r.estado === 'activa' || (r.metricas?.gasto ?? 0) > 0)
    .map((r) => ({
      id: r.id,
      nombre: r.nombre,
      activa: r.estado === 'activa',
      tono: r.entrega?.tono ?? 'off',
      entrega: r.entrega?.texto ?? '',
      gasto: r.metricas?.gasto ?? 0,
      resultado: resultOf(r.metricas, kindOf(r, plataforma)),
    }))
    .sort((a, b) => Number(b.tono === 'warning') - Number(a.tono === 'warning') || b.gasto - a.gasto || a.nombre.localeCompare(b.nombre, 'es'))
  const kinds = ['conversaciones', 'leads', 'conversiones'].filter((kind) => campanas.some((c) => c.resultado.tipo === kind))
  return {
    moneda: rows.moneda,
    gasto: rows.totales?.gasto ?? 0,
    resultados: kinds.map((kind) => resultOf(rows.totales, kind)),
    campanas,
    avisos: campanas.filter((c) => c.tono === 'warning').length,
  }
}

const count = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1, useGrouping: 'always' })
const WORDS = {
  conversaciones: ['conversación', 'conversaciones'],
  leads: ['cliente potencial', 'clientes potenciales'],
  conversiones: ['conversión', 'conversiones'],
}

/** «38 conversaciones», «1 cliente potencial», «2,5 conversiones», «1.389 conversaciones». */
export const resultText = ({ tipo, cantidad }) => `${count.format(cantidad)} ${WORDS[tipo][cantidad === 1 ? 0 : 1]}`
