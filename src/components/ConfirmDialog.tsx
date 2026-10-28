import { useEffect, useRef } from 'react'
import { ShieldAlert } from 'lucide-react'
import { answerConfirm, useConfirm } from '../lib/confirm'

/** דיאלוג אישור מרכזי */
export function ConfirmDialog() {
  const req = useConfirm()
  const okRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!req) return
    okRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') answerConfirm(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [req])
  if (!req) return null
  return (
    <div className="confirm-backdrop" onClick={() => answerConfirm(false)}>
      <div className={`confirm tone-${req.tone ?? 'normal'}`} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}>
        <div className="cf-head">
          <ShieldAlert size={20} />
          <h3 id="confirm-title">{req.title}</h3>
        </div>
        {req.lines && req.lines.length > 0 && (
          <ul className="cf-lines">{req.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        )}
        {req.note && <p className="cf-note">{req.note}</p>}
        <div className="cf-actions">
          <button className="btn ghost" onClick={() => answerConfirm(false)}>{req.cancelLabel ?? 'ביטול'}</button>
          {req.alt ? <>
            <button className="btn ghost danger-text" onClick={() => answerConfirm(true)}>{req.confirmLabel}</button>
            <button ref={okRef} className="btn" onClick={() => { req.alt!.run(); answerConfirm(true) }}>{req.alt.label}</button>
          </> : (
            <button ref={okRef} className={`btn ${req.tone === 'danger' ? 'btn-danger' : ''}`} onClick={() => answerConfirm(true)}>{req.confirmLabel}</button>
          )}
        </div>
      </div>
    </div>
  )
}
