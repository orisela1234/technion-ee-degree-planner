import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BookMarked, Calculator, FileText, GitBranch, GraduationCap, Layers, LayoutDashboard, PanelRightClose, PanelRightOpen, Settings, Undo2, Zap, X } from 'lucide-react'
import { ChainsView } from './components/ChainsView'
import { SheetView } from './components/SheetView'
import { ChainCard } from './components/ChainCard'
import { AuditView } from './components/AuditView'
import { Welcome } from './components/Welcome'
import { BackupGuard, persistState } from './components/BackupGuard'
import { backupStatus, safariAtRisk } from './lib/persist'
import { GradesView } from './components/GradesView'
import { DragLayer } from './components/DragLayer'
import { HoverCard } from './components/HoverCard'
import { GradeEditor } from './components/GradeEditor'
import { ConfirmDialog } from './components/ConfirmDialog'
import { IssuesPanel } from './components/IssuesPanel'
import { RemainingStrip } from './components/RemainingStrip'
import { BINARY_MAX_COURSES, BINARY_MAX_POINTS, binaryUsage } from './lib/grades'
import { StoreProvider, useStore, exportState } from './lib/store'
import { UiProvider, useUi } from './lib/ui'
import { Flowchart } from './components/Flowchart'
import { CoursePool } from './components/CoursePool'
import { CourseDrawer } from './components/CourseDrawer'
import { Requirements } from './components/Requirements'
import { CatalogView } from './components/CatalogView'
import { CreditsPanel } from './components/CreditsPanel'
import { computeRequirements, gpa, groupsSummary } from './lib/requirements'
import { DATA_META, fmtPts, semLabel } from './lib/catalog'
import { TRACK } from './data/track'
import { activeSheet } from './lib/sheet'
import type { AppState } from './lib/types'

type Tab = 'plan' | 'chains' | 'grades' | 'sheet' | 'reqs' | 'audit' | 'catalog'

const TABS: { id: Tab; label: string; Icon: typeof GitBranch }[] = [
  { id: 'plan', label: 'תרשים התואר', Icon: GitBranch },
  { id: 'chains', label: 'שרשראות', Icon: Layers },
  { id: 'grades', label: 'ציונים וממוצע', Icon: Calculator },
  { id: 'sheet', label: 'גיליון ציונים', Icon: FileText },
  { id: 'reqs', label: 'דרישות ונקודות', Icon: LayoutDashboard },
  { id: 'audit', label: 'סגירת תואר', Icon: GraduationCap },
  { id: 'catalog', label: 'קטלוג', Icon: BookMarked },
]

function Toasts() {
  const { toasts, dismiss } = useUi()
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`} role="status">
          <div className="toast-body">
            <b>{t.title}</b>
            {t.lines?.slice(0, 8).map((l, i) => <div key={i} className="small">{l}</div>)}
          </div>
          {t.action && (
            <button className="toast-action" onClick={() => { t.action!.run(); dismiss(t.id) }}>
              <Undo2 size={14} /> {t.action.label}
            </button>
          )}
          <button className="toast-x" aria-label="סגירה" onClick={() => dismiss(t.id)}><X size={14} /></button>
        </div>
      ))}
    </div>
  )
}

function TopBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const { state, dispatch, canUndo } = useStore()
  const ui = useUi()
  const done = useMemo(() => computeRequirements(state, 'done'), [state])
  const plan = useMemo(() => computeRequirements(state, 'plan'), [state])
  const groups = useMemo(() => groupsSummary(state), [state])
  const curGpa = gpa(state.items)
  const projGpa = gpa(state.items, state.expected, true)
  const binUse = binaryUsage(state.items)
  const [menu, setMenu] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const barRef = useRef<HTMLElement>(null)
  // גובה הסרגל משתנה כשהוא נשבר לשתי שורות – האלמנטים הדביקים נצמדים מתחתיו
  useLayoutEffect(() => {
    const el = barRef.current
    if (!el) return
    const set = () => document.documentElement.style.setProperty('--topbar-h', `${el.offsetHeight}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pct = (done.total.have / TRACK.totalPoints) * 100
  const pctPlan = (plan.total.have / TRACK.totalPoints) * 100

  return (
    <header className="topbar" ref={barRef}>
      <div className="brand">
        <div className="logo"><Zap size={20} /></div>
        <div>
          <h1>מתכנן התואר</h1>
          <div className="muted small">{activeSheet().student} · {TRACK.name} · קטלוג {TRACK.catalogYear}</div>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi wide">
          <div className="kpi-top"><span>נק"ז שנספרות</span><b>{fmtPts(done.total.have)}<small> / {TRACK.totalPoints}</small></b></div>
          <div className="kpi-bar"><i className="plan" style={{ width: `${Math.min(100, pctPlan)}%` }} /><i className="done" style={{ width: `${Math.min(100, pct)}%` }} /></div>
          <div className="muted small">בתכנון המלא: {fmtPts(plan.total.have)}</div>
        </div>
        <button className="kpi kpi-btn" onClick={() => setTab('grades')} title="לסימולטור הציונים">
          <span>ממוצע</span><b>{curGpa != null ? curGpa.toFixed(1) : '—'}</b>
          {projGpa != null && curGpa != null && Math.abs(projGpa - curGpa) > 0.05 && <small className="muted">משוער {projGpa.toFixed(1)}</small>}
          <small className="muted kpi-binary">בינארי {binUse.count}/{BINARY_MAX_COURSES} · {fmtPts(binUse.points)}/{BINARY_MAX_POINTS} נק"ז</small>
        </button>
        <button className="kpi kpi-btn" onClick={() => setTab('chains')} title="להשוואת השרשראות"><span>שרשראות</span><b>{groups.completedPlan}<small>/{groups.need}</small></b></button>
        <div className="kpi"><span>סמסטר נוכחי</span><b className="sm">{semLabel(state.currentSem)}</b></div>
      </div>

      <nav className="tabs">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}>
            <Icon size={15} aria-hidden /> <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="top-actions">
        <button className="btn ghost" disabled={!canUndo} onClick={() => dispatch({ type: 'undo' })} title="ביטול פעולה (Ctrl+Z)"><Undo2 size={15} /> בטל</button>
        <div className="menu-wrap">
          <button className="btn ghost icon-only" onClick={() => setMenu(!menu)} aria-label="הגדרות"><Settings size={16} /></button>
          {menu && (
            <div className="menu" onMouseLeave={() => setMenu(false)}>
              <label className="toggle">
                <input type="checkbox" checked={state.strict} onChange={(e) => dispatch({ type: 'setStrict', strict: e.target.checked })} />
                אכיפת דרישות קדם (מומלץ)
              </label>
              <label className="toggle">
                <input type="checkbox" checked={state.arrows === 'all'} onChange={(e) => dispatch({ type: 'setArrows', arrows: e.target.checked ? 'all' : 'hover' })} />
                הצג את כל החיצים (אחרת רק במעבר עכבר)
              </label>
              <label className="toggle">
                <select value={state.binaryRule ?? 'strict'} onChange={(e) => dispatch({ type: 'setBinaryRule', rule: e.target.value as 'strict' | 'lenient' })}>
                  <option value="strict">עובר בינארי: 5 קורסים וגם 10% נק"ז</option>
                  <option value="lenient">עובר בינארי: 5 קורסים או 10% נק"ז</option>
                </select>
              </label>
              <hr />
              <div className="storage-info small">
                <div>אחסון בדפדפן: {persistState === true ? 'קבוע ✓ (לא יימחק כשהדיסק מתמלא)' : persistState === false ? 'רגיל – כדאי לגבות' : 'רגיל'}</div>
                <div>גיבוי אחרון: {backupStatus().lastBackup ? new Date(backupStatus().lastBackup).toLocaleDateString('he-IL') : 'עוד לא'}</div>
                {safariAtRisk() && <div className="warn-text">בספארי ובאייפון נתוני אתרים נמחקים אחרי 7 ימים בלי כניסה – כדאי לגבות או להוסיף למסך הבית</div>}
              </div>
              <button className="menu-item" onClick={() => exportState(state)}>⬇︎ ייצוא גיבוי (JSON)</button>
              <button className="menu-item" onClick={() => fileRef.current?.click()}>⬆︎ ייבוא גיבוי</button>
              <button className="menu-item danger" onClick={() => {
                if (confirm('לאפס את התכנון לפי גיליון הציונים? כל השינויים שלא גובו יימחקו.')) dispatch({ type: 'reset' })
              }}>↺ איפוס לפי גיליון הציונים</button>
              <hr />
              <div className="muted small">נתוני קורסים: CheeseFork + technion-histograms, עודכן {DATA_META.builtAt}</div>
            </div>
          )}
          <input
            ref={fileRef} type="file" accept="application/json" hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              try {
                const s = JSON.parse(await f.text()) as AppState
                if (s.v !== 1 || !Array.isArray(s.items)) throw new Error()
                dispatch({ type: 'import', state: s })
                ui.toast('הגיבוי נטען', 'ok')
              } catch {
                ui.toast('הקובץ לא נראה כמו גיבוי של מתכנן התואר', 'error')
              }
              e.target.value = ''
            }}
          />
        </div>
      </div>
      <RemainingStrip onPick={() => setTab('plan')} />
    </header>
  )
}

function NoticeBanner() {
  const { state, dispatch } = useStore()
  if (!state.notice) return null
  return (
    <div className="banner info">
      <span>{state.notice}</span>
      <button className="link-btn" onClick={() => dispatch({ type: 'dismissNotice' })}>סגירה</button>
    </div>
  )
}

function PendingBanner() {
  const { state } = useStore()
  const pendingSems = [...new Set(state.items.filter((i) => !i.result && i.sem < state.currentSem).map((i) => i.sem))]
  if (!pendingSems.length) return null
  return (
    <div className="banner">
      <b>{pendingSems.map(semLabel).join(', ')}</b> לא מופיע בגיליון הציונים (מ-{activeSheet().issued.split('-').reverse().join('.')}).
      שיבצתי שם את הקורסים לפי התוכנית המומלצת – לחצו על כל קורס כדי לסמן ציון, או גררו אותו למקום הנכון.
    </div>
  )
}

function Shell() {
  const [tab, setTab] = useState<Tab>(() => {
    try { return (localStorage.getItem('degree-planner:tab') as Tab) || 'plan' } catch { return 'plan' }
  })
  // מעבר ללשונית מכל מקום (למשל מבדיקת סגירת התואר)
  useEffect(() => {
    const on = (e: Event) => setTab((e as CustomEvent<Tab>).detail)
    window.addEventListener('degree:tab', on)
    return () => window.removeEventListener('degree:tab', on)
  }, [])
  const { state, dispatch } = useStore()
  const { poolOpen, setPoolOpen, poolW, setPoolW } = useUi()
  useEffect(() => {
    try { localStorage.setItem('degree-planner:tab', tab) } catch { /* ignore */ }
    window.scrollTo({ top: 0 })
    window.scrollTo(0, 0)
  }, [tab])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !['INPUT', 'TEXTAREA'].includes(t.tagName)) {
        e.preventDefault()
        dispatch({ type: 'undo' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatch])

  // גרסת השיתוף: עד שמעלים תעודת ציונים – מסך פתיחה בלבד
  if (!state.sheet) {
    return (
      <div className="app">
        <Welcome />
        <ConfirmDialog />
        <Toasts />
      </div>
    )
  }

  return (
    <div className="app">
      <TopBar tab={tab} setTab={setTab} />
      <BackupGuard />
      {tab === 'plan' && (
        <div className={`plan-layout ${poolOpen ? '' : 'pool-closed'}`} style={{ '--pool-w': `${poolW}px` } as React.CSSProperties}>
          {poolOpen && <CoursePool />}
          {poolOpen && (
            <div
              className="pool-resizer"
              role="separator" aria-orientation="vertical" aria-label="שינוי רוחב המאגר" tabIndex={0}
              title="גררו לשינוי הרוחב · לחיצה כפולה לקיפול"
              onDoubleClick={() => setPoolOpen(false)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') setPoolW(poolW + 20)
                if (e.key === 'ArrowRight') setPoolW(poolW - 20)
              }}
              onPointerDown={(e) => {
                const startX = e.clientX, startW = poolW
                const el = e.currentTarget
                el.setPointerCapture(e.pointerId)
                document.body.classList.add('is-resizing')
                const move = (ev: PointerEvent) => setPoolW(startW + (startX - ev.clientX))
                const up = () => {
                  el.removeEventListener('pointermove', move)
                  el.removeEventListener('pointerup', up)
                  document.body.classList.remove('is-resizing')
                }
                el.addEventListener('pointermove', move)
                el.addEventListener('pointerup', up)
              }}
            />
          )}
          <button className="pool-toggle" onClick={() => setPoolOpen(!poolOpen)} aria-label={poolOpen ? 'הסתרת המאגר' : 'הצגת המאגר'} title={poolOpen ? 'הסתרת המאגר – יותר מקום לתרשים' : 'הצגת מאגר הקורסים'}>
            {poolOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
          <main className="plan-main">
            <NoticeBanner />
            <IssuesPanel />
            <PendingBanner />
            <Flowchart />
            <CreditsPanel />
          </main>
        </div>
      )}
      {tab === 'chains' && <main className="page wide"><ChainsView /></main>}
      {tab === 'grades' && <main className="page"><GradesView /></main>}
      {tab === 'sheet' && <main className="page"><SheetView /></main>}
      {tab === 'audit' && <main className="page"><AuditView /></main>}
      {tab === 'reqs' && <main className="page"><IssuesPanel /><Requirements /></main>}
      {tab === 'catalog' && <main className="page"><CatalogView /></main>}
      <CourseDrawer />
      <HoverCard />
      <ChainCard />
      <GradeEditor />
      <ConfirmDialog />
      <DragLayer />
      <Toasts />
    </div>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <UiProvider>
        <Shell />
      </UiProvider>
    </StoreProvider>
  )
}
