import type { SheetRecord } from '../data/student'
import { lastSheetSem, sheetOf } from './sheet'
import { MANDATORY_IDS } from '../data/track'
import { COURSES, noCreditWith, semLabel } from './catalog'
import { itemName } from './requirements'
import { sheetText } from './grades'
import type { Action } from './store'
import type { AppState, PlanItem } from './types'
import { isFailed } from './types'

/** בדיקות תקינות: כפילויות בתכנון ואי-התאמות מול גיליון הציונים */

export type IssueKind = 'duplicate' | 'no-credit' | 'sheet-missing' | 'sheet-sem' | 'sheet-grade' | 'not-in-sheet'

export interface Fix { label: string; actions: Action[]; primary?: boolean }
export interface Issue {
  id: string
  kind: IssueKind
  severity: 'error' | 'warn'
  title: string
  detail: string
  keys: string[]
  courseId?: string
  fixes: Fix[]
}

/** אותו תנאי כמו בבניית התכנון: מה מהגיליון אמור להופיע בתרשים (השאר בסקטור הפטורים) */
export const isChartRecord = (r: SheetRecord) =>
  ((r.kind === 'grade' || r.kind === 'pass') && (MANDATORY_IDS.has(r.id) || r.points > 0)) ||
  (r.kind === 'exempt-credit' && MANDATORY_IDS.has(r.id))


const sameResult = (i: PlanItem, r: SheetRecord) =>
  (r.kind === 'grade' && i.result?.kind === 'grade' && i.result.grade === r.grade) ||
  (r.kind === 'pass' && i.result?.kind === 'pass') ||
  (r.kind === 'exempt-credit' && i.result?.kind === 'exempt')

/** עדיפות לשמירה כשיש כפילות: קורס שהושלם > בלימוד/מתוכנן מוקדם יותר */
function keepOrder(a: PlanItem, b: PlanItem) {
  if (!!a.result !== !!b.result) return a.result ? -1 : 1
  return a.sem.localeCompare(b.sem)
}

export function findIssues(state: AppState): Issue[] {
  const issues: Issue[] = []
  const name = (id: string) => COURSES[id]?.name ?? id

  // 1. אותו קורס מופיע יותר מפעם אחת (ניסיון שנכשל + מועד חוזר זה תקין)
  const byCourse = new Map<string, PlanItem[]>()
  state.items.forEach((i) => {
    if (!i.courseId || isFailed(i)) return
    byCourse.set(i.courseId, [...(byCourse.get(i.courseId) ?? []), i])
  })
  byCourse.forEach((list, id) => {
    if (list.length < 2) return
    const sorted = [...list].sort(keepOrder)
    const keep = sorted[0]
    const extra = sorted.slice(1)
    issues.push({
      id: `dup-${id}`,
      kind: 'duplicate',
      severity: 'error',
      title: `"${name(id)}" מופיע ${list.length} פעמים בתכנון`,
      detail: list.map((i) => `${semLabel(i.sem)}${i.result ? ' (הושלם)' : ''}`).join(' · '),
      keys: list.map((i) => i.key),
      courseId: id,
      fixes: [
        { label: `השאר ב${semLabel(keep.sem)} ומחק ${extra.length > 1 ? `את ${extra.length} האחרים` : `מ${semLabel(extra[0].sem)}`}`, actions: extra.map((i) => ({ type: 'remove', key: i.key })), primary: true },
      ],
    })
  })

  // 2. שני קורסים שמוגדרים "ללא זיכוי נוסף" זה עם זה
  const active = state.items.filter((i) => i.courseId && !isFailed(i))
  const seenPairs = new Set<string>()
  for (const a of active) {
    for (const otherId of noCreditWith(a.courseId!)) {
      const b = active.find((x) => x.courseId === otherId)
      if (!b) continue
      const pair = [a.courseId, b.courseId].sort().join('|')
      if (seenPairs.has(pair)) continue
      seenPairs.add(pair)
      const drop = [a, b].sort(keepOrder)[1]
      issues.push({
        id: `nc-${pair}`,
        kind: 'no-credit',
        severity: 'warn',
        title: `"${itemName(a)}" ו"${itemName(b)}" – ללא זיכוי נוסף`,
        detail: 'חומר חופף: הנקודות ייספרו רק על אחד מהם.',
        keys: [a.key, b.key],
        courseId: drop.courseId,
        fixes: drop.result ? [] : [{ label: `מחק את "${itemName(drop)}" (${semLabel(drop.sem)})`, actions: [{ type: 'remove', key: drop.key }], primary: true }],
      })
    }
  }

  // 3. התאמה לגיליון הציונים
  const sheet = sheetOf(state)
  const lastSem = lastSheetSem(sheet)
  for (const r of sheet.records.filter(isChartRecord)) {
    const matches = state.items.filter((i) => i.courseId === r.id)
    const exact = matches.find((i) => i.sem === r.sem)
    if (exact) {
      if (exact.result && !sameResult(exact, r)) {
        issues.push({
          id: `grade-${r.id}-${r.sem}`,
          kind: 'sheet-grade',
          severity: 'warn',
          title: `"${r.name}": הציון שונה מהגיליון`,
          detail: `בגיליון: ${sheetText(r)} · בתכנון: ${exact.result.kind === 'grade' ? exact.result.grade : exact.result.kind === 'pass' ? 'עובר' : 'פטור'}`,
          keys: [exact.key],
          courseId: r.id,
          fixes: [{ label: 'החזר לפי הגיליון', actions: [{ type: 'resetToSheet', key: exact.key }], primary: true }],
        })
      } else if (!exact.result) {
        issues.push({
          id: `nores-${r.id}-${r.sem}`,
          kind: 'sheet-grade',
          severity: 'warn',
          title: `"${r.name}": בגיליון יש ${sheetText(r)}, בתכנון הוא בלי תוצאה`,
          detail: semLabel(r.sem),
          keys: [exact.key],
          courseId: r.id,
          fixes: [{ label: 'החזר לפי הגיליון', actions: [{ type: 'resetToSheet', key: exact.key }], primary: true }],
        })
      }
      continue
    }
    // הקורס מהגיליון הועבר לסמסטר אחר
    const moved = matches.find((i) => (r.kind === 'grade' && (r.grade ?? 0) < 55) === isFailed(i))
    if (moved) {
      issues.push({
        id: `sem-${r.id}-${r.sem}`,
        kind: 'sheet-sem',
        severity: 'warn',
        title: `"${r.name}" בתרשים ב${semLabel(moved.sem)}, בגיליון ב${semLabel(r.sem)}`,
        detail: 'קורס שכבר נלמד צריך לשבת בסמסטר שבו הוא מופיע בגיליון.',
        keys: [moved.key],
        courseId: r.id,
        fixes: [{ label: `העבר ל${semLabel(r.sem)}`, actions: [{ type: 'applyMoves', moves: [{ key: moved.key, sem: r.sem, col: null }], addSems: [r.sem] }], primary: true }],
      })
      continue
    }
    issues.push({
      id: `miss-${r.id}-${r.sem}`,
      kind: 'sheet-missing',
      severity: 'error',
      title: `"${r.name}" מופיע בגיליון אבל לא בתרשים`,
      detail: `${semLabel(r.sem)} · ${sheetText(r)} · ${r.points} נק"ז`,
      keys: [],
      courseId: r.id,
      fixes: [{ label: 'החזר לתרשים', actions: [{ type: 'restoreSheetRecord', id: r.id, sem: r.sem }], primary: true }],
    })
  }

  // 4. מסומן כ"בוצע" בסמסטר שהגיליון כבר מכסה – אבל לא מופיע בגיליון
  for (const i of state.items) {
    if (!i.courseId || !i.result || i.sem > lastSem) continue
    if (sheet.records.some((r) => r.id === i.courseId && r.sem === i.sem)) continue
    issues.push({
      id: `extra-${i.key}`,
      kind: 'not-in-sheet',
      severity: 'warn',
      title: `"${itemName(i)}" מסומן כבוצע ב${semLabel(i.sem)} אבל לא מופיע בגיליון`,
      detail: 'ייתכן שזה ציון שהוזן ידנית לבדיקה, או שהקורס לא נלמד בפועל.',
      keys: [i.key],
      courseId: i.courseId,
      fixes: [
        { label: 'הסר את התוצאה', actions: [{ type: 'setResult', key: i.key }], primary: true },
        { label: 'מחק את הקורס', actions: [{ type: 'remove', key: i.key }] },
      ],
    })
  }

  return issues
}

export const issueKeys = (issues: Issue[]) => {
  const m = new Map<string, Issue['kind']>()
  issues.forEach((x) => x.keys.forEach((k) => { if (!m.has(k) || x.kind === 'duplicate') m.set(k, x.kind) }))
  return m
}
