import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Check, RotateCcw, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { useUi } from '../lib/ui'
import { gpa, itemName } from '../lib/requirements'
import { BINARY_MAX_COURSES, BINARY_MAX_POINTS, binaryUsage, canMarkBinary, isBinaryPass, verifyState, withinBinaryLimit } from '../lib/grades'
import { fmtPts } from '../lib/catalog'
import { isFailed, PASS_GRADE, type PlanItem } from '../lib/types'

/** עורך ציון קטן שנפתח ישירות על כרטיס הקורס בתרשים */

interface Anchor { key: string; x: number; top: number; bottom: number }
let anchor: Anchor | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

export function openGradeEditor(itemKey: string, el: HTMLElement) {
  const r = el.getBoundingClientRect()
  anchor = { key: itemKey, x: r.left + r.width / 2, top: r.top, bottom: r.bottom }
  emit()
}
export function closeGradeEditor() {
  if (anchor) { anchor = null; emit() }
}
export const useGradeEditorKey = () =>
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => anchor?.key ?? null)

export function GradeEditor() {
  const a = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => anchor)
  const { state, dispatch } = useStore()
  const item = a ? state.items.find((i) => i.key === a.key) : undefined
  if (!a || !item) return null
  return <Editor key={a.key} a={a} item={item} state={state} dispatch={dispatch} />
}

function Editor({ a, item, state, dispatch }: {
  a: Anchor; item: PlanItem; state: ReturnType<typeof useStore>['state']; dispatch: ReturnType<typeof useStore>['dispatch']
}) {
  const ui = useUi()
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const future = !item.result && item.sem >= state.currentSem
  const hasGradeField = !item.result || item.result.kind === 'grade'
  const initial = item.result?.kind === 'grade' ? String(item.result.grade) : future && state.expected[item.key] != null ? String(state.expected[item.key]) : ''
  const [draft, setDraft] = useState(initial)
  const v = verifyState(item)
  const binary = isBinaryPass(item)
  const usage = binaryUsage(state.items)
  const usageOk = withinBinaryLimit(usage.count, usage.points, state.binaryRule)

  const parsed = draft.trim() === '' ? undefined : Math.max(0, Math.min(100, Math.round(Number(draft))))
  const valid = draft.trim() === '' || (!Number.isNaN(Number(draft)) && Number(draft) >= 0 && Number(draft) <= 100)

  // ממוצע לפני/אחרי – כדי לראות מיד את ההשפעה
  const before = gpa(state.items, state.expected, true)
  const previewItems = state.items.map((i) => {
    if (i.key !== item.key || !hasGradeField) return i
    if (future) return i
    return { ...i, result: parsed == null ? undefined : { kind: 'grade' as const, grade: parsed } }
  })
  const previewExpected = future ? { ...state.expected, ...(parsed == null ? {} : { [item.key]: parsed }) } : state.expected
  if (future && parsed == null) delete (previewExpected as Record<string, number>)[item.key]
  const after = gpa(previewItems, previewExpected, true)

  const commit = () => {
    if (!valid || !hasGradeField) return
    if (draft === initial) return
    if (future) dispatch({ type: 'setExpected', key: item.key, grade: parsed })
    else dispatch({ type: 'setResult', key: item.key, result: parsed == null ? undefined : { kind: 'grade', grade: parsed } })
  }
  const close = (save: boolean) => {
    if (save) commit()
    closeGradeEditor()
  }

  // פוקוס ובחירת הטקסט רק בפתיחה – אחרת כל הקשה מחליפה את הספרה הקודמת
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) close(true)
    }
    const onScroll = () => close(true)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
    }
  })

  const toggleBinary = () => {
    if (!binary) {
      const chk = canMarkBinary(state, item)
      if (!chk.ok) { ui.toast('אי אפשר לסמן עובר בינארי', 'error', [chk.reason!]); return }
    }
    dispatch({ type: 'setBinary', key: item.key, binary: !binary })
  }

  const W = 248
  const below = a.bottom + 230 < window.innerHeight
  const left = Math.min(window.innerWidth - W - 8, Math.max(8, a.x - W / 2))
  const style: React.CSSProperties = below ? { left, top: a.bottom + 6, width: W } : { left, top: a.top - 6, width: W, transform: 'translateY(-100%)' }

  return (
    <div
      ref={boxRef}
      className="grade-pop"
      style={style}
      role="dialog"
      aria-label={`עריכת ציון: ${itemName(item)}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); close(false) }
      }}
    >
      <div className="gp-head">
        <b>{itemName(item)}</b>
        <button className="icon-btn" aria-label="סגירה" onClick={() => close(false)}><X size={14} /></button>
      </div>
      <div className={`gp-usage ${usageOk ? '' : 'over'}`}>
        עובר בינארי נוצל: {usage.count}/{BINARY_MAX_COURSES} קורסים · {fmtPts(usage.points)}/{BINARY_MAX_POINTS} נק"ז
      </div>

      {hasGradeField ? (
        <div className="gp-row">
          <label htmlFor="gp-input">{future ? 'ציון צפוי' : 'ציון'}</label>
          <input
            id="gp-input" ref={inputRef} type="number" inputMode="numeric" min={0} max={100}
            className={`grade-input ${parsed != null && parsed < PASS_GRADE ? 'failing' : ''} ${!valid ? 'invalid' : ''}`}
            value={draft} placeholder="—"
            onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); close(true) } }}
          />
          <button className="btn gp-save" disabled={!valid} onClick={() => close(true)} aria-label="שמירה"><Check size={15} /></button>
        </div>
      ) : (
        <div className="gp-row muted small">{item.result?.kind === 'pass' ? 'עובר (בלי ציון מספרי)' : 'פטור'}</div>
      )}

      {hasGradeField && parsed != null && parsed < PASS_GRADE && (
        <div className="gp-note bad">מתחת ל-{PASS_GRADE}: נכשל – נספר בממוצע, בלי נקודות</div>
      )}
      {hasGradeField && before != null && after != null && Math.abs(after - before) > 0.004 && (
        <div className="gp-note">ממוצע משוער: {before.toFixed(2)} ← <b>{after.toFixed(2)}</b></div>
      )}

      {item.result?.kind !== 'exempt' && !isFailed(item) && (
        <label className="gp-binary">
          <span>
            עובר בינארי
            <small className="muted"> · נספר בנק"ז, לא בממוצע</small>
          </span>
          <span className="switch">
            <input type="checkbox" checked={binary} onChange={toggleBinary} />
            <span />
          </span>
        </label>
      )}

      {v.state === 'edited' && (
        <div className="gp-foot">
          <span className="vchip edited">נערך · בגיליון {v.sheetText}</span>
          <button className="link-btn small" onClick={() => { dispatch({ type: 'resetToSheet', key: item.key }); closeGradeEditor() }}>
            <RotateCcw size={12} /> החזר לגיליון
          </button>
        </div>
      )}
      {!future && hasGradeField && v.state !== 'edited' && <div className="gp-hint muted small">Enter לשמירה · Esc לביטול</div>}
      {future && <div className="gp-hint muted small">ציון צפוי לא משנה את מצב הקורס – רק את הממוצע המשוער</div>}
    </div>
  )
}
