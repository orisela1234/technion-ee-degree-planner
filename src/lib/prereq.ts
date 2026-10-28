import { COURSES, getCourse, nextSemCode, noCreditWith, offeredSeasons, seasonOf, semLabel, SEASON_HE, type Tree } from './catalog'
import type { PlanItem, AppState } from './types'
import { itemCourseId, isFailed } from './types'

/** מקצועות השלמה טרום-אקדמיים (0103/0113) נחשבים כמולאו – מי שהתקבל פטור מהם */
const autoSatisfied = (id: string) => id.startsWith('0103') || id.startsWith('0113')

/** ממיר עץ קדמים לצורה נורמלית דיסיונקטיבית: רשימת חלופות, כל חלופה = קבוצת קורסים שכולם נדרשים */
export function toDNF(t: Tree | undefined, cap = 64): string[][] {
  if (!t) return []
  if (typeof t === 'string') return [[t]]
  if (t.op === 'or') return t.args.flatMap((a) => toDNF(a, cap)).slice(0, cap)
  let acc: string[][] = [[]]
  for (const a of t.args) {
    const sub = toDNF(a, cap)
    const next: string[][] = []
    for (const x of acc) for (const y of sub) next.push([...new Set([...x, ...y])])
    acc = next.slice(0, cap)
  }
  return acc
}

const dnfCache = new Map<string, string[][]>()
export function prereqAlternatives(courseId: string): string[][] {
  let d = dnfCache.get(courseId)
  if (!d) {
    d = toDNF(COURSES[courseId]?.prereq)
    dnfCache.set(courseId, d)
  }
  return d
}

export interface PrereqStatus {
  ok: boolean
  /** החלופה הטובה ביותר (מלאה אם ok) */
  best: string[]
  missing: string[]
  coreqOk: boolean
  coreqMissing: string[]
}

/**
 * בודק אם הקדמים של קורס מתקיימים.
 * before – קורסים שהושלמו/מתוכננים לפני הסמסטר; same – קורסים באותו סמסטר (לצמודים).
 */
export function evalPrereq(courseId: string, before: Set<string>, same: Set<string> = new Set()): PrereqStatus {
  const has = (id: string) => before.has(id) || autoSatisfied(id)
  const alts = prereqAlternatives(courseId)
  let best: string[] = []
  let missing: string[] = []
  let ok = alts.length === 0
  if (!ok) {
    let bestScore = Infinity
    for (const alt of alts) {
      const miss = alt.filter((id) => !has(id))
      // מעדיף חלופה עם פחות חסרים, ובשוויון – חלופה שהקורסים בה קיימים בנתונים
      const score = miss.length * 100 + alt.filter((id) => !COURSES[id]).length
      if (score < bestScore) {
        bestScore = score
        best = alt
        missing = miss
      }
      if (miss.length === 0) {
        ok = true
        break
      }
    }
  }
  // מקצועות צמודים: מספיק שאחד מהם נלקח קודם או באותו סמסטר
  const coreq = COURSES[courseId]?.coreq ?? []
  const coreqOk = coreq.length === 0 || coreq.some((id) => has(id) || same.has(id))
  return { ok, best, missing, coreqOk, coreqMissing: coreqOk ? [] : coreq }
}

export function idsBefore(items: PlanItem[], sem: string, excludeKey?: string, credits: string[] = []): Set<string> {
  const s = new Set<string>(credits)
  for (const it of items) {
    if (it.key === excludeKey) continue
    const id = itemCourseId(it)
    if (id && it.sem < sem && !isFailed(it)) s.add(id)
  }
  return s
}

export function idsIn(items: PlanItem[], sem: string, excludeKey?: string): Set<string> {
  const s = new Set<string>()
  for (const it of items) {
    if (it.key === excludeKey) continue
    const id = itemCourseId(it)
    if (id && it.sem === sem && !isFailed(it)) s.add(id)
  }
  return s
}

const creditIds = (state: AppState) => state.credits.map((c) => c.id)

export interface ItemValidity { ok: boolean; reasons: string[]; warnings: string[] }

const nameOf = (id: string) => getCourse(id)?.name ?? id

export function describeMissing(st: PrereqStatus): string[] {
  const out: string[] = []
  if (!st.ok) out.push(`חסר קדם: ${st.missing.map(nameOf).join(', ')}`)
  if (!st.coreqOk) out.push(`דרוש צמוד (לפני או במקביל): אחד מ-${st.coreqMissing.map(nameOf).join(' / ')}`)
  return out
}

/** תקינות של פריט במיקומו הנוכחי (קורס שהושלם תמיד תקין – זו עובדה היסטורית) */
export function itemValidity(state: AppState, item: PlanItem, items = state.items): ItemValidity {
  const id = itemCourseId(item)
  if (!id || item.result) return { ok: true, reasons: [], warnings: [] }
  const st = evalPrereq(id, idsBefore(items, item.sem, item.key, creditIds(state)), idsIn(items, item.sem, item.key))
  const reasons = describeMissing(st)
  const warnings: string[] = []
  const seasons = offeredSeasons(id)
  const season = seasonOf(item.sem)
  if (seasons.size && !seasons.has(season)) {
    warnings.push(`בשנתיים האחרונות לא נפתח בסמסטר ${SEASON_HE[season]}`)
  }
  const clash = noCreditWith(id).filter((x) => items.some((o) => o.key !== item.key && itemCourseId(o) === x))
  if (clash.length) warnings.push(`ללא זיכוי נוסף עם: ${clash.map(nameOf).join(', ')}`)
  return { ok: reasons.length === 0, reasons, warnings }
}

export interface PlacementCheck { ok: boolean; reasons: string[]; warnings: string[] }

/**
 * האם אפשר לשבץ קורס בסמסטר. בודק גם שאין קורס מתוכנן בהמשך שתלוי בקורס הזה ושיישבר בעקבות ההזזה.
 * itemKey – כשמזיזים פריט קיים; courseId – כשמוסיפים קורס חדש מהמאגר.
 */
export function checkPlacement(
  state: AppState,
  opts: { itemKey?: string; courseId?: string; targetSem: string | null; replaceSlotKey?: string },
): PlacementCheck {
  const existing = opts.itemKey ? state.items.find((i) => i.key === opts.itemKey) : undefined
  const courseId = opts.courseId ?? (existing ? itemCourseId(existing) : undefined)
  const reasons: string[] = []
  const warnings: string[] = []

  if (courseId && !existing && state.items.some((i) => itemCourseId(i) === courseId && !isFailed(i))) {
    return { ok: false, reasons: ['הקורס כבר נמצא בתכנון'], warnings }
  }

  // מצב התכנון אחרי ההזזה
  let after = state.items.filter((i) => i.key !== opts.itemKey && i.key !== opts.replaceSlotKey)
  if (opts.targetSem) {
    const moved: PlanItem = existing
      ? { ...existing, sem: opts.targetSem }
      : { key: '__new__', courseId, sem: opts.targetSem }
    after = [...after, moved]
    const v = itemValidity(state, moved, after)
    reasons.push(...v.reasons)
    warnings.push(...v.warnings)
  }

  // קורסים תלויים שהיו תקינים ויישברו (רלוונטי רק כשמזיזים/מסירים פריט קיים – הוספה לא שוברת כלום)
  if (courseId && existing) {
    const broken: string[] = []
    for (const it of after) {
      if (it.result || it.key === '__new__' || it.key === opts.itemKey) continue
      const before = itemValidity(state, it, state.items)
      if (!before.ok) continue
      const now = itemValidity(state, it, after)
      if (!now.ok) broken.push(`${nameOf(itemCourseId(it) ?? '')} (${semLabel(it.sem)})`)
    }
    if (broken.length) reasons.push(`יפגע בקורסים שתלויים בו: ${broken.join(', ')}`)
  }
  return { ok: reasons.length === 0, reasons, warnings }
}

/** קשתות לציור בתרשים: מכל קורס אל הקורסים שבחלופת הקדם שנבחרה */
export interface Edge { from: string; to: string; kind: 'prereq' | 'coreq' }

export function computeEdges(state: AppState): Edge[] {
  const edges: Edge[] = []
  const byCourse = new Map<string, PlanItem>()
  state.items.forEach((i) => {
    const id = itemCourseId(i)
    // קורס שנכשל לא מהווה מקור לחץ; אם יש גם מועד חוזר – הוא זה שנספר
    if (id && !isFailed(i)) byCourse.set(id, i)
  })
  for (const it of state.items) {
    const id = itemCourseId(it)
    if (!id) continue
    // לקשתות לוקחים את כל מה שקיים בתרשים עד הסמסטר הזה (כולל) כדי שגם קורס "שבור" יראה מאיפה הוא מגיע
    const avail = new Set<string>()
    state.items.forEach((o) => {
      const oid = itemCourseId(o)
      if (oid && o.sem < it.sem && !isFailed(o)) avail.add(oid)
    })
    state.credits.forEach((c) => avail.add(c.id))
    const st = evalPrereq(id, avail)
    for (const p of st.best) {
      const src = byCourse.get(p)
      if (src && src.key !== it.key) edges.push({ from: src.key, to: it.key, kind: 'prereq' })
    }
    for (const p of COURSES[id]?.coreq ?? []) {
      const src = byCourse.get(p)
      if (src && src.sem <= it.sem && src.key !== it.key) edges.push({ from: src.key, to: it.key, kind: 'coreq' })
    }
  }
  return edges
}

/** הסמסטר המוקדם ביותר בתכנון שבו אפשר לשבץ קורס */
export function earliestSem(state: AppState, courseId: string): string | null {
  for (const sem of state.semesters) {
    if (sem < state.currentSem) continue
    if (checkPlacement(state, { courseId, targetSem: sem }).ok) return sem
  }
  return null
}

// ---------- הזזה עם דחיפה קדימה ----------

export interface MovePlan {
  ok: boolean
  reasons: string[]
  warnings: string[]
  /** כל הפריטים שזזים (כולל הפריט עצמו), עם הסמסטר הסופי */
  moves: { key: string; from: string; to: string }[]
  addSems: string[]
}

/**
 * מזיז פריט לסמסטר אחר. קורסים מתוכננים שנשענים עליו (ישירות או בשרשרת) ויישברו –
 * נדחפים קדימה באותו סדר, רק כמה שצריך, ועדיף לסמסטר שבו הקורס נפתח בדרך כלל.
 */
export function planMove(state: AppState, itemKey: string, targetSem: string, opts: { allowInvalidSelf?: boolean } = {}): MovePlan {
  const orig = state.items.find((i) => i.key === itemKey)
  const empty: MovePlan = { ok: false, reasons: [], warnings: [], moves: [], addSems: [] }
  if (!orig) return empty
  const items = state.items.map((i) => ({ ...i }))
  const moved = items.find((i) => i.key === itemKey)!
  moved.sem = targetSem
  const sems = [...new Set([...state.semesters, targetSem])].sort()
  const addSems: string[] = targetSem && !state.semesters.includes(targetSem) ? [targetSem] : []
  const warnings: string[] = []

  if (moved.courseId && !moved.result) {
    const v = itemValidity(state, moved, items)
    // באישור חריג (או כשהקורס כבר משובץ בלי קדם) מותר להזיז גם בלי שהקדם מתקיים
    if (!v.ok && !opts.allowInvalidSelf && !moved.waived) return { ...empty, reasons: v.reasons }
    if (!v.ok) warnings.push(...v.reasons)
    warnings.push(...v.warnings)
  }

  const wasValid = new Map(state.items.map((i) => [i.key, itemValidity(state, i).ok]))
  const nextSem = (sem: string) => {
    const idx = sems.indexOf(sem)
    if (idx >= 0 && idx < sems.length - 1) return sems[idx + 1]
    let n = nextSemCode(sem)
    while (sems.includes(n)) n = nextSemCode(n)
    sems.push(n)
    sems.sort()
    addSems.push(n)
    return n
  }

  for (let round = 0; round < 40; round++) {
    let changed = false
    const order = items
      .filter((i) => i.key !== itemKey && !i.result && i.courseId && wasValid.get(i.key))
      .sort((a, b) => a.sem.localeCompare(b.sem))
    for (const it of order) {
      if (itemValidity(state, it, items).ok) continue
      const id = it.courseId!
      const seasons = offeredSeasons(id)
      let cand = it.sem
      let fallback: string | null = null
      let found: string | null = null
      for (let k = 0; k < 10 && !found; k++) {
        cand = nextSem(cand)
        it.sem = cand
        if (!itemValidity(state, it, items).ok) continue
        if (!seasons.size || seasons.has(seasonOf(cand))) found = cand
        else fallback ??= cand
      }
      const to = found ?? fallback
      if (!to) return { ...empty, reasons: [`אין סמסטר מתאים ל"${nameOf(id)}" אחרי ההזזה`] }
      it.sem = to
      if (!found) warnings.push(`"${nameOf(id)}" נדחף לסמסטר שבו הוא בדרך כלל לא נפתח`)
      changed = true
    }
    if (!changed) break
  }

  const moves = items
    .map((it) => ({ key: it.key, from: state.items.find((o) => o.key === it.key)!.sem, to: it.sem }))
    .filter((m) => m.from !== m.to)
  const usedAdd = addSems.filter((s) => moves.some((m) => m.to === s))
  return { ok: true, reasons: [], warnings, moves, addSems: usedAdd }
}
