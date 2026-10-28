import { useSyncExternalStore } from 'react'
import { Check, CircleDot, Pin } from 'lucide-react'
import { useStore } from '../lib/store'
import { useDrag } from '../lib/drag'
import { COURSES, semLabel } from '../lib/catalog'
import { chainAllocation } from '../lib/chainAlloc'
import { variantLabel } from '../lib/chains'
import { GROUPS } from '../data/track'
import { isDone, isFailed } from '../lib/types'
import { hideHoverCard } from './HoverCard'

interface CC { gid: number; x: number; y: number; above: boolean }
let current: CC | null = null
let timer = 0
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

/** כרטיס "מה בחרתי מהשרשרת הזאת" – מופיע במעבר עכבר על כל סימון של שרשרת במסך, ומדגיש את הקורסים שלה בתרשים */
export function showChainCard(gid: number, el: HTMLElement) {
  window.clearTimeout(timer)
  hideHoverCard()
  document.documentElement.dataset.fchain = String(gid)
  timer = window.setTimeout(() => {
    const r = el.getBoundingClientRect()
    const above = r.bottom + 300 > window.innerHeight
    current = { gid, x: r.left + r.width / 2, y: above ? r.top - 8 : r.bottom + 8, above }
    emit()
  }, 220)
}
export function hideChainCard() {
  window.clearTimeout(timer)
  delete document.documentElement.dataset.fchain
  if (current) { current = null; emit() }
}

/** מאזיני ריחוף לכל אלמנט שמייצג שרשרת */
export const chainHover = (gid: number) => ({
  onMouseEnter: (e: React.MouseEvent<HTMLElement>) => { e.stopPropagation(); showChainCard(gid, e.currentTarget) },
  onMouseLeave: () => hideChainCard(),
  onFocus: (e: React.FocusEvent<HTMLElement>) => showChainCard(gid, e.currentTarget),
  onBlur: () => hideChainCard(),
})

export function ChainCard() {
  const cc = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => current)
  const { state } = useStore()
  const drag = useDrag()
  if (!cc || drag.payload) return null
  const idx = state.selectedGroups.findIndex((s) => s.id === cc.gid)
  const g = GROUPS.find((x) => x.id === cc.gid)
  if (!g) return null
  const sel = state.selectedGroups[idx]
  const alloc = chainAllocation(state)
  const ev = alloc.plan.get(cc.gid)
  const evDone = alloc.done.get(cc.gid)
  const nameOf = (id: string) => COURSES[id]?.name ?? id
  const itemOf = (id: string) => state.items.find((i) => i.courseId === id && !isFailed(i))
  const mine = [...alloc.assign].filter(([, gid]) => gid === cc.gid).map(([id]) => id)
    .sort((a, b) => (itemOf(a)?.sem ?? '').localeCompare(itemOf(b)?.sem ?? ''))
  // קורסים מהשרשרת הזאת שנספרים בשרשרת אחרת
  const elsewhere = [...alloc.options].filter(([id, opts]) => opts.includes(cc.gid) && alloc.assign.get(id) !== cc.gid)
  const left = Math.min(window.innerWidth - 170, Math.max(170, cc.x))

  return (
    <div className={`chaincard ${idx >= 0 ? `c${idx + 1}` : ''} ${cc.above ? 'above' : ''}`} style={{ left, top: cc.y }} role="tooltip">
      <div className="ccd-head">
        {idx >= 0 && <span className={`chain-dot c${idx + 1}`}>{idx + 1}</span>}
        <b>{variantLabel(g, !!sel?.double)}</b>
      </div>
      {!sel || !ev ? (
        <p className="muted small">השרשרת לא נבחרה – בחרו אותה בלשונית "שרשראות".</p>
      ) : (
        <>
          <div className={`ccd-count ${ev.complete ? 'ok' : ''}`}>
            {ev.count}/{ev.need} קורסים בתכנון · {evDone?.count ?? 0} הושלמו{ev.complete ? ' · ✓ סגורה' : ` · חסרים ${Math.max(0, ev.need - ev.count)}`}
          </div>
          {mine.length === 0 && <p className="muted small">עוד לא בחרת קורסים מהשרשרת הזאת.</p>}
          <ul className="ccd-list">
            {mine.map((id) => {
              const it = itemOf(id)
              const done = !!it && isDone(it)
              return (
                <li key={id}>
                  {done ? <Check size={12} className="ok" aria-hidden /> : <CircleDot size={12} aria-hidden />}
                  <span>{nameOf(id)}</span>
                  <span className="mono">{id}</span>
                  {alloc.pinned.has(id) && <Pin size={11} aria-label="שויך ידנית" />}
                  <span className="muted">{done ? 'הושלם' : it ? semLabel(it.sem) : ''}</span>
                </li>
              )
            })}
          </ul>
          {ev.rules.some((r) => !r.ok) && (
            <div className="ccd-missing">{ev.rules.filter((r) => !r.ok).map((r) => <div key={r.text}>✗ {r.text}</div>)}</div>
          )}
          {elsewhere.length > 0 && (
            <div className="ccd-else">
              {elsewhere.map(([id]) => {
                const other = state.selectedGroups.findIndex((s) => s.id === alloc.assign.get(id))
                return <div key={id}>↔ {nameOf(id)} – נספר בשרשרת {other + 1}</div>
              })}
            </div>
          )}
          {alloc.options.size > 0 && [...alloc.options.values()].some((o) => o.length > 1) && (
            <p className="ccd-hint">קורס משותף נספר רק בשרשרת אחת. לחיצה על נקודת שרשרת בכרטיס הקורס מעבירה אותו אליה.</p>
          )}
        </>
      )}
    </div>
  )
}
