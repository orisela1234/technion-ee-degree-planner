import { useEffect, useState } from 'react'
import { PanelRightClose, PanelRightOpen, Undo2, X } from 'lucide-react'
import { ChainsView } from './components/ChainsView'
import { SheetView } from './components/SheetView'
import { ChainCard, hideChainCard } from './components/ChainCard'
import { AuditView } from './components/AuditView'
import { BackupGuard } from './components/BackupGuard'
import { Welcome } from './components/Welcome'
import { GradesView } from './components/GradesView'
import { DragLayer } from './components/DragLayer'
import { HoverCard, hideHoverCard } from './components/HoverCard'
import { GradeEditor } from './components/GradeEditor'
import { ConfirmDialog } from './components/ConfirmDialog'
import { IssuesPanel } from './components/IssuesPanel'
import { TopBar, SummaryBar, type Tab } from './components/TopBar'
import { StoreProvider, useStore } from './lib/store'
import { UiProvider, useUi } from './lib/ui'
import { Flowchart } from './components/Flowchart'
import { CoursePool } from './components/CoursePool'
import { CourseDrawer } from './components/CourseDrawer'
import { Requirements } from './components/Requirements'
import { CatalogView } from './components/CatalogView'
import { CreditsPanel } from './components/CreditsPanel'
import { semLabel } from './lib/catalog'
import { activeSheet } from './lib/sheet'

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
    // כרטיסי ריחוף נסגרים במעבר לשונית (האלמנט שפתח אותם כבר לא קיים)
    hideChainCard()
    hideHoverCard()
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
      <SummaryBar setTab={setTab} />
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
