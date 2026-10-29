import { useMemo } from 'react'
import { fmtGpa } from '../lib/grades'
import { useStore } from '../lib/store'
import { useUi } from '../lib/ui'
import { COURSES, courseStats, dependentsOf, fmtPts, semLabel } from '../lib/catalog'
import { computeRequirements, groupsSummary, gpa, itemName, itemPoints, type Bucket } from '../lib/requirements'
import { checkPlacement, itemValidity } from '../lib/prereq'
import { GROUPS, TRACK, isFacultyElective, isLabCourse, MANDATORY_IDS } from '../data/track'
import { activeSheet } from '../lib/sheet'
import { ReserveCreditsPanel } from './ReserveCredits'
import { chainHover } from './ChainCard'
import { isFailed, itemCourseId } from '../lib/types'
import { CreditsPanel } from './CreditsPanel'
import { Layers } from 'lucide-react'
import { goTab } from './AuditView'

function Ring({ done, plan, total, size = 150 }: { done: number; plan: number; total: number; size?: number }) {
  const r = size / 2 - 12, c = 2 * Math.PI * r
  const f = (v: number) => Math.min(1, v / total) * c
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="ring">
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-bg" />
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-plan" strokeDasharray={`${f(plan)} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-done" strokeDasharray={`${f(done)} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="46%" textAnchor="middle" className="ring-val">{fmtPts(done)}</text>
      <text x="50%" y="62%" textAnchor="middle" className="ring-sub">מתוך {total}</text>
    </svg>
  )
}

function Bar({ label, done, plan, hint, cat, credit }: { label: string; done: Bucket; plan: Bucket; hint?: string; cat?: string; credit?: number }) {
  const pd = Math.min(100, (done.have / done.need) * 100)
  const pp = Math.min(100, (plan.have / plan.need) * 100)
  const complete = plan.have >= plan.need
  return (
    <div className={`bucket ${cat ? `cat-${cat}` : ''}`}>
      <div className="bk-top">
        <span className="bk-label">{label}</span>
        <span className="bk-num"><b>{fmtPts(done.have)}</b> / {fmtPts(done.need)}</span>
      </div>
      <div className="bk-bar">
        <i className="plan" style={{ width: `${pp}%` }} />
        <i className="done" style={{ width: `${pd}%` }} />
      </div>
      <div className="bk-sub">
        {complete ? <span className="ok">✓ מכוסה בתכנון</span> : <span>בתכנון: {fmtPts(plan.have)} · חסר {fmtPts(plan.need - plan.have)}</span>}
        {hint && <span className="muted"> · {hint}</span>}
      </div>
      {!!credit && (
        <div className="bk-credit">כולל קיזוז מילואים של <b>{fmtPts(credit)}</b> נק' · מקורסים נדרשים {fmtPts(Math.max(0, done.need - credit))}</div>
      )}
    </div>
  )
}

export function Requirements() {
  const { state } = useStore()
  const ui = useUi()
  const done = useMemo(() => computeRequirements(state, 'done'), [state])
  const plan = useMemo(() => computeRequirements(state, 'plan'), [state])
  const groups = useMemo(() => groupsSummary(state), [state])
  const curGpa = gpa(state.items)
  const projGpa = gpa(state.items, state.expected, true)
  const futureSems = state.semesters.filter((s) => s > state.currentSem)
  const remainingPts = Math.max(0, TRACK.totalPoints - done.total.have)

  const insights = useMemo(() => {
    const planIds = new Set(state.items.filter((i) => !isFailed(i)).map(itemCourseId).filter(Boolean) as string[])
    const nextSem = futureSems[0]
    const selectedIds = new Set(state.selectedGroups.flatMap((s) => GROUPS.find((g) => g.id === s.id)?.courses ?? []))
    const pool = Object.keys(COURSES).filter((id) => !planIds.has(id) && (isFacultyElective(id) && !MANDATORY_IDS.has(id) && !isLabCourse(id)))
    const openNext = nextSem
      ? pool
        .filter((id) => (selectedIds.size ? selectedIds.has(id) : true) && checkPlacement(state, { courseId: id, targetSem: nextSem }).ok)
        .sort((a, b) => (courseStats(b).recentAvg ?? 0) - (courseStats(a).recentAvg ?? 0))
        .slice(0, 8)
      : []
    const unlockers = pool
      .filter((id) => id.startsWith('0044') || id.startsWith('0046'))
      .map((id) => ({ id, n: dependentsOf(id).filter((d) => !planIds.has(d)).length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 8)
    const warnings: { text: string; key?: string; courseId?: string }[] = []
    for (const it of state.items) {
      const v = itemValidity(state, it)
      if (!v.ok) warnings.push({ text: `${itemName(it)} (${semLabel(it.sem)}): ${v.reasons.join(' · ')}`, key: it.key, courseId: it.courseId })
      else if (v.warnings.length && it.sem >= state.currentSem) warnings.push({ text: `${itemName(it)} (${semLabel(it.sem)}): ${v.warnings.join(' · ')}`, key: it.key, courseId: it.courseId })
    }
    for (const sem of state.semesters) {
      const items = state.items.filter((i) => i.sem === sem)
      const pts = items.filter((i) => !isFailed(i)).reduce((a, i) => a + itemPoints(i), 0)
      if (pts > 24) warnings.push({ text: `${semLabel(sem)} עמוס במיוחד: ${fmtPts(pts)} נק"ז` })
      if (sem < state.currentSem && items.some((i) => !i.result)) {
        warnings.push({ text: `${semLabel(sem)} עבר אבל יש בו קורסים בלי ציון – עדכנו מה נלמד בפועל ואת הציונים` })
      }
    }
    for (const f of state.items.filter(isFailed)) {
      if (!state.items.some((i) => i.courseId === f.courseId && i.key !== f.key && !isFailed(i))) {
        warnings.unshift({ text: `${itemName(f)}: נכשל ב${semLabel(f.sem)} ואין מועד חוזר בתכנון`, key: f.key, courseId: f.courseId })
      }
    }
    return { nextSem, openNext, unlockers, warnings }
  }, [state, futureSems])

  const selectedGroups = state.selectedGroups.map((sg) => groups.all.find((x) => x.done.group.id === sg.id)).filter((x): x is (typeof groups.all)[number] => !!x)

  return (
    <div className="reqs">
      <section className="hero">
        <Ring done={done.total.have} plan={plan.total.have} total={TRACK.totalPoints} />
        <div className="hero-stats">
          <div className="hs"><span>ממוצע מצטבר</span><b>{curGpa != null ? fmtGpa(curGpa) : '—'}</b></div>
          <div className="hs"><span>ממוצע משוער (עם ציונים צפויים)</span><b>{projGpa != null ? fmtGpa(projGpa) : '—'}</b></div>
          <div className="hs"><span>נקודות שנספרות לתואר</span><b>{fmtPts(done.total.have)}</b></div>
          <div className="hs"><span>לפי גיליון הציונים</span><b>{fmtPts(activeSheet().accumulated)}</b></div>
          <div className="hs"><span>נותרו</span><b>{fmtPts(remainingPts)}</b></div>
          <div className="hs"><span>סמסטרים עתידיים בתכנון</span><b>{futureSems.length}</b></div>
        </div>
        <div className="hero-note">
          <p className="muted small">גיליון הציונים מ-{activeSheet().issued.split('-').reverse().join('.')} · ממוצע בגיליון {activeSheet().gpa}</p>
        </div>
      </section>

      <section className="buckets">
        <Bar label="מקצועות חובה" done={done.mandatory} plan={plan.mandatory} hint="כולל 3 נק' מעבדות" cat="mandatory" />
        <Bar label="בחירה פקולטית" done={done.faculty} plan={plan.faculty} hint="0044/0046 וקבוצות ההתמחות" cat="faculty" credit={done.socialCredit.faculty} />
        <Bar label="בחירה כלל-טכניונית" done={done.general} plan={plan.general} cat="free" credit={done.socialCredit.free + done.socialCredit.enrichment} />
        <Bar label="העשרה (מל&quot;ג)" done={done.enrichment} plan={plan.enrichment} hint="חלק מהכלל-טכניונית" cat="enrichment" credit={done.socialCredit.enrichment} />
        <Bar label="חינוך גופני" done={done.sport} plan={plan.sport} hint="חלק מהכלל-טכניונית" cat="sport" />
        <Bar label="מעבדות" done={done.labs} plan={plan.labs} hint="עד 4 נק', הרביעית כבחירה פקולטית" cat="lab" />
      </section>

      <ReserveCreditsPanel />

      {done.remainingMandatory.length > 0 && (
        <section className="panel">
          <h3>חובה שעוד לא הושלמה ({done.remainingMandatory.length})</h3>
          <div className="alt-chips">
            {done.remainingMandatory.map((m) => {
              const it = state.items.find((i) => !isFailed(i) && (i.courseId === m.id || m.alternatives?.includes(i.courseId ?? '')))
              return (
                <button key={m.id} className={`cchip ${it ? 'plan' : 'missing'}`} onClick={() => ui.openCourse(m.id, it?.key)}>
                  {COURSES[m.id]?.name ?? m.id}{it ? ` · ${semLabel(it.sem)}` : ' · לא בתכנון'}
                </button>
              )
            })}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h3>קבוצות התמחות (שרשראות)</h3>
          <span className={`pill ${groups.completedPlan >= groups.need ? 'ok' : ''}`}>
            הושלמו {groups.completedDone} · בתכנון {groups.completedPlan} מתוך {groups.need} נדרשות
          </span>
        </div>
        {selectedGroups.length === 0 ? (
          <p className="muted">עוד לא נבחרו שרשראות. צריך לפחות 3 קבוצות (קבוצה כפולה נספרת כשתיים).</p>
        ) : (
          <div className="group-sum">
            {selectedGroups.map(({ done: gd, plan: gp }) => {
              const g = gd.group
              const idx = state.selectedGroups.findIndex((s) => s.id === g.id)
              const sel = state.selectedGroups[idx]
              return (
                <div key={g.id} className={`gs-row c${idx + 1} ${gp.complete ? 'complete' : ''}`} tabIndex={0} {...chainHover(g.id)}>
                  <span className={`chain-dot c${idx + 1}`}>{idx + 1}</span>
                  <b className="gs-name">{g.name}{sel?.double ? ' – כפולה' : ''}</b>
                  <div className="bk-bar thin">
                    <i className="plan" style={{ width: `${Math.min(100, (gp.count / gp.need) * 100)}%` }} />
                    <i className="done" style={{ width: `${Math.min(100, (gd.count / gd.need) * 100)}%` }} />
                  </div>
                  <span className="gs-count">{gd.count} הושלמו · {gp.count} בתכנון · נדרשים {gp.need}</span>
                  <span className={`pill ${gp.complete ? 'ok' : ''}`}>{gp.complete ? '✓ התכנון משלים' : 'חסר בתכנון'}</span>
                </div>
              )
            })}
          </div>
        )}
        <button className="btn ghost" onClick={() => goTab('chains')}><Layers size={15} aria-hidden /> {selectedGroups.length ? 'לפירוט, החלפה והשוואה' : 'לבחירת שרשראות'}</button>
      </section>

      <section className="panel insights">
        <h3>המלצות ותובנות</h3>
        <div className="ins-grid">
          <div className="ins">
            <h4>פתוח לשיבוץ ב{insights.nextSem ? semLabel(insights.nextSem) : 'סמסטר הבא'}</h4>
            <p className="muted small">{state.selectedGroups.length ? 'מתוך הקבוצות שבחרת, ממוין לפי ממוצע' : 'בחירה פקולטית, ממוין לפי ממוצע (בחרו קבוצות כדי למקד)'}</p>
            <div className="alt-chips">
              {insights.openNext.map((id) => (
                <button key={id} className="cchip neutral" onClick={() => ui.openCourse(id)}>
                  {COURSES[id].name}{courseStats(id).recentAvg != null ? ` · ${Math.round(courseStats(id).recentAvg!)}` : ''}
                </button>
              ))}
              {insights.openNext.length === 0 && <span className="muted">אין כרגע</span>}
            </div>
          </div>
          <div className="ins">
            <h4>קורסים שפותחים הכי הרבה המשך</h4>
            <p className="muted small">לוקחים אותם מוקדם – ויש יותר אפשרויות בהמשך</p>
            <div className="alt-chips">
              {insights.unlockers.map((x) => (
                <button key={x.id} className="cchip neutral" onClick={() => ui.openCourse(x.id)}>{COURSES[x.id].name} · פותח {x.n}</button>
              ))}
            </div>
          </div>
          <div className="ins wide">
            <h4>דברים שכדאי לבדוק ({insights.warnings.length})</h4>
            {insights.warnings.length === 0 ? <p className="ok">הכל תקין בתכנון</p> : (
              <ul className="warn-list">
                {insights.warnings.slice(0, 14).map((w, i) => (
                  <li key={i}>
                    {w.courseId ? <button className="link-btn" onClick={() => ui.openCourse(w.courseId, w.key)}>{w.text}</button> : w.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <CreditsPanel />
    </div>
  )
}
