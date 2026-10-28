import type { GradeSheet } from '../data/student'
import type { Category } from './catalog'
import type { SlotType } from '../data/track'

export type Result =
  | { kind: 'grade'; grade: number }
  | { kind: 'pass' }
  | { kind: 'exempt' }

export interface PlanItem {
  key: string
  courseId?: string
  slot?: SlotType
  /** נקודות למשבצת או לקורס שאינו בנתונים */
  points?: number
  name?: string
  sem: string
  result?: Result
  category?: Category
  /** עמודה שנבחרה ידנית בגרירה (1 = הימנית). בלי – סידור אוטומטי */
  col?: number
  /** עובר בינארי: הנקודות נספרות, הציון לא נכנס לממוצע */
  binary?: boolean
  /** שובץ בלי קדם באישור חריג (מסומן באדום עד שהקדם יושלם) */
  waived?: boolean
}

/** זיכויים ופטורים שאינם חלק מהתרשים (פעילות חברתית, השלמות, עברית…) */
export interface Credit {
  key: string
  id: string
  name: string
  points: number
  kind: 'exempt-credit' | 'exempt-nocredit' | 'pass'
  sem: string
  category: Category
}

export interface SelectedGroup { id: number; double: boolean }

export type ColorBy = 'category' | 'subject'

export interface AppState {
  v: 1
  semesters: string[]
  currentSem: string
  items: PlanItem[]
  credits: Credit[]
  selectedGroups: SelectedGroup[]
  notes: Record<string, string>
  expected: Record<string, number>
  strict: boolean
  arrows: 'all' | 'hover' | 'none'
  /** הדגשת השרשראות שנבחרו בתרשים */
  lens?: boolean
  density?: 'comfortable' | 'compact'
  /** צביעת הקורסים: לפי סיווג הדרישה (חובה/פקולטית/מל"ג…) או לפי תחום הלימוד */
  colorBy?: ColorBy
  /** מגבלת עובר בינארי: strict = גם 5 קורסים וגם 10% נק"ז; lenient = אחד מהשניים */
  binaryRule?: 'strict' | 'lenient'
  sheetIssued: string
  /** גיליון ציונים שהועלה מהממשק (בלי – הגיליון המובנה) */
  sheet?: GradeSheet
  /** גיליונות קודמים – אפשר לחזור אליהם */
  sheetHistory?: GradeSheet[]
  /** שיוך ידני של קורס משותף לשרשרת אחת (courseId → מזהה קבוצה) */
  chainAssign?: Record<string, number>
  /** גרסת כלל הסיווג של נקודות המילואים שהוחלה על התכנון השמור */
  reserveRuleV?: number
  /** הודעה חד-פעמית אחרי עדכון אוטומטי לפי גיליון ציונים חדש */
  notice?: string
}

export const PASS_GRADE = 55

export const itemCourseId = (i: PlanItem) => i.courseId
/** נכשל – נשאר בתרשים כהיסטוריה ונספר בממוצע, אבל לא מקנה נקודות ולא ממלא קדם */
export const isFailed = (i: PlanItem) => i.result?.kind === 'grade' && i.result.grade < PASS_GRADE
/** הושלם בהצלחה */
export const isDone = (i: PlanItem) => !!i.result && !isFailed(i)

export type ItemStatus = 'done' | 'failed' | 'exempt' | 'current' | 'pending' | 'planned'

export function itemStatus(i: PlanItem, currentSem: string): ItemStatus {
  if (i.result?.kind === 'exempt') return 'exempt'
  if (isFailed(i)) return 'failed'
  if (i.result) return 'done'
  if (i.sem === currentSem) return 'current'
  if (i.sem < currentSem) return 'pending'
  return 'planned'
}

export const STATUS_LABEL: Record<ItemStatus, string> = {
  done: 'הושלם',
  failed: 'נכשל',
  exempt: 'פטור',
  current: 'בלימוד עכשיו',
  pending: 'ממתין לעדכון',
  planned: 'מתוכנן',
}
