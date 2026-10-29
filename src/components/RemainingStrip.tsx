import { useMemo } from 'react'
import { useStore } from '../lib/store'
import { focusColor, useUi, type PoolFilter } from '../lib/ui'
import { computeRequirements, type Bucket } from '../lib/requirements'
import { CATEGORY_TITLE, fmtPts, nCourses } from '../lib/catalog'

interface Row {
  key: string
  label: string
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

  const rows: Row[] = [
    { key: 'mand', label: CATEGORY_TITLE.mandatory, done: done.mandatory, plan: plan.mandatory, perCourse: 3.5, filter: 'mandatory', cat: 'mandatory', extra: nCourses(done.remainingMandatory.length) },
    { key: 'fac', label: CATEGORY_TITLE.faculty, done: done.faculty, plan: plan.faculty, perCourse: 3, filter: 'faculty', cat: 'faculty', credit: done.socialCredit.faculty },
    { key: 'enr', label: CATEGORY_TITLE.enrichment, done: done.enrichment, plan: plan.enrichment, perCourse: 2, filter: 'enrichment', cat: 'enrichment', credit: done.socialCredit.enrichment },
    { key: 'sport', label: CATEGORY_TITLE.sport, done: done.sport, plan: plan.sport, perCourse: 1, filter: 'sport', cat: 'sport' },
    { key: 'labs', label: CATEGORY_TITLE.lab, done: done.labs, plan: plan.labs, perCourse: 1, filter: 'labs', cat: 'lab' },
    { key: 'gen', label: CATEGORY_TITLE.free, done: done.general, plan: plan.general, perCourse: 2, filter: 'all', cat: 'free', credit: done.socialCredit.free + done.socialCredit.enrichment },
  ]

  return (
    <div className="remaining" role="list" aria-label="מה נשאר לתואר">
      <span className="rem-title">נשאר לתואר:</span>
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
            title={complete ? 'הושלם' : `${fmtPts(r.done.have)} מתוך ${fmtPts(r.done.need)} הושלמו · בתכנון ${fmtPts(r.plan.have)}${missingInPlan > 0 ? ` · חסרים בתכנון ${fmtPts(missingInPlan)} נק' (בערך ${nCourses(courses)}) – לחצו לבחירה` : ' · מכוסה בתכנון'}`}
            onClick={() => { focusColor(null); ui.setPoolFilter(r.filter); ui.setPoolOpen(true); onPick() }}
            onMouseEnter={() => focusColor(r.key === 'gen' ? 'k-general' : `k-${r.cat}`)}
            onMouseLeave={() => focusColor(null)}
          >
            <i className="rem-dot" aria-hidden />
            <b>{r.label}</b>
            {!!r.credit && <span className="rem-credit" title={`${fmtPts(r.credit)} נק' מילואים / פעילות חברתית נספרות כאן`}>קוזזו {fmtPts(r.credit)}</span>}
            {complete ? <span className="rem-done">✓ הושלם</span> : (
              <>
                <span>נותרו {fmtPts(left)}{r.extra ? ` · ${r.extra}` : ''}</span>
                {missingInPlan > 0
                  ? <span className="rem-gap">לבחור עוד {courses}</span>
                  : <span className="rem-ok">מתוכנן</span>}
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}
