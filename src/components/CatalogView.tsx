import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { useUi } from '../lib/ui'
import {
  COURSES, courseStats, difficultyOf, fmtPts, groupsOf, isTrackRelevant, offeredSeasons, semLabel,
  workloadOf, CATEGORY_LABEL, categoryOfCourse, nCourses, type Season,
} from '../lib/catalog'
import { GROUPS } from '../data/track'
import { colorClass } from '../lib/requirements'
import { itemStatus, STATUS_LABEL, isFailed } from '../lib/types'
import { attendanceOf, hasReviewData, reviewsOf } from '../lib/reviews'

type Key = 'id' | 'name' | 'points' | 'avg' | 'pass' | 'hours' | 'diff' | 'rating' | 'load' | 'nrev'

const SEASON_SHORT: Record<Season, string> = { winter: 'ח', spring: 'א', summer: 'ק' }

export function CatalogView() {
  const { state } = useStore()
  const ui = useUi()
  const [q, setQ] = useState('')
  const [group, setGroup] = useState<number | ''>('')
  const [sortKey, setSortKey] = useState<Key>('id')
  const [asc, setAsc] = useState(true)
  const [hideOld, setHideOld] = useState(true)

  const rows = useMemo(() => {
    const term = q.trim()
    const g = GROUPS.find((x) => x.id === group)
    return Object.values(COURSES)
      .filter((c) => isTrackRelevant(c.id))
      .filter((c) => !hideOld || c.offered.some((s) => s >= '202501'))
      .filter((c) => !g || g.courses.includes(c.id))
      .filter((c) => !term || c.id.includes(term) || c.name.includes(term))
      .map((c) => {
        const st = courseStats(c.id)
        return {
          c, st,
          diff: difficultyOf(c.id),
          work: workloadOf(c.id),
          groups: groupsOf(c.id),
          item: state.items.find((i) => i.courseId === c.id && !isFailed(i)) ?? state.items.find((i) => i.courseId === c.id),
        }
      })
  }, [q, group, hideOld, state.items])

  const sorted = useMemo(() => {
    const val = (r: (typeof rows)[number]): number | string => {
      switch (sortKey) {
        case 'name': return r.c.name
        case 'points': return r.c.points
        case 'avg': return r.st.recentAvg ?? -1
        case 'pass': return r.st.recentPass ?? -1
        case 'hours': return r.work?.hours ?? -1
        case 'diff': return r.diff?.score ?? -1
        case 'rating': return reviewsOf(r.c.id)?.g ?? -1
        case 'load': return reviewsOf(r.c.id)?.w ?? -1
        case 'nrev': return reviewsOf(r.c.id)?.n ?? -1
        default: return r.c.id
      }
    }
    return [...rows].sort((a, b) => {
      const va = val(a), vb = val(b)
      const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number)
      return asc ? cmp : -cmp
    })
  }, [rows, sortKey, asc])

  // נוכחות ידועה רק לחלק קטן מהקורסים (מהערות הרישום) – העמודה מוצגת רק כשיש בה מידע
  const showAtt = sorted.some((r) => attendanceOf(r.c.id).level !== 'unknown')
  const th = (k: Key, label: string) => (
    <th onClick={() => { if (sortKey === k) setAsc(!asc); else { setSortKey(k); setAsc(k === 'id' || k === 'name') } }} className={sortKey === k ? 'sorted' : ''}>
      {label}{sortKey === k ? (asc ? ' ▲' : ' ▼') : ''}
    </th>
  )

  return (
    <div className="catalog">
      <div className="cat-tools">
        <input className="search" placeholder="חיפוש בקטלוג הפקולטה…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={group} onChange={(e) => setGroup(e.target.value ? Number(e.target.value) : '')}>
          <option value="">כל הקבוצות</option>
          {GROUPS.map((g) => <option key={g.id} value={g.id}>{g.id}. {g.name}</option>)}
        </select>
        <label className="toggle">
          <input type="checkbox" checked={hideOld} onChange={(e) => setHideOld(e.target.checked)} />
          רק קורסים שנפתחו בשנה האחרונה
        </label>
        <span className="muted">{nCourses(sorted.length)}</span>
      </div>
      <div className="table-wrap">
        <table className="cat-table">
          <thead>
            <tr>
              {th('id', 'מספר')}
              {th('name', 'שם הקורס')}
              {th('points', 'נק"ז')}
              <th>סיווג</th>
              <th>קבוצות</th>
              {th('avg', 'ממוצע')}
              {th('pass', 'עוברים')}
              {th('hours', 'ש"ש')}
              {th('diff', 'קושי משוער')}
              {hasReviewData && <>
                {th('rating', 'דירוג')}
                {th('load', 'עומס')}
                {th('nrev', 'חוות דעת')}
              </>}
              {showAtt && <th>נוכחות</th>}
              <th>נלמד</th>
              <th>בתכנון</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ c, st, diff, work, groups, item }) => {
              const seasons = offeredSeasons(c.id)
              return (
                <tr key={c.id} onClick={() => ui.openCourse(c.id, item?.key)} className={colorClass(state.colorBy, undefined, c.id)}>
                  <td className="mono"><i className="dot" />{c.id}</td>
                  <td className="name">{c.name}</td>
                  <td>{fmtPts(c.points)}</td>
                  <td className="muted small">{CATEGORY_LABEL[categoryOfCourse(c.id)]}</td>
                  <td>{groups.map((g) => <span key={g.id} className="gtag" title={g.name}>{g.id}</span>)}</td>
                  <td><b>{st.recentAvg != null ? Math.round(st.recentAvg) : '—'}</b></td>
                  <td>{st.recentPass != null ? `${Math.round(st.recentPass)}%` : '—'}</td>
                  <td>{work ? work.hours : '—'}</td>
                  <td>{diff ? <span className={`diff d${Math.round(diff.score)}`}>{diff.label}</span> : '—'}</td>
                  {hasReviewData && <>
                    <td>{reviewsOf(c.id)?.g != null ? <b>★ {reviewsOf(c.id)!.g!.toFixed(1)}</b> : '—'}</td>
                    <td>{reviewsOf(c.id)?.w != null ? `${reviewsOf(c.id)!.w!.toFixed(1)}/5` : '—'}</td>
                    <td className="muted">{reviewsOf(c.id)?.n ?? '—'}</td>
                  </>}
                  {showAtt && <td className={`small att-${attendanceOf(c.id).level}`}>{attendanceOf(c.id).level === 'unknown' ? '—' : attendanceOf(c.id).label}</td>}
                  <td className="seasons">{(['winter', 'spring', 'summer'] as Season[]).map((s) => <i key={s} className={seasons.has(s) ? 'on' : ''}>{SEASON_SHORT[s]}</i>)}</td>
                  <td className="small">{item ? `${STATUS_LABEL[itemStatus(item, state.currentSem)]} · ${semLabel(item.sem)}` : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
