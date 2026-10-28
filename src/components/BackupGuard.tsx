import { useEffect, useRef, useState } from 'react'
import { Download, ShieldCheck, Smartphone } from 'lucide-react'
import { useStore, exportState } from '../lib/store'
import { backupStatus, markChange, requestPersistence, safariAtRisk, snoozeBackup, type BackupStatus } from '../lib/persist'

/** מצב האחסון הקבוע – מוצג בתפריט ההגדרות */
export let persistState: boolean | null = null

const fmtAgo = (t: number) => {
  const d = Math.floor((Date.now() - t) / 86400000)
  return d <= 0 ? 'היום' : d === 1 ? 'אתמול' : `לפני ${d} ימים`
}

/** שומר על הנתונים: מבקש אחסון קבוע, עוקב אחרי שינויים, ומזכיר לגבות כשצריך */
export function BackupGuard() {
  const { state } = useStore()
  const [st, setSt] = useState<BackupStatus>(() => backupStatus())
  const first = useRef(true)

  // אחסון קבוע – פעם אחת אחרי שיש תכנון
  useEffect(() => {
    requestPersistence().then((ok) => { persistState = ok })
  }, [])

  // כל שינוי בתכנון (חוץ מהטעינה) נרשם, כדי לדעת אם יש מה לגבות
  useEffect(() => {
    if (first.current) { first.current = false; return }
    markChange()
  }, [state])

  useEffect(() => {
    const refresh = () => setSt(backupStatus())
    refresh()
    const t = window.setInterval(refresh, 60000)
    window.addEventListener('degree:backup', refresh)
    return () => { window.clearInterval(t); window.removeEventListener('degree:backup', refresh) }
  }, [state])

  if (!st.needs) return null
  const safari = safariAtRisk()
  return (
    <div className={`backup-banner ${safari ? 'risk' : ''}`} role="status">
      <ShieldCheck size={16} aria-hidden />
      <span>
        <b>{st.lastBackup ? `יש שינויים שלא גובו (גיבוי אחרון ${fmtAgo(st.lastBackup)}).` : 'עוד לא שמרת גיבוי של התכנון.'}</b>{' '}
        התכנון שמור רק בדפדפן הזה
        {safari ? ' – וספארי (וכל דפדפן באייפון) מוחק נתוני אתרים אחרי 7 ימים בלי כניסה.' : ', וניקוי נתוני גלישה ימחק אותו.'}
        {' '}קובץ גיבוי אפשר לטעון בכל מחשב.
      </span>
      {safari && (
        <span className="bb-tip" title="באייפון: שיתוף ← הוספה למסך הבית. במק: קובץ ← הוספה ל-Dock. משם פותחים את האפליקציה, ושם הנתונים לא נמחקים אחרי 7 ימים – אבל היא שומרת בנפרד, אז טוענים בה את הגיבוי">
          <Smartphone size={14} aria-hidden /> טיפ: הוספה למסך הבית
        </span>
      )}
      <button className="btn" onClick={() => exportState(state)}><Download size={15} aria-hidden /> הורדת גיבוי</button>
      <button className="link-btn" onClick={() => snoozeBackup(1)}>אחר כך</button>
    </div>
  )
}
