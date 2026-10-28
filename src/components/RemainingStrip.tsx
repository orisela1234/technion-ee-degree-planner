import { useMemo } from 'react'
import { BookOpenCheck, Dumbbell, FlaskConical, GraduationCap, Palette, Shapes } from 'lucide-react'
import { useStore } from '../lib/store'
import { focusColor, useUi, type PoolFilter } from '../lib/ui'
import { computeRequirements, graduationGap, type Bucket } from '../lib/requirements'
import { CATEGORY_TITLE, fmtPts } from '../lib/catalog'
import { DegreeStatusBadge } from './AuditView'

interface Row {
  key: string
  label: string
  Icon: typeof Shapes
  done: Bucket
  plan: Bucket
  perCourse: number
  filter: PoolFilter
  /** הסיווג – אותו צבע כמו בכרטיסים בתרשים */
  cat: string
  extra?: string
  /** נקודות מילואים שקוזזו בדרישה הזאת */
  credit?: number
}

/** "מה נשאר לתואר" – לכל סוג דרישה: כמה נק' חסרות, כמה בערך קורסים, ולחיצה פותחת את המאגר מסונן */
export function RemainingStrip({ onPick }: { onPick: () => void }) {
  const { state } = useStore()
  const ui = useUi()
  const done = useMemo(() => computeRequirements(state, 'done'), [state])
  const plan = useMemo(() => computeRequirements(state, 'plan'), [state])
  const gap = useMemo(() => graduationGap(plan), [plan])

  const rows: Row[] = [
    { key: 'mand', label: CATEGORY_TITLE.mandatory, Icon: BookOpenCheck, done: done.mandatory, plan: plan.mandatory, perCourse: 3.5, filter: 'mandatory', cat: 'mandatory', extra: `${done.remainingMandatory.length} קורסים` },
    { key: 'fac', label: CATEGORY_TITLE.faculty, Icon: GraduationCap, done: done.faculty, plan: plan.faculty, perCourse: 3, filter: 'faculty', cat: 'faculty', credit: done.socialCredit.faculty },
    { key: 'enr', label: CATEGORY_TITLE.enrichment, Icon: Palette, done: done.enrichment, plan: plan.enrichment, perCourse: 2, filter: 'enrichment', cat: 'enrichment', credit: done.socialCredit.enrichment },
    { key: 'sport', label: CATEGORY_TITLE.sport, Icon: Dumbbell, done: done.sport, plan: plan.sport, perCourse: 1, filter: 'sport', cat: 'sport' },
    { key: 'labs', label: CATEGORY_TITLE.lab, Icon: FlaskConical, done: done.labs, plan: plan.labs, perCourse: 1, filter: 'labs', cat: 'lab' },
    { key: 'gen', label: CATEGORY_TITLE.free, Icon: Shapes, done: done.general, plan: plan.general, perCourse: 2, filter: 'all', cat: 'free', credit: done.socialCredit.free + done.socialCredit.enrichment },
  ]

  return (
    <div className="remaining" role="list" aria-label="מה נשאר לתואר">
      <DegreeStatusBadge compact />
      <span className="rem-title">נשאר לתואר:</span>
      <span
        className={`rem-total ${gap.missing <= 0 ? 'done' : ''} ${gap.surplus > 0 ? 'has-surplus' : ''}`}
        title={`סכום מה שחסר בכל הדרישות לפי התכנון. התואר ייסגר על ${fmtPts(gap.finalTotal)} נק"ז${gap.surplus > 0 ? ` – ${fmtPts(gap.surplus)} עודפות מעבר ל-157.5` : ''}`}
      >
        {gap.missing <= 0 ? 'הנקודות מכוסות ✓' : <>חסרות בתכנון <b>{fmtPts(gap.missing)}</b> נק'</>}
        {gap.surplus > 0 && <em> · {fmtPts(gap.surplus)} עודפות</em>}
      </span>
      {rows.map((r) => {
        const left = Math.max(0, r.done.need - r.done.have)
        const missingInPlan = Math.max(0, r.plan.need - r.plan.have)
        const courses = Math.ceil(missingInPlan / r.perCourse)
        const complete = left <= 0
        return (
          <button
            key={r.key}
            role="listitem"
            className={`rem cat-${r.cat} ${complete ? 'complete' : missingInPlan > 0 ? 'missing' : 'planned'}`}
            title={complete ? 'הושלם' : `${fmtPts(r.done.have)} מתוך ${fmtPts(r.done.need)} הושלמו · בתכנון ${fmtPts(r.plan.have)}${missingInPlan > 0 ? ` · חסרים בתכנון ${fmtPts(missingInPlan)} נק' (~${courses} קורסים) – לחצו לבחירה` : ' · מכוסה בתכנון'}`}
            onClick={() => { focusColor(null); ui.setPoolFilter(r.filter); ui.setPoolOpen(true); onPick() }}
            onMouseEnter={() => focusColor(r.key === 'gen' ? 'k-general' : `k-${r.cat}`)}
            onMouseLeave={() => focusColor(null)}
          >
            <r.Icon size={13} aria-hidden />
            <b>{r.label}</b>
            {!!r.credit && <span className="rem-credit" title={`${fmtPts(r.credit)} נק' מילואים / פעילות חברתית נספרות כאן`}>קוזזו {fmtPts(r.credit)}</span>}
            {complete ? <span className="rem-done">✓</span> : (
              <>
                <span>{fmtPts(left)} נק'{r.extra ? ` · ${r.extra}` : ''}</span>
                {missingInPlan > 0
                  ? <span className="rem-gap">+{courses} לבחור</span>
                  : <span className="rem-ok">בתכנון</span>}
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}
