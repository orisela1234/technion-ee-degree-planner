import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

export type Tone = 'error' | 'ok' | 'info' | 'warn'
export interface Toast {
  id: number
  title: string
  lines?: string[]
  tone: Tone
  action?: { label: string; run: () => void }
}

export type PoolFilter = 'mandatory' | 'groups' | 'faculty' | 'labs' | 'enrichment' | 'sport' | 'english' | 'all'

interface UiCtx {
  selected: { courseId?: string; itemKey?: string } | null
  openCourse: (courseId?: string, itemKey?: string) => void
  closeCourse: () => void
  hoverKey: string | null
  setHoverKey: (k: string | null) => void
  toasts: Toast[]
  toast: (title: string, tone?: Tone, lines?: string[], action?: Toast['action']) => void
  dismiss: (id: number) => void
  poolFilter: PoolFilter
  setPoolFilter: (f: PoolFilter) => void
  /** קבוצה אחת, או 'mine' = כל השרשראות שבחרתי */
  poolGroup: number | 'mine' | null
  setPoolGroup: (g: number | 'mine' | null) => void
  slotTarget: string | null
  setSlotTarget: (k: string | null) => void
  poolOpen: boolean
  setPoolOpen: (v: boolean) => void
  poolW: number
  setPoolW: (w: number) => void
}

const Ctx = createContext<UiCtx | null>(null)

export function UiProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<UiCtx['selected']>(null)
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [poolFilter, setPoolFilter] = useState<PoolFilter>('groups')
  const [poolGroup, setPoolGroup] = useState<UiCtx['poolGroup']>('mine')
  const [slotTarget, setSlotTarget] = useState<string | null>(null)
  const [poolOpen, setPoolOpen] = useState(true)
  const [poolW, setPoolWState] = useState<number>(() => {
    try { return Number(localStorage.getItem('degree-planner:poolW')) || 340 } catch { return 340 }
  })
  const setPoolW = useCallback((w: number) => {
    const v = Math.round(Math.min(620, Math.max(260, w)))
    setPoolWState(v)
    try { localStorage.setItem('degree-planner:poolW', String(v)) } catch { /* ignore */ }
  }, [])
  const seq = useRef(0)

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const toast = useCallback((title: string, tone: Tone = 'info', lines?: string[], action?: Toast['action']) => {
    const id = ++seq.current
    setToasts((t) => [...t.slice(-3), { id, title, tone, lines, action }])
    window.setTimeout(() => dismiss(id), action ? 9000 : tone === 'error' ? 7000 : 4000)
  }, [dismiss])

  const value = useMemo<UiCtx>(() => ({
    selected,
    openCourse: (courseId, itemKey) => setSelected({ courseId, itemKey }),
    closeCourse: () => setSelected(null),
    hoverKey, setHoverKey,
    toasts, toast, dismiss,
    poolFilter, setPoolFilter,
    poolGroup, setPoolGroup,
    slotTarget, setSlotTarget,
    poolOpen, setPoolOpen,
    poolW, setPoolW,
  }), [selected, hoverKey, toasts, toast, dismiss, poolFilter, poolGroup, slotTarget, poolOpen, poolW, setPoolW])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useUi() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useUi outside provider')
  return c
}

/** הדגשת סיווג/תחום בתרשים (מעבר עכבר על הפס העליון או על המקרא) */
export function focusColor(cls: string | null) {
  const el = document.documentElement
  if (cls) el.dataset.fcls = cls
  else delete el.dataset.fcls
}
