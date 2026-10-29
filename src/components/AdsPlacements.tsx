import { useId } from 'react'
import type { Placements } from '../ads'
import { ALL_PLACEMENTS, fits, formatsText, PLACEMENT_GROUPS, type Formato, type Placement } from '../placements'
import { cx } from '../util'
import * as Icon from './Icons'
import { Switch } from './Switch'

export type PlacementMode = Placements | 'meta'

/** Las de Tablero de una plataforma (las plantillas de antes decían «solo Facebook» o «solo Instagram»). */
export const keysOfPlatform = (label: string) =>
  PLACEMENT_GROUPS.find((g) => g.label.toLowerCase() === label)
    ?.items.filter((p) => !p.video)
    .map((p) => p.key) ?? []

/** Las elegidas, contando las de «solo Facebook» o «solo Instagram» de antes. */
export function chosenKeys(mode: PlacementMode, chosen: string[]) {
  if (mode === 'facebook' || mode === 'instagram') return keysOfPlatform(mode)
  return chosen
}

/**
 * Las ubicaciones: automáticas (Meta las reparte) o elegidas, cada una con el tamaño que le va y, si alguna versión
 * subida le encaja, un check verde. `pieces`: los formatos de cada anuncio (el check sale si todos tienen uno que le
 * vaya; si solo algunos, cuántos). `video`: si los anuncios son vídeos (las de solo vídeo, sin vídeos, no se eligen).
 */
export function PlacementPicker({
  mode,
  chosen,
  pieces,
  video = null,
  readOnly = false,
  note,
  onChange,
}: {
  mode: PlacementMode
  chosen: string[]
  pieces?: Formato[][]
  video?: boolean | null
  readOnly?: boolean
  note?: string | null
  onChange?: (mode: PlacementMode, chosen: string[]) => void
}) {
  const ids = useId()
  const auto = mode === 'auto'
  const selected = new Set(auto ? ALL_PLACEMENTS.map((p) => p.key) : chosenKeys(mode, chosen))
  const editable = !readOnly && !auto && mode !== 'meta'
  const usable = (p: Placement) => !(p.video && video === false)

  const set = (keys: Set<string>) =>
    onChange?.(
      'manual',
      ALL_PLACEMENTS.map((p) => p.key).filter((key) => keys.has(key)),
    )
  const toggle = (p: Placement, on: boolean) => {
    const next = new Set(selected)
    if (on) {
      next.add(p.key)
      if (p.needs) next.add(p.needs)
    } else {
      next.delete(p.key)
      // Sin Instagram Stories, Meta no deja los Estados de WhatsApp.
      for (const other of ALL_PLACEMENTS) if (other.needs === p.key) next.delete(other.key)
    }
    set(next)
  }

  const coverage = (p: Placement) => {
    if (!pieces?.length) return null
    const ok = pieces.filter((formats) => fits(p, formats)).length
    return { ok, total: pieces.length }
  }

  return (
    <div className="ads-placements">
      {!readOnly && (
        <div className="ads-placements-head">
          <Switch
            checked={auto}
            label="Ubicaciones automáticas"
            onChange={(on) => onChange?.(on ? 'auto' : 'manual', on ? [] : ALL_PLACEMENTS.filter((p) => usable(p) && !p.video).map((p) => p.key))}
          />
          <span>
            <strong>Automáticas</strong>
            <small>
              {auto
                ? 'Meta reparte el anuncio donde rinda más (también en otras, como Audience Network).'
                : mode === 'meta'
                  ? 'Las eligieron en Meta, con alguna que Tablero no conoce: se quedan como están si no las cambias.'
                  : 'Solo en las que marques.'}
            </small>
          </span>
          {mode === 'meta' && (
            <button type="button" className="link-btn" onClick={() => onChange?.('manual', [])}>
              Elegirlas aquí
            </button>
          )}
        </div>
      )}
      {note && <p className="ads-hint">{note}</p>}
      <div className="ads-placement-groups">
        {PLACEMENT_GROUPS.map((group) => {
          const items = group.items.filter(usable)
          const all = items.length > 0 && items.every((p) => selected.has(p.key))
          return (
            <fieldset key={group.label} className={cx('ads-placement-group', readOnly && 'is-read-only')} disabled={!editable}>
              <legend>
                {editable ? (
                  <label className="ads-placement-all">
                    <input
                      type="checkbox"
                      checked={all}
                      onChange={(e) => {
                        const next = new Set(selected)
                        for (const p of items) {
                          if (e.target.checked) next.add(p.key)
                          else next.delete(p.key)
                        }
                        if (e.target.checked) for (const p of items) if (p.needs) next.add(p.needs)
                        set(next)
                      }}
                    />
                    {group.label}
                  </label>
                ) : (
                  group.label
                )}
              </legend>
              {group.items.map((p) => {
                const disabled = !usable(p)
                const state = coverage(p)
                const id = `${ids}-${p.key}`
                const on = !disabled && selected.has(p.key)
                const label = (
                  <>
                    {p.label}
                    {p.video && <small>solo vídeo</small>}
                    {p.needs && <small>con Instagram Stories</small>}
                  </>
                )
                return (
                  <div key={p.key} className={cx('ads-placement', disabled && 'is-disabled', readOnly && !on && 'is-off')}>
                    {readOnly ? (
                      <span className="ads-placement-name">
                        {label}
                        {!on && <span className="sr-only"> (no está)</span>}
                      </span>
                    ) : (
                      <>
                        <input id={id} type="checkbox" checked={on} disabled={!editable || disabled} onChange={(e) => toggle(p, e.target.checked)} />
                        <label htmlFor={id} className="ads-placement-name">
                          {label}
                        </label>
                      </>
                    )}
                    <span className="ads-placement-size" title="Tamaño recomendado">
                      {formatsText(p.formats)}
                    </span>
                    {state &&
                      on &&
                      (state.ok === state.total ? (
                        <span className="ads-placement-ok" title="Hay una versión de este tamaño" aria-label="Hay una versión de este tamaño">
                          <Icon.Check />
                        </span>
                      ) : state.ok > 0 ? (
                        <span className="ads-placement-some" title={`${state.ok} de ${state.total} anuncios tienen una versión de este tamaño`}>
                          {state.ok}/{state.total}
                        </span>
                      ) : (
                        <span
                          className="ads-placement-none"
                          title="Ninguna versión de este tamaño: Meta adaptará la del feed"
                          aria-label="Sin versión de este tamaño"
                        />
                      ))}
                  </div>
                )
              })}
            </fieldset>
          )
        })}
      </div>
    </div>
  )
}
