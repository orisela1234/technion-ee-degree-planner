import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, CopyX, FileWarning, Wrench } from 'lucide-react'
import { useStore } from '../lib/store'
import { useUi } from '../lib/ui'
import { findIssues, type Issue } from '../lib/integrity'

const KIND_ICON = { duplicate: CopyX, 'no-credit': CopyX } as const

/** התראות על כפילויות ועל אי-התאמה לגיליון הציונים, עם תיקון בלחיצה */
export function IssuesPanel() {
  const { state, dispatch } = useStore()
  const ui = useUi()
  const issues = useMemo(() => findIssues(state), [state])
  const [open, setOpen] = useState(true)
  if (!issues.length) return null

  const dups = issues.filter((i) => i.kind === 'duplicate' || i.kind === 'no-credit').length
  const sheet = issues.length - dups
  const fixable = issues.filter((i) => i.fixes.some((f) => f.primary))

  const apply = (i: Issue, fixIndex: number) => {
    const fix = i.fixes[fixIndex]
    dispatch({ type: 'batch', actions: fix.actions })
    ui.toast('תוקן', 'ok', [i.title], { label: 'בטל', run: () => dispatch({ type: 'undo' }) })
  }
  const fixAll = () => {
    const actions = fixable.flatMap((i) => i.fixes.find((f) => f.primary)!.actions)
    dispatch({ type: 'batch', actions })
    ui.toast(`תוקנו ${fixable.length} בעיות`, 'ok', undefined, { label: 'בטל', run: () => dispatch({ type: 'undo' }) })
  }

  return (
    <section className={`issues ${open ? 'open' : ''}`} aria-live="polite">
      <button className="iss-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <AlertTriangle size={16} />
        <b>
          {dups > 0 && (dups === 1 ? 'כפילות אחת' : `${dups} כפילויות`)}{dups > 0 && sheet > 0 && ' · '}{sheet > 0 && (sheet === 1 ? 'אי-התאמה אחת לגיליון הציונים' : `${sheet} אי-התאמות לגיליון הציונים`)}
        </b>
        <span className="muted small">בדיקה אוטומטית של התכנון</span>
        <ChevronDown size={16} className="iss-chev" />
      </button>
      {open && (
        <div className="iss-body">
          <ul>
            {issues.map((i) => {
              const Icon = i.kind in KIND_ICON ? KIND_ICON[i.kind as keyof typeof KIND_ICON] : FileWarning
              return (
                <li key={i.id} className={`iss sev-${i.severity}`}>
                  <Icon size={15} className="iss-ic" />
                  <div className="iss-text">
                    <button className="link-btn iss-title" onClick={() => i.courseId && ui.openCourse(i.courseId, i.keys[0])}>{i.title}</button>
                    <div className="muted small">{i.detail}</div>
                  </div>
                  <div className="iss-fixes">
                    {i.fixes.map((f, k) => (
                      <button key={k} className={`btn ${f.primary ? '' : 'ghost'} small-btn`} onClick={() => apply(i, k)}>{f.label}</button>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
          {fixable.length > 1 && (
            <button className="btn ghost" onClick={fixAll}><Wrench size={14} /> תקן הכל לפי ההמלצה ({fixable.length})</button>
          )}
        </div>
      )}
    </section>
  )
}
