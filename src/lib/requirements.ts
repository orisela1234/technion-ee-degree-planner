import { COURSES, categoryOfCourse, hueOf, type Category } from './catalog'
import {
  TRACK, MANDATORY, MANDATORY_SLOTS, GROUPS, GROUP_COURSE_IDS, OPT_COURSE, OPT_SUBSTITUTES, SLOT_INFO,
  type GroupRule, type SpecGroup, type MandatoryItem,
} from '../data/track'
import type { AppState, ColorBy, PlanItem } from './types'
import { isSocialCredit } from './sheet'
import { chainAllocation } from './chainAlloc'
import { isDone, isFailed, itemCourseId } from './types'

export function itemPoints(i: PlanItem): number {
  if (i.points != null) return i.points
  return COURSES[i.courseId ?? '']?.points ?? 0
}

export function itemName(i: PlanItem): string {
  if (i.name) return i.name
  if (i.courseId) return COURSES[i.courseId]?.name ?? i.courseId
  if (i.slot) return SLOT_INFO[i.slot].label
  return '—'
}

const SLOT_CATEGORY: Record<string, Category> = {
  lab: 'lab', sport: 'sport', enrichment: 'enrichment', facultyElective: 'faculty', free: 'free',
}

export function itemCategory(i: PlanItem): Category {
  if (i.category) return i.category
  if (i.slot) return SLOT_CATEGORY[i.slot]
  if (i.courseId) return categoryOfCourse(i.courseId)
  return 'free'
}

/** מחלקת הצבע של קורס: לפי סיווג הדרישה (ברירת מחדל) או לפי תחום הלימוד */
export function colorClass(colorBy: ColorBy | undefined, item?: PlanItem, courseId?: string): string {
  const id = item?.courseId ?? courseId
  if (colorBy === 'subject') return `hue-${item?.slot ? 'slot' : hueOf(id)}`
  return `cat-${item ? itemCategory(item) : categoryOfCourse(id ?? '')}`
}

/** "מפקולטות אחרות" (תקרה של 9 נק') – לא 0044/0045/0046/0048, ולא מקצוע שמופיע בקבוצות ההתמחות (לפי הקטלוג) */
const isExternalFaculty = (id?: string) =>
  !!id && !/^004[4568]/.test(id) && !GROUP_COURSE_IDS.has(id) && !OPT_SUBSTITUTES.includes(id)

export interface Bucket { have: number; need: number }

export interface Requirements {
  mandatory: Bucket
  faculty: Bucket
  general: Bucket
  enrichment: Bucket
  sport: Bucket
  labs: Bucket
  total: Bucket
  /** סך הנקודות כפי שמופיע בגיליון (כולל עודפים) */
  raw: number
  /** נקודות שנצברו אבל לא נספרות לתואר */
  surplus: number
  otherGeneral: number
  remainingMandatory: MandatoryItem[]
  remainingSlots: { slot: string; points: number }[]
  /** נקודות מילואים/פעילות חברתית שנספרות בכל דרישה */
  socialCredit: { faculty: number; enrichment: number; free: number; sport: number }
  /** בחירה פקולטית מפקולטות אחרות (עד 9 נק') ומלימודי מוסמכים 0048 */
  external: { points: number; ids: string[]; grad: string[] }
}

export function computeRequirements(state: AppState, mode: 'done' | 'plan'): Requirements {
  const items = state.items.filter((i) => !isFailed(i) && (mode === 'plan' || isDone(i)))
  let mand = 0, lab = 0, fac = 0, ext = 0, enr = 0, sport = 0, other = 0, raw = 0
  const externalIds: string[] = []
  const gradIds: string[] = []
  const seenMandatory = new Set<string>()

  for (const it of items) {
    const pts = itemPoints(it)
    raw += pts
    const cat = itemCategory(it)
    const id = itemCourseId(it)
    switch (cat) {
      case 'mandatory': {
        const req = MANDATORY.find((m) => m.id === id || m.alternatives?.includes(id ?? ''))
        const key = req?.id ?? id ?? it.key
        if (seenMandatory.has(key)) other += pts
        else {
          seenMandatory.add(key)
          mand += pts
        }
        break
      }
      case 'lab': lab += pts; break
      case 'faculty':
        if (isExternalFaculty(id)) { ext += pts; externalIds.push(id!) }
        if (id?.startsWith('0048')) gradIds.push(id)
        else fac += pts
        break
      case 'enrichment': enr += pts; break
      case 'sport': sport += pts; break
      default: other += pts
    }
  }
  // נקודות מילואים/פעילות חברתית – לכל דרישה כמה מהן קוזזו (מוצג במפורש בממשק)
  const socialCredit = { faculty: 0, enrichment: 0, free: 0, sport: 0 }
  for (const c of state.credits) {
    raw += c.points
    const social = isSocialCredit(c.id)
    if (c.category === 'enrichment') enr += c.points
    else if (c.category === 'sport') sport += c.points
    else if (c.category === 'faculty') {
      // קיזוז מילואים נספר כבחירה פקולטית רגילה – לא בתקרת 9 הנק' של פקולטות אחרות
      if (social) fac += c.points
      else ext += c.points
    } else other += c.points
    if (social) {
      const k = c.category === 'faculty' || c.category === 'enrichment' || c.category === 'sport' ? c.category : 'free'
      socialCredit[k] += c.points
    }
  }

  const labToMand = Math.min(lab, TRACK.labPoints)
  const labToFac = Math.min(Math.max(lab - TRACK.labPoints, 0), TRACK.maxLabPoints - TRACK.labPoints)
  other += Math.max(lab - TRACK.maxLabPoints, 0)

  const extCounted = Math.min(ext, TRACK.maxExternalFacultyPoints)
  other += ext - extCounted
  const facRaw = fac + extCounted + labToFac
  const facCounted = Math.min(facRaw, TRACK.facultyElectivePoints)
  other += facRaw - facCounted

  const mandRaw = mand + labToMand
  const mandCounted = Math.min(mandRaw, TRACK.mandatoryPoints)
  // "הנקודות העודפות תזוכנה לבחירה כלל טכניונית" (למשל מעבדה פיסיקלית 1 במקום 1ח')
  other += Math.max(0, mandRaw - TRACK.mandatoryPoints)

  // כל נקודה נספרת: גם פעילות חברתית/מילואים נכנסות במלואן לבחירה הכלל-טכניונית
  const G = TRACK.generalPoints
  const generalCounted = Math.min(G, enr + sport + other)

  // מה נשאר מהחובה
  const allIds = new Set(items.map(itemCourseId).filter(Boolean) as string[])
  const remainingMandatory = MANDATORY.filter((m) => ![m.id, ...(m.alternatives ?? [])].some((x) => allIds.has(x)))
  const slotHave: Record<string, number> = { lab, sport }
  const remainingSlots: { slot: string; points: number }[] = []
  for (const s of ['lab', 'sport'] as const) {
    const need = MANDATORY_SLOTS.filter((x) => x.slot === s).reduce((a, b) => a + b.points, 0)
    if (slotHave[s] < need) remainingSlots.push({ slot: s, points: need - slotHave[s] })
  }

  return {
    mandatory: { have: mandCounted, need: TRACK.mandatoryPoints },
    faculty: { have: facCounted, need: TRACK.facultyElectivePoints },
    general: { have: generalCounted, need: G },
    enrichment: { have: enr, need: TRACK.enrichmentPoints },
    sport: { have: sport, need: TRACK.sportPoints },
    labs: { have: lab, need: TRACK.labPoints },
    // כל נקודה נספרת לסך התואר (כמו בגיליון); החלוקה לדרישות היא רק להתקדמות בכל סוג
    total: { have: raw, need: TRACK.totalPoints },
    raw,
    surplus: 0,
    otherGeneral: other,
    remainingMandatory,
    remainingSlots,
    socialCredit,
    external: { points: ext, ids: externalIds, grad: gradIds },
  }
}

// ---------- קבוצות התמחות ----------

export interface GroupEval {
  group: SpecGroup
  double: boolean
  need: number
  count: number
  rules: { text: string; ok: boolean }[]
  members: string[]
  complete: boolean
}

const shortName = (id: string) => COURSES[id]?.name ?? id

function ruleText(r: GroupRule): string {
  if ('all' in r) return r.all.length === 1 ? `חובה: ${shortName(r.all[0])}` : `חובה: ${r.all.map(shortName).join(' + ')}`
  if ('oneOf' in r) return `אחד מ: ${r.oneOf.map(shortName).join(' / ')}`
  return `${r.nOf} מתוך: ${r.of.map(shortName).join(' / ')}`
}

function normalizedSet(group: SpecGroup, ids: Set<string>): Set<string> {
  const s = new Set<string>()
  for (const id of group.courses) if (ids.has(id)) s.add(id)
  if (group.courses.includes(OPT_COURSE) && !s.has(OPT_COURSE) && OPT_SUBSTITUTES.some((x) => ids.has(x))) {
    s.add(OPT_COURSE)
  }
  return s
}

export function evalGroup(group: SpecGroup, double: boolean, ids: Set<string>): GroupEval {
  const spec = double && group.double ? group.double : group.single
  const have = normalizedSet(group, ids)
  let count = have.size
  for (const ex of group.exclusive ?? []) {
    const n = ex.filter((x) => have.has(x)).length
    if (n > 1) count -= n - 1
  }
  const rules = spec.rules.map((r) => {
    let ok: boolean
    if ('all' in r) ok = r.all.every((x) => have.has(x))
    else if ('oneOf' in r) ok = r.oneOf.some((x) => have.has(x))
    else ok = r.of.filter((x) => have.has(x)).length >= r.nOf
    return { text: ruleText(r), ok }
  })
  return {
    group, double, need: spec.count, count,
    rules,
    members: [...have],
    complete: count >= spec.count && rules.every((r) => r.ok),
  }
}

export function groupsSummary(state: AppState) {
  const doneIds = new Set(state.items.filter(isDone).map(itemCourseId).filter(Boolean) as string[])
  const planIds = new Set(state.items.filter((i) => !isFailed(i)).map(itemCourseId).filter(Boolean) as string[])
  // בשרשראות שנבחרו כל קורס נספר בשרשרת אחת בלבד (לפי השיוך); בשאר – כל מה שבתכנון, להשוואה
  const alloc = chainAllocation(state)
  const all = GROUPS.map((g) => {
    const sel = state.selectedGroups.find((s) => s.id === g.id)
    const double = !!sel?.double
    if (sel && alloc.plan.has(g.id)) return { selected: true, done: alloc.done.get(g.id)!, plan: alloc.plan.get(g.id)! }
    return { selected: !!sel, done: evalGroup(g, double, doneIds), plan: evalGroup(g, double, planIds) }
  })
  const weight = (e: GroupEval) => (e.double ? 2 : 1)
  const selected = all.filter((x) => x.selected)
  return {
    all,
    completedDone: selected.filter((x) => x.done.complete).reduce((a, x) => a + weight(x.done), 0),
    completedPlan: selected.filter((x) => x.plan.complete).reduce((a, x) => a + weight(x.plan), 0),
    selectedWeight: selected.reduce((a, x) => a + weight(x.plan), 0),
    need: TRACK.minGroups,
  }
}

// ---------- ממוצע ----------

/** ממוצע משוקלל בנק"ז. בקורס שנלמד שוב – הציון האחרון קובע (כולל ציון נכשל עד שמשפרים) */
export function gpa(items: PlanItem[], expected: Record<string, number> = {}, includePlanned = false) {
  const latest = new Map<string, { grade: number; pts: number; sem: string }>()
  for (const it of items) {
    let grade: number | undefined
    if (it.binary) continue
    if (it.result?.kind === 'grade') grade = it.result.grade
    else if (includePlanned && !it.result && expected[it.key] != null) grade = expected[it.key]
    if (grade == null) continue
    const id = it.courseId ?? it.key
    const prev = latest.get(id)
    if (!prev || it.sem >= prev.sem) latest.set(id, { grade, pts: itemPoints(it), sem: it.sem })
  }
  let sum = 0, pts = 0
  for (const x of latest.values()) {
    sum += x.grade * x.pts
    pts += x.pts
  }
  return pts ? sum / pts : null
}

/**
 * כמה עוד חסר באמת לתואר: סכום החוסרים בכל דרישה (חובה, פקולטית, מל"ג, ספורט, וחופשי בכלל-טכניונית).
 * העודף – נקודות שנספרות בסך הכולל אבל לא ממלאות שום דרישה, כך שהתואר ייסגר מעל 157.5.
 */
export function graduationGap(r: Requirements) {
  const gap = (b: Bucket) => Math.max(0, b.need - b.have)
  const enr = Math.max(r.enrichment.have, r.enrichment.need)
  const sport = Math.max(r.sport.have, r.sport.need)
  const free = Math.max(0, TRACK.generalPoints - enr - sport - r.otherGeneral)
  const missing = Math.round((gap(r.mandatory) + gap(r.faculty) + gap(r.enrichment) + gap(r.sport) + free) * 10) / 10
  const surplus = Math.max(0, Math.round((r.raw + missing - TRACK.totalPoints) * 10) / 10)
  return { missing, surplus, finalTotal: Math.round((r.raw + missing) * 10) / 10 }
}
