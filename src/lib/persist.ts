/**
 * הגנות על הנתונים בדפדפן: אחסון קבוע, מעקב אחרי גיבויים, וזיהוי ספארי
 * (ספארי מוחק נתוני אתרים שלא נכנסו אליהם 7 ימים, חוץ מאפליקציה שהוספה למסך הבית).
 */
const K_BACKUP = 'degree-planner:lastBackup'
const K_CHANGE = 'degree-planner:lastChange'
const K_FIRST = 'degree-planner:firstUse'
const K_SNOOZE = 'degree-planner:backupSnooze'

const DAY = 86400000
const get = (k: string) => { try { return Number(localStorage.getItem(k)) || 0 } catch { return 0 } }
const set = (k: string, v: number) => { try { localStorage.setItem(k, String(v)) } catch { /* אין אחסון */ } }
const emit = () => window.dispatchEvent(new Event('degree:backup'))

export const markBackup = () => { set(K_BACKUP, Date.now()); emit() }
export const markChange = () => { if (!get(K_FIRST)) set(K_FIRST, Date.now()); set(K_CHANGE, Date.now()) }
export const snoozeBackup = (days = 1) => { set(K_SNOOZE, Date.now() + days * DAY); emit() }

export const isSafari = () => /^((?!chrome|chromium|android|crios|fxios|edg|opr).)*safari/i.test(navigator.userAgent)
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
/** אייפון/אייפד – כל הדפדפנים שם רצים על מנוע של ספארי, ומאז iOS 14 חלה עליהם אותה מחיקה */
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
/** ספארי (או כל דפדפן באייפון) בלשונית רגילה – שם הנתונים בסיכון אחרי 7 ימים בלי כניסה */
export const safariAtRisk = () => (isSafari() || isIOS()) && !isStandalone()

export interface BackupStatus { lastBackup: number; lastChange: number; unsaved: boolean; needs: boolean }

/** האם להציע גיבוי: יש שינויים שלא גובו, ועבר מספיק זמן (בספארי – מהר יותר) */
export function backupStatus(): BackupStatus {
  const now = Date.now()
  const lastBackup = get(K_BACKUP)
  const lastChange = get(K_CHANGE)
  const first = get(K_FIRST) || now
  const unsaved = lastChange > lastBackup
  const since = now - (lastBackup || first)
  // עוד לא גיבו אף פעם: אחרי חצי שעה של עבודה; אחר כך – כל יומיים בספארי, כל שבוע בשאר הדפדפנים
  const threshold = !lastBackup ? DAY / 48 : safariAtRisk() ? 2 * DAY : 7 * DAY
  return { lastBackup, lastChange, unsaved, needs: unsaved && since > threshold && get(K_SNOOZE) < now }
}

/** מבקש מהדפדפן לסמן את הנתונים כקבועים (לא יימחקו כשהדיסק מתמלא). null = לא נתמך */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return null
  }
}
