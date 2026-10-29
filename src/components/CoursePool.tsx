import { useMemo, useState } from 'react'
import { FlaskConical, MessageSquare, Plus, Search, Star, Trash2, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { useUi, type PoolFilter } from '../lib/ui'
import { usePlanActions } from '../lib/actions'
import { beginDrag, useDrag } from '../lib/drag'
import {
  COURSES, courseStats, difficultyOf, englishSems, fmtPts, groupsOf, isEnrichmentCourse, isSportCourse,
  offeredSeasons, semLabel, SEASON_HE, type Season,
} from '../lib/catalog'
import { checkPlacement } from '../lib/prereq'
import { GROUPS, MANDATORY, isFacultyElective, isLabCourse, MANDATORY_IDS, SLOT_INFO } from '../data/track'
import { colorClass, computeRequirements, evalGroup } from '../lib/requirements'
import { chainCourses, chainsOf } from '../lib/chains'
import { itemCourseId, isFailed } from '../lib/types'
import { showHoverCard, hideHoverCard } from './HoverCard'
import { GENERAL_LABEL, WORKLOAD_LABEL, hasReviewData, reviewsOf } from '../lib/reviews'
import { chainHover } from './ChainCard'

const FILTERS: { id: PoolFilter; label: string }[] = [
  { id: 'groups', label: 'שרשראות' },
  { id: 'mandatory', label: 'חובה שנותרו' },
  { id: 'faculty', label: 'בחירה פקולטית' },
  { id: 'labs', label: 'מקצועות מעבדה' },
  { id: 'enrichment', label: 'העשרה' },
  { id: 'sport', label: 'ספורט' },
  { id: 'english', label: 'באנגלית' },
  { id: 'all', label: 'כל הטכניון' },
]

type Sort = 'smart' | 'avg' | 'easy' | 'rating' | 'light' | 'reviews' | 'points' | 'id'
const SEASON_SHORT: Record<Season, string> = { winter: 'ח', spring: 'א', summer: 'ק' }

export function CoursePool() {
  const { state, dispatch } = useStore()
  const ui = useUi()
  const drag = useDrag()
  const { place } = usePlanActions()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('smart')
  const [onlyEligible, setOnlyEligible] = useState(false)
  const [limit, setLimit] = useState(120)
  const [labPts, setLabPts] = useState(2)

  const inPlan = useMemo(() => new Set(state.items.filter((i) => !isFailed(i)).map(itemCourseId).filter(Boolean) as string[]), [state.items])
  const slotItem = ui.slotTarget ? state.items.find((i) => i.key === ui.slotTarget) : undefined
  const futureSems = useMemo(() => state.semesters.filter((s) => s >= state.currentSem), [state.semesters, state.currentSem])
  const mine = state.selectedGroups

  const candidates = useMemo(() => {
    let ids: string[]
    switch (ui.poolFilter) {
      case 'mandatory':
        ids = MANDATORY.filter((m) => ![m.id, ...(m.alternatives ?? [])].some((x) => inPlan.has(x))).map((m) => m.id)
        break
      case 'groups':
        if (ui.poolGroup === 'mine' && mine.length) ids = [...new Set(mine.flatMap((s) => chainCourses(s.id)))]
        else if (typeof ui.poolGroup === 'number') ids = chainCourses(ui.poolGroup)
        else ids = [...new Set(GROUPS.flatMap((x) => x.courses))]
        break
      case 'faculty':
        ids = Object.keys(COURSES).filter((id) => isFacultyElective(id) && !MANDATORY_IDS.has(id) && !isLabCourse(id))
        break
      case 'labs':
        ids = Object.keys(COURSES).filter(isLabCourse)
        break
      case 'enrichment':
        ids = Object.keys(COURSES).filter((id) => isEnrichmentCourse(COURSES[id]))
        break
      case 'english':
        ids = Object.keys(COURSES).filter((id) => englishSems(id).length > 0)
        break
      case 'sport':
        ids = Object.keys(COURSES).filter((id) => isSportCourse(COURSES[id]))
        break
      default:
        ids = Object.keys(COURSES)
    }
    return ids.filter((id) => COURSES[id] && !inPlan.has(id))
  }, [ui.poolFilter, ui.poolGroup, inPlan, mine])

  const rows = useMemo(() => {
    const term = q.trim()
    const filtered = term ? candidates.filter((id) => id.includes(term) || (COURSES[id]?.name ?? '').includes(term)) : candidates
    const heavy = filtered.length > 500
    const enriched = filtered.map((id) => ({
      id,
      c: COURSES[id],
      stats: courseStats(id),
      diff: difficultyOf(id),
      chains: chainsOf(id, mine),
      groups: groupsOf(id),
      earliest: heavy ? undefined : (futureSems.find((sem) => checkPlacement(state, { courseId: id, targetSem: sem }).ok) ?? null) as string | null | undefined,
    }))
    const list = onlyEligible ? enriched.filter((r) => r.earliest === futureSems[0] || r.earliest === futureSems[1]) : enriched
    const byAvg = (r: (typeof enriched)[number]) => r.stats.recentAvg ?? 0
    // קורסים בלי חוות דעת תמיד בסוף כשממיינים לפי דירוג/עומס
    const rev = (id: string) => reviewsOf(id)
    list.sort((a, b) => {
      switch (sort) {
        case 'avg': return byAvg(b) - byAvg(a)
        case 'rating': return (rev(b.id)?.g ?? -1) - (rev(a.id)?.g ?? -1) || (rev(b.id)?.n ?? 0) - (rev(a.id)?.n ?? 0)
        case 'light': return (rev(a.id)?.w ?? 99) - (rev(b.id)?.w ?? 99) || (rev(b.id)?.n ?? 0) - (rev(a.id)?.n ?? 0)
        case 'reviews': return (rev(b.id)?.n ?? 0) - (rev(a.id)?.n ?? 0)
        case 'easy': return (a.diff?.score ?? 9) - (b.diff?.score ?? 9)
        case 'points': return (b.c?.points ?? 0) - (a.c?.points ?? 0)
        case 'id': return a.id.localeCompare(b.id)
        default: {
          if (a.chains.length !== b.chains.length) return b.chains.length - a.chains.length
          const ea = a.earliest ?? 'z', eb = b.earliest ?? 'z'
          if (ea !== eb) return ea.localeCompare(eb)
          if (a.groups.length !== b.groups.length) return b.groups.length - a.groups.length
          return byAvg(b) - byAvg(a)
        }
      }
    })
    return list
  }, [candidates, q, sort, onlyEligible, state, futureSems, mine])

  const groupInfo = ui.poolFilter === 'groups' && typeof ui.poolGroup === 'number' ? GROUPS.find((g) => g.id === ui.poolGroup) : undefined
  const groupEval = groupInfo ? evalGroup(groupInfo, !!mine.find((s) => s.id === groupInfo.id)?.double, inPlan) : undefined
  const draggingPlanItem = !!drag.payload?.itemKey
  const overPool = drag.over.pool

  const labsReq = useMemo(
    () => (ui.poolFilter === 'labs' ? { done: computeRequirements(state, 'done').labs, plan: computeRequirements(state, 'plan').labs } : null),
    [ui.poolFilter, state],
  )
  const nextSem = futureSems.find((s) => s > state.currentSem) ?? futureSems[0] ?? state.semesters[state.semesters.length - 1]
  const addLabSlot = () => {
    dispatch({ type: 'addSlot', slot: 'lab', points: labPts, sem: nextSem })
    ui.toast(`"${SLOT_INFO.lab.label}" (${fmtPts(labPts)} נק"ז) נוסף ל${semLabel(nextSem)}`, 'info',
      ['אפשר לגרור את המשבצת לכל סמסטר, וללחוץ עליה כדי לבחור מעבדה מסוימת'], { label: 'בטל', run: () => dispatch({ type: 'undo' }) })
  }

  const quickAdd = (id: string) => {
    if (slotItem) {
      if (place({ courseId: id, sem: slotItem.sem, replaceSlotKey: slotItem.key })) ui.setSlotTarget(null)
      return
    }
    const sem = futureSems.find((s) => checkPlacement(state, { courseId: id, targetSem: s }).ok)
    place({ courseId: id, sem: sem ?? futureSems[0] ?? state.semesters[state.semesters.length - 1] })
  }

  return (
    <aside className={`pool ${draggingPlanItem ? 'drop-armed' : ''} ${overPool && draggingPlanItem ? 'drop-remove' : ''}`} data-drop-pool>
      {draggingPlanItem && (
        <div className="pool-drop-overlay" aria-hidden>
          <Trash2 size={28} />
          <b>שחררו כאן כדי להוציא מהתכנון</b>
          <span>הקורס יחזור למאגר</span>
        </div>
      )}
      <div className="pool-head">
        <h2>מאגר הקורסים</h2>
        <p className="muted">גררו לסמסטר בתרשים, או לחצו + לשיבוץ במקום המוקדם האפשרי</p>
      </div>

      {slotItem && (
        <div className="slot-banner">
          <div>
            בוחרים קורס עבור <b>{SLOT_INFO[slotItem.slot!].label}</b> ב{semLabel(slotItem.sem)}
            <div className="muted small">+ או גרירה על המשבצת יחליפו אותה בקורס</div>
          </div>
          <button className="icon-btn" aria-label="ביטול" onClick={() => ui.setSlotTarget(null)}><X size={16} /></button>
        </div>
      )}

      <label className="search-wrap">
        <Search size={15} aria-hidden />
        <input className="search" placeholder="חיפוש לפי שם או מספר קורס…" value={q} onChange={(e) => { setQ(e.target.value); setLimit(120) }} />
      </label>

      <div className="chips" role="tablist">
        {FILTERS.map((f) => (
          <button key={f.id} role="tab" aria-selected={ui.poolFilter === f.id} className={`chip ${ui.poolFilter === f.id ? 'on' : ''}`} onClick={() => { ui.setPoolFilter(f.id); setLimit(120) }}>
            {f.label}
          </button>
        ))}
      </div>

      {ui.poolFilter === 'groups' && (
        <div className="group-picker">
          <button className={`gchip mine-all ${ui.poolGroup === 'mine' ? 'on' : ''}`} onClick={() => ui.setPoolGroup('mine')} disabled={!mine.length}>
            <Star size={12} /> השרשראות שלי {mine.length ? `(${mine.length})` : ''}
          </button>
          {GROUPS.map((g) => {
            const idx = mine.findIndex((s) => s.id === g.id)
            return (
              <button key={g.id} className={`gchip ${ui.poolGroup === g.id ? 'on' : ''} ${idx >= 0 ? `mine c${idx + 1}` : ''}`}
                onClick={() => ui.setPoolGroup(ui.poolGroup === g.id ? null : g.id)} {...(idx >= 0 ? chainHover(g.id) : {})} title={idx >= 0 ? undefined : g.name}>
                {idx >= 0 && <span className={`chain-dot c${idx + 1}`}>{idx + 1}</span>}{g.short}{idx >= 0 && mine[idx].double ? ' ×2' : ''}
              </button>
            )
          })}
        </div>
      )}
      {ui.poolFilter === 'groups' && ui.poolGroup === 'mine' && mine.length > 1 && (
        <div className="muted small">קורסים משותפים לכמה שרשראות מופיעים ראשונים – כל אחד מהם מקדם יותר משרשרת אחת.</div>
      )}
      {groupInfo && groupEval && (
        <div className="group-info">
          <div className="gi-title">
            <b>{groupInfo.name}</b>
            <span className={`pill ${groupEval.complete ? 'ok' : ''}`}>{groupEval.count}/{groupEval.need} בתכנון</span>
          </div>
          <ul>{groupEval.rules.map((r, i) => <li key={i} className={r.ok ? 'ok' : ''}>{r.ok ? '✓' : '○'} {r.text}</li>)}</ul>
        </div>
      )}

      {ui.poolFilter === 'labs' && labsReq && (
        <div className="labs-info">
          <div className="li-head">
            <FlaskConical size={15} aria-hidden />
            <b>מקצועות מעבדה מתוך רשימה</b>
            <span className={`pill ${labsReq.plan.have >= labsReq.plan.need ? 'ok' : ''}`}>
              {fmtPts(labsReq.done.have)}/{fmtPts(labsReq.done.need)} הושלמו · {fmtPts(labsReq.plan.have)} בתכנון
            </span>
          </div>
          <p>
            לפי תרשים הטכניון: <b>3 נק' חובה</b> – 2 בסמסטר ו' ו-1 בסמסטר ז'. כל מעבדה 1 נק' (00450100–00450121),
            אפשר עד 4 נק' – הרביעית נספרת כבחירה פקולטית.
          </p>
          {!slotItem && (
            <div
              className={`pool-item lab-generic ${colorClass(state.colorBy, { key: '', slot: 'lab', sem: '' })}`}
              onPointerDown={(e) => { hideHoverCard(); beginDrag(e, { slot: { type: 'lab', points: labPts } }) }}
              role="button" tabIndex={0}
              aria-label={`מקצועות מעבדה, ${fmtPts(labPts)} נק"ז – גררו לסמסטר`}
              onKeyDown={(e) => e.key === 'Enter' && addLabSlot()}
            >
              <div className="pi-main">
                <div className="pi-name">מקצועות מעבדה</div>
                <div className="pi-meta"><span>משבצת כללית – גררו לכל סמסטר, ואת המעבדה עצמה בוחרים אחר כך</span></div>
                <div className="pi-meta">
                  <span className="seg small" onPointerDown={(e) => e.stopPropagation()} aria-label="נקודות זכות">
                    {[2, 1].map((n) => (
                      <button key={n} className={labPts === n ? 'on' : ''} onClick={() => setLabPts(n)}>{n} נק"ז</button>
                    ))}
                  </span>
                </div>
              </div>
              <div className="pi-side">
                <button
                  className="add-btn" aria-label={`הוספת מקצועות מעבדה ל${semLabel(nextSem)}`} title={`הוספה ל${semLabel(nextSem)}`}
                  onPointerDown={(e) => e.stopPropagation()} onClick={addLabSlot}
                ><Plus size={16} /></button>
                <span className="pi-when">{semLabel(nextSem).split(' ')[0]}</span>
              </div>
            </div>
          )}
          <div className="li-foot">או גררו מעבדה מסוימת מהרשימה:</div>
        </div>
      )}

      <div className="pool-tools">
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="מיון">
          <option value="smart">מיון: משותפים ומה שאפשר הכי מוקדם</option>
          <option value="avg">מיון: ממוצע גבוה</option>
          <option value="easy">מיון: ממוצעים גבוהים ואחוזי מעבר (נוח יותר)</option>
          {hasReviewData && <>
            <option value="rating">מיון: דירוג כללי גבוה (חוות דעת)</option>
            <option value="light">מיון: עומס נמוך (חוות דעת)</option>
            <option value="reviews">מיון: הכי הרבה חוות דעת</option>
          </>}
          <option value="points">מיון: נק"ז</option>
          <option value="id">מיון: מספר קורס</option>
        </select>
        <label className="toggle">
          <input type="checkbox" checked={onlyEligible} onChange={(e) => setOnlyEligible(e.target.checked)} />
          רק מה שפתוח לי בשני הסמסטרים הקרובים
        </label>
      </div>

      <div className="pool-count muted small">
        {rows.length === 1 ? 'קורס אחד' : `${rows.length} קורסים`}
      </div>

      <div className="pool-list">
        {rows.slice(0, limit).map((r) => {
          const seasons = offeredSeasons(r.id)
          const star = groupInfo?.single.rules.some((rule) =>
            ('all' in rule && rule.all.includes(r.id)) || ('oneOf' in rule && rule.oneOf.includes(r.id)) || ('of' in rule && rule.of.includes(r.id)))
          return (
            <div
              key={r.id}
              className={`pool-item ${colorClass(state.colorBy, undefined, r.id)} ${r.earliest === null ? 'locked' : ''} ${r.chains.length > 1 ? 'shared' : ''}`}
              onPointerDown={(e) => { hideHoverCard(); beginDrag(e, { courseId: r.id }) }}
              onClick={() => ui.openCourse(r.id)}
              onMouseEnter={(e) => showHoverCard(r.id, undefined, e.currentTarget)}
              onMouseLeave={hideHoverCard}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && ui.openCourse(r.id)}
            >
              <div className="pi-main">
                <div className="pi-name">
                  {star && <Star size={12} className="star" aria-label="חובה בקבוצה" />}
                  {r.c?.name ?? r.id}
                </div>
                <div className="pi-meta">
                  <span className="mono">{r.id}</span>
                  <span>{fmtPts(r.c?.points ?? 0)} נק"ז</span>
                  {englishSems(r.id).length > 0 && <span className="en-tag yes" title={`נלמד באנגלית: ${englishSems(r.id).map((s) => (s === '*' ? 'בכל סמסטר' : semLabel(s))).join(', ')}`}>EN</span>}
                  {r.stats.recentAvg != null && <span title="ממוצע סופי ב-3 הסמסטרים האחרונים">ממוצע {Math.round(r.stats.recentAvg)}</span>}
                  {r.diff && <span className={`diff d${Math.round(r.diff.score)}`}>{r.diff.label}</span>}
                </div>
                {(() => {
                  const rv = reviewsOf(r.id)
                  if (!rv?.n) return null
                  return (
                    <div className="pi-meta pi-reviews">
                      {rv.g != null && (
                        <span className="rate-chip" title={`דירוג כללי ${rv.g.toFixed(1)}/5 – ${GENERAL_LABEL[Math.round(rv.g)]}`}>
                          <Star size={10} aria-hidden /> {rv.g.toFixed(1)}
                        </span>
                      )}
                      {rv.w != null && (
                        <span className={`load-chip l${Math.round(rv.w)}`} title={`עומס ${rv.w.toFixed(1)}/5 – ${WORKLOAD_LABEL[Math.round(rv.w)]}`}>
                          עומס {rv.w.toFixed(1)}
                        </span>
                      )}
                      <span className="rev-count" title="מספר חוות הדעת בצ'יזפורק – לחצו על הקורס כדי לקרוא">
                        <MessageSquare size={10} aria-hidden /> {rv.n}
                      </span>
                    </div>
                  )
                })()}
                <div className="pi-meta">
                  <span className="seasons">
                    {(['winter', 'spring', 'summer'] as Season[]).map((s) => (
                      <i key={s} className={seasons.has(s) ? 'on' : ''} title={SEASON_HE[s]}>{SEASON_SHORT[s]}</i>
                    ))}
                  </span>
                  {r.chains.map((i) => <span key={i} className={`chain-dot c${i + 1}`} title="בשרשרת שבחרת">{i + 1}</span>)}
                  {r.chains.length > 1 && <span className="shared-tag">משותף</span>}
                  {r.groups.filter((g) => !mine.some((s) => s.id === g.id)).slice(0, 2).map((g) => <span key={g.id} className="gtag">{g.short}</span>)}
                </div>
              </div>
              <div className="pi-side">
                <button
                  className="add-btn"
                  aria-label={`הוספה: ${r.c?.name}`}
                  title={r.earliest ? `שבץ ב${semLabel(r.earliest)}` : r.earliest === null ? 'חסרות דרישות קדם' : 'שבץ בסמסטר המוקדם האפשרי'}
                  onClick={(e) => { e.stopPropagation(); quickAdd(r.id) }}
                ><Plus size={16} /></button>
                <span className="pi-when">{r.earliest ? semLabel(r.earliest).split(' ')[0] : r.earliest === null ? 'נעול' : ''}</span>
              </div>
            </div>
          )
        })}
        {rows.length > limit && <button className="btn ghost wide" onClick={() => setLimit((l) => l + 150)}>הצג עוד ({rows.length - limit})</button>}
        {rows.length === 0 && <div className="empty">אין קורסים להצגה בסינון הזה</div>}
      </div>
    </aside>
  )
}
