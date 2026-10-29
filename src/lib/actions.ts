import { useCallback } from 'react'
import { useStore } from './store'
import { useUi } from './ui'
import { checkPlacement, planMove, type MovePlan } from './prereq'
import { askConfirm } from './confirm'
import type { PlanItem } from './types'
import { getCourse, nextSemCode, semLabel } from './catalog'

/** פעולות על התכנון שעוברות בדיקת קדמים, עם הודעות למשתמש */
export function usePlanActions() {
  const { state, dispatch } = useStore()
  const { toast } = useUi()
  const undo = { label: 'בטל', run: () => dispatch({ type: 'undo' }) }

  const place = useCallback(
    (opts: { itemKey?: string; courseId?: string; sem: string; replaceSlotKey?: string; col?: number | null }) => {
      const item = opts.itemKey ? state.items.find((i) => i.key === opts.itemKey) : undefined
      const col = opts.col ?? undefined
      // אותו סמסטר – רק שינוי מיקום בשורה
      if (item && item.sem === opts.sem) {
        if (col != null && col !== item.col) dispatch({ type: 'move', key: item.key, sem: item.sem, col })
        return true
      }
      const courseId = opts.courseId ?? item?.courseId
      const name = getCourse(courseId)?.name ?? item?.name ?? 'הקורס'
      const isPrereqReason = (r: string) => r.startsWith('חסר קדם') || r.startsWith('דרוש צמוד')

      // שיבוץ בלי קדם: שואלים, ובאישור מסמנים "אישור חריג"
      const confirmWaiver = (reasons: string[]) =>
        state.strict
          ? askConfirm({
            title: `לשבץ את "${name}" ב${semLabel(opts.sem)} בלי הקדם?`,
            lines: reasons,
            note: 'מתאים כשקיבלת אישור חריג – למשל כשעוד לא נבחנת בקורס הקדם. הקורס יסומן באדום בוהק עד שהקדם יופיע בתכנון לפניו.',
            confirmLabel: 'שבץ בכל זאת – אישור חריג',
            tone: 'danger',
          })
          : Promise.resolve(true)

      const applyPlan = (plan: MovePlan, it: PlanItem, waived: boolean) => {
        dispatch({
          type: 'applyMoves',
          addSems: plan.addSems,
          moves: plan.moves.map((m) => ({
            key: m.key, sem: m.to,
            col: m.key === it.key ? col ?? null : undefined,
            waived: m.key === it.key && waived ? true : undefined,
          })),
        })
        const pushed = plan.moves.filter((m) => m.key !== it.key)
        const lines = [
          ...pushed.map((m) => {
            const o = state.items.find((i) => i.key === m.key)
            return `${getCourse(o?.courseId)?.name ?? ''}: ${semLabel(m.from)} ← ${semLabel(m.to)}`
          }),
          ...plan.warnings,
        ]
        if (waived) toast(`"${name}" שובץ ב${semLabel(opts.sem)} באישור חריג – מסומן באדום`, 'warn', lines, undo)
        else if (pushed.length) toast(`"${name}" עבר ל${semLabel(opts.sem)} · ${pushed.length === 1 ? 'קורס אחד נדחף' : `${pushed.length} קורסים נדחפו`} קדימה`, 'info', lines, undo)
        else if (plan.warnings.length) toast(`"${name}" עבר ל${semLabel(opts.sem)}`, 'warn', plan.warnings, undo)
      }

      // הזזת פריט קיים – כולל דחיפה קדימה של הקורסים שנשענים עליו
      if (item) {
        const plan = planMove(state, item.key, opts.sem)
        if (plan.ok) {
          applyPlan(plan, item, false)
          return true
        }
        if (!plan.reasons.some(isPrereqReason)) {
          toast(`אי אפשר להעביר את "${name}" ל${semLabel(opts.sem)}`, 'error', plan.reasons)
          return false
        }
        confirmWaiver(plan.reasons).then((ok) => {
          if (!ok) return
          const forced = planMove(state, item.key, opts.sem, { allowInvalidSelf: true })
          if (!forced.ok) toast(`אי אפשר להעביר את "${name}"`, 'error', forced.reasons)
          else applyPlan(forced, item, true)
        })
        return false
      }

      // קורס חדש מהמאגר
      const check = checkPlacement(state, { courseId, targetSem: opts.sem, replaceSlotKey: opts.replaceSlotKey })
      if (check.ok) {
        if (courseId) dispatch({ type: 'add', courseId, sem: opts.sem, replaceSlotKey: opts.replaceSlotKey, col })
        if (check.warnings.length) toast(`"${name}" שובץ ב${semLabel(opts.sem)}`, 'warn', check.warnings, undo)
        return true
      }
      if (!courseId || !check.reasons.some(isPrereqReason)) {
        toast(`אי אפשר לשבץ את "${name}" ב${semLabel(opts.sem)}`, 'error', check.reasons)
        return false
      }
      confirmWaiver(check.reasons).then((ok) => {
        if (!ok) return
        dispatch({ type: 'add', courseId, sem: opts.sem, replaceSlotKey: opts.replaceSlotKey, col, waived: true })
        toast(`"${name}" שובץ ב${semLabel(opts.sem)} באישור חריג – מסומן באדום`, 'warn', check.reasons, undo)
      })
      return false
    },
    [state, dispatch, toast],
  )

  /** סמסטר אחד אחורה/קדימה (כפתורי החצים בכרטיס) */
  const shift = useCallback(
    (itemKey: string, dir: -1 | 1) => {
      const item = state.items.find((i) => i.key === itemKey)
      if (!item) return
      const idx = state.semesters.indexOf(item.sem)
      let target = state.semesters[idx + dir]
      if (!target && dir === 1) target = nextSemCode(item.sem)
      if (!target) return
      place({ itemKey, sem: target })
    },
    [state, place],
  )

  const remove = useCallback(
    (itemKey: string, opts: { force?: boolean } = {}): boolean => {
      const item = state.items.find((i) => i.key === itemKey)
      if (!item) return false
      const check = checkPlacement(state, { itemKey, targetSem: null })
      const name = getCourse(item.courseId)?.name ?? item.name ?? 'המשבצת'
      if (!check.ok && state.strict && !opts.force) {
        toast(`"${name}" הוא קדם לקורסים אחרים בתכנון`, 'error', [...check.reasons, 'אפשר למחוק בכל זאת (הקורסים התלויים יסומנו כחסרי קדם), או להעביר אותו לסמסטר מאוחר יותר'], {
          label: 'מחק בכל זאת',
          run: () => {
            dispatch({ type: 'remove', key: itemKey })
            toast(`"${name}" נמחק מהתכנון`, 'warn', undefined, undo)
          },
        })
        return false
      }
      dispatch({ type: 'remove', key: itemKey })
      toast(`"${name}" הוחזר למאגר`, check.ok ? 'info' : 'warn', check.ok ? undefined : check.reasons, undo)
      return true
    },
    [state, dispatch, toast],
  )

  return { place, remove, shift }
}
