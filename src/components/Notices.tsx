import { useEffect, useRef, useState } from 'react'
import { dismissNotice, useNotices, type Notice } from '../notices'
import { cx } from '../util'
import * as Icon from './Icons'

/** Lo bueno se va solo; un error se queda hasta cerrarlo, que hay que poder leerlo. */
const VISIBLE_MS = 6000

const ICONS = { ok: Icon.Check, error: Icon.Alert, info: Icon.Info }

/** Los avisos, arriba a la derecha, por encima de todo. */
export function Notices() {
  const notices = useNotices()
  return (
    <div className="notices">
      {notices.map((n) => (
        <NoticeCard key={n.id} notice={n} />
      ))}
    </div>
  )
}

function NoticeCard({ notice }: { notice: Notice }) {
  const [held, setHeld] = useState(false)
  const close = useRef(() => dismissNotice(notice.id))
  const Glyph = ICONS[notice.tone]

  // Con el ratón encima no se va: puede que se esté leyendo.
  useEffect(() => {
    if (notice.tone === 'error' || held) return
    const timer = setTimeout(close.current, VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [notice.tone, held])

  return (
    <div
      className={cx('notice', `is-${notice.tone}`)}
      role={notice.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <span className="notice-icon">
        <Glyph />
      </span>
      <p>{notice.text}</p>
      <button type="button" className="notice-close" aria-label="Cerrar el aviso" title="Cerrar" onClick={close.current}>
        <Icon.Close />
      </button>
    </div>
  )
}
