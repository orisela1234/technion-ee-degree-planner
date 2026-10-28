import reviewsRaw from '../data/reviews.json?raw'
import { COURSES } from './catalog'

/** חוות דעת מ-CheeseFork (נבנה ע"י scripts/fetch_reviews.py). ריק עד שמריצים את הסקריפט */
export interface ReviewPost { s: string; g: number | null; w: number | null; ts: number | null; t: string }
export interface CourseReviews {
  n: number
  g: number | null
  w: number | null
  gd: number[]
  wd: number[]
  att: { yes: number; no: number }
  grades: number[]
  posts: ReviewPost[]
}

export const REVIEWS: Record<string, CourseReviews> = JSON.parse(reviewsRaw)
export const hasReviewData = Object.keys(REVIEWS).length > 0
export const reviewsOf = (id?: string): CourseReviews | undefined => (id ? REVIEWS[id] : undefined)

export const GENERAL_LABEL = ['', 'לא מומלץ כלל', 'פחות מומלץ', 'בינוני', 'מומלץ', 'מומלץ מאוד']
export const WORKLOAD_LABEL = ['', 'לא עמוס כלל', 'טיפה עמוס', 'בינוני', 'עמוס', 'עמוס מאוד']

const OFFICIAL_YES = /(חובת\s*נוכחות|נוכחות\s*(?:היא\s*)?חובה|חובה\s*להשתתף|נוכחות\s*מלאה)/
const OFFICIAL_NO = /(אין\s*חובת\s*נוכחות|ללא\s*חובת\s*נוכחות|נוכחות\s*(?:אינה|לא)\s*חובה)/

export type AttendanceLevel = 'yes' | 'no' | 'mixed' | 'unknown'
export interface Attendance { level: AttendanceLevel; label: string; source: string }

/** נוכחות חובה: לפי הערות הרישום הרשמיות, מעבדות, ואזכורים בחוות הדעת */
export function attendanceOf(id: string): Attendance {
  const c = COURSES[id]
  const text = `${c?.notes ?? ''} ${c?.syllabus ?? ''}`
  if (OFFICIAL_NO.test(text)) return { level: 'no', label: 'אין חובת נוכחות', source: 'לפי הערות הרישום' }
  if (OFFICIAL_YES.test(text)) return { level: 'yes', label: 'נוכחות חובה', source: 'לפי הערות הרישום' }
  if (c && /מעבדה/.test(c.name) && c.hours?.lab) return { level: 'yes', label: 'נוכחות חובה (מעבדה)', source: 'קורס מעבדה' }
  const r = REVIEWS[id]
  if (r && r.att.yes + r.att.no > 0) {
    const { yes, no } = r.att
    const level: AttendanceLevel = yes && no ? (yes >= no * 2 ? 'yes' : no >= yes * 2 ? 'no' : 'mixed') : yes ? 'yes' : 'no'
    const label = level === 'yes' ? 'כנראה נוכחות חובה' : level === 'no' ? 'כנראה בלי נוכחות חובה' : 'דיווחים סותרים'
    return { level, label, source: `${yes} אמרו שיש · ${no} אמרו שאין (חוות דעת)` }
  }
  return { level: 'unknown', label: 'לא ידוע', source: hasReviewData ? 'אין אזכור' : 'עוד לא נשאבו חוות דעת' }
}

/** מפרק טקסט חוות דעת לפי כותרות התבנית של CheeseFork */
const HEADS = ['שם המרצה:', 'חוות דעת - הרצאות:', 'שם המתרגל/ת:', 'חוות דעת - תרגולים:', 'שעורי הבית:', 'המבחן:', 'השורה התחתונה:']
export function splitReview(text: string): { head?: string; body: string }[] {
  const idx = HEADS.map((h) => ({ h, i: text.indexOf(h) })).filter((x) => x.i >= 0).sort((a, b) => a.i - b.i)
  if (!idx.length) return [{ body: text }]
  const out: { head?: string; body: string }[] = []
  if (idx[0].i > 0) out.push({ body: text.slice(0, idx[0].i).trim() })
  idx.forEach((x, k) => {
    const end = k + 1 < idx.length ? idx[k + 1].i : text.length
    const body = text.slice(x.i + x.h.length, end).trim()
    if (body) out.push({ head: x.h.replace(':', ''), body })
  })
  return out.filter((p) => p.body)
}

export const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
