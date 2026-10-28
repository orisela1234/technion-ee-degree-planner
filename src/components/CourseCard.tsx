import { memo } from 'react'
import { ChevronDown, ChevronUp, CircleDashed, Lock, PencilLine, Trash2 } from 'lucide-react'
import type { IssueKind } from '../lib/integrity'
import { verifyState } from '../lib/grades'
import { useStore } from '../lib/store'
import { useUi, type PoolFilter } from '../lib/ui'
import { usePlanActions } from '../lib/actions'
import { beginDrag } from '../lib/drag'
import { CATEGORY_LABEL, CATEGORY_SHORT, englishSems, englishStatus, fmtPts, semLabel } from '../lib/catalog'
import { colorClass, itemCategory, itemName, itemPoints } from '../lib/requirements'
import { itemStatus, type PlanItem } from '../lib/types'
import type { ItemValidity } from '../lib/prereq'
import { SLOT_INFO } from '../data/track'
import { showHoverCard, hideHoverCard } from './HoverCard'
import { openGradeEditor, useGradeEditorKey } from './GradeEditor'
import { chainHover } from './ChainCard'

const SLOT_FILTER: Record<string, PoolFilter> = {
  lab: 'labs', sport: 'sport', enrichment: 'enrichment', facultyElective: 'faculty', free: 'all',
}

export type CardMark = 'origin' | 'prereq' | 'dependent' | null

interface Props {
  item: PlanItem
  validity?: ItemValidity
  dim?: boolean
  highlight?: boolean
  compact?: boolean
  chains?: number[]
  /** האינדקס של השרשרת שבה הקורס נספר (מבין שנבחרו) */
  assignedChain?: number
  lens?: boolean
  mark?: CardMark
  willMoveTo?: string
  issue?: IssueKind
  style?: React.CSSProperties
  refCb?: (n: HTMLDivElement | null) => void
}

function CourseCardImpl({ item, validity, dim, highlight, compact, chains = [], assignedChain, lens, mark, willMoveTo, issue, style, refCb }: Props) {
  const { state, dispatch } = useStore()
  const ui = useUi()
  const { shift, remove } = usePlanActions()
  const status = itemStatus(item, state.currentSem)
  const colorCls = colorClass(state.colorBy, item)
  const cat = itemCategory(item)
  // חובה בלי תווית; בחירה פקולטית שבתוך שרשרת שנבחרה מסומנת "שרשרת"
  const catTag = item.slot || cat === 'mandatory' ? null : cat === 'faculty' && chains.length ? 'שרשרת' : CATEGORY_SHORT[cat]
  const invalid = validity && !validity.ok
  const warn = validity && validity.ok && validity.warnings.length > 0
  const expected = state.expected[item.key]
  const isSlot = !!item.slot
  const locked = !!item.result
  const shared = chains.length > 1
  const editorKey = useGradeEditorKey()
  const editable = !isSlot && !!item.courseId && item.result?.kind !== 'exempt'
  const openEditor = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation()
    hideHoverCard()
    openGradeEditor(item.key, e.currentTarget)
  }
  const v = isSlot ? { state: 'none' as const } : verifyState(item)
  const vMark = v.state === 'edited' ? 'edited' : v.state === 'unverified' || (!item.result && expected != null) ? 'unverified' : null

  const badge = (() => {
    if (status === 'failed' && item.result?.kind === 'grade') return <span className="badge fail" title="נכשל – צריך מועד חוזר">{item.result.grade} · נכשל</span>
    if (item.binary && item.result) return <span className="badge pass" title={item.result.kind === 'grade' ? `ציון ${item.result.grade} – לא נכנס לממוצע` : undefined}>עובר בינארי</span>
    if (item.result?.kind === 'grade') return <span className="badge grade">{item.result.grade}</span>
    if (item.result?.kind === 'pass') return <span className="badge pass">עובר</span>
    if (item.result?.kind === 'exempt') return <span className="badge exempt">פטור</span>
    if (item.binary) return <span className="badge expected" title="מתוכנן כעובר בינארי">בינארי</span>
    if (expected != null) return <span className="badge expected" title="ציון צפוי – לא מאומת">~{expected}</span>
    if (status === 'current') return <span className="badge now">בלימוד</span>
    if (status === 'pending') return <span className="badge pending">ציון?</span>
    return null
  })()

  return (
    <div
      ref={refCb}
      style={style}
      data-slot-key={isSlot ? item.key : undefined}
      data-chain={assignedChain != null ? state.selectedGroups[assignedChain]?.id : undefined}
      className={[
        'card', colorCls, `k-${cat}`, state.colorBy !== 'subject' ? 'by-cat' : '', `st-${status}`, editorKey === item.key ? 'editing' : '',
        invalid ? (item.waived ? 'waived' : 'invalid') : '', warn ? 'warn' : '', dim ? 'dim' : '', highlight ? 'hl' : '',
        compact ? 'compact' : '', isSlot ? 'slot' : '', ui.slotTarget === item.key ? 'slot-target' : '',
        lens && chains.length ? 'in-chain' : '', lens && !chains.length && !isSlot ? 'lens-out' : '',
        shared ? 'shared' : '', mark ? `mark-${mark}` : '', willMoveTo ? 'will-move' : '', issue === 'duplicate' ? 'dup' : '',
      ].join(' ')}
      onPointerDown={(e) => { hideHoverCard(); beginDrag(e, { itemKey: item.key }) }}
      onMouseEnter={(e) => {
        if (isSlot) return
        ui.setHoverKey(item.key)
        showHoverCard(item.courseId, item.key, e.currentTarget)
      }}
      onMouseLeave={() => { ui.setHoverKey(null); hideHoverCard() }}
      onClick={() => {
        hideHoverCard()
        if (isSlot) {
          ui.setPoolFilter(SLOT_FILTER[item.slot!] ?? 'all')
          ui.setSlotTarget(ui.slotTarget === item.key ? null : item.key)
        } else ui.openCourse(item.courseId, item.key)
      }}
      title={[...(validity?.reasons ?? []), ...(validity?.warnings ?? [])].join('\n') || undefined}
      role="button"
      tabIndex={0}
      aria-label={`${itemName(item)}, ${CATEGORY_LABEL[cat]}, ${semLabel(item.sem)}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !isSlot) ui.openCourse(item.courseId, item.key)
        if (!locked && e.altKey && e.key === 'ArrowDown') { e.preventDefault(); shift(item.key, 1) }
        if (!locked && e.altKey && e.key === 'ArrowUp') { e.preventDefault(); shift(item.key, -1) }
        if ((e.key === 'Delete' || e.key === 'Backspace') && !locked) { e.preventDefault(); remove(item.key) }
      }}
    >
      {chains.length > 0 && (
        <div className="chain-bar" aria-hidden>
          {chains.map((i) => <i key={i} className={`c${i + 1}`} />)}
        </div>
      )}
      <div className="card-top">
        <span className="cid">{isSlot ? SLOT_INFO[item.slot!].label : item.courseId}</span>
        {(() => {
          const en = isSlot ? null : englishStatus(item.courseId, item.sem)
          return en && (
            <span className={`en-tag ${en}`} title={en === 'yes' ? `נלמד באנגלית בסמסטר הזה – נספר לחובת 2 הקורסים באנגלית` : `נלמד באנגלית ב: ${englishSems(item.courseId!).map((s) => (s === '*' ? 'תמיד' : semLabel(s))).join(', ')} – לא בסמסטר הזה`}>EN</span>
          )
        })()}
        {catTag && <span className="cat-tag" title={catTag === 'שרשרת' ? `${CATEGORY_LABEL.faculty} – בשרשרת שבחרת` : CATEGORY_LABEL[cat]}>{catTag}</span>}
        <span className="pts">{fmtPts(itemPoints(item))}</span>
      </div>
      <div className="card-name">{isSlot ? 'לחצו לבחירה מהמאגר' : itemName(item)}</div>
      {(badge || invalid || warn || chains.length > 0) && (
        <div className="card-foot">
          {badge && editable ? (
            <button
              className={`badge-btn ${vMark ? `v-${vMark}` : ''}`}
              title={vMark === 'edited'
                ? `הציון נערך ידנית – לא תואם לגיליון (בגיליון: ${v.sheetText ?? 'אין'}). לחצו לעריכה או להחזרה`
                : vMark === 'unverified' ? 'ציון שהוזן ידנית – עדיין לא מאומת מגיליון הציונים' : 'עריכת ציון / עובר בינארי'}
              aria-label={`עריכת ציון: ${itemName(item)}${vMark === 'edited' ? ' (נערך, לא תואם לגיליון)' : ''}`}
              onPointerDown={(e) => e.stopPropagation()} onClick={openEditor}
            >
              {vMark === 'edited' && <PencilLine size={10} strokeWidth={2.6} className="vb-ic" aria-hidden />}
              {vMark === 'unverified' && <CircleDashed size={10} strokeWidth={2.6} className="vb-ic" aria-hidden />}
              {badge}
            </button>
          ) : badge}
          {issue === 'duplicate' && <span className="badge dup-b" title="הקורס מופיע יותר מפעם אחת בתכנון">כפול</span>}
          {invalid && (item.waived
            ? <span className="badge waived-b" title={validity?.reasons.join('\n')}>ללא קדם · אישור חריג</span>
            : <span className="badge err">חסר קדם</span>)}
          {warn && <span className="badge warn-b" title={validity?.warnings.join('\n')}>!</span>}
          {chains.length > 0 && (
            <span className="chain-dots" onPointerDown={(e) => e.stopPropagation()}>
              {chains.map((i) => {
                const gid = state.selectedGroups[i]?.id
                const on = assignedChain === i
                return (
                  <button
                    key={i} type="button"
                    className={`chain-dot c${i + 1} ${shared ? (on ? 'assigned' : 'alt') : ''}`}
                    aria-pressed={shared ? on : undefined}
                    aria-label={shared ? (on ? `נספר בשרשרת ${i + 1}` : `העבר לשרשרת ${i + 1}`) : `בשרשרת ${i + 1}`}
                    title={shared ? (on ? `נספר בשרשרת ${i + 1}` : `לחיצה – לספור בשרשרת ${i + 1} במקום`) : `בשרשרת ${i + 1}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (shared && !on && item.courseId && gid != null) dispatch({ type: 'assignChain', courseId: item.courseId, groupId: gid })
                    }}
                    {...(gid != null ? chainHover(gid) : {})}
                  >{i + 1}</button>
                )
              })}
            </span>
          )}
        </div>
      )}
      {locked && !isSlot && !vMark && <Lock className="lock-ic" size={11} aria-hidden />}
      <div className="move-btns" onPointerDown={(e) => e.stopPropagation()}>
        {!locked && <button aria-label="סמסטר קודם" title="סמסטר קודם (Alt+↑)" onClick={(e) => { e.stopPropagation(); shift(item.key, -1) }}><ChevronUp size={14} /></button>}
        {!locked && <button aria-label="סמסטר הבא" title="סמסטר הבא – דוחף קדימה את מה שתלוי (Alt+↓)" onClick={(e) => { e.stopPropagation(); shift(item.key, 1) }}><ChevronDown size={14} /></button>}
        <button
          className="del" aria-label={`מחיקה: ${itemName(item)}`} title="מחיקה מהתרשים (Delete)"
          onClick={(e) => {
            e.stopPropagation()
            hideHoverCard()
            if (locked && !confirm(`"${itemName(item)}" מופיע כבוצע${item.sem <= state.currentSem ? ' לפי גיליון הציונים' : ''}. למחוק אותו מהתרשים בכל זאת?`)) return
            remove(item.key)
          }}
        ><Trash2 size={13} /></button>
      </div>
      {editable && !badge && (
        <button
          className={`add-grade-btn ${editorKey === item.key ? 'open' : ''} ${vMark === 'edited' ? 'v-edited' : ''}`}
          title="הוספת ציון / עובר בינארי" aria-label={`הוספת ציון: ${itemName(item)}`}
          onPointerDown={(e) => e.stopPropagation()} onClick={openEditor}
        >+ ציון</button>
      )}
      {willMoveTo && <div className="move-tag">↓ {semLabel(willMoveTo)}</div>}
    </div>
  )
}

export const CourseCard = memo(CourseCardImpl)
