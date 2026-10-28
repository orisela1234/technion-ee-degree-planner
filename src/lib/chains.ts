import { GROUPS, OPT_COURSE, OPT_SUBSTITUTES } from '../data/track'
import type { SpecGroup } from '../data/track'
import type { SelectedGroup } from './types'

/** שלוש השרשראות המקבילות – צבע ומספר קבועים לכל משבצת */
export const CHAIN_SLOTS = [1, 2, 3] as const

export function chainCourses(groupId: number): string[] {
  const g = GROUPS.find((x) => x.id === groupId)
  if (!g) return []
  return g.courses.includes(OPT_COURSE) ? [...g.courses, ...OPT_SUBSTITUTES] : g.courses
}

/** באילו מהשרשראות שנבחרו מופיע הקורס (אינדקסים 0–2) */
export function chainsOf(courseId: string | undefined, selected: SelectedGroup[]): number[] {
  if (!courseId) return []
  const out: number[] = []
  selected.slice(0, 3).forEach((s, i) => {
    if (chainCourses(s.id).includes(courseId)) out.push(i)
  })
  return out
}

// ---------- וריאנטים: קבוצה בודדת / כפולה הן שתי שרשראות שונות ----------

export interface ChainVariant { group: SpecGroup; double: boolean; key: string; label: string; count: number; weight: 1 | 2 }

export const variantLabel = (g: SpecGroup, double: boolean) => (double ? `${g.name} – כפולה` : g.name)

export const CHAIN_VARIANTS: ChainVariant[] = GROUPS.flatMap((g) => {
  const single: ChainVariant = { group: g, double: false, key: `${g.id}`, label: g.name, count: g.single.count, weight: 1 }
  return g.canBeDouble && g.double
    ? [single, { group: g, double: true, key: `${g.id}d`, label: variantLabel(g, true), count: g.double.count, weight: 2 as const }]
    : [single]
})

export type ReqRow = { kind: 'all' | 'oneOf' | 'nOf'; n: number; ids: string[] }

/** כללי החובה של שרשרת כשורות ברורות */
export function chainRules(g: SpecGroup, double: boolean): ReqRow[] {
  const spec = double && g.double ? g.double : g.single
  return spec.rules.map((r) =>
    'all' in r ? { kind: 'all', n: r.all.length, ids: r.all }
      : 'oneOf' in r ? { kind: 'oneOf', n: 1, ids: r.oneOf }
        : { kind: 'nOf', n: r.nOf, ids: r.of })
}

/** מספר המקומות בשרשרת שלא נתפסים ע"י החובה (בחירה חופשית מתוך רשימת הקבוצה) */
export function freeSlots(g: SpecGroup, double: boolean) {
  const spec = double && g.double ? g.double : g.single
  const forced = chainRules(g, double).reduce((a, r) => a + r.n, 0)
  return Math.max(0, spec.count - forced)
}
