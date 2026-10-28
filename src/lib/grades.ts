import type { SheetRecord } from '../data/student'
import { activeSheet } from './sheet'
import { TRACK } from '../data/track'
import { itemPoints } from './requirements'
import type { AppState, PlanItem } from './types'
import { isFailed } from './types'

export const BINARY_MAX_COURSES = 5
export const BINARY_MAX_POINTS = +(TRACK.totalPoints * 0.1).toFixed(2)

export const sheetRecordFor = (i: PlanItem): SheetRecord | undefined =>
  activeSheet().records.find((r) => r.id === i.courseId && r.sem === i.sem)

export type Verify = 'verified' | 'edited' | 'unverified' | 'none'

/** האם התוצאה של הקורס תואמת לגיליון הציונים, נערכה ידנית, או עדיין לא מאומתת */
export function verifyState(i: PlanItem): { state: Verify; sheetText?: string } {
  const rec = sheetRecordFor(i)
  if (!i.result) return { state: rec ? 'edited' : 'none', sheetText: rec ? sheetText(rec) : undefined }
  if (!rec) return { state: 'unverified' }
  const r = i.result
  const same =
    (rec.kind === 'grade' && r?.kind === 'grade' && r.grade === rec.grade) ||
    (rec.kind === 'pass' && r?.kind === 'pass') ||
    (rec.kind === 'exempt-credit' && r?.kind === 'exempt')
  return { state: same ? 'verified' : 'edited', sheetText: sheetText(rec) }
}

export function sheetText(r: SheetRecord): string {
  if (r.kind === 'grade') return String(r.grade)
  if (r.kind === 'pass') return 'עובר'
  return 'פטור'
}

/** עובר בינארי – רק מה שסומן ידנית. "עובר" או "פטור" בגיליון לא נחשבים אוטומטית */
export const isBinaryPass = (i: PlanItem) => !isFailed(i) && !!i.binary

export function binaryUsage(items: PlanItem[]) {
  const used = items.filter(isBinaryPass)
  return { items: used, count: used.length, points: used.reduce((a, i) => a + itemPoints(i), 0) }
}

export function withinBinaryLimit(count: number, points: number, rule: AppState['binaryRule']) {
  const okCount = count <= BINARY_MAX_COURSES
  const okPts = points <= BINARY_MAX_POINTS + 1e-9
  return rule === 'lenient' ? okCount || okPts : okCount && okPts
}

export function canMarkBinary(state: AppState, item: PlanItem): { ok: boolean; reason?: string } {
  if (isBinaryPass(item)) return { ok: true }
  const u = binaryUsage(state.items)
  const count = u.count + 1, pts = u.points + itemPoints(item)
  if (withinBinaryLimit(count, pts, state.binaryRule)) return { ok: true }
  return {
    ok: false,
    reason: `חריגה ממגבלת העובר הבינארי: ${count} קורסים (מותר ${BINARY_MAX_COURSES}), ${pts.toFixed(1)} נק"ז (מותר ${BINARY_MAX_POINTS})`,
  }
}
