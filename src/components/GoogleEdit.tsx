import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { googleApi, type GoogleEditChanges, type GoogleEditDetails, type SearchAsset } from '../ads'
import { cx } from '../util'
import { errorText } from './Ads'
import { Field } from './AdsComposer'
import { MoneyInput, NameCard, SaveBar, useSave } from './AdsEdit'
import type { EditorProps } from './AdsRunning'
import * as Icon from './Icons'

const WORDS = {
  campana: { el: 'la campaña', saved: 'guardada' },
  conjunto: { el: 'el grupo de anuncios', saved: 'guardado' },
  anuncio: { el: 'el anuncio', saved: 'guardado' },
}

/** Lo que admite Google en un anuncio de búsqueda adaptable. */
const HEADLINES = { min: 3, max: 15, chars: 30 }
const DESCRIPTIONS = { min: 2, max: 4, chars: 90 }

/** Editar en Google Ads: el nombre y el presupuesto de una campaña, un grupo, o los textos de un anuncio de búsqueda. */
export function GoogleEditor({ account, level, row, onCancel, onSaved }: EditorProps) {
  const heading = useRef<HTMLHeadingElement>(null)
  const [data, setData] = useState<GoogleEditDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    setError(null)
    googleApi.details(account.id, level, row.id).then(setData, (err) => setError(errorText(err)))
  }, [account.id, level, row.id])
  useEffect(load, [load])
  useEffect(() => heading.current?.focus(), [])

  const save = async (cambios: GoogleEditChanges) => {
    const saved = await googleApi.update(account.id, level, row.id, cambios)
    const what = WORDS[level]
    onSaved(`${what.el.charAt(0).toUpperCase()}${what.el.slice(1)} «${saved.nombre}», ${what.saved}.${cambios.anuncio ? ' Google lo vuelve a revisar.' : ''}`)
  }

  return (
    <div className="ads-edit">
      <header className="ads-composer-head">
        <h3 ref={heading} tabIndex={-1}>
          Editar {WORDS[level].el} «{row.nombre}»
        </h3>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </header>
      {!data ? (
        error ? (
          <div className="ads-error-box" role="alert">
            <p>{error}</p>
            <button type="button" className="btn" onClick={load}>
              Reintentar
            </button>
          </div>
        ) : (
          <p className="ads-loading" aria-busy="true">
            Leyendo cómo está en Google Ads…
          </p>
        )
      ) : level === 'anuncio' ? (
        <SearchAdForm data={data} onSave={save} />
      ) : (
        <NameBudgetForm data={data} onSave={save} />
      )}
    </div>
  )
}

function NameBudgetForm({ data, onSave }: { data: GoogleEditDetails; onSave: (c: GoogleEditChanges) => Promise<void> }) {
  const ids = useId()
  const { busy, error, run } = useSave<GoogleEditChanges>(onSave)
  const [name, setName] = useState(data.nombre)
  const budget = data.campana?.presupuesto ?? null
  const cpc = data.conjunto?.cpc ?? null
  const [amount, setAmount] = useState(budget ?? cpc ?? Number.NaN)
  const changes: GoogleEditChanges = {}
  if (name.trim() !== data.nombre) changes.nombre = name.trim()
  if (data.campana && budget !== null && amount !== budget) changes.presupuesto = amount
  if (data.conjunto && cpc !== null && amount !== cpc) changes.cpc = amount
  return (
    <>
      <NameCard id={`${ids}-name`} label={data.campana ? 'Campaña' : 'Grupo de anuncios'} value={name} onChange={setName} />
      {(budget !== null || cpc !== null) && (
        <section className="ads-card" aria-labelledby={`${ids}-money`}>
          <h4 id={`${ids}-money`}>{data.campana ? 'Presupuesto' : 'Puja'}</h4>
          <div className="ads-fields">
            <Field
              label={data.campana ? 'Al día' : 'CPC máximo'}
              htmlFor={`${ids}-amount`}
              note={
                data.campana?.compartido
                  ? 'Este presupuesto es compartido: el cambio vale para todas las campañas que lo usan.'
                  : data.conjunto
                    ? 'Solo cuenta si la campaña puja con CPC manual.'
                    : 'Google puede gastar hasta el doble un día concreto, sin pasarse del total del mes.'
              }
            >
              <MoneyInput id={`${ids}-amount`} value={amount} currency={data.moneda} onChange={setAmount} />
            </Field>
          </div>
        </section>
      )}
      <SaveBar changed={Object.keys(changes).length > 0} busy={busy} error={error} onSave={() => void run(() => changes)} />
    </>
  )
}

function SearchAdForm({ data, onSave }: { data: GoogleEditDetails; onSave: (c: GoogleEditChanges) => Promise<void> }) {
  const ids = useId()
  const ad = data.anuncio!
  const { busy, error, run } = useSave<GoogleEditChanges>(onSave)
  const [headlines, setHeadlines] = useState<SearchAsset[]>(ad.titulos)
  const [descriptions, setDescriptions] = useState<SearchAsset[]>(ad.descripciones)
  const [url, setUrl] = useState(ad.url)
  const [path1, setPath1] = useState(ad.ruta1)
  const [path2, setPath2] = useState(ad.ruta2)
  if (!ad.editable) {
    return (
      <section className="ads-card">
        <p className="ads-hint">{ad.motivo}</p>
      </section>
    )
  }
  const value = { titulos: headlines, descripciones: descriptions, url: url.trim(), ruta1: path1.trim(), ruta2: path2.trim() }
  const changed = JSON.stringify(value) !== JSON.stringify({ titulos: ad.titulos, descripciones: ad.descripciones, url: ad.url, ruta1: ad.ruta1, ruta2: ad.ruta2 })
  const filled = (list: SearchAsset[]) => list.filter((a) => a.texto.trim()).length
  const blocked =
    filled(headlines) < HEADLINES.min
      ? `Hacen falta al menos ${HEADLINES.min} títulos.`
      : filled(descriptions) < DESCRIPTIONS.min
        ? `Hacen falta al menos ${DESCRIPTIONS.min} descripciones.`
        : headlines.some((a) => a.texto.length > HEADLINES.chars) || descriptions.some((a) => a.texto.length > DESCRIPTIONS.chars)
          ? 'Hay textos demasiado largos.'
          : null
  let domain = ''
  try {
    domain = new URL(url).host.replace(/^www\./, '')
  } catch {}
  return (
    <>
      <section className="ads-card" aria-labelledby={`${ids}-titles`}>
        <h4 id={`${ids}-titles`}>Títulos</h4>
        <p className="ads-hint">
          Entre {HEADLINES.min} y {HEADLINES.max}, de hasta {HEADLINES.chars} caracteres. Google combina los que mejor funcionan.
        </p>
        <AssetList label="Título" values={headlines} max={HEADLINES.max} chars={HEADLINES.chars} onChange={setHeadlines} />
      </section>
      <section className="ads-card" aria-labelledby={`${ids}-descriptions`}>
        <h4 id={`${ids}-descriptions`}>Descripciones</h4>
        <p className="ads-hint">
          Entre {DESCRIPTIONS.min} y {DESCRIPTIONS.max}, de hasta {DESCRIPTIONS.chars} caracteres.
        </p>
        <AssetList label="Descripción" values={descriptions} max={DESCRIPTIONS.max} chars={DESCRIPTIONS.chars} multiline onChange={setDescriptions} />
      </section>
      <section className="ads-card" aria-labelledby={`${ids}-url`}>
        <h4 id={`${ids}-url`}>Dónde lleva</h4>
        <div className="ads-fields">
          <Field label="URL final" htmlFor={`${ids}-final`}>
            <input id={`${ids}-final`} className="input ads-wide" type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <Field label="Ruta visible" note={domain ? `Se ve como ${[domain, path1.trim(), path2.trim()].filter(Boolean).join('/')}` : null}>
            <span className="ads-paths">
              <input className="input" aria-label="Ruta 1" maxLength={15} value={path1} onChange={(e) => setPath1(e.target.value)} />
              <span aria-hidden="true">/</span>
              <input className="input" aria-label="Ruta 2" maxLength={15} value={path2} onChange={(e) => setPath2(e.target.value)} />
            </span>
          </Field>
        </div>
      </section>
      <SaveBar changed={changed && !blocked} busy={busy} error={error} note={blocked ?? undefined} onSave={() => void run(() => ({ anuncio: value }))} />
    </>
  )
}

/** Los títulos o las descripciones: cada uno con su cuenta de caracteres (y dónde está fijado, si lo está). */
function AssetList({
  label,
  values,
  max,
  chars,
  multiline = false,
  onChange,
}: {
  label: string
  values: SearchAsset[]
  max: number
  chars: number
  multiline?: boolean
  onChange: (values: SearchAsset[]) => void
}) {
  const set = (i: number, texto: string) => onChange(values.map((v, j) => (j === i ? { ...v, texto } : v)))
  return (
    <div className="ads-assets">
      {values.map((asset, i) => (
        <div key={i} className="ads-variant">
          {multiline ? (
            <textarea className="input ads-textarea is-short" rows={2} aria-label={`${label} ${i + 1}`} value={asset.texto} onChange={(e) => set(i, e.target.value)} />
          ) : (
            <input className="input ads-wide" aria-label={`${label} ${i + 1}`} value={asset.texto} onChange={(e) => set(i, e.target.value)} />
          )}
          <span className={cx('ads-chars', asset.texto.length > chars && 'is-over')} aria-label={`${asset.texto.length} de ${chars} caracteres`}>
            {asset.texto.length}/{chars}
          </span>
          {asset.fijado && (
            <span className="ads-pinned" title="Fijado: siempre sale en esta posición">
              {asset.fijado.replace(/^HEADLINE_/, 'Posición ').replace(/^DESCRIPTION_/, 'Posición ')}
            </span>
          )}
          <button type="button" className="icon-btn" aria-label={`Quitar ${label.toLowerCase()} ${i + 1}`} title="Quitar" onClick={() => onChange(values.filter((_, j) => j !== i))}>
            <Icon.Close />
          </button>
        </div>
      ))}
      {values.length < max && (
        <button type="button" className="link-btn ads-variant-add" onClick={() => onChange([...values, { texto: '', fijado: null }])}>
          <Icon.Plus />
          Añadir {label.toLowerCase()}
        </button>
      )}
    </div>
  )
}
