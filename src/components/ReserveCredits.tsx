import { useMemo } from 'react'
import { CheckCircle2, ShieldCheck, Sparkles } from 'lucide-react'
import { useStore } from '../lib/store'
import { CATEGORY_TITLE, fmtPts, type Category } from '../lib/catalog'
import { computeRequirements, graduationGap } from '../lib/requirements'
import { isReserveShortening, isSocialCredit, reserveOptions } from '../lib/sheet'
import { TRACK } from '../data/track'
import type { AppState, Credit } from '../lib/types'

const NEED: Partial<Record<Category, number>> = {
  faculty: TRACK.facultyElectivePoints,
  enrichment: TRACK.enrichmentPoints,
  free: TRACK.generalPoints - TRACK.enrichmentPoints - TRACK.sportPoints,
}
const SHORT: Partial<Record<Category, string>> = { faculty: 'בחירה פקולטית', enrichment: 'מל"ג', free: 'כלל-טכניונית' }

const catOf = (c: Credit): Category => (c.category === 'faculty' || c.category === 'enrichment' ? c.category : 'free')

/** כל השיוכים האפשריים של שורות המילואים, והטוב ביותר לפי התכנון: הכי מעט נקודות חסרות, בלי עודף */
function bestAllocation(state: AppState, lines: Credit[]) {
  let best: { cats: Category[]; missing: number; surplus: number; defaults: number } | null = null
  const n = lines.length
  for (let mask = 0; mask < 1 << n; mask++) {
    const cats = lines.map((c, i) => reserveOptions(c.id)[(mask >> i) & 1])
    const credits = state.credits.map((c) => {
      const i = lines.indexOf(c)
      return i >= 0 ? { ...c, category: cats[i] } : c
    })
    const g = graduationGap(computeRequirements({ ...state, credits }, 'plan'))
    // שוויון: מעדיפים את ברירת המחדל (קיצור → פקולטית, פעילות → מל"ג)
    const defaults = cats.filter((x, i) => x === reserveOptions(lines[i].id)[0]).length
    if (!best || g.missing < best.missing - 1e-9 || (Math.abs(g.missing - best.missing) < 1e-9 && (g.surplus < best.surplus - 1e-9 || (Math.abs(g.surplus - best.surplus) < 1e-9 && defaults > best.defaults)))) {
      best = { cats, missing: g.missing, surplus: g.surplus, defaults }
    }
  }
  return best
}

/** נקודות המילואים/פעילות חברתית: לאן כל שורה נספרת, מה זה מקזז, ומה נשאר – עם אפשרות לשנות ולראות מיד את ההשפעה */
export function ReserveCreditsPanel() {
  const { state, dispatch } = useStore()
  const lines = useMemo(() => state.credits.filter((c) => isSocialCredit(c.id) && c.points > 0).sort((a, b) => b.points - a.points), [state.credits])
  const now = useMemo(() => graduationGap(computeRequirements(state, 'plan')), [state])
  const best = useMemo(() => (lines.length ? bestAllocation(state, lines) : null), [state, lines])
  if (!lines.length) return null

  const total = lines.reduce((a, c) => a + c.points, 0)
  const sums = (['faculty', 'enrichment', 'free'] as Category[]).map((cat) => ({ cat, pts: lines.filter((c) => catOf(c) === cat).reduce((a, c) => a + c.points, 0) }))
  const isBest = !!best && best.cats.every((cat, i) => catOf(lines[i]) === cat)
  const better = !!best && !isBest && (best.missing < now.missing - 1e-9 || best.surplus < now.surplus - 1e-9)
  const applyBest = () => best && dispatch({
    type: 'batch',
    actions: lines.map((c, i) => ({ type: 'setCreditCategory' as const, key: c.key, category: best.cats[i] })),
  })

  return (
    <section className="panel reserve-panel">
      <div className="panel-head">
        <h3><ShieldCheck size={16} aria-hidden /> קיזוז מילואים ופעילות חברתית</h3>
        <span className="muted small">{fmtPts(total)} נק"ז מהגיליון · נספרות בסך התואר ומקטינות את מה שצריך להשלים בקורסים</span>
      </div>

      <div className="reserve-lines">
        {lines.map((c) => (
          <div key={c.key} className={`reserve-line cat-${catOf(c)}`}>
            <span className="rl-name">
              <span className="mono">{c.id}</span> {c.name} · <b>{fmtPts(c.points)} נק'</b>
              <small className="muted">{isReserveShortening(c.id) ? 'קיצור תואר – מתווה המילואים' : 'זיכוי פעילות חברתית / מילואים'}</small>
            </span>
            <span className="seg small" role="radiogroup" aria-label={`לאן נספרות ${fmtPts(c.points)} הנקודות של ${c.name}`}>
              {reserveOptions(c.id).map((cat) => (
                <button
                  key={cat} role="radio" aria-checked={catOf(c) === cat} className={`${catOf(c) === cat ? 'on' : ''} cat-${cat}`}
                  onClick={() => dispatch({ type: 'setCreditCategory', key: c.key, category: cat })}
                >{SHORT[cat]}</button>
              ))}
            </span>
          </div>
        ))}
      </div>

      <div className="reserve-sums">
        {sums.filter((x) => x.pts > 0).map(({ cat, pts }) => (
          <div key={cat} className={`reserve-sum cat-${cat}`}>
            <span className="cat-chip">{CATEGORY_TITLE[cat]}{cat === 'free' ? ' (חופשי)' : ''}</span>
            <b>−{fmtPts(pts)} נק'</b>
            {NEED[cat] != null && (
              <span>מתוך {fmtPts(NEED[cat]!)} נשארו <b>{fmtPts(Math.max(0, NEED[cat]! - pts))}</b> להשלים בקורסים
                {pts > NEED[cat]! && <em className="over"> · {fmtPts(pts - NEED[cat]!)} עודפות</em>}</span>
            )}
          </div>
        ))}
      </div>

      <div className={`reserve-verdict ${now.surplus > 0 ? 'warn' : 'ok'}`}>
        {now.surplus > 0
          ? <>לפי התכנון: חסרות עוד <b>{fmtPts(now.missing)}</b> נק' לתואר, והוא ייסגר על {fmtPts(now.finalTotal)} – <b>{fmtPts(now.surplus)} נק' עודפות</b> מעבר ל-{fmtPts(TRACK.totalPoints)}.</>
          : <><CheckCircle2 size={15} aria-hidden /> לפי התכנון: חסרות עוד <b>{fmtPts(now.missing)}</b> נק' לתואר, והוא ייסגר בדיוק על {fmtPts(TRACK.totalPoints)} – אין נקודות מבוזבזות.</>}
      </div>

      {better && best && (
        <div className="reserve-suggest">
          <Sparkles size={15} aria-hidden />
          <span>
            הכי חסכוני לפי התכנון שלך: {lines.map((c, i) => `${c.name} → ${SHORT[best.cats[i]]}`).join(' · ')}.
            {' '}חסרות אז {fmtPts(best.missing)} נק'{best.surplus > 0 ? ` (${fmtPts(best.surplus)} עודפות)` : ' ובלי עודף'}.
          </span>
          <button className="btn" onClick={applyBest}>החל</button>
        </div>
      )}

      <ul className="reserve-notes">
        <li>ברירת מחדל: קיצור התואר (מתווה המילואים) נספר כבחירה פקולטית, וזיכוי הפעילות החברתית – כמל"ג. לפי הבירור מול הפקולטה אפשר גם כלל-טכניונית – כדאי לוודא מול מזכירות הפקולטה שלך.</li>
        <li>נקודות שנספרות כבחירה פקולטית <b>לא פוטרות מ-3 קבוצות ההתמחות</b> – את השרשראות משלימים בקורסים (מכתב דיקן לימודי הסמכה, 13.11.2023).</li>
      </ul>
    </section>
  )
}
