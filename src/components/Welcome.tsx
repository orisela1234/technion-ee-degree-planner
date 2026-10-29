import { useRef } from 'react'
import { DatabaseBackup, GraduationCap, Lock, Route, Undo2, Zap } from 'lucide-react'
import { useStore } from '../lib/store'
import { useUi } from '../lib/ui'
import { TRACK } from '../data/track'
import type { AppState } from '../lib/types'
import { SheetView } from './SheetView'
import { safariAtRisk } from '../lib/persist'

/** מסך הפתיחה של גרסת השיתוף: מעלים תעודת ציונים, והמערכת נבנית לפיה */
export function Welcome() {
  const { dispatch, canUndo } = useStore()
  const ui = useUi()
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <div className="welcome">
      <header className="wl-head">
        <span className="brand-mark"><Zap size={18} aria-hidden /></span>
        <div>
          <h1>מתכנן התואר</h1>
          <div className="muted small">{TRACK.name} ({TRACK.code}) · קטלוג {TRACK.catalogYear}</div>
        </div>
      </header>

      <section className="wl-hero">
        <h2>התואר שלך, מתוך תעודת הציונים</h2>
        <p>
          מעלים את קובץ ה-PDF של תעודת הציונים מהטכניון, והמערכת בונה לבד את תרשים התואר לפי סמסטרים,
          סופרת נקודות לפי הדרישות, ממליצה מה אפשר לקחת, ובודקת את כל התנאים לסגירת התואר.
        </p>
        <ul className="wl-points">
          <li><Lock size={16} aria-hidden /><span><b>פרטי לגמרי:</b> הקובץ נקרא רק בדפדפן שלך. שום דבר לא נשלח לשרת, ואף אחד אחר לא רואה את הנתונים. מספר תעודת הזהות לא נשמר.</span></li>
          <li><Route size={16} aria-hidden /><span><b>מותאם למסלול הנדסת חשמל</b> (004004-1-000) לפי קטלוג תשפ"ו – כולל קבוצות ההתמחות, מעבדות, מל"ג וספורט.</span></li>
          <li><DatabaseBackup size={16} aria-hidden /><span><b>הכול נשמר אוטומטית</b> בדפדפן הזה. לעבור למחשב אחר – "הורדת גיבוי" בהגדרות, ואז "טעינת גיבוי" כאן.</span></li>
        </ul>
        {safariAtRisk() && (
          <p className="wl-safari">
            <b>בספארי או באייפון?</b> שם נתוני אתרים נמחקים אם לא נכנסים אליהם 7 ימים. כדי לשמור על התכנון: הוסיפו את האתר למסך הבית
            (שיתוף ← "הוספה למסך הבית") ובנו את התכנון משם, ושמרו מדי פעם גיבוי – המערכת תזכיר.
          </p>
        )}
      </section>

      <SheetView onboarding />

      {canUndo && (
        <section className="wl-foot">
          <span className="muted small">התחלת מחדש בטעות?</span>
          <button className="btn ghost" onClick={() => dispatch({ type: 'undo' })}><Undo2 size={15} aria-hidden /> חזרה לתכנון הקודם</button>
        </section>
      )}
      <section className="wl-foot">
        <span className="muted small">יש לך כבר גיבוי מהמערכת?</span>
        <button className="btn ghost" onClick={() => fileRef.current?.click()}><DatabaseBackup size={15} aria-hidden /> טעינת גיבוי</button>
        <input
          ref={fileRef} type="file" accept="application/json" hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            try {
              const s = JSON.parse(await f.text()) as AppState
              if (s.v !== 1 || !Array.isArray(s.items)) throw new Error()
              if (!s.sheet?.records?.length) { ui.toast('בגיבוי הזה אין תעודת ציונים – העלו את קובץ ה-PDF במקום', 'error'); return }
              dispatch({ type: 'import', state: s })
              ui.toast('הגיבוי נטען', 'ok')
            } catch {
              ui.toast('הקובץ לא נראה כמו גיבוי של מתכנן התואר', 'error')
            }
          }}
        />
      </section>
      <p className="wl-legal muted small">
        <GraduationCap size={13} aria-hidden /> כלי עזר לתכנון בלבד. ההחלטה על זכאות לתואר – של מזכירות לימודי הסמכה בפקולטה.
        נתוני הקורסים מצ'יזפורק וממאגר ההיסטוגרמות הציבורי.
      </p>
    </div>
  )
}
