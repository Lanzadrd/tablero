import { useId, useRef, useState, type FormEvent } from 'react'
import { ApiError, metaApi, type Copy, type CopyRequest } from '../ads'
import { errorText } from './Ads'
import * as Icon from './Icons'
import { Popover } from './Popover'

const CONSOLE = 'https://console.anthropic.com/settings/keys'

/**
 * «Escribir con Claude»: pide a Claude todos los textos del anuncio y del chat a partir de las imágenes, la página,
 * el público, lo que ya haya escrito y unas indicaciones. La primera vez, la clave de la API de Claude.
 */
export function CopyButton({ build, onCopy }: { build: () => Promise<Omit<CopyRequest, 'indicaciones'>>; onCopy: (copy: Copy) => void }) {
  const ids = useId()
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [notes, setNotes] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const show = () => {
    setOpen(!open)
    setError(null)
    if (!open) metaApi.claudeStatus().then((s) => setHasKey(s.clave), (err) => setError(errorText(err)))
  }

  const write = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onCopy(await metaApi.writeCopy({ ...(await build()), indicaciones: notes }))
      setOpen(false)
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'claude-sin-clave' || err.code === 'claude-clave')) setHasKey(false)
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const saveKey = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      setHasKey((await metaApi.saveClaudeKey(key.trim())).clave)
      setKey('')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button ref={button} type="button" className="btn ads-claude-btn" aria-expanded={open} aria-haspopup="dialog" onClick={show}>
        <Icon.Sparkles />
        Escribir con Claude
      </button>
      {open && button.current && (
        <Popover anchor={button.current} placement="below-end" width={340} label="Escribir con Claude" onClose={() => !busy && setOpen(false)}>
          {hasKey === false ? (
            <form className="ads-claude" onSubmit={saveKey}>
              <h3>Clave de la API de Claude</h3>
              <p className="ads-note">
                Créala en console.anthropic.com › API Keys y pégala aquí. Se guarda solo en este Mac; cada texto cuesta unos
                céntimos de tu cuenta de Anthropic.
              </p>
              <label className="sr-only" htmlFor={`${ids}-key`}>
                Clave de la API de Claude
              </label>
              <input
                id={`${ids}-key`}
                className="input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-ant-…"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              {error && (
                <p className="ads-error" role="alert">
                  {error}
                </p>
              )}
              <div className="ads-form-foot">
                <a className="link-btn" href={CONSOLE} target="_blank" rel="noreferrer">
                  Abrir la consola
                </a>
                <button type="submit" className="btn is-accent" disabled={busy || !key.trim()}>
                  Guardar
                </button>
              </div>
            </form>
          ) : (
            <form className="ads-claude" onSubmit={write}>
              <h3>Escribir con Claude</h3>
              <p className="ads-note">
                Claude ve las imágenes, la página, el público y lo que ya hay escrito, y rellena el texto principal, el título,
                la descripción y el chat de WhatsApp. Lo puedes deshacer.
              </p>
              <label className="field-label" htmlFor={`${ids}-notes`}>
                Indicaciones (opcional)
              </label>
              <textarea
                id={`${ids}-notes`}
                className="input ads-textarea is-short"
                rows={3}
                value={notes}
                placeholder="p. ej. 2x1 en el city tour hasta el domingo; tono cercano"
                onChange={(e) => setNotes(e.target.value)}
              />
              {error && (
                <p className="ads-error" role="alert">
                  {error}
                </p>
              )}
              <div className="ads-form-foot">
                <button type="button" className="link-btn" disabled={busy} onClick={() => setOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn is-accent" disabled={busy || hasKey === null}>
                  {busy ? 'Escribiendo…' : 'Escribir'}
                </button>
              </div>
            </form>
          )}
        </Popover>
      )}
    </>
  )
}
