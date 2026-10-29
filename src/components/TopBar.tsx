import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  BookMarked, Calculator, Download, FileText, GitBranch, GraduationCap, Layers, LayoutDashboard, RotateCcw, Settings, Undo2, Upload, UserPlus, Zap,
} from 'lucide-react'
import { useStore, exportState } from '../lib/store'
import { useUi } from '../lib/ui'
import { askConfirm } from '../lib/confirm'
import { computeRequirements, gpa, graduationGap, groupsSummary } from '../lib/requirements'
import { DATA_META, fmtPts } from '../lib/catalog'
import { fmtGpa } from '../lib/grades'
import { TRACK } from '../data/track'
import { BUILTIN_SHEET } from '../data/student'
import { activeSheet } from '../lib/sheet'
import { backupStatus, resetBackupMarks, safariAtRisk } from '../lib/persist'
import { confirmNewUser, requestNewUser } from '../lib/switchUser'
import type { AppState } from '../lib/types'
import { persistState } from './BackupGuard'
import { DegreeStatusBadge } from './AuditView'
import { RemainingStrip } from './RemainingStrip'

export type Tab = 'plan' | 'chains' | 'grades' | 'sheet' | 'reqs' | 'audit' | 'catalog'

const TABS: { id: Tab; label: string; short: string; Icon: typeof GitBranch }[] = [
  { id: 'plan', label: 'תרשים התואר', short: 'תרשים', Icon: GitBranch },
  { id: 'chains', label: 'שרשראות', short: 'שרשראות', Icon: Layers },
  { id: 'grades', label: 'ציונים וממוצע', short: 'ציונים', Icon: Calculator },
  { id: 'sheet', label: 'גיליון ציונים', short: 'גיליון', Icon: FileText },
  { id: 'reqs', label: 'דרישות ונקודות', short: 'דרישות', Icon: LayoutDashboard },
  { id: 'audit', label: 'סגירת תואר', short: 'סגירה', Icon: GraduationCap },
  { id: 'catalog', label: 'קטלוג', short: 'קטלוג', Icon: BookMarked },
]

/** גרסת השיתוף נבנית בלי גיליון מובנה – החלפת משתמש שם חוזרת למסך הפתיחה */
const SHARED = BUILTIN_SHEET.records.length === 0

/** הסרגל העליון (נשאר צמוד למעלה): שם, לשוניות, ביטול והגדרות */
export function TopBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const { canUndo, dispatch } = useStore()
  const barRef = useRef<HTMLElement>(null)
  // האלמנטים הדביקים (המאגר, ידית הרוחב) נצמדים מתחת לסרגל – גובהו משתנה כשהוא נשבר לשתי שורות
  useLayoutEffect(() => {
    const el = barRef.current
    if (!el) return
    const set = () => document.documentElement.style.setProperty('--topbar-h', `${el.offsetHeight}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <header className="topbar" ref={barRef}>
      <div className="brand">
        <div className="logo" aria-hidden><Zap size={19} /></div>
        <div className="brand-text">
          <h1>מתכנן התואר</h1>
          <div className="muted small">{activeSheet().student ? `${activeSheet().student} · ` : ''}{TRACK.name} · קטלוג {TRACK.catalogYear}</div>
        </div>
      </div>

      <nav className="tabs" aria-label="מסכי המערכת">
        {TABS.map(({ id, label, short, Icon }) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined} title={label}>
            <Icon size={15} aria-hidden /> <span className="t-full">{label}</span><span className="t-short">{short}</span>
          </button>
        ))}
      </nav>

      <div className="top-actions">
        <button className="btn ghost" disabled={!canUndo} onClick={() => dispatch({ type: 'undo' })} title="ביטול הפעולה האחרונה (Ctrl+Z)">
          <Undo2 size={15} aria-hidden /> <span className="t-full">ביטול</span>
        </button>
        <SettingsMenu setTab={setTab} />
      </div>
    </header>
  )
}

function SettingsMenu({ setTab }: { setTab: (t: Tab) => void }) {
  const { state, dispatch } = useStore()
  const ui = useUi()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // נסגר בלחיצה מחוץ לתפריט או ב-Esc (לא ביציאת העכבר – זה סגר אותו בטעות)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const backup = backupStatus()
  const act = (fn: () => void) => () => { setOpen(false); fn() }

  const reset = async () => {
    const ok = await askConfirm({
      title: 'לאפס את התכנון לפי גיליון הציונים?',
      lines: ['הקורסים שתכננת, השרשראות וההערות יימחקו, והתכנון ייבנה מחדש לפי הגיליון.', 'אפשר לבטל מיד אחרי האיפוס.'],
      confirmLabel: 'איפוס', tone: 'danger',
      alt: backup.unsaved || !backup.lastBackup ? { label: 'הורדת גיבוי ואיפוס', run: () => exportState(state) } : undefined,
    })
    if (!ok) return
    dispatch({ type: 'reset' })
    ui.toast('התכנון אופס לפי גיליון הציונים', 'info', [], { label: 'ביטול', run: () => dispatch({ type: 'undo' }) })
  }

  const switchUser = async () => {
    if (!SHARED) { requestNewUser(); setTab('sheet'); return }
    if (!(await confirmNewUser(state))) return
    resetBackupMarks()
    dispatch({ type: 'newUser' })
    ui.toast('התכנון נמחק – אפשר להעלות את תעודת הציונים של המשתמש החדש', 'info', [], { label: 'ביטול', run: () => dispatch({ type: 'undo' }) })
  }

  return (
    <div className="menu-wrap" ref={wrapRef}>
      <button className="btn ghost icon-only" onClick={() => setOpen(!open)} aria-label="הגדרות" aria-expanded={open} aria-haspopup="true" title="הגדרות וגיבוי">
        <Settings size={16} aria-hidden />
      </button>
      {open && (
        <div className="menu" role="menu" aria-label="הגדרות">
          <div className="menu-sec">
            <div className="menu-h">בדיקות</div>
            <label className="toggle">
              <input type="checkbox" checked={state.strict} onChange={(e) => dispatch({ type: 'setStrict', strict: e.target.checked })} />
              אכיפת דרישות קדם (מומלץ)
            </label>
            <label className="menu-field">
              <span>כלל עובר בינארי</span>
              <select value={state.binaryRule ?? 'strict'} onChange={(e) => dispatch({ type: 'setBinaryRule', rule: e.target.value as 'strict' | 'lenient' })}>
                <option value="strict">עד 5 קורסים וגם עד 10% מהנק"ז</option>
                <option value="lenient">עד 5 קורסים או עד 10% מהנק"ז</option>
              </select>
            </label>
          </div>

          <div className="menu-sec">
            <div className="menu-h">גיבוי</div>
            <div className="storage-info small">
              <div>גיבוי אחרון: <b>{backup.lastBackup ? new Date(backup.lastBackup).toLocaleDateString('he-IL') : 'עוד לא'}</b>{backup.lastBackup && backup.unsaved ? ' · יש שינויים מאז' : ''}</div>
              <div>אחסון בדפדפן: {persistState === true ? 'קבוע (לא יימחק כשהדיסק מתמלא)' : 'רגיל – כדאי לגבות מדי פעם'}</div>
              {safariAtRisk() && <div className="warn-text">בספארי ובאייפון נתוני אתרים נמחקים אחרי 7 ימים בלי כניסה – כדאי לגבות או להוסיף למסך הבית</div>}
            </div>
            <button className="menu-item" role="menuitem" onClick={act(() => exportState(state))}><Download size={15} aria-hidden /> הורדת גיבוי</button>
            <button className="menu-item" role="menuitem" onClick={() => fileRef.current?.click()}><Upload size={15} aria-hidden /> טעינת גיבוי</button>
          </div>

          <div className="menu-sec">
            <div className="menu-h">התחלה מחדש</div>
            <button className="menu-item danger" role="menuitem" onClick={act(reset)}><RotateCcw size={15} aria-hidden /> איפוס התכנון לפי הגיליון</button>
            <button className="menu-item danger" role="menuitem" onClick={act(switchUser)}><UserPlus size={15} aria-hidden /> החלפת משתמש – גיליון ציונים אחר</button>
          </div>

          <div className="menu-foot muted small">נתוני הקורסים: CheeseFork ו-technion-histograms · עודכנו {DATA_META.builtAt}</div>
        </div>
      )}
      <input
        ref={fileRef} type="file" accept="application/json,.json" hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          setOpen(false)
          try {
            const s = JSON.parse(await f.text()) as AppState
            if (s.v !== 1 || !Array.isArray(s.items)) throw new Error()
            dispatch({ type: 'import', state: s })
            ui.toast('הגיבוי נטען', 'ok', [], { label: 'ביטול', run: () => dispatch({ type: 'undo' }) })
          } catch {
            ui.toast('הקובץ לא נראה כמו גיבוי של מתכנן התואר', 'error')
          }
        }}
      />
    </div>
  )
}

/** שורת הסיכום מתחת לסרגל: מצב סגירת התואר, נקודות, ממוצע, שרשראות ומה נשאר */
export function SummaryBar({ setTab }: { setTab: (t: Tab) => void }) {
  const { state } = useStore()
  const done = useMemo(() => computeRequirements(state, 'done'), [state])
  const plan = useMemo(() => computeRequirements(state, 'plan'), [state])
  const groups = useMemo(() => groupsSummary(state), [state])
  const gap = useMemo(() => graduationGap(plan), [plan])
  const curGpa = gpa(state.items)
  const projGpa = gpa(state.items, state.expected, true)
  const pct = Math.min(100, (done.total.have / TRACK.totalPoints) * 100)
  const pctPlan = Math.min(100, (plan.total.have / TRACK.totalPoints) * 100)

  return (
    <section className="summary-bar" aria-label="סיכום התואר">
      <div className="sum-kpis">
        <DegreeStatusBadge />
        <button className="sum-kpi sum-points" onClick={() => setTab('reqs')} title="נקודות שהושלמו ונספרות לתואר – לחיצה לפירוט הדרישות">
          <span className="sk-top"><span className="sk-label">נק"ז שהושלמו</span><span className="sk-val"><b>{fmtPts(done.total.have)}</b> / {TRACK.totalPoints}</span></span>
          <span className="kpi-bar" aria-hidden><i className="plan" style={{ width: `${pctPlan}%` }} /><i className="done" style={{ width: `${pct}%` }} /></span>
          <span className="sk-sub">כולל התכנון: {fmtPts(plan.total.have)}</span>
        </button>
        <button
          className={`sum-kpi ${gap.missing <= 0 ? 'good' : ''}`} onClick={() => setTab('reqs')}
          title={`סכום הנקודות שחסרות בכל הדרישות לפי התכנון. התואר ייסגר על ${fmtPts(gap.finalTotal)} נק"ז${gap.surplus > 0 ? ` – ${fmtPts(gap.surplus)} מעבר ל-${TRACK.totalPoints}` : ''}`}
        >
          <span className="sk-label">חסר בתכנון</span>
          <span className="sk-val">{gap.missing <= 0 ? <b>מכוסה ✓</b> : <><b>{fmtPts(gap.missing)}</b> נק"ז</>}</span>
          <span className="sk-sub">{gap.surplus > 0 ? `${fmtPts(gap.surplus)} עודפות` : `סוגר על ${fmtPts(gap.finalTotal)}`}</span>
        </button>
        <button className="sum-kpi" onClick={() => setTab('grades')} title="ממוצע מצטבר (כולל ציונים שעדכנת) – לחיצה לסימולטור הציונים">
          <span className="sk-label">ממוצע</span>
          <span className="sk-val"><b>{curGpa != null ? fmtGpa(curGpa) : '—'}</b></span>
          {projGpa != null && curGpa != null && Math.abs(projGpa - curGpa) > 0.005 && <span className="sk-sub">משוער {fmtGpa(projGpa)}</span>}
        </button>
        <button className="sum-kpi" onClick={() => setTab('chains')} title="שרשראות שהתכנון משלים – לחיצה לבחירה והשוואה">
          <span className="sk-label">שרשראות</span>
          <span className="sk-val"><b>{groups.completedPlan}</b> / {groups.need}</span>
          <span className="sk-sub">בתכנון</span>
        </button>
      </div>
      <RemainingStrip onPick={() => setTab('plan')} />
    </section>
  )
}
