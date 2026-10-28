import { useEffect, useMemo, useRef } from 'react'
import { ArrowDownToLine, Ban, Check, Trash2, Replace } from 'lucide-react'
import { useStore } from '../lib/store'
import { SLOT_INFO } from '../data/track'
import { useUi } from '../lib/ui'
import { usePlanActions } from '../lib/actions'
import { setDropHandler, setGhostEl, useDrag, type DragOver, type DragPayload } from '../lib/drag'
import { checkPlacement, planMove } from '../lib/prereq'
import { COURSES, fmtPts, semLabel } from '../lib/catalog'
import { colorClass, itemName, itemPoints } from '../lib/requirements'

/** הכרטיס הצף בזמן גרירה + ביצוע ההפלה */
export function DragLayer() {
  const { state, dispatch } = useStore()
  const ui = useUi()
  const { place, remove } = usePlanActions()
  const drag = useDrag()
  const ghostRef = useRef<HTMLDivElement>(null)
  const handlerRef = useRef<(p: DragPayload, o: DragOver) => void>()

  handlerRef.current = (p, over) => {
    if (p.slot) {
      // משבצת כללית חדשה – נכנסת לכל סמסטר, בלי בדיקת קדמים
      const sem = over.sem ?? (over.slotKey ? state.items.find((i) => i.key === over.slotKey)?.sem : null)
      if (!sem || over.pool) return
      dispatch({ type: 'addSlot', slot: p.slot.type, points: p.slot.points, sem, col: over.slotKey ? null : over.col })
      ui.toast(`"${SLOT_INFO[p.slot.type].label}" (${fmtPts(p.slot.points)} נק"ז) נוסף ל${semLabel(sem)}`, 'info',
        ['לחיצה על המשבצת בתרשים מאפשרת לבחור מעבדה מסוימת מהרשימה'], { label: 'בטל', run: () => dispatch({ type: 'undo' }) })
      return
    }
    const item = p.itemKey ? state.items.find((i) => i.key === p.itemKey) : undefined
    if (over.pool) {
      if (item) remove(item.key)
      return
    }
    if (over.slotKey && p.courseId) {
      const slot = state.items.find((i) => i.key === over.slotKey)
      if (slot && place({ courseId: p.courseId, sem: slot.sem, replaceSlotKey: slot.key })) ui.setSlotTarget(null)
      return
    }
    if (over.sem) place({ itemKey: p.itemKey, courseId: p.courseId, sem: over.sem, col: over.col })
  }

  useEffect(() => {
    setDropHandler((p, o) => handlerRef.current?.(p, o))
    return () => setDropHandler(null)
  }, [])

  useEffect(() => {
    setGhostEl(ghostRef.current)
  })

  const p = drag.payload
  const item = p?.itemKey ? state.items.find((i) => i.key === p.itemKey) : undefined
  const courseId = p?.courseId ?? item?.courseId
  const over = drag.over

  const verdict = useMemo(() => {
    if (!p) return null
    if (p.slot) {
      if (over.pool) return { tone: 'muted', text: 'גררו לסמסטר בתרשים' }
      const sem = over.sem ?? (over.slotKey ? state.items.find((i) => i.key === over.slotKey)?.sem : null)
      return sem ? { tone: 'ok', text: `הוספה ל${semLabel(sem)}` } : { tone: 'muted', text: 'גררו לשורת סמסטר' }
    }
    if (over.pool) return item ? { tone: 'out', text: 'הוצאה מהתכנון' } : { tone: 'muted', text: 'גררו לסמסטר בתרשים' }
    if (over.slotKey && p.courseId) return { tone: 'ok', text: 'החלפת המשבצת בקורס' }
    if (!over.sem) return { tone: 'muted', text: 'גררו לשורת סמסטר' }
    if (item && item.sem === over.sem) return { tone: 'ok', text: 'שינוי מיקום בשורה' }
    if (item && !item.courseId) return { tone: 'ok', text: semLabel(over.sem) }
    if (item) {
      const plan = planMove(state, item.key, over.sem)
      if (!plan.ok) return { tone: 'bad', text: plan.reasons[0]?.startsWith('חסר קדם') ? `${plan.reasons[0]} · שחרור יבקש אישור חריג` : plan.reasons[0] ?? 'לא אפשרי' }
      const pushed = plan.moves.length - 1
      return pushed > 0
        ? { tone: 'push', text: `${semLabel(over.sem)} · ידחוף ${pushed} קורסים קדימה` }
        : { tone: 'ok', text: semLabel(over.sem) }
    }
    const c = checkPlacement(state, { courseId, targetSem: over.sem })
    return c.ok ? { tone: 'ok', text: semLabel(over.sem) } : { tone: 'bad', text: c.reasons[0]?.startsWith('חסר קדם') ? `${c.reasons[0]} · שחרור יבקש אישור חריג` : c.reasons[0] ?? 'לא אפשרי' }
  }, [p, over, item, courseId, state])

  if (!p) return <div ref={ghostRef} className="drag-ghost hidden" />

  const name = p.slot ? SLOT_INFO[p.slot.type].label : item ? itemName(item) : COURSES[courseId ?? '']?.name ?? ''
  const pts = p.slot ? p.slot.points : item ? itemPoints(item) : COURSES[courseId ?? '']?.points ?? 0
  const Icon = verdict?.tone === 'bad' ? Ban : verdict?.tone === 'out' ? Trash2 : verdict?.tone === 'push' ? ArrowDownToLine : over.slotKey ? Replace : Check

  return (
    <div ref={ghostRef} className={`drag-ghost ${colorClass(state.colorBy, p.slot ? { key: '', slot: p.slot.type, sem: '' } : item, courseId)}`}>
      <div className="dg-card">
        <div className="card-top"><span className="cid">{p.slot ? 'משבצת כללית' : courseId ?? ''}</span><span className="pts">{fmtPts(pts)}</span></div>
        <div className="card-name">{name}</div>
      </div>
      {verdict && (
        <div className={`dg-verdict v-${verdict.tone}`}>
          <Icon size={13} aria-hidden /> {verdict.text}
        </div>
      )}
    </div>
  )
}
