// «Hoy», los anuncios: todas las cuentas de Meta y de Google Ads, por empresa, con lo gastado y lo conseguido por
// cada campaña en marcha. Solo se mira: se cambia en la vista de cada cuenta (a un clic de su nombre).
import { useEffect, useId, useMemo } from 'react'
import { accountView, companiesOf, resultText, type AccountView, type AdResult, type Company, type CompanyAccount } from '../../server/empresas.mjs'
import { googleAccounts, metaAccounts, type AccountStore } from '../adAccounts'
import { money, type Period } from '../ads'
import { loadOverview, useOverview, useSummaryLinks, type AccountData } from '../adsOverview'
import { useUI } from '../context'
import { cx, useStoredState } from '../util'
import { Avatar } from './Ads'
import * as Icon from './Icons'
import { Segmented } from './Segmented'

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: 'hoy', label: 'Hoy' },
  { value: 'ayer', label: 'Ayer' },
  { value: '7d', label: '7 días' },
]

const PLATFORMS = {
  meta: { store: metaAccounts, view: 'ads', label: 'Meta Ads', icon: Icon.MetaLogo },
  google: { store: googleAccounts, view: 'google', label: 'Google Ads', icon: Icon.GoogleAdsLogo },
} as const

const clock = (at: number) => new Date(at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })

/** Las cuentas de un sitio; si aún no se han pedido (el menú lateral está oculto), se piden. */
function useAccounts(store: AccountStore) {
  const accounts = store.useAccounts()
  const missing = accounts.portfolios === null && !accounts.loading && !accounts.disconnected && !accounts.error
  useEffect(() => {
    if (missing) void store.load()
  }, [missing, store])
  return accounts
}

/** Una cuenta con lo leído y lo que se enseña de ello (null: aún no se ha leído nada). */
interface Loaded {
  account: CompanyAccount
  data: AccountData
  view: AccountView | null
}

/** Leída y sin nada en marcha: no ocupa una fila. */
const quiet = (a: Loaded) => a.view !== null && a.view.campanas.length === 0 && !a.data.error

/** Sin ninguna cuenta de anuncios conectada, no sale nada. */
export function TodayAds() {
  const meta = useAccounts(metaAccounts)
  const google = useAccounts(googleAccounts)
  const links = useSummaryLinks()
  const [stored, setPeriod] = useStoredState<Period>('tablero.hoy.anuncios', 'hoy')
  const period = PERIODS.some((p) => p.value === stored) ? stored : 'hoy'
  const companies = useMemo(
    () => companiesOf({ meta: meta.portfolios ?? [], google: google.portfolios ?? [], summaries: links }),
    [meta.portfolios, google.portfolios, links],
  )
  const accounts = useMemo(() => companies.flatMap((c) => c.cuentas), [companies])
  const dataOf = useOverview(accounts, period)
  const headId = useId()
  if (!accounts.length) return null

  const loaded = companies.map((company) => ({
    company,
    cuentas: company.cuentas.map((account): Loaded => {
      const data = dataOf(account)
      return { account, data, view: data.rows ? accountView(data.rows, account.plataforma) : null }
    }),
  }))
  const running = loaded.filter((c) => !c.cuentas.every(quiet))
  const resting = loaded.filter((c) => c.cuentas.every(quiet))
  const loading = accounts.some((a) => dataOf(a).loading)
  const latest = Math.max(0, ...accounts.map((a) => dataOf(a).at ?? 0))

  return (
    <aside className="today-ads" aria-labelledby={headId}>
      <header className="today-ads-head">
        <h3 id={headId} className="today-label">
          Anuncios
        </h3>
        <span className="today-ads-updated" role="status">
          {loading ? 'Actualizando…' : latest ? `Actualizado a las ${clock(latest)}` : ''}
        </span>
        <Segmented value={period} options={PERIODS} label="Periodo de los anuncios" onChange={setPeriod} />
        <button
          type="button"
          className="icon-btn"
          aria-label="Actualizar los anuncios"
          title="Actualizar los anuncios"
          disabled={loading}
          onClick={() => loadOverview(accounts, period, true)}
        >
          <Icon.Reload />
        </button>
      </header>
      {running.map(({ company, cuentas }) => (
        <CompanyCard key={company.id} company={company} cuentas={cuentas} />
      ))}
      {resting.length > 0 && <p className="today-ads-resting">Sin campañas en marcha: {resting.map((c) => c.company.nombre).join(', ')}.</p>}
    </aside>
  )
}

/** Una empresa: sus cuentas con algo en marcha, cada una con sus campañas; las demás, nombradas al final. */
function CompanyCard({ company, cuentas }: { company: Company; cuentas: Loaded[] }) {
  const resting = cuentas.filter(quiet)
  return (
    <section className="today-card today-company" aria-label={company.nombre}>
      <header className="today-ad-row today-company-head">
        <div className="today-company-name">
          <Avatar name={company.nombre} src={company.foto} />
          <h4>{company.nombre}</h4>
        </div>
        <span className="today-fig-label">Gasto</span>
        <span className="today-fig-label">Resultados</span>
        <span className="today-fig-label">Coste c/u</span>
      </header>
      {cuentas
        .filter((a) => !quiet(a))
        .map((a) => (
          <AccountBlock key={`${a.account.plataforma}:${a.account.id}`} {...a} />
        ))}
      {resting.length > 0 && <p className="today-ads-note">Sin campañas en marcha: {resting.map((a) => a.account.nombre).join(', ')}.</p>}
    </section>
  )
}

function AccountBlock({ account, data, view }: Loaded) {
  const ui = useUI()
  const platform = PLATFORMS[account.plataforma]
  return (
    <div className="today-account" role="group" aria-label={`${account.nombre}, ${platform.label}`}>
      <div className="today-ad-row is-account">
        <button
          type="button"
          className="today-account-name"
          title={`Abrir «${account.nombre}» en ${platform.label}`}
          onClick={() => {
            platform.store.select(account.id)
            ui.setView(platform.view)
          }}
        >
          <platform.icon />
          <span>{account.nombre}</span>
        </button>
        {view && <Figures gasto={view.gasto} resultados={view.resultados} moneda={view.moneda} />}
      </div>
      {!view && data.loading && <p className="today-ads-note">Leyendo sus campañas…</p>}
      {data.error && <p className="today-ads-note is-error">{view ? `No se ha podido actualizar: ${data.error}` : data.error}</p>}
      {view?.campanas.map((c) => (
        <div key={c.id} className="today-ad-row">
          <span className="today-campaign" title={c.nombre}>
            <span className={cx('today-campaign-dot', `is-${c.tono}`)} aria-hidden="true" />
            <span className="today-campaign-name">{c.nombre}</span>
            {c.tono !== 'ok' && <span className={cx('today-campaign-state', `is-${c.tono}`)}>{c.entrega}</span>}
          </span>
          <Figures gasto={c.gasto} resultados={[c.resultado]} moneda={view.moneda} />
        </div>
      ))}
    </div>
  )
}

/** Lo gastado, lo conseguido y lo que cuesta cada uno (una línea por cada cosa que se busca). */
function Figures({ gasto, resultados, moneda }: { gasto: number; resultados: AdResult[]; moneda: string }) {
  // Sin gasto ni resultados no hay nada que decir: una raya.
  const said = resultados.filter((r) => r.cantidad > 0 || gasto > 0)
  return (
    <>
      <span className="today-fig">
        <span className="sr-only">Gasto: </span>
        {gasto > 0 ? money(gasto, moneda) : <Dash />}
      </span>
      <span className="today-fig is-result">
        {said.length ? said.map((r) => <Result key={r.tipo} result={r} />) : <Dash />}
      </span>
      <span className="today-fig">
        {said.some((r) => r.coste !== null && r.cantidad > 0) ? (
          said.map((r) => (
            <span key={r.tipo}>
              {r.coste !== null && r.cantidad > 0 ? (
                <>
                  {money(r.coste, moneda)}
                  <span className="today-fig-unit"> c/u</span>
                </>
              ) : (
                <Dash />
              )}
            </span>
          ))
        ) : (
          <Dash />
        )}
      </span>
    </>
  )
}

/** «38 conversaciones»: el número, y su palabra más apagada. */
function Result({ result }: { result: AdResult }) {
  const text = resultText(result)
  const cut = text.indexOf(' ')
  return (
    <span>
      {text.slice(0, cut)}
      <span className="today-fig-word">{text.slice(cut)}</span>
    </span>
  )
}

const Dash = () => (
  <span className="today-fig-none">
    <span aria-hidden="true">—</span>
    <span className="sr-only">nada</span>
  </span>
)
