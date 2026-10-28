import { useMemo, useState } from 'react'
import { Check, CircleDot, KeyRound, ListChecks, Lock, Pin, Plus, ShieldAlert, X } from 'lucide-react'
import { useStore, MAX_CHAINS } from '../lib/store'
import { useUi } from '../lib/ui'
import { usePlanActions } from '../lib/actions'
import { COURSES, courseStats, fmtPts, semLabel } from '../lib/catalog'
import { checkPlacement, evalPrereq } from '../lib/prereq'
import { evalGroup } from '../lib/requirements'
import { chainAllocation } from '../lib/chainAlloc'
import { chainHover } from './ChainCard'
import { CHAIN_VARIANTS, chainCourses, chainRules, freeSlots, variantLabel } from '../lib/chains'
import { GROUPS, OPT_COURSE, OPT_SUBSTITUTES, type SpecGroup } from '../data/track'
import { isDone, isFailed } from '../lib/types'
import { RuleSummary } from './RuleSummary'

type Region = 'all' | '12' | '13' | '23' | '123'

/** השוואת עד 3 שרשראות (קבוצות התמחות) במקביל – בודדת וכפולה הן שרשראות נפרדות */
export function ChainsView() {
  const { state, dispatch } = useStore()
  const ui = useUi()
  const { place } = usePlanActions()
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [region, setRegion] = useState<Region>('all')
  const sel = state.selectedGroups.slice(0, MAX_CHAINS)
  const groups = sel.map((s) => GROUPS.find((g) => g.id === s.id)!).filter(Boolean)

  const doneIds = useMemo(() => new Set([...state.items.filter(isDone).map((i) => i.courseId), ...state.credits.map((c) => c.id)]), [state])
  const planIds = useMemo(() => new Set(state.items.filter((i) => !isFailed(i)).map((i) => i.courseId)), [state.items])
  const allHave = useMemo(() => new Set([...doneIds, ...planIds].filter(Boolean) as string[]), [doneIds, planIds])
  const futureSems = state.semesters.filter((s) => s >= state.currentSem)

  const sets = groups.map((g) => new Set(chainCourses(g.id).filter((id) => COURSES[id])))
  const shared = useMemo(() => {
    const all = new Map<string, number[]>()
    sets.forEach((s, i) => s.forEach((id) => all.set(id, [...(all.get(id) ?? []), i])))
    return [...all.entries()].filter(([, v]) => v.length > 1)
  }, [sets])
  const matches = (v: number[], r: Region) =>
    r === 'all' || (r === '123' ? v.length === 3 : v.length === 2 && r.split('').every((d) => v.includes(Number(d) - 1)))
  const regionCount = (r: Region) => shared.filter(([, v]) => matches(v, r)).length
  const sharedShown = shared
    .filter(([, v]) => matches(v, region))
    .sort((a, b) => b[1].length - a[1].length || (courseStats(b[0]).recentAvg ?? 0) - (courseStats(a[0]).recentAvg ?? 0))

  const statusOf = (id: string) => {
    if (doneIds.has(id)) return { cls: 'done', text: 'הושלם', Icon: Check }
    const it = state.items.find((i) => i.courseId === id && !isFailed(i))
    if (it) return { cls: 'plan', text: semLabel(it.sem), Icon: CircleDot }
    const earliest = futureSems.find((s) => checkPlacement(state, { courseId: id, targetSem: s }).ok)
    return earliest ? { cls: 'open', text: `פתוח מ${semLabel(earliest).split(' ')[0]}`, Icon: Plus } : { cls: 'locked', text: 'חסר קדם', Icon: Lock }
  }

  const add = (id: string) => {
    const sem = futureSems.find((s) => checkPlacement(state, { courseId: id, targetSem: s }).ok)
    if (sem) place({ courseId: id, sem })
    else ui.toast('אין כרגע סמסטר שבו הקדמים מתקיימים – בדקו את הקדמים החסרים', 'error')
  }

  const nameOf = (id: string) => COURSES[id]?.name ?? id
  const alloc = chainAllocation(state)

  // שורת קורס (בשימוש בכל הרשימות)
  const Row = ({ id, must, compact, gid }: { id: string; must?: boolean; compact?: boolean; gid?: number }) => {
    const c = COURSES[id]
    const st = statusOf(id)
    const inChains = sets.map((s, i) => (s.has(id) ? i : -1)).filter((i) => i >= 0)
    const avg = courseStats(id).recentAvg
    // קורס בתכנון שמשותף לכמה שרשראות שנבחרו – נספר רק באחת
    const opts = alloc.options.get(id)
    const assignedGid = alloc.assign.get(id)
    const assignedIdx = assignedGid != null ? groups.findIndex((x) => x.id === assignedGid) : -1
    const contested = !!opts && opts.length > 1
    const elsewhere = gid != null && contested && assignedGid !== gid
    return (
      <div
        className={`ch-row st-${st.cls} ${hoverId === id ? 'hl' : ''} ${inChains.length > 1 ? 'shared' : ''} ${must ? 'must' : ''} ${compact ? 'compact' : ''} ${elsewhere ? 'counted-elsewhere' : ''}`}
        onMouseEnter={() => setHoverId(id)}
        onMouseLeave={() => setHoverId(null)}
        onClick={() => c && ui.openCourse(id)}
        role="button" tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && c && ui.openCourse(id)}
      >
        <span className={`ch-st ${st.cls}`} title={st.text}><st.Icon size={13} /></span>
        <div className="ch-main">
          <div className="ch-name">{must && <span className="role must">חובה</span>}{c?.name ?? 'קורס שלא נפתח לאחרונה'}</div>
          <div className="ch-meta">
            <span className="mono">{id}</span>
            {c && <span>{fmtPts(c.points)} נק"ז</span>}
            {avg != null && <span>ממוצע {Math.round(avg)}</span>}
            <span className={`ch-when ${st.cls}`}>{st.text}</span>
          </div>
        </div>
        {contested && gid != null && (
          elsewhere
            ? (
              <button
                className="assign-btn" title={`עכשיו נספר בשרשרת ${assignedIdx + 1} – לחיצה תספור אותו כאן`}
                onClick={(e) => { e.stopPropagation(); dispatch({ type: 'assignChain', courseId: id, groupId: gid }) }}
              >נספר ב-{assignedIdx + 1} · ספור כאן</button>
            )
            : <span className="assign-here" title={alloc.pinned.has(id) ? 'שויך ידנית לשרשרת הזאת' : 'שויך אוטומטית – כך נסגרות הכי הרבה שרשראות'}>נספר כאן{alloc.pinned.has(id) && <Pin size={10} aria-hidden />}</span>
        )}
        <span className="chain-dots">{inChains.map((i) => (
          <span key={i} className={`chain-dot c${i + 1} ${contested ? (assignedIdx === i ? 'assigned' : 'alt') : ''}`} {...chainHover(groups[i].id)}>{i + 1}</span>
        ))}</span>
        {st.cls === 'open' && c && (
          <button className="add-btn" aria-label={`הוספה: ${c.name}`} onClick={(e) => { e.stopPropagation(); add(id) }}><Plus size={15} /></button>
        )}
      </div>
    )
  }

  // קדמים: לכל קורס חובה – החלופה המתאימה ומה חסר (בלי קשר לסמסטר)
  const PrereqLine = ({ id }: { id: string }) => {
    const st = evalPrereq(id, allHave)
    const alt = st.best
    if (!alt.length && !COURSES[id]?.coreq?.length) {
      return <div className="pq-line"><span className="pq-course">{nameOf(id)} <span className="mono">{id}</span></span><span className="muted small">אין דרישות קדם</span></div>
    }
    return (
      <div className={`pq-line ${st.ok ? 'ok' : 'bad'}`}>
        <span className="pq-course">{nameOf(id)} <span className="mono">{id}</span></span>
        <span className="pq-arrow">דורש</span>
        <span className="pq-chips">
          {alt.map((p) => {
            const cls = doneIds.has(p) || p.startsWith('0103') || p.startsWith('0113') ? 'done' : planIds.has(p) ? 'plan' : 'missing'
            return (
              <button key={p} className={`cchip ${cls}`} onClick={() => COURSES[p] && ui.openCourse(p)} title={cls === 'missing' ? 'לא בתכנון' : cls === 'plan' ? 'בתכנון' : 'הושלם'}>
                {nameOf(p)} <span className="mono">{p}</span>
              </button>
            )
          })}
          {!!COURSES[id]?.coreq?.length && <span className="muted small">· צמוד (לפני או במקביל): {COURSES[id]!.coreq!.join(' / ')}</span>}
        </span>
      </div>
    )
  }

  const ChainColumn = ({ g, double, idx }: { g: SpecGroup; double: boolean; idx: number }) => {
    // ספירה לפי השיוך: קורס משותף נספר רק בשרשרת אחת
    const ev = alloc.plan.get(g.id) ?? evalGroup(g, double, planIds as Set<string>)
    const evDone = alloc.done.get(g.id) ?? evalGroup(g, double, doneIds as Set<string>)
    const rules = chainRules(g, double)
    const free = freeSlots(g, double)
    const mustIds = rules.filter((r) => r.kind === 'all').flatMap((r) => r.ids)
    const optionIds = rules.filter((r) => r.kind !== 'all').flatMap((r) => r.ids)
    const ruleIdSet = new Set([...mustIds, ...optionIds])
    const here = (id: string) => alloc.assign.get(id) === g.id
    const has = (id: string) => here(id) || (id === OPT_COURSE && OPT_SUBSTITUTES.some(here))
    const rest = [...sets[idx]].filter((id) => !ruleIdSet.has(id))
      .sort((a, b) => Number(has(b)) - Number(has(a)) || (courseStats(b).recentAvg ?? 0) - (courseStats(a).recentAvg ?? 0))
    const freeTaken = rest.filter(has).length
    // קדמים שחסרים לכל קורסי החובה (כולל קורסי ה"אחד מ")
    const missingPre = new Set<string>()
    ;[...mustIds, ...optionIds].forEach((id) => {
      if (doneIds.has(id)) return
      evalPrereq(id, allHave).missing.forEach((m) => { if (!ruleIdSet.has(m)) missingPre.add(m) })
    })

    return (
      <div className={`chain-col c${idx + 1}`}>
        <header>
          <div className="cc-title" tabIndex={0} {...chainHover(g.id)}><span className={`chain-dot c${idx + 1}`}>{idx + 1}</span> {variantLabel(g, double)}</div>
          <div className="cc-variant">
            {double ? `קבוצה כפולה · ${g.double!.count} קורסים · נספרת כשתי קבוצות` : `קבוצה בודדת · ${g.single.count} קורסים`}
            {g.canBeDouble && (
              <button className="link-btn small" onClick={() => dispatch({ type: 'selectChain', id: g.id, double: !double })}>
                החלף ל{double ? 'בודדת' : 'כפולה'}
              </button>
            )}
          </div>
          <div className="cc-progress">
            <div className="bk-bar thin">
              <i className="plan" style={{ width: `${Math.min(100, (ev.count / ev.need) * 100)}%` }} />
              <i className="done" style={{ width: `${Math.min(100, (evDone.count / evDone.need) * 100)}%` }} />
            </div>
            <span>{evDone.count} הושלמו · {ev.count} בתכנון · נדרשים {ev.need}{ev.complete ? ' · ✓ מכוסה בתכנון' : ''}</span>
          </div>
        </header>

        {/* חובה – תמיד למעלה ובולט */}
        <section className="cc-must">
          <div className="cc-h"><ShieldAlert size={15} /> חובה בשרשרת</div>
          {rules.map((r, k) => {
            const takenCount = r.ids.filter(has).length
            const ok = takenCount >= r.n
            if (r.kind === 'all') {
              return (
                <div key={k} className="must-group">
                  {r.ids.map((id) => <Row key={id} id={id} must gid={g.id} />)}
                </div>
              )
            }
            return (
              <div key={k} className={`must-pick ${ok ? 'ok' : ''}`}>
                <div className="mp-h">
                  <span className="role must">חובה</span>
                  <b>{r.kind === 'oneOf' ? 'לבחור אחד מתוך:' : `לבחור ${r.n} מתוך:`}</b>
                  <span className={`pill ${ok ? 'ok' : ''}`}>{takenCount}/{r.n}</span>
                </div>
                {r.ids.map((id) => <Row key={id} id={id} compact gid={g.id} />)}
              </div>
            )
          })}
          {g.courses.includes(OPT_COURSE) && (
            <p className="muted small">* במקום 00460197 אפשר אחד מ: 01040193 (תורת האופטימיזציה) או 02360330 (מבוא לאופטימיזציה).</p>
          )}
          {g.exclusive?.map((ex) => (
            <p key={ex.join()} className="muted small">רק אחד נספר מתוך: {ex.map((id) => `${nameOf(id)} (${id})`).join(' / ')}</p>
          ))}
        </section>

        <section className="cc-free">
          <div className="cc-h"><ListChecks size={15} /> ועוד {free} קורסים לבחירה מרשימת השרשרת <span className={`pill ${freeTaken >= free ? 'ok' : ''}`}>{Math.min(freeTaken, free)}/{free}</span></div>
          <p className="muted small">כדי להגיע ל-{double ? g.double!.count : g.single.count} קורסים: {mustIds.length} חובה{optionIds.length ? ` + ${rules.filter((r) => r.kind !== 'all').reduce((a, r) => a + r.n, 0)} מתוך הבחירה המחייבת` : ''} + {free} מהרשימה (כל קורס מהשרשרת שלא נספר כחובה).</p>
        </section>

        <details className="cc-pre" open={missingPre.size > 0}>
          <summary><KeyRound size={14} /> קדמים לקורסי החובה {missingPre.size > 0 ? <span className="pill bad">חסרים {missingPre.size}</span> : <span className="pill ok">הכל מכוסה</span>}</summary>
          {missingPre.size > 0 && (
            <div className="pq-missing">
              חסרים לך לפני השרשרת:{' '}
              {[...missingPre].map((m) => (
                <button key={m} className="cchip missing" onClick={() => COURSES[m] && ui.openCourse(m)}>{nameOf(m)} <span className="mono">{m}</span></button>
              ))}
            </div>
          )}
          {[...mustIds, ...optionIds].map((id) => <PrereqLine key={id} id={id} />)}
        </details>

        <div className="cc-list">
          <div className="cc-h small"><span>כל שאר קורסי השרשרת ({rest.length})</span></div>
          {rest.map((id) => <Row key={id} id={id} gid={g.id} />)}
        </div>
      </div>
    )
  }

  // ונ – שלושה עיגולים עם מספרי החפיפות
  const venn = groups.length >= 2 && (
    <svg viewBox="0 0 260 190" className="venn" role="img" aria-label="חפיפה בין השרשראות">
      <circle cx="98" cy="78" r="62" className="v c1" />
      <circle cx="162" cy="78" r="62" className="v c2" />
      {groups.length === 3 && <circle cx="130" cy="128" r="62" className="v c3" />}
      <text x="62" y="60" className="vt">{sets[0]?.size ?? 0}</text>
      <text x="198" y="60" className="vt">{sets[1]?.size ?? 0}</text>
      {groups.length === 3 && <text x="130" y="178" className="vt">{sets[2]?.size ?? 0}</text>}
      <g className={`vr ${region === '12' ? 'on' : ''}`} onClick={() => setRegion(region === '12' ? 'all' : '12')}>
        <circle cx="130" cy="58" r="15" /><text x="130" y="63">{regionCount('12')}</text>
      </g>
      {groups.length === 3 && (
        <>
          <g className={`vr ${region === '13' ? 'on' : ''}`} onClick={() => setRegion(region === '13' ? 'all' : '13')}>
            <circle cx="96" cy="122" r="15" /><text x="96" y="127">{regionCount('13')}</text>
          </g>
          <g className={`vr ${region === '23' ? 'on' : ''}`} onClick={() => setRegion(region === '23' ? 'all' : '23')}>
            <circle cx="164" cy="122" r="15" /><text x="164" y="127">{regionCount('23')}</text>
          </g>
          <g className={`vr center ${region === '123' ? 'on' : ''}`} onClick={() => setRegion(region === '123' ? 'all' : '123')}>
            <circle cx="130" cy="98" r="15" /><text x="130" y="103">{regionCount('123')}</text>
          </g>
        </>
      )}
    </svg>
  )

  const totalWeight = sel.reduce((a, s) => a + (s.double ? 2 : 1), 0)

  return (
    <div className="chains">
      <section className="panel chain-picker">
        <div className="panel-head">
          <h3>בחירת שרשראות</h3>
          <span className="muted small">עד {MAX_CHAINS} במקביל · בודדת וכפולה הן אפשרויות נפרדות · כפולה נספרת כשתיים · {totalWeight >= 3 ? `✓ מכסה את דרישת 3 הקבוצות (${totalWeight})` : `נבחרו ${totalWeight} מתוך 3 נדרשות`}</span>
        </div>
        <div className="picker-grid">
          {GROUPS.map((g) => {
            const idx = sel.findIndex((s) => s.id === g.id)
            const chosen = idx >= 0 ? sel[idx] : undefined
            const variants = CHAIN_VARIANTS.filter((v) => v.group.id === g.id)
            return (
              <div key={g.id} className={`pick-card ${chosen ? `on c${idx + 1}` : ''}`}>
                <div className="pk-title">
                  {chosen && <span className={`chain-dot c${idx + 1}`}>{idx + 1}</span>}
                  <b>{g.id}. {g.name}</b>
                  {g.honorsOnly && <small className="muted">מצטיינים</small>}
                </div>
                <div className="pk-variants">
                  {variants.map((v) => {
                    const on = chosen && chosen.double === v.double
                    const full = !chosen && sel.length >= MAX_CHAINS
                    return (
                      <div key={v.key} className={`pk-variant ${on ? 'on' : ''}`}>
                        <button
                          className={`pk-var ${on ? 'on' : ''} ${full ? 'full' : ''}`}
                          aria-pressed={!!on}
                          onClick={() => {
                            if (full) { ui.toast(`אפשר לבחור עד ${MAX_CHAINS} שרשראות – הסירו אחת קודם`, 'warn'); return }
                            dispatch({ type: 'selectChain', id: g.id, double: v.double })
                          }}
                        >
                          {on ? '✓ ' : ''}{v.double ? 'כפולה' : 'בודדת'} · {v.count} קורסים
                        </button>
                        <RuleSummary g={g} double={v.double} compact />
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {groups.length === 0 ? (
        <div className="empty big">בחרו שרשרת אחת או יותר כדי לראות אותן זו לצד זו</div>
      ) : (
        <>
          <section className="chain-cols" style={{ gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr))` }}>
            {groups.map((g, i) => <ChainColumn key={g.id} g={g} double={sel[i].double} idx={i} />)}
          </section>

          <section className="chain-overview">
            {groups.length >= 2 && (
              <div className="panel venn-panel">
                <h3>חפיפה בין השרשראות</h3>
                {venn}
                <p className="muted small">לחיצה על מספר בחפיפה מסננת את רשימת המשותפים.</p>
              </div>
            )}
            <div className="panel shared-panel">
              <div className="panel-head">
                <h3>קורסים משותפים ({sharedShown.length})</h3>
                {region !== 'all' && <button className="link-btn small" onClick={() => setRegion('all')}><X size={12} /> כל החפיפות</button>}
              </div>
              <p className="muted small">כל קורס כאן מתקדם בכמה שרשראות בבת אחת.</p>
              <div className="shared-list">
                {sharedShown.length === 0 && <div className="muted">אין קורסים משותפים בין השרשראות שנבחרו.</div>}
                {sharedShown.map(([id]) => <Row key={id} id={id} />)}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
