import type { GradeSheet } from '../data/student'
import type { AppState } from './types'
import { askConfirm } from './confirm'
import { exportState } from './store'
import { backupStatus } from './persist'
import { fmtDate, sheetOf } from './sheet'

/**
 * החלפת משתמש: תכנון חדש לגמרי מגיליון ציונים של מישהו אחר.
 * לפני שמוחקים – מציעים להוריד גיבוי של התכנון הנוכחי, כדי שאפשר יהיה לחזור אליו.
 */

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

/** הגיליון החדש של סטודנט אחר מזה של התכנון הנוכחי (רק כששני השמות ידועים) */
export function isOtherStudent(current: GradeSheet, next: GradeSheet) {
  return !!norm(current.student) && !!norm(next.student) && norm(current.student) !== norm(next.student)
}

/** כוונה שנקבעה בתפריט ההגדרות: הגיליון הבא שיועלה – למשתמש חדש */
let newUserIntent = false
export const requestNewUser = () => { newUserIntent = true; window.dispatchEvent(new Event('degree:newuser')) }
export const newUserRequested = () => newUserIntent
export const clearNewUserRequest = () => { newUserIntent = false }

export async function confirmNewUser(state: AppState, next?: GradeSheet) {
  const cur = sheetOf(state)
  const st = backupStatus()
  const backedUp = !!st.lastBackup && !st.unsaved
  return askConfirm({
    title: next ? `תכנון חדש לפי הגיליון של ${norm(next.student) || 'המשתמש החדש'}?` : 'להתחיל מחדש עם משתמש אחר?',
    lines: [
      `כל התכנון הנוכחי${cur.student ? ` של ${norm(cur.student)}` : ''} יימחק מהדפדפן: הקורסים שתכננת, השרשראות, הציונים הצפויים, ההערות והגיליונות הקודמים.`,
      next ? `ייבנה תכנון חדש מאפס לפי הגיליון מ-${fmtDate(next.issued)}.` : 'אחר כך מעלים את תעודת הציונים של המשתמש החדש, והתכנון נבנה ממנה.',
      backedUp
        ? `יש גיבוי מ-${new Date(st.lastBackup).toLocaleDateString('he-IL')} שכולל את כל השינויים – אפשר לחזור אליו ב"טעינת גיבוי".`
        : 'כדי שאפשר יהיה לחזור לתכנון הנוכחי – כדאי להוריד קודם גיבוי שלו.',
    ],
    confirmLabel: backedUp ? 'התחל מחדש' : 'בלי גיבוי',
    tone: 'danger',
    alt: backedUp ? undefined : { label: 'הורדת גיבוי והתחלה מחדש', run: () => exportState(state) },
  })
}
