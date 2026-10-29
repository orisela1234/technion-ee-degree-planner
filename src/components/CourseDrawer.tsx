import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useStore } from '../lib/store'
import { useUi } from '../lib/ui'
import { usePlanActions } from '../lib/actions'
import {
  COURSES, CATEGORY_LABEL, HUE_LABEL, cheeseForkUrl, courseStats, dependentsOf, difficultyOf, fmtPts, groupsOf,
  histogramsUrl, hueOf, noCreditWith, englishSems, lecturersOf, offeredSeasons, semLabel, staffHistory, workloadOf, SEASON_HE, HIST,
  type Category, type Season,
} from '../lib/catalog'
import { checkPlacement, evalPrereq, idsBefore, idsIn, prereqAlternatives } from '../lib/prereq'
import { colorClass, itemCategory } from '../lib/requirements'
import { itemStatus, STATUS_LABEL, isDone, isFailed } from '../lib/types'
import { MANDATORY_IDS } from '../data/track'
import { AvgChart } from './AvgChart'
import { ReviewsPanel, ReviewStrip } from './ReviewsPanel'
import { hasReviewData, reviewsOf } from '../lib/reviews'
import { BarChart3, BookOpen, CalendarClock, ChevronDown, CircleDashed, ExternalLink, GitBranch, Layers, MessageSquare, PencilLine, RotateCcw, ShieldCheck, X } from 'lucide-react'
import { canMarkBinary, isBinaryPass, verifyState } from '../lib/grades'

function Section({ title, icon, children, defaultOpen = false, badge }: {
  title: string; icon: ReactNode; children: ReactNode; defaultOpen?: boolean; badge?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`acc ${open ? 'open' : ''}`}>
      <button className="acc-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="acc-icon">{icon}</span>
        <span className="acc-title">{title}</span>
        {badge}
        <ChevronDown className="acc-chev" size={16} />
      </button>
      {open && <div className="acc-body">{children}</div>}
    </div>
  )
}

export function CourseDrawer() {
  const ui = useUi()
  const { state, dispatch } = useStore()
  const { place, remove } = usePlanActions()
  const sel = ui.selected
  const courseId = sel?.courseId
  const course = courseId ? COURSES[courseId] : undefined
  const item = sel?.itemKey
    ? state.items.find((i) => i.key === sel.itemKey)
    : state.items.find((i) => i.courseId === courseId && !isFailed(i)) ?? state.items.find((i) => i.courseId === courseId)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && ui.closeCourse()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ui])

  const futureSems = state.semesters
  const placements = useMemo(() => {
    if (!courseId) return []
    return futureSems.map((sem) => ({
      sem,
      check: checkPlacement(state, { itemKey: item?.key, courseId: item ? undefined : courseId, targetSem: sem }),
    }))
  }, [state, courseId, item, futureSems])

  if (!sel || !courseId) return null

  const stats = courseStats(courseId)
  const diff = difficultyOf(courseId)
  const work = workloadOf(courseId)
  const groups = groupsOf(courseId)
  const seasons = offeredSeasons(courseId)
  const hue = hueOf(courseId)
  const status = item ? itemStatus(item, state.currentSem) : null
  const refSem = item?.sem ?? placements.find((p) => p.check.ok && p.sem >= state.currentSem)?.sem ?? state.currentSem
  const before = idsBefore(state.items, refSem, item?.key, state.credits.map((c) => c.id))
  const same = idsIn(state.items, refSem, item?.key)
  const pre = evalPrereq(courseId, before, same)
  const alts = prereqAlternatives(courseId)
  // חלופות שמתקיימות קודם, אחר כך חלופות שכל הקורסים בהן עדיין קיימים; חלופות עם מספרים ישנים מוסתרות
  const hasPre = (id: string) => before.has(id) || id.startsWith('0103') || id.startsWith('0113')
  const rankedAlts = alts
    .map((alt) => ({ alt, ok: alt.every(hasPre), known: alt.every((id) => COURSES[id]), missing: alt.filter((id) => !hasPre(id)).length }))
    .sort((a, b) => Number(b.ok) - Number(a.ok) || Number(b.known) - Number(a.known) || a.missing - b.missing)
  const visibleAlts = rankedAlts.filter((a) => a.ok || a.known).slice(0, 6)
  if (visibleAlts.length === 0) visibleAlts.push(...rankedAlts.slice(0, 3))
  const hiddenAlts = alts.length - visibleAlts.length
  const doneIds = new Set(state.items.filter(isDone).map((i) => i.courseId))
  const planIds = new Set(state.items.filter((i) => !isFailed(i)).map((i) => i.courseId))
  const attempts = state.items.filter((i) => i.courseId === courseId && i.key !== item?.key && i.result?.kind === 'grade')
  const retake = item && isFailed(item) ? state.items.find((i) => i.courseId === courseId && i.key !== item.key && !isFailed(i)) : undefined
  const deps = dependentsOf(courseId).filter((id) => COURSES[id])
  const lecturers = lecturersOf(courseId)
  const history = staffHistory(courseId)
  const hist = HIST[courseId] ?? []

  const chip = (id: string) => {
    const cls = doneIds.has(id) || state.credits.some((c) => c.id === id) ? 'done' : before.has(id) ? 'plan' : planIds.has(id) ? 'later' : 'missing'
    return (
      <button key={id} className={`cchip ${cls}`} onClick={() => COURSES[id] && ui.openCourse(id)} title={id}>
        {COURSES[id]?.name ?? id}
      </button>
    )
  }

  const scheduleByType = new Map<string, { d: string; h: string; l: string; r: string; groups: number[] }[]>()
  for (const s of course?.schedule ?? []) {
    const arr = scheduleByType.get(s.t) ?? []
    const found = arr.find((x) => x.d === s.d && x.h === s.h && x.l === s.l)
    if (found) { if (!found.groups.includes(s.g)) found.groups.push(s.g) }
    else arr.push({ d: s.d, h: s.h, l: s.l, r: s.r, groups: [s.g] })
    scheduleByType.set(s.t, arr)
  }

  const category: Category = item ? itemCategory(item) : (MANDATORY_IDS.has(courseId) ? 'mandatory' : 'faculty')

  return (
    <>
      <div className="drawer-backdrop" onClick={ui.closeCourse} />
      <aside className={`drawer ${colorClass(state.colorBy, item, courseId)}`} role="dialog" aria-label={course?.name ?? courseId}>
        <header className="drawer-head">
          <div className="dh-top">
            <span className="mono">{courseId}</span>
            <span className="dh-fac">{HUE_LABEL[hue]}</span>
            <button className="icon-btn" onClick={ui.closeCourse} aria-label="סגירה"><X size={18} /></button>
          </div>
          <h2>{course?.name ?? item?.name ?? courseId}</h2>
          <div className="dh-tags">
            <span className="tag">{fmtPts(course?.points ?? item?.points ?? 0)} נק"ז</span>
            <span className="tag">{CATEGORY_LABEL[category]}</span>
            {groups.map((g) => <span key={g.id} className="tag g">קבוצה {g.id}: {g.short}</span>)}
            {status && <span className={`tag st-${status}`}>{STATUS_LABEL[status]}{item?.sem ? ` · ${semLabel(item.sem)}` : ''}</span>}
          </div>
        </header>

        <div className="drawer-body">
          <div className="tiles">
            <div className="tile">
              <div className="t-label">ממוצע סופי אחרון</div>
              <div className="t-val">{stats.recentAvg != null ? Math.round(stats.recentAvg) : '—'}</div>
              <div className="t-sub">{stats.semesters ? `לפי ${Math.min(3, stats.semesters)} סמסטרים` : 'אין נתונים'}</div>
            </div>
            <div className="tile">
              <div className="t-label">אחוז עוברים</div>
              <div className="t-val">{stats.recentPass != null ? `${Math.round(stats.recentPass)}%` : '—'}</div>
              <div className="t-sub">ציון סופי</div>
            </div>
            <div className="tile">
              <div className="t-label">שעות שבועיות</div>
              <div className="t-val">{work ? `${work.hours}ש'` : '—'}</div>
              <div className="t-sub">{work ? work.label : ''}</div>
            </div>
            <div className="tile">
              <div className="t-label" title="לפי ממוצעי הציונים ואחוזי המעבר, ביחס לשאר קורסי הפקולטה">קושי משוער</div>
              <div className="t-val">{diff ? diff.label : '—'}</div>
              {diff && <div className="meter"><i style={{ width: `${(diff.score / 5) * 100}%` }} className={`d${Math.round(diff.score)}`} /></div>}
            </div>
          </div>
          <ReviewStrip courseId={courseId} />

          {/* שיבוץ ומצב */}
          {item && isFailed(item) && (
            <div className="fail-box">
              <b>נכשל בציון {item.result?.kind === 'grade' ? item.result.grade : ''}</b> ב{semLabel(item.sem)}. הקורס לא מקנה נקודות ולא נחשב כקדם עד שעוברים אותו.
              {retake
                ? <> מועד חוזר מתוכנן ל<button className="link-btn" onClick={() => ui.openCourse(courseId, retake.key)}>{semLabel(retake.sem)}</button>.</>
                : <div className="sem-buttons" style={{ marginTop: 8 }}>{placements.filter((p) => p.sem >= state.currentSem).slice(0, 4).map((p) => (
                    <button key={p.sem} className={`sem-btn ${p.check.ok ? 'ok' : 'bad'}`} onClick={() => place({ courseId, sem: p.sem })}>+ מועד חוזר ב{semLabel(p.sem)}</button>
                  ))}</div>}
            </div>
          )}
          {attempts.length > 0 && !isFailed(item ?? { key: '', sem: '' }) && (
            <div className="muted small">ניסיונות קודמים: {attempts.map((a) => `${a.result?.kind === 'grade' ? a.result.grade : ''} (${semLabel(a.sem)})`).join(', ')} · הציון האחרון הוא הקובע בממוצע</div>
          )}
          <div className="plan-box">
            {item ? (
              <>
                {item.waived && (
                  <div className="waiver-note">
                    <b>שובץ באישור חריג</b> – בלי הקדם{!pre.ok ? `: ${pre.missing.map((id) => COURSES[id]?.name ?? id).join(', ')}` : ' (הקדם כבר מתקיים)'}
                    <button className="link-btn small" onClick={() => dispatch({ type: 'setWaived', key: item.key, waived: false })}>בטל סימון</button>
                  </div>
                )}
                <div className="pb-row">
                  <label>סמסטר</label>
                  <select value={item.sem} onChange={(e) => place({ itemKey: item.key, sem: e.target.value })}>
                    {placements.map((p) => (
                      <option key={p.sem} value={p.sem}>
                        {p.check.ok ? '' : '✕ '}{semLabel(p.sem)}
                      </option>
                    ))}
                  </select>
                  <button className="btn danger ghost" onClick={() => { if (remove(item.key)) ui.closeCourse() }}>הוצא מהתכנון</button>
                </div>
                <div className="pb-row">
                  <label>מצב</label>
                  <div className="seg">
                    <button className={!item.result ? 'on' : ''} onClick={() => dispatch({ type: 'setResult', key: item.key })}>
                      {item.sem > state.currentSem ? 'מתוכנן' : item.sem === state.currentSem ? 'בלימוד' : 'ללא ציון'}
                    </button>
                    <button className={item.result?.kind === 'grade' ? 'on' : ''} onClick={() => dispatch({ type: 'setResult', key: item.key, result: { kind: 'grade', grade: item.result?.kind === 'grade' ? item.result.grade : 85 } })}>ציון</button>
                    <button className={item.result?.kind === 'pass' ? 'on' : ''} onClick={() => dispatch({ type: 'setResult', key: item.key, result: { kind: 'pass' } })}>עובר</button>
                    <button className={item.result?.kind === 'exempt' ? 'on' : ''} onClick={() => dispatch({ type: 'setResult', key: item.key, result: { kind: 'exempt' } })}>פטור</button>
                  </div>
                  {item.result?.kind === 'grade' && (
                    <input
                      type="number" min={0} max={100} className="grade-input" value={item.result.grade}
                      onChange={(e) => dispatch({ type: 'setResult', key: item.key, result: { kind: 'grade', grade: Math.max(0, Math.min(100, Number(e.target.value))) } })}
                    />
                  )}
                  {!item.result && (
                    <input
                      type="number" min={0} max={100} className="grade-input" placeholder="ציון צפוי"
                      value={state.expected[item.key] ?? ''}
                      onChange={(e) => dispatch({ type: 'setExpected', key: item.key, grade: e.target.value === '' ? undefined : Number(e.target.value) })}
                      title="ציון צפוי – משמש לחישוב ממוצע משוער"
                    />
                  )}
                </div>
                {(() => {
                  const v = verifyState(item)
                  const binary = isBinaryPass(item)
                  return (
                    <div className="pb-row">
                      <label>אימות</label>
                      {v.state === 'verified' && <span className="vchip verified"><ShieldCheck size={12} /> מאומת מהגיליון</span>}
                      {v.state === 'edited' && (
                        <>
                          <span className="vchip edited"><PencilLine size={12} /> נערך · בגיליון {v.sheetText ?? '—'}</span>
                          <button className="link-btn small" onClick={() => dispatch({ type: 'resetToSheet', key: item.key })}><RotateCcw size={12} /> החזר</button>
                        </>
                      )}
                      {(v.state === 'unverified' || (v.state === 'none' && state.expected[item.key] != null)) && <span className="vchip unverified"><CircleDashed size={12} /> לא מאומת</span>}
                      {v.state === 'none' && state.expected[item.key] == null && <span className="muted small">עוד אין ציון</span>}
                      {item.result?.kind !== 'exempt' && !isFailed(item) && (
                        <label className="toggle small" title="הנקודות נספרות, הציון לא נכנס לממוצע">
                          <input
                            type="checkbox" checked={binary}
                            onChange={(e) => {
                              if (e.target.checked) {
                                const chk = canMarkBinary(state, item)
                                if (!chk.ok) { ui.toast('אי אפשר לסמן עובר בינארי', 'error', [chk.reason!]); return }
                              }
                              dispatch({ type: 'setBinary', key: item.key, binary: e.target.checked })
                            }}
                          />
                          עובר בינארי
                        </label>
                      )}
                    </div>
                  )
                })()}
                <div className="pb-row">
                  <label>נספר כ</label>
                  <select value={item.category ?? ''} onChange={(e) => dispatch({ type: 'setCategory', key: item.key, category: (e.target.value || undefined) as Category | undefined })}>
                    <option value="">אוטומטי ({CATEGORY_LABEL[itemCategory({ ...item, category: undefined })]})</option>
                    {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                  </select>
                </div>
              </>
            ) : (
              <>
                <div className="pb-title">הוספה לתכנון</div>
                <div className="sem-buttons">
                  {placements.filter((p) => p.sem >= state.currentSem).map((p) => (
                    <button
                      key={p.sem}
                      className={`sem-btn ${p.check.ok ? (p.check.warnings.length ? 'warn' : 'ok') : 'bad'}`}
                      title={[...p.check.reasons, ...p.check.warnings].join('\n')}
                      onClick={() => place({ courseId, sem: p.sem })}
                    >
                      {p.check.ok ? '✓' : '✕'} {semLabel(p.sem)}
                    </button>
                  ))}
                </div>
                {!pre.ok && <div className="muted small">חסרים קדמים: {pre.missing.map((id) => COURSES[id]?.name ?? id).join(', ')}</div>}
              </>
            )}
          </div>

          <Section title="על הקורס" icon={<BookOpen size={16} />} defaultOpen>
            <p className="syllabus">{course?.syllabus ?? 'אין תיאור זמין.'}</p>
            <div className="facts">
              <div><span>פקולטה</span>{course?.faculty ?? '—'}</div>
              <div><span>נלמד בסמסטרי</span>{seasons.size ? [...seasons].map((s: Season) => SEASON_HE[s]).join(', ') : 'לא נפתח בשנתיים האחרונות'}</div>
              {englishSems(courseId).length > 0 && (
                <div><span>נלמד באנגלית</span>{englishSems(courseId).map((s) => (s === '*' ? 'תמיד' : semLabel(s))).join(', ')} · נספר לחובת 2 הקורסים באנגלית</div>
              )}
              {work && <div><span>שעות שבועיות</span>{work.breakdown}{work.hasLab ? ' · כולל נוכחות במעבדה' : ''}</div>}
              {course?.exams && (
                <div><span>בחינות ({semLabel(course.examsSem ?? '')})</span>
                  {course.exams.examA && `מועד א' ${course.exams.examA}`}{course.exams.examB && ` · מועד ב' ${course.exams.examB}`}
                </div>
              )}
            </div>
          </Section>

          <Section
            title="דרישות קדם וצמודים" icon={<GitBranch size={16} />} defaultOpen
            badge={<span className={`pill ${pre.ok && pre.coreqOk ? 'ok' : 'bad'}`}>{pre.ok && pre.coreqOk ? 'מתקיים' : 'חסר'}</span>}
          >
            {alts.length === 0 && !course?.coreq?.length && <p className="muted">אין דרישות קדם.</p>}
            {alts.length > 0 && (
              <>
                <div className="sub-h">צריך אחת מהחלופות{item ? ` (נבדק ל${semLabel(refSem)})` : ''}:</div>
                <div className="alts">
                  {visibleAlts.map(({ alt, ok: okAlt }, i) => (
                    <div key={i} className={`alt ${okAlt ? 'ok' : ''} ${alt === pre.best ? 'best' : ''}`}>
                      <span className="alt-n">{okAlt ? '✓' : i + 1}</span>
                      <div className="alt-chips">{alt.map(chip)}</div>
                    </div>
                  ))}
                  {hiddenAlts > 0 && <div className="muted small">ועוד {hiddenAlts} חלופות עם מספרי קורס ישנים שכבר לא נלמדים</div>}
                </div>
              </>
            )}
            {!!course?.coreq?.length && (
              <>
                <div className="sub-h">צמודים – אחד מהם לפני או באותו סמסטר:</div>
                <div className="alt-chips">{course.coreq.map(chip)}</div>
              </>
            )}
            <div className="chip-legend">
              <span className="cchip done">הושלם</span><span className="cchip plan">מתוכנן לפני</span>
              <span className="cchip later">מתוכנן מאוחר מדי</span><span className="cchip missing">לא בתכנון</span>
            </div>
            {deps.length > 0 && (
              <>
                <div className="sub-h">הקורס הזה פותח את ({deps.length}):</div>
                <div className="alt-chips">{deps.slice(0, 30).map((id) => (
                  <button key={id} className={`cchip ${planIds.has(id) ? 'plan' : 'neutral'}`} onClick={() => ui.openCourse(id)}>{COURSES[id].name}</button>
                ))}</div>
              </>
            )}
            {noCreditWith(courseId).length > 0 && (
              <>
                <div className="sub-h">ללא זיכוי נוסף עם:</div>
                <div className="alt-chips">{noCreditWith(courseId).map((id) => (
                  <button key={id} className={`cchip ${planIds.has(id) ? 'missing' : 'neutral'}`} onClick={() => COURSES[id] && ui.openCourse(id)}>{COURSES[id]?.name ?? id}</button>
                ))}</div>
              </>
            )}
          </Section>

          <Section title="מרצים ומערכת שעות" icon={<CalendarClock size={16} />} badge={lecturers.length ? <span className="pill">{lecturers[0]}</span> : undefined}>
            {course?.scheduleSem ? (
              <>
                <div className="sub-h">מערכת {semLabel(course.scheduleSem)}</div>
                {[...scheduleByType.entries()].map(([type, rows]) => (
                  <div key={type} className="sched-block">
                    <div className="sched-type">{type}</div>
                    <table className="sched">
                      <tbody>
                        {rows.slice(0, 12).map((r, i) => (
                          <tr key={i}>
                            <td>{r.d}</td>
                            <td className="mono">{r.h}</td>
                            <td>{r.l || '—'}</td>
                            <td className="muted small">קב' {r.groups.sort((a, b) => a - b).join(', ')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {rows.length > 12 && <div className="muted small">ועוד {rows.length - 12} מפגשים</div>}
                  </div>
                ))}
              </>
            ) : <p className="muted">אין מערכת שעות בסמסטרים האחרונים.</p>}
            {course?.staff && <div className="facts"><div><span>אחראי/ת</span>{course.staff}</div></div>}
            {history.length > 0 && (
              <>
                <div className="sub-h">מי לימד לאורך השנים</div>
                <table className="sched">
                  <tbody>
                    {history.slice(0, 8).map((h) => (
                      <tr key={h.sem}><td>{semLabel(h.sem)}</td><td>{h.lecturers.join(', ')}</td></tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Section>

          <Section title="ממוצעים לאורך השנים" icon={<BarChart3 size={16} />} defaultOpen={stats.trend.length > 0}>
            {stats.trend.length ? (
              <>
                <AvgChart trend={stats.trend} />
                <table className="sched stats">
                  <thead><tr><th>סמסטר</th><th>ממוצע</th><th>חציון</th><th>עוברים</th><th>נבחנים</th><th>מבחן א'</th></tr></thead>
                  <tbody>
                    {hist.filter((h) => h.fin || h.fa).slice(0, 10).map((h) => {
                      const f = h.fin ?? h.fa!
                      return (
                        <tr key={h.sem}>
                          <td>{semLabel(h.sem)}</td>
                          <td><b>{f.avg != null ? f.avg.toFixed(1) : '—'}</b></td>
                          <td>{f.med ?? '—'}</td>
                          <td>{f.pass != null ? `${f.pass}%` : '—'}</td>
                          <td>{f.n ?? '—'}</td>
                          <td className="muted">{h.ea?.avg != null ? h.ea.avg.toFixed(0) : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <a className="ext" href={histogramsUrl(courseId)} target="_blank" rel="noopener">היסטוגרמות מלאות ↗</a>
              </>
            ) : <p className="muted">אין נתוני ציונים פומביים לקורס הזה.</p>}
          </Section>

          {groups.length > 0 && (
            <Section title="קבוצות התמחות" icon={<Layers size={16} />}>
              {groups.map((g) => {
                const rules = g.single.rules
                const role = rules.some((r) => 'all' in r && r.all.includes(courseId)) ? 'חובה בקבוצה'
                  : rules.some((r) => ('oneOf' in r && r.oneOf.includes(courseId)) || ('of' in r && r.of.includes(courseId))) ? 'אחד מקורסי החובה לבחירה' : 'בחירה בקבוצה'
                const mine = state.selectedGroups.some((s) => s.id === g.id)
                return (
                  <div key={g.id} className="grp-line">
                    <button className="link-btn" onClick={() => { ui.setPoolFilter('groups'); ui.setPoolGroup(g.id) }}>{g.id}. {g.name}</button>
                    <span className={`pill ${role === 'בחירה בקבוצה' ? '' : 'ok'}`}>{role}</span>
                    {mine && <span className="pill mine">★ בחרתי</span>}
                  </div>
                )
              })}
            </Section>
          )}

          <Section
            title={hasReviewData ? 'חוות דעת, עומס ונוכחות' : 'חוות דעת והערות'} icon={<MessageSquare size={16} />} defaultOpen={!!reviewsOf(courseId)}
            badge={reviewsOf(courseId) ? <span className="pill">{reviewsOf(courseId)!.n}</span> : undefined}
          >
            <ReviewsPanel courseId={courseId} />
            <div className="ext-row">
              <a className="btn" href={cheeseForkUrl(courseId)} target="_blank" rel="noopener">חוות דעת ב-CheeseFork <ExternalLink size={13} /></a>
              <a className="btn ghost" href={histogramsUrl(courseId)} target="_blank" rel="noopener">היסטוגרמות <ExternalLink size={13} /></a>
            </div>
            <label className="sub-h" htmlFor="my-notes">ההערות שלי</label>
            <textarea
              id="my-notes" className="notes" rows={4} placeholder="מה שמעתי על הקורס, טיפים, עם מי ללמוד…"
              value={state.notes[courseId] ?? ''}
              onChange={(e) => dispatch({ type: 'setNote', id: courseId, text: e.target.value })}
            />
            {course?.notes && (
              <>
                <div className="sub-h">הערות מהרישום</div>
                <p className="reg-notes">{course.notes}</p>
              </>
            )}
          </Section>
        </div>
      </aside>
    </>
  )
}
