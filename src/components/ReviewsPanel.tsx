import { useState } from 'react'
import { Dumbbell, Star, UserCheck } from 'lucide-react'
import { semLabel } from '../lib/catalog'
import {
  attendanceOf, GENERAL_LABEL, hasReviewData, median, reviewsOf, splitReview, WORKLOAD_LABEL,
} from '../lib/reviews'

function Stars({ value, Icon = Star, cls }: { value: number; Icon?: typeof Star; cls: string }) {
  return (
    <span className={`rate-icons ${cls}`} aria-label={value.toFixed(1)}>
      {[1, 2, 3, 4, 5].map((k) => {
        const fill = Math.max(0, Math.min(1, value - (k - 1)))
        return (
          <span key={k} className="ri">
            <Icon size={15} className="ri-bg" />
            <span className="ri-fg" style={{ width: `${fill * 100}%` }}><Icon size={15} fill="currentColor" /></span>
          </span>
        )
      })}
    </span>
  )
}

function Dist({ counts, cls }: { counts: number[]; cls: string }) {
  const max = Math.max(1, ...counts)
  return (
    <div className={`dist ${cls}`}>
      {[5, 4, 3, 2, 1].map((k) => (
        <div key={k} className="dist-row">
          <span>{k}</span>
          <i><b style={{ width: `${(counts[k - 1] / max) * 100}%` }} /></i>
          <span className="muted">{counts[k - 1]}</span>
        </div>
      ))}
    </div>
  )
}

/** סיכום שורה אחת לכרטיסים קטנים (מגירה, ריחוף) */
export function ReviewStrip({ courseId }: { courseId: string }) {
  const r = reviewsOf(courseId)
  const att = attendanceOf(courseId)
  // בלי חוות דעת ובלי מידע על נוכחות – אין מה להציג
  if (!r && att.level === 'unknown') return null
  return (
    <div className="review-strip">
      {r && r.g != null && (
        <span className="rs-item" title={GENERAL_LABEL[Math.round(r.g)]}><Star size={13} fill="currentColor" className="c-star" /> {r.g.toFixed(1)}</span>
      )}
      {r && r.w != null && <span className="rs-item" title={WORKLOAD_LABEL[Math.round(r.w)]}><Dumbbell size={13} /> עומס {r.w.toFixed(1)}/5</span>}
      {r && <span className="rs-item muted">{r.n} חוות דעת</span>}
      {att.level !== 'unknown' && <span className={`rs-item att-${att.level}`} title={att.source}><UserCheck size={13} /> {att.label}</span>}
    </div>
  )
}

export function ReviewsPanel({ courseId }: { courseId: string }) {
  const r = reviewsOf(courseId)
  const att = attendanceOf(courseId)
  const [limit, setLimit] = useState(4)
  const [open, setOpen] = useState<Set<number>>(new Set([0]))

  if (!r) {
    return (
      <div className="rev-empty">
        {att.level !== 'unknown' && <div className={`att-line att-${att.level}`}><UserCheck size={14} /> {att.label} <span className="muted small">· {att.source}</span></div>}
        <p className="muted small">
          {hasReviewData ? 'אין חוות דעת לקורס הזה ב-CheeseFork.' : 'חוות דעת של סטודנטים על הקורס – בקישור ל-CheeseFork.'}
        </p>
      </div>
    )
  }

  const med = median(r.grades)
  return (
    <div className="reviews">
      <div className="rev-summary">
        <div className="rev-block">
          <div className="rb-title">דירוג כללי</div>
          <div className="rb-val">{r.g != null ? r.g.toFixed(1) : '—'}<small>/5</small></div>
          {r.g != null && <Stars value={r.g} cls="c-star" />}
          <div className="muted small">{r.g != null ? GENERAL_LABEL[Math.round(r.g)] : ''}</div>
          <Dist counts={r.gd} cls="d-star" />
        </div>
        <div className="rev-block">
          <div className="rb-title">עומס לפי סטודנטים</div>
          <div className="rb-val">{r.w != null ? r.w.toFixed(1) : '—'}<small>/5</small></div>
          {r.w != null && <Stars value={r.w} Icon={Dumbbell} cls="c-load" />}
          <div className="muted small">{r.w != null ? WORKLOAD_LABEL[Math.round(r.w)] : ''}</div>
          <Dist counts={r.wd} cls="d-load" />
        </div>
      </div>
      <div className="rev-facts">
        <div className={`att-line att-${att.level}`}><UserCheck size={14} /> <b>{att.label}</b> <span className="muted small">· {att.source}</span></div>
        <div>
          <b>ציונים שסטודנטים דיווחו:</b>{' '}
          {r.grades.length
            ? <>חציון {med} · {r.grades.slice(0, 14).map((g, i) => <span key={i} className="grade-chip">{g}</span>)}</>
            : <span className="muted">לא דווחו בטקסט</span>}
        </div>
        <div className="muted small">{r.n} חוות דעת סה"כ · מוצגות האחרונות</div>
      </div>

      <div className="rev-list">
        {r.posts.slice(0, limit).map((p, i) => {
          const isOpen = open.has(i)
          const parts = splitReview(p.t)
          return (
            <article key={i} className={`rev-post ${isOpen ? 'open' : ''}`}>
              <button
                className="rp-head"
                onClick={() => setOpen((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })}
                aria-expanded={isOpen}
              >
                <span className="rp-sem">{p.s ? semLabel(p.s) : ''}</span>
                {p.g != null && <span className="rp-chip"><Star size={11} fill="currentColor" className="c-star" /> {p.g}</span>}
                {p.w != null && <span className="rp-chip"><Dumbbell size={11} /> {p.w}</span>}
                {!isOpen && <span className="rp-preview">{p.t.replace(/\s+/g, ' ').slice(0, 90)}…</span>}
              </button>
              {isOpen && (
                <div className="rp-body">
                  {parts.map((part, k) => (
                    <p key={k}>{part.head && <b>{part.head}: </b>}{part.body}</p>
                  ))}
                </div>
              )}
            </article>
          )
        })}
        {r.posts.length > limit && (
          <button className="btn ghost wide" onClick={() => setLimit((l) => l + 6)}>עוד חוות דעת ({r.posts.length - limit})</button>
        )}
      </div>
    </div>
  )
}
