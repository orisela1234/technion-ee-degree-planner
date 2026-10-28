import { useSyncExternalStore } from 'react'
import { useStore } from '../lib/store'
import { COURSES, courseStats, difficultyOf, fmtPts, groupsOf, lecturersOf, workloadOf } from '../lib/catalog'
import { evalPrereq, idsBefore, idsIn } from '../lib/prereq'
import { isDone, isFailed } from '../lib/types'
import { chainsOf } from '../lib/chains'
import { useDrag } from '../lib/drag'
import { attendanceOf, reviewsOf } from '../lib/reviews'

interface HC { courseId: string; itemKey?: string; x: number; y: number; above: boolean }
let current: HC | null = null
let timer = 0
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

/** כרטיס מידע מהיר שמופיע אחרי השהיה קצרה מעל קורס */
export function showHoverCard(courseId: string | undefined, itemKey: string | undefined, el: HTMLElement) {
  window.clearTimeout(timer)
  if (!courseId) return
  timer = window.setTimeout(() => {
    const r = el.getBoundingClientRect()
    const above = r.bottom + 230 > window.innerHeight
    current = { courseId, itemKey, x: r.left + r.width / 2, y: above ? r.top - 8 : r.bottom + 8, above }
    emit()
  }, 420)
}
export function hideHoverCard() {
  window.clearTimeout(timer)
  if (current) { current = null; emit() }
}

export function HoverCard() {
  const hc = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => current)
  const { state } = useStore()
  const drag = useDrag()
  if (!hc || drag.payload) return null
  const c = COURSES[hc.courseId]
  if (!c) return null
  const st = courseStats(hc.courseId)
  const diff = difficultyOf(hc.courseId)
  const work = workloadOf(hc.courseId)
  const item = hc.itemKey ? state.items.find((i) => i.key === hc.itemKey) : undefined
  // קדמים: לקורס בתרשים – ביחס לסמסטר שלו; לקורס מהמאגר – ביחס לכל מה שהושלם או מתוכנן
  const creditIds = state.credits.map((x) => x.id)
  const before = item
    ? idsBefore(state.items, item.sem, item.key, creditIds)
    : new Set<string>([...creditIds, ...(state.items.filter((i) => !isFailed(i)).map((i) => i.courseId).filter(Boolean) as string[])])
  const pre = evalPrereq(hc.courseId, before, item ? idsIn(state.items, item.sem, item.key) : new Set())
  const doneSet = new Set<string>([...creditIds, ...(state.items.filter(isDone).map((i) => i.courseId).filter(Boolean) as string[])])
  const preStatus = (id: string) =>
    doneSet.has(id) || id.startsWith('0103') || id.startsWith('0113') ? 'done' : before.has(id) ? 'plan' : 'missing'
  const blocking = pre.best.filter((id) => preStatus(id) === 'missing')
  const others = pre.best.filter((id) => preStatus(id) !== 'missing')
  const coreq = c.coreq ?? []
  const nameOf = (id: string) => COURSES[id]?.name ?? id
  const chains = chainsOf(hc.courseId, state.selectedGroups)
  const lect = lecturersOf(hc.courseId)[0]
  const left = Math.min(window.innerWidth - 150, Math.max(150, hc.x))

  return (
    <div className={`hovercard ${hc.above ? 'above' : ''}`} style={{ left, top: hc.y }} role="tooltip">
      <div className="hc-title">{c.name}</div>
      <div className="hc-sub mono">{c.id} · {fmtPts(c.points)} נק"ז</div>
      <div className="hc-stats">
        <div><span>ממוצע</span><b>{st.recentAvg != null ? Math.round(st.recentAvg) : '—'}</b></div>
        <div><span>עוברים</span><b>{st.recentPass != null ? `${Math.round(st.recentPass)}%` : '—'}</b></div>
        <div><span>שעות</span><b>{work ? work.hours : '—'}</b></div>
        <div><span>קושי</span><b className={diff ? `dtext d${Math.round(diff.score)}` : ''}>{diff?.label ?? '—'}</b></div>
      </div>
      {lect && <div className="hc-line">מרצה: {lect}</div>}
      {(() => {
        const r = reviewsOf(hc.courseId)
        const att = attendanceOf(hc.courseId)
        return (
          <div className="hc-line">
            {r && r.g != null && <>★ {r.g.toFixed(1)} · עומס {r.w?.toFixed(1) ?? '—'}/5 · {r.n} חוות דעת · </>}
            <span className={`att-${att.level}`}>{att.label}</span>
          </div>
        )
      })()}
      <div className={`hc-pre ${!item?.result && (blocking.length || !pre.coreqOk) ? 'blocked' : ''}`}>
        {pre.best.length === 0 && coreq.length === 0 ? (
          <div className="hc-pre-h muted">אין דרישות קדם</div>
        ) : (
          <>
            <div className="hc-pre-h">
              {item?.result ? 'קדמים' : blocking.length ? `חוסם: חסר ${blocking.length === 1 ? 'קדם' : `${blocking.length} קדמים`}` : 'כל הקדמים מתקיימים'}
              {!item && <span className="muted"> (מול כל התכנון)</span>}
            </div>
            {!item?.result && blocking.map((id) => (
              <div key={id} className="hc-pq missing"><span className="pq-ic">✗</span> {nameOf(id)} <span className="mono">{id}</span> <b className="pq-tag">חוסם</b></div>
            ))}
            {(item?.result ? pre.best : others).map((id) => {
              const s = preStatus(id)
              return (
                <div key={id} className={`hc-pq ${s}`}>
                  <span className="pq-ic">{s === 'done' ? '✓' : s === 'plan' ? '○' : '✗'}</span> {nameOf(id)} <span className="mono">{id}</span>
                  <span className="pq-st">{s === 'done' ? 'הושלם' : s === 'plan' ? 'בתכנון לפני' : 'חסר'}</span>
                </div>
              )
            })}
            {coreq.length > 0 && (
              <div className={`hc-pq ${pre.coreqOk ? 'done' : 'missing'}`}>
                <span className="pq-ic">{pre.coreqOk ? '✓' : '✗'}</span> צמוד (לפני או במקביל): {coreq.map(nameOf).join(' / ')}
              </div>
            )}
          </>
        )}
      </div>
      {(chains.length > 0 || groupsOf(hc.courseId).length > 0) && (
        <div className="hc-chains">
          {chains.map((i) => <span key={i} className={`chain-dot c${i + 1}`}>{i + 1}</span>)}
          {groupsOf(hc.courseId).slice(0, 4).map((g) => <span key={g.id} className="gtag">{g.short}</span>)}
        </div>
      )}
      <div className="hc-hint">לחיצה לפרטים מלאים · גרירה להזזה</div>
    </div>
  )
}
