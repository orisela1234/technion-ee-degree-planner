import { useMemo } from 'react'
import { CircleDashed, PencilLine, RotateCcw, ShieldCheck } from 'lucide-react'
import { useStore } from '../lib/store'
import { useUi } from '../lib/ui'
import { fmtPts, semLabel } from '../lib/catalog'
import { colorClass, gpa, itemName, itemPoints } from '../lib/requirements'
import {
  BINARY_MAX_COURSES, BINARY_MAX_POINTS, binaryUsage, canMarkBinary, isBinaryPass, verifyState, withinBinaryLimit,
} from '../lib/grades'
import { itemStatus, isFailed, PASS_GRADE, type PlanItem } from '../lib/types'
import { activeSheet } from '../lib/sheet'

const clampGrade = (v: string) => (v === '' ? undefined : Math.max(0, Math.min(100, Math.round(Number(v)))))

/** סימולטור ציונים: עריכה חופשית, עובר בינארי, והממוצע מתעדכן מיד */
export function GradesView() {
  const SHEET = activeSheet()
  const { state, dispatch } = useStore()
  const ui = useUi()
  const real = gpa(state.items)
  const projected = gpa(state.items, state.expected, true)
  const usage = binaryUsage(state.items)
  const edits = state.items.filter((i) => verifyState(i).state === 'edited').length
  const unverified = state.items.filter((i) => verifyState(i).state === 'unverified' || (!i.result && state.expected[i.key] != null)).length
  const limitOk = withinBinaryLimit(usage.count, usage.points, state.binaryRule)

  const bySem = useMemo(() => {
    const m = new Map<string, PlanItem[]>()
    state.semesters.forEach((s) => m.set(s, []))
    state.items.filter((i) => i.courseId && itemPoints(i) > 0).forEach((i) => m.get(i.sem)?.push(i))
    return m
  }, [state.items, state.semesters])

  const toggleBinary = (i: PlanItem) => {
    const on = !i.binary
    if (on) {
      const chk = canMarkBinary(state, i)
      if (!chk.ok) {
        ui.toast('אי אפשר לסמן עובר בינארי', 'error', [chk.reason!])
        return
      }
    }
    dispatch({ type: 'setBinary', key: i.key, binary: on })
  }

  const setGrade = (i: PlanItem, raw: string) => {
    const g = clampGrade(raw)
    const graded = !!i.result || i.sem < state.currentSem
    if (graded) dispatch({ type: 'setResult', key: i.key, result: g == null ? undefined : { kind: 'grade', grade: g } })
    else dispatch({ type: 'setExpected', key: i.key, grade: g })
  }

  return (
    <div className="grades">
      <section className="hero grades-hero">
        <div className="gh-kpis">
          <div className="gk">
            <span>לפי גיליון הציונים</span>
            <b>{SHEET.gpa.toFixed(1)}</b>
            <small className="muted">מאומת · {SHEET.issued.split('-').reverse().join('.')}</small>
          </div>
          <div className={`gk ${real != null && Math.abs(real - SHEET.gpa) > 0.05 ? 'changed' : ''}`}>
            <span>כולל העריכות שלך</span>
            <b>{real != null ? real.toFixed(2) : '—'}</b>
            <small>{real != null ? `${real - SHEET.gpa >= 0 ? '+' : ''}${(real - SHEET.gpa).toFixed(2)} מהגיליון` : ''}</small>
          </div>
          <div className="gk primary">
            <span>ממוצע משוער לסוף התואר</span>
            <b>{projected != null ? projected.toFixed(2) : '—'}</b>
            <small>כולל ציונים צפויים בקורסים עתידיים</small>
          </div>
        </div>
        <div className="binary-box">
          <div className="bb-head">
            <b>עובר בינארי</b>
            <span className={`pill ${limitOk ? 'ok' : 'bad'}`}>{limitOk ? 'בתוך המגבלה' : 'חריגה מהמגבלה'}</span>
          </div>
          <div className="bb-meter">
            <span>קורסים</span>
            <div className="bk-bar thin"><i className={`done ${usage.count > BINARY_MAX_COURSES ? 'over' : ''}`} style={{ width: `${Math.min(100, (usage.count / BINARY_MAX_COURSES) * 100)}%` }} /></div>
            <b>{usage.count}/{BINARY_MAX_COURSES}</b>
          </div>
          <div className="bb-meter">
            <span>נק"ז</span>
            <div className="bk-bar thin"><i className={`done ${usage.points > BINARY_MAX_POINTS ? 'over' : ''}`} style={{ width: `${Math.min(100, (usage.points / BINARY_MAX_POINTS) * 100)}%` }} /></div>
            <b>{fmtPts(usage.points)}/{BINARY_MAX_POINTS}</b>
          </div>
          <label className="toggle small">
            <select value={state.binaryRule ?? 'strict'} onChange={(e) => dispatch({ type: 'setBinaryRule', rule: e.target.value as 'strict' | 'lenient' })}>
              <option value="strict">מגבלה: גם 5 קורסים וגם 10% מהנק"ז</option>
              <option value="lenient">מגבלה: 5 קורסים או 10% מהנק"ז (המקל)</option>
            </select>
          </label>
          <p className="muted small">קורס בעובר בינארי נספר בנקודות אבל לא נכנס לממוצע. רק קורסים שסימנת כאן נספרים במכסה – "עובר" או "פטור" מהגיליון לא נחשבים אוטומטית.</p>
        </div>
        <div className="gh-legend">
          <span><ShieldCheck size={14} className="ok" /> מאומת מהגיליון</span>
          <span><PencilLine size={14} className="c-edit" /> נערך ({edits})</span>
          <span><CircleDashed size={14} className="c-unv" /> לא מאומת / צפוי ({unverified})</span>
          {edits > 0 && (
            <button className="btn ghost" onClick={() => { if (confirm('להחזיר את כל הציונים לפי הגיליון?')) dispatch({ type: 'resetToSheet' }) }}>
              <RotateCcw size={14} /> החזר הכל לגיליון
            </button>
          )}
        </div>
      </section>

      {state.semesters.map((sem) => {
        const rows = bySem.get(sem) ?? []
        if (!rows.length) return null
        const semGpa = gpa(rows, state.expected, true)
        return (
          <section key={sem} className="panel grade-sem">
            <div className="panel-head">
              <h3>{semLabel(sem)}</h3>
              <span className="muted">{fmtPts(rows.filter((i) => !isFailed(i)).reduce((a, i) => a + itemPoints(i), 0))} נק"ז{semGpa != null ? ` · ממוצע ${semGpa.toFixed(1)}` : ''}</span>
            </div>
            <table className="grade-table">
              <thead>
                <tr><th>קורס</th><th>נק"ז</th><th>מצב</th><th>ציון</th><th>עובר בינארי</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((i) => {
                  const v = verifyState(i)
                  const st = itemStatus(i, state.currentSem)
                  const future = !i.result && i.sem >= state.currentSem
                  const value = i.result?.kind === 'grade' ? i.result.grade : future ? state.expected[i.key] ?? '' : ''
                  const binary = isBinaryPass(i)
                  const mark = v.state === 'edited' ? 'edited' : v.state === 'unverified' || (future && state.expected[i.key] != null) ? 'unverified' : v.state === 'verified' ? 'verified' : null
                  return (
                    <tr key={i.key} className={`${colorClass(state.colorBy, i)} ${mark ? `m-${mark}` : ''} ${binary ? 'is-binary' : ''}`}>
                      <td>
                        <button className="link-btn name" onClick={() => ui.openCourse(i.courseId, i.key)}><i className="dot" />{itemName(i)}</button>
                        <div className="muted small mono">{i.courseId}</div>
                      </td>
                      <td>{fmtPts(itemPoints(i))}</td>
                      <td>
                        {mark === 'verified' && <span className="vchip verified"><ShieldCheck size={12} /> מאומת</span>}
                        {mark === 'edited' && <span className="vchip edited" title={`בגיליון: ${v.sheetText ?? '—'}`}><PencilLine size={12} /> נערך · בגיליון {v.sheetText ?? '—'}</span>}
                        {mark === 'unverified' && <span className="vchip unverified"><CircleDashed size={12} /> {future ? 'צפוי' : 'לא מאומת'}</span>}
                        {!mark && <span className="muted small">{future ? (st === 'current' ? 'בלימוד' : 'מתוכנן') : 'ללא ציון'}</span>}
                      </td>
                      <td>
                        {i.result?.kind === 'pass' ? <span className="badge-inline">עובר</span>
                          : i.result?.kind === 'exempt' ? <span className="badge-inline">פטור</span>
                            : (
                              <input
                                type="number" min={0} max={100} className={`grade-input ${typeof value === 'number' && value < PASS_GRADE ? 'failing' : ''}`}
                                value={value} placeholder={future ? 'צפוי' : 'ציון'}
                                onChange={(e) => setGrade(i, e.target.value)}
                                aria-label={`ציון ב${itemName(i)}`}
                              />
                            )}
                      </td>
                      <td>
                        {i.result?.kind === 'exempt' ? null : (
                          <label className="switch" title="הנקודות נספרות, הציון לא נכנס לממוצע">
                            <input type="checkbox" checked={binary} disabled={isFailed(i)} onChange={() => toggleBinary(i)} aria-label={`עובר בינארי ב${itemName(i)}`} />
                            <span />
                          </label>
                        )}
                      </td>
                      <td>
                        {mark === 'edited' && (
                          <button className="icon-btn" title="החזר לפי הגיליון" aria-label="החזר לפי הגיליון" onClick={() => dispatch({ type: 'resetToSheet', key: i.key })}>
                            <RotateCcw size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        )
      })}
    </div>
  )
}
