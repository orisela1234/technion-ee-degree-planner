import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowDownToLine, Ban, Check, LayoutGrid, Layers, NotebookPen, Palette, Plus, Rows3, Rows4, Spline, Wand2 } from 'lucide-react'
import { useStore } from '../lib/store'
import { focusColor, useUi } from '../lib/ui'
import { setColResolver, useDrag } from '../lib/drag'
import { checkPlacement, computeEdges, itemValidity, planMove } from '../lib/prereq'
import { CATEGORY_TITLE, CATEGORY_ORDER, HUE_LABEL, fmtPts, hueOf, nextSemCode, seasonOf, semLabel, semYears, COURSES, type Hue } from '../lib/catalog'
import { colorClass, gpa, itemCategory, itemName, itemPoints } from '../lib/requirements'
import { computeLayout, routeEdges, GRID, type Rect, type RoutedPath } from '../lib/layout'
import { chainsOf } from '../lib/chains'
import { chainAllocation } from '../lib/chainAlloc'
import { chainHover } from './ChainCard'
import { DegreeStatusBadge } from './AuditView'
import { itemStatus, isFailed, type PlanItem } from '../lib/types'
import { GROUPS } from '../data/track'
import { CourseCard, type CardMark } from './CourseCard'
import { findIssues, issueKeys } from '../lib/integrity'

const HUES: Hue[] = ['ee', 'math', 'phys', 'cs', 'gen', 'other']
const MARKER_CLASSES = [...HUES.map((h) => `hue-${h}`), ...CATEGORY_ORDER.map((c) => `cat-${c}`)]

const isGeneralColumn = (i: PlanItem) =>
  i.slot === 'sport' || i.slot === 'enrichment' || i.slot === 'free' || (!!i.courseId && hueOf(i.courseId) === 'gen')

/** "21-02-2027" → Date */
const parseExamDate = (d?: string) => {
  const m = d?.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null
}

/** מבחני הגמר בסמסטר: קורסים שיש להם מועד א/ב לפי צ'יזפורק; לסמסטר שכבר פורסם – גם התאריך */
function semesterExams(items: PlanItem[], sem: string) {
  const out = items
    // בלי פטורים (לא נבחנו) ובלי מקצועות של 0 נק' (כמו בטיחות במעבדות)
    .filter((i) => i.courseId && !i.slot && i.result?.kind !== 'exempt' && itemPoints(i) > 0 && COURSES[i.courseId]?.exams && (COURSES[i.courseId]!.exams!.examA || COURSES[i.courseId]!.exams!.examB))
    .map((i) => {
      const c = COURSES[i.courseId!]!
      const dated = c.examsSem === sem
      return { key: i.key, name: itemName(i), id: i.courseId!, pts: itemPoints(i), date: dated ? parseExamDate(c.exams!.examA) : null, examA: dated ? c.exams!.examA : undefined, examB: dated ? c.exams!.examB : undefined, tight: false }
    })
    .sort((a, b) => (a.date && b.date ? +a.date - +b.date : a.date ? -1 : b.date ? 1 : b.pts - a.pts))
  // שני מבחנים בהפרש של יומיים או פחות – מסומן
  for (let k = 1; k < out.length; k++) {
    const a = out[k - 1].date, b = out[k].date
    if (a && b && (+b - +a) / 86400000 <= 2) { out[k - 1].tight = true; out[k].tight = true }
  }
  return out
}

interface DropInfo { tone: 'ok' | 'warn' | 'push' | 'bad'; text: string; moves: Map<string, string> }

export function Flowchart() {
  const { state, dispatch } = useStore()
  const ui = useUi()
  const drag = useDrag()
  const density = state.density ?? 'comfortable'
  const G = GRID[density]
  const containerRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef(new Map<string, HTMLElement>())
  const rowRefs = useRef(new Map<string, HTMLElement>())
  const [paths, setPaths] = useState<RoutedPath[]>([])
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [ncols, setNcols] = useState(6)
  const [tick, setTick] = useState(0)

  const edges = useMemo(() => computeEdges(state), [state])
  const validity = useMemo(() => {
    const m = new Map<string, ReturnType<typeof itemValidity>>()
    state.items.forEach((i) => m.set(i.key, itemValidity(state, i)))
    return m
  }, [state])

  const bySem = useMemo(() => {
    const main = new Map<string, PlanItem[]>(), gen = new Map<string, PlanItem[]>()
    state.semesters.forEach((s) => { main.set(s, []); gen.set(s, []) })
    state.items.forEach((i) => (isGeneralColumn(i) ? gen : main).get(i.sem)?.push(i))
    return { main, gen }
  }, [state.items, state.semesters])

  const issueMap = useMemo(() => issueKeys(findIssues(state)), [state])
  const layout = useMemo(() => computeLayout(bySem.main, state.semesters, edges, ncols), [bySem, state.semesters, edges, ncols])

  // קורסים קשורים למה שמתחת לעכבר
  const related = useMemo(() => {
    if (!ui.hoverKey || drag.payload) return null
    const up = new Map<string, string[]>(), down = new Map<string, string[]>()
    edges.forEach((e) => {
      up.set(e.to, [...(up.get(e.to) ?? []), e.from])
      down.set(e.from, [...(down.get(e.from) ?? []), e.to])
    })
    const set = new Set<string>([ui.hoverKey])
    const walk = (k: string, g: Map<string, string[]>) => {
      for (const n of g.get(k) ?? []) if (!set.has(n)) { set.add(n); walk(n, g) }
    }
    walk(ui.hoverKey, up)
    walk(ui.hoverKey, down)
    return set
  }, [ui.hoverKey, edges, drag.payload])

  // מצב גרירה: לכל סמסטר – מותר/אסור/ידחוף
  const dragItem = drag.payload?.itemKey ? state.items.find((i) => i.key === drag.payload!.itemKey) : undefined
  const dropInfo = useMemo(() => {
    if (!drag.payload) return null
    const m = new Map<string, DropInfo>()
    for (const sem of state.semesters) {
      if (drag.payload.slot) {
        m.set(sem, { tone: 'ok', text: 'אפשר', moves: new Map() })
        continue
      }
      if (dragItem && (!dragItem.courseId || dragItem.sem === sem)) {
        m.set(sem, { tone: 'ok', text: dragItem.sem === sem ? 'שינוי מיקום' : 'אפשר', moves: new Map() })
        continue
      }
      if (dragItem) {
        const plan = planMove(state, dragItem.key, sem)
        const moves = new Map(plan.moves.filter((x) => x.key !== dragItem.key).map((x) => [x.key, x.to]))
        if (!plan.ok) m.set(sem, { tone: 'bad', text: plan.reasons[0] ?? 'לא אפשרי', moves })
        else if (moves.size) m.set(sem, { tone: 'push', text: `ידחוף ${moves.size} קורסים`, moves })
        else m.set(sem, { tone: plan.warnings.length ? 'warn' : 'ok', text: plan.warnings[0] ?? 'אפשר', moves })
      } else {
        const c = checkPlacement(state, { courseId: drag.payload.courseId, targetSem: sem })
        m.set(sem, { tone: c.ok ? (c.warnings.length ? 'warn' : 'ok') : 'bad', text: c.ok ? c.warnings[0] ?? 'אפשר' : c.reasons[0], moves: new Map() })
      }
    }
    return m
  }, [drag.payload, dragItem, state])

  const hoverDrop = drag.over.sem ? dropInfo?.get(drag.over.sem) : undefined
  const dragCourse = drag.payload?.courseId ?? dragItem?.courseId
  const dragMarks = useMemo(() => {
    const m = new Map<string, CardMark>()
    if (!drag.payload) return m
    if (dragItem) m.set(dragItem.key, 'origin')
    if (dragCourse) {
      edges.forEach((e) => {
        if (dragItem && e.to === dragItem.key) m.set(e.from, 'prereq')
        if (dragItem && e.from === dragItem.key) m.set(e.to, 'dependent')
      })
      if (!dragItem) {
        // קורס חדש: מסמנים את קורסי הקדם שלו שכבר בתרשים
        const pre = COURSES[dragCourse]?.prereqRaw ?? ''
        state.items.forEach((i) => { if (i.courseId && pre.includes(i.courseId) && !isFailed(i)) m.set(i.key, 'prereq') })
      }
    }
    return m
  }, [drag.payload, dragItem, dragCourse, edges, state.items])

  // מדידות: מספר עמודות, מיקומי כרטיסים, ניתוב החיצים
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const firstMain = el.querySelector<HTMLElement>('.sem-main')
    if (firstMain) {
      const avail = firstMain.clientWidth - 2 * G.pad
      const n = Math.max(2, Math.floor((avail + G.gap) / (G.w + G.gap)))
      if (n !== ncols) { setNcols(n); return }
    }
    const base = el.getBoundingClientRect()
    const rects = new Map<string, Rect>()
    const rowOf = new Map<string, number>()
    const semIndex = new Map(state.semesters.map((s, i) => [s, i]))
    cardRefs.current.forEach((node, key) => {
      if (!node.isConnected) return
      const r = node.getBoundingClientRect()
      rects.set(key, { l: r.left - base.left, t: r.top - base.top, r: r.right - base.left, b: r.bottom - base.top })
      const it = state.items.find((i) => i.key === key)
      if (it) rowOf.set(key, semIndex.get(it.sem) ?? 0)
    })
    const rows = state.semesters.map((sem, idx) => {
      const keys = [...rowOf.entries()].filter(([, r]) => r === idx).map(([k]) => rects.get(k)!)
      const rowEl = rowRefs.current.get(sem)
      const rr = rowEl?.getBoundingClientRect()
      const top = rr ? rr.top - base.top : 0, bottom = rr ? rr.bottom - base.top : 0
      return keys.length
        ? { cardsTop: Math.min(...keys.map((k) => k.t)), cardsBottom: Math.max(...keys.map((k) => k.b)) }
        : { cardsTop: top + 26, cardsBottom: bottom - 26 }
    })
    const gutters: number[] = []
    if (firstMain) {
      const mr = firstMain.getBoundingClientRect()
      const right = mr.right - base.left - G.pad
      gutters.push(right + Math.min(G.gap, G.pad) / 2)
      for (let c = 1; c <= ncols; c++) {
        const left = right - (c - 1) * (G.w + G.gap) - G.w
        gutters.push(left - (c < ncols ? G.gap / 2 : Math.min(G.gap, G.pad) / 2))
      }
    }
    setPaths(routeEdges(edges, rects, rowOf, rows, gutters, G.gap / 2 - 5))
    setSize({ w: el.scrollWidth, h: el.scrollHeight })
  }, [edges, state.items, state.semesters, layout, tick, ncols, density, G])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setTick((t) => t + 1))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // עמודה מתחת לסמן בזמן גרירה
  const ncolsRef = useRef(ncols)
  ncolsRef.current = ncols
  useEffect(() => {
    setColResolver((rowEl, x) => {
      const main = rowEl.querySelector<HTMLElement>('.sem-main')
      if (!main) return null
      const r = main.getBoundingClientRect()
      if (x < r.left || x > r.right) return null
      const offset = r.right - G.pad - x
      const col = Math.floor((offset + G.gap / 2) / (G.w + G.gap)) + 1
      return Math.min(ncolsRef.current, Math.max(1, col))
    })
    return () => setColResolver(null)
  }, [G])

  const lastSem = state.semesters[state.semesters.length - 1]
  const summerOptions = state.semesters
    .filter((s) => seasonOf(s) === 'spring' && s >= state.currentSem.slice(0, 4) + '01')
    .map((s) => `${s.slice(0, 4)}03`)
    .filter((s) => !state.semesters.includes(s))
  const showArrows = state.arrows === 'all' || (state.arrows === 'hover' && !!related)
  const lensOn = !!state.lens && state.selectedGroups.length > 0
  const chainKeys = useMemo(
    () => new Set(state.items.filter((i) => chainsOf(i.courseId, state.selectedGroups).length).map((i) => i.key)),
    [state.items, state.selectedGroups],
  )
  const hasPins = state.items.some((i) => i.col != null)
  const colorBy = state.colorBy ?? 'category'
  const legend = useMemo(() => {
    const live = state.items.filter((i) => !isFailed(i))
    return colorBy === 'category'
      ? CATEGORY_ORDER.map((c) => {
        const its = live.filter((i) => itemCategory(i) === c)
        return { cls: `cat-${c}`, focus: `k-${c}`, label: CATEGORY_TITLE[c], n: its.length, pts: its.reduce((a, i) => a + itemPoints(i), 0) }
      })
      : HUES.map((h) => {
        const its = live.filter((i) => !i.slot && hueOf(i.courseId) === h)
        return { cls: `hue-${h}`, focus: `hue-${h}`, label: HUE_LABEL[h], n: its.length, pts: its.reduce((a, i) => a + itemPoints(i), 0) }
      })
  }, [state.items, colorBy])
  useEffect(() => () => focusColor(null), [])

  const alloc = chainAllocation(state)
  const renderCard = (i: PlanItem, compact = false) => {
    const pos = layout.get(i.key)
    const chains = chainsOf(i.courseId, state.selectedGroups)
    const assignedGid = i.courseId ? alloc.assign.get(i.courseId) : undefined
    const assignedChain = assignedGid != null ? state.selectedGroups.findIndex((s) => s.id === assignedGid) : undefined
    const moveTo = hoverDrop?.moves.get(i.key)
    return (
      <CourseCard
        key={i.key}
        item={i}
        validity={validity.get(i.key)}
        dim={(!!related && !related.has(i.key)) || (!!drag.payload && !dragMarks.has(i.key) && !moveTo)}
        highlight={!!related && related.has(i.key)}
        chains={chains}
        assignedChain={assignedChain}
        lens={!!state.lens && state.selectedGroups.length > 0}
        mark={dragMarks.get(i.key) ?? null}
        willMoveTo={moveTo}
        issue={issueMap.get(i.key)}
        compact={compact || density === 'compact'}
        style={!compact && pos ? { gridColumn: pos.col, gridRow: pos.line } : undefined}
        refCb={(n) => (n ? cardRefs.current.set(i.key, n) : cardRefs.current.delete(i.key))}
      />
    )
  }

  return (
    <div className={`chart-wrap density-${density} ${drag.payload ? 'dragging' : ''}`}>
      <div className="chart-toolbar">
        <div className="tb-group tb-status"><DegreeStatusBadge /></div>
        <div className="tb-group">
          <span className="tb-label"><Layers size={14} /> שרשראות</span>
          {state.selectedGroups.length === 0 && <span className="muted small">לא נבחרו – בחרו בלשונית "שרשראות"</span>}
          {state.selectedGroups.map((s, i) => (
            <span key={s.id} className={`chain-chip c${i + 1}`} tabIndex={0} {...chainHover(s.id)}>
              <b>{i + 1}</b> {GROUPS.find((g) => g.id === s.id)?.short}{s.double ? ' – כפולה' : ''}
            </span>
          ))}
          {state.selectedGroups.length > 0 && (
            <button className={`tb-btn ${state.lens ? 'on' : ''}`} onClick={() => dispatch({ type: 'setLens', lens: !state.lens })} aria-pressed={!!state.lens}>
              הדגש בתרשים
            </button>
          )}
        </div>
        <div className="tb-group">
          <span className="tb-label"><Spline size={14} /> חיצים</span>
          <div className="seg small">
            {(['all', 'hover', 'none'] as const).map((a) => (
              <button key={a} className={state.arrows === a ? 'on' : ''} onClick={() => dispatch({ type: 'setArrows', arrows: a })}>
                {a === 'all' ? 'הכל' : a === 'hover' ? 'במעבר עכבר' : 'ללא'}
              </button>
            ))}
          </div>
        </div>
        <div className="tb-group">
          <div className="seg small" aria-label="צפיפות">
            <button className={density === 'comfortable' ? 'on' : ''} onClick={() => dispatch({ type: 'setDensity', density: 'comfortable' })} title="מרווח"><Rows3 size={14} /></button>
            <button className={density === 'compact' ? 'on' : ''} onClick={() => dispatch({ type: 'setDensity', density: 'compact' })} title="צפוף"><Rows4 size={14} /></button>
          </div>
          <span className="tb-label"><Palette size={14} /> צבע לפי</span>
          <div className="seg small" aria-label="צביעת הקורסים">
            <button className={colorBy === 'category' ? 'on' : ''} onClick={() => dispatch({ type: 'setColorBy', colorBy: 'category' })} title="חובה / בחירה פקולטית / מעבדה / מל&quot;ג / ספורט / כללי">סיווג</button>
            <button className={colorBy === 'subject' ? 'on' : ''} onClick={() => dispatch({ type: 'setColorBy', colorBy: 'subject' })} title="חשמל / מתמטיקה / פיזיקה / מדמ&quot;ח…">תחום</button>
          </div>
          {hasPins && (
            <button className="tb-btn" onClick={() => dispatch({ type: 'unpinAll' })} title="מבטל את המיקומים הידניים ומסדר לפי שרשראות הקדם">
              <Wand2 size={14} /> סידור אוטומטי
            </button>
          )}
        </div>
        <div className="cat-legend" role="list" aria-label="מקרא צבעים">
          <span className="lg-title">{colorBy === 'category' ? 'מקרא סיווג:' : 'מקרא תחומים:'}</span>
          {legend.filter((l) => colorBy === 'category' || l.n > 0).map((l) => (
            <span
              key={l.cls} role="listitem" tabIndex={0} className={`lg-cat ${l.cls}`}
              title={`${l.label}: ${l.n} קורסים בתרשים · ${fmtPts(l.pts)} נק"ז – מעבר עכבר מדגיש אותם`}
              onMouseEnter={() => focusColor(l.focus)} onMouseLeave={() => focusColor(null)}
              onFocus={() => focusColor(l.focus)} onBlur={() => focusColor(null)}
            >
              <i aria-hidden /><b>{l.label}</b><small>{l.n}</small>
            </span>
          ))}
        </div>
      </div>

      <div className="chart" ref={containerRef}>
        <svg className="arrows" width={size.w} height={size.h} aria-hidden>
          <defs>
            {MARKER_CLASSES.map((h) => (
              <marker key={h} id={`ah-${h}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" className={`ah ${h}`} />
              </marker>
            ))}
          </defs>
          {showArrows && paths.map((p) => {
            const hue = colorClass(colorBy, state.items.find((i) => i.key === p.edge.from))
            const on = !related || (related.has(p.edge.from) && related.has(p.edge.to))
            const dragOn = drag.payload && dragItem && (p.edge.from === dragItem.key || p.edge.to === dragItem.key)
            const lensDim = lensOn && !related && !drag.payload && !chainKeys.has(p.edge.to)
            return (
              <path
                key={`${p.edge.from}-${p.edge.to}-${p.edge.kind}`}
                d={p.d}
                className={`edge ${hue} ${p.edge.kind} ${related ? (on ? 'on' : 'off') : ''} ${drag.payload ? (dragOn ? 'on' : 'off') : ''} ${lensDim ? 'off' : ''}`}
                markerEnd={`url(#ah-${hue})`}
              />
            )
          })}
        </svg>

        {state.semesters.map((sem, idx) => {
          const main = bySem.main.get(sem) ?? []
          const general = bySem.gen.get(sem) ?? []
          const items = [...main, ...general]
          const pts = items.filter((i) => !isFailed(i)).reduce((a, i) => a + itemPoints(i), 0)
          const semGpa = gpa(items)
          const statuses = items.map((i) => itemStatus(i, state.currentSem))
          const status = sem === state.currentSem ? 'current'
            : sem < state.currentSem ? (statuses.some((s) => s === 'pending') ? 'pending' : 'done') : 'future'
          const info = dropInfo?.get(sem)
          const isOver = drag.over.sem === sem && !drag.over.slotKey
          const lines = Math.max(1, ...main.map((i) => layout.get(i.key)?.line ?? 1))
          return (
            <section
              key={sem}
              data-sem={sem}
              ref={(n) => (n ? rowRefs.current.set(sem, n) : rowRefs.current.delete(sem))}
              className={`sem-row st-${status} ${info ? `drop-${info.tone}` : ''} ${isOver ? 'is-over' : ''}`}
            >
              <div className="sem-general">{general.map((i) => renderCard(i, true))}</div>
              <div
                className="sem-main"
                style={{ gridTemplateColumns: `repeat(${ncols}, ${G.w}px)`, columnGap: G.gap, padding: `26px ${G.pad}px` }}
              >
                {main.map((i) => renderCard(i))}
                {isOver && drag.over.col != null && info?.tone !== 'bad' && (
                  <div className="drop-slot" style={{ gridColumn: drag.over.col, gridRow: 1 }} aria-hidden>
                    <Plus size={18} />
                  </div>
                )}
                {items.length === 0 && !isOver && (
                  <div className="sem-empty" style={{ gridColumn: `1 / span ${ncols}`, gridRow: lines }}>גררו לכאן קורסים מהמאגר</div>
                )}
              </div>
              <div className="sem-label">
                <div className="sem-index">{String.fromCharCode(0x05d0 + idx)}</div>
                <div className="sem-name">{semLabel(sem)}</div>
                <div className="sem-years">{semYears(sem)}</div>
                <div className={`sem-pts ${pts > 24 ? 'heavy' : ''}`}>{fmtPts(pts)} נק"ז</div>
                <div className="load-meter" title="עומס: 18–22 נק״ז נחשב סמסטר מלא">
                  <i style={{ width: `${Math.min(100, (pts / 24) * 100)}%` }} className={pts > 24 ? 'over' : pts >= 18 ? 'full' : ''} />
                </div>
                {semGpa != null && <div className="sem-gpa">ממוצע {semGpa.toFixed(1)}</div>}
                {(() => {
                  if (!items.some((i) => i.courseId)) return null
                  const exams = semesterExams(items, sem)
                  if (!exams.length) return <div className="sem-exams none">אין מבחני גמר</div>
                  const examPts = exams.reduce((a, e) => a + e.pts, 0)
                  const tight = exams.some((e) => e.tight)
                  return (
                    <div className="sem-exams" aria-label={`${exams.length} מבחני גמר בסמסטר`}>
                      <div className="se-head">
                        <NotebookPen size={11} aria-hidden /> {exams.length} {exams.length === 1 ? 'מבחן' : 'מבחנים'} · {fmtPts(examPts)} נק"ז
                        {tight && <AlertTriangle size={11} className="se-warn" aria-label="מבחנים צמודים" />}
                      </div>
                      <ul>
                        {exams.map((e) => (
                          <li
                            key={e.key} className={e.tight ? 'tight' : ''}
                            title={`${e.name} (${e.id}) · ${fmtPts(e.pts)} נק"ז${e.examA ? ` · מועד א' ${e.examA}` : ''}${e.examB ? ` · מועד ב' ${e.examB}` : ''}${e.tight ? ' · צמוד למבחן אחר (יומיים או פחות)' : ''}`}
                          >
                            <span className="se-name">{e.name}</span>
                            {e.date && <span className="se-date">{e.date.getDate()}.{e.date.getMonth() + 1}</span>}
                            <span className="se-pts">{fmtPts(e.pts)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })()}
                <div className={`sem-chip chip-${status}`}>
                  {status === 'current' ? 'הסמסטר הנוכחי' : status === 'pending' ? 'ממתין לציונים' : status === 'done' ? 'הושלם' : 'עתידי'}
                </div>
                {items.length === 0 && !drag.payload && (
                  <button className="link-btn small" onClick={() => dispatch({ type: 'removeSem', code: sem })}>הסר סמסטר</button>
                )}
              </div>
              {info && (isOver || info.tone === 'bad') && (
                <div className={`drop-banner t-${info.tone} ${isOver ? 'strong' : ''}`}>
                  {info.tone === 'bad' ? <Ban size={14} /> : info.tone === 'push' ? <ArrowDownToLine size={14} /> : <Check size={14} />}
                  <span>{isOver ? (info.tone === 'bad' ? `${info.text}${info.text.startsWith('חסר קדם') ? ' · אפשר לשבץ באישור חריג' : ''}` : info.tone === 'push' ? `שחררו כאן · ${info.text} קדימה (מסומנים בכתום)` : `שחררו כאן · ${semLabel(sem)}`) : info.text}</span>
                </div>
              )}
            </section>
          )
        })}
      </div>

      <div className="chart-actions">
        <button className="btn ghost" onClick={() => dispatch({ type: 'addSem', code: nextSemCode(lastSem) })}>
          <Plus size={15} /> סמסטר {semLabel(nextSemCode(lastSem))}
        </button>
        {summerOptions.map((s) => (
          <button key={s} className="btn ghost" onClick={() => dispatch({ type: 'addSem', code: s })}>
            <Plus size={15} /> {semLabel(s)}
          </button>
        ))}
        <span className="spacer" />
        <span className="legend">
          <span className="lg"><i className="lg-line" /> קדם</span>
          <span className="lg"><i className="lg-line dashed" /> צמוד</span>
          <span className="lg"><i className="lg-box invalid" /> חסרה דרישה</span>
          <span className="lg"><LayoutGrid size={13} /> גררו לעמודה מסוימת כדי לקבע מיקום</span>
        </span>
      </div>
    </div>
  )
}
