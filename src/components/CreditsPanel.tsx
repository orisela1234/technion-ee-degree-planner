import { useStore } from '../lib/store'
import { useUi } from '../lib/ui'
import { CATEGORY_LABEL, fmtPts, semLabel, type Category } from '../lib/catalog'
import { itemName, itemPoints } from '../lib/requirements'
import { isReserveShortening, isSocialCredit, reserveOptions } from '../lib/sheet'

const KIND_LABEL = { 'exempt-credit': 'פטור עם ניקוד', 'exempt-nocredit': 'פטור ללא ניקוד', pass: 'עובר' }

/** הסקטור של פטורים וזיכויים – נצברים בנקודות אבל לא חלק מהתרשים */
export function CreditsPanel() {
  const { state, dispatch } = useStore()
  const ui = useUi()
  const exemptInChart = state.items.filter((i) => i.result?.kind === 'exempt')
  const total = state.credits.reduce((a, c) => a + c.points, 0) + exemptInChart.reduce((a, i) => a + itemPoints(i), 0)

  return (
    <section className="credits">
      <div className="credits-head">
        <h3>פטורים וזיכויים</h3>
        <span className="muted">מחוץ לתרשים · {fmtPts(total)} נק"ז</span>
      </div>
      <div className="credit-grid">
        {exemptInChart.map((i) => (
          <button key={i.key} className="credit in-chart" onClick={() => ui.openCourse(i.courseId, i.key)}>
            <div className="cr-top"><span className="mono">{i.courseId}</span><b>{fmtPts(itemPoints(i))}</b></div>
            <div className="cr-name">{itemName(i)}</div>
            <div className="cr-foot"><span className="badge exempt">פטור עם ניקוד</span><span className="muted small">מופיע גם בתרשים · {semLabel(i.sem)}</span></div>
          </button>
        ))}
        {state.credits.map((c) => (
          <div key={c.key} className={`credit ${c.points === 0 ? 'zero' : ''}`}>
            <div className="cr-top"><span className="mono">{c.id}</span><b>{fmtPts(c.points)}</b></div>
            <div className="cr-name">{c.name}{isSocialCredit(c.id) && <small className="muted"> · {isReserveShortening(c.id) ? 'קיצור תואר – מילואים' : 'זיכוי פעילות/מילואים'}</small>}</div>
            <div className="cr-foot">
              <span className={`badge ${c.kind === 'pass' ? 'pass' : 'exempt'}`}>{KIND_LABEL[c.kind]}</span>
              {c.points > 0 && (
                <select
                  value={c.category}
                  onChange={(e) => dispatch({ type: 'setCreditCategory', key: c.key, category: e.target.value as Category })}
                  title="לאיזו דרישה הנקודות נספרות"
                >
                  {(isSocialCredit(c.id) ? reserveOptions(c.id) : (['free', 'enrichment', 'sport', 'faculty'] as Category[])).map((k) => (
                    <option key={k} value={k}>{CATEGORY_LABEL[k]}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
