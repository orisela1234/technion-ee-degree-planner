import { GROUPS } from '../data/track'
import { chainCourses } from './chains'
import { evalGroup, type GroupEval } from './requirements'
import type { AppState } from './types'
import { isDone, isFailed, itemCourseId } from './types'

/**
 * שיוך קורסים לשרשראות: כל קורס נספר בשרשרת אחת בלבד ("6 מקצועות שונים של שתי הקבוצות").
 * קורס שמופיע בכמה שרשראות שנבחרו – לפי מה שהמשתמש קבע, ואחרת אוטומטית: השיוך שמשלים הכי הרבה שרשראות.
 */
export interface ChainAlloc {
  /** courseId → מזהה השרשרת שבה הוא נספר */
  assign: Map<string, number>
  /** courseId → כל השרשראות שנבחרו שהוא יכול להיספר בהן */
  options: Map<string, number[]>
  /** קורסים שהשיוך שלהם נקבע ידנית */
  pinned: Set<string>
  plan: Map<number, GroupEval>
  done: Map<number, GroupEval>
}

const cache = new WeakMap<AppState, ChainAlloc>()

export function chainAllocation(state: AppState): ChainAlloc {
  const hit = cache.get(state)
  if (hit) return hit
  const sel = state.selectedGroups.slice(0, 3)
  const planIds = [...new Set(state.items.filter((i) => !isFailed(i)).map(itemCourseId).filter(Boolean) as string[])]
  const doneIds = new Set(state.items.filter(isDone).map(itemCourseId).filter(Boolean) as string[])
  const members = new Map(sel.map((s) => [s.id, new Set(chainCourses(s.id))]))

  const options = new Map<string, number[]>()
  for (const id of planIds) {
    const opts = sel.filter((s) => members.get(s.id)!.has(id)).map((s) => s.id)
    if (opts.length) options.set(id, opts)
  }

  const assign = new Map<string, number>()
  const pinned = new Set<string>()
  const free: string[] = []
  for (const [id, opts] of options) {
    const want = state.chainAssign?.[id]
    if (opts.length === 1) assign.set(id, opts[0])
    else if (want != null && opts.includes(want)) { assign.set(id, want); pinned.add(id) }
    else free.push(id)
  }

  const evalAll = (a: Map<string, number>, ids: Set<string> | null) => {
    const out = new Map<number, GroupEval>()
    for (const s of sel) {
      const g = GROUPS.find((x) => x.id === s.id)!
      const set = new Set([...a].filter(([id, gid]) => gid === s.id && (!ids || ids.has(id))).map(([id]) => id))
      out.set(s.id, evalGroup(g, s.double, set))
    }
    return out
  }
  const score = (ev: Map<number, GroupEval>) =>
    [...ev.values()].reduce((t, e) => t + (e.complete ? 1000 : 0) + Math.min(e.count, e.need) * 10 + e.rules.filter((r) => r.ok).length, 0)

  // חיפוש מלא על הקורסים המשותפים (בדרך כלל מעטים); אם יש הרבה – בחירה חמדנית אחד-אחד
  const combos = free.reduce((n, id) => n * options.get(id)!.length, 1)
  if (combos <= 4096) {
    let best: Map<string, number> | null = null
    let bestScore = -1
    for (let k = 0; k < combos; k++) {
      const a = new Map(assign)
      let r = k
      for (const id of free) {
        const opts = options.get(id)!
        a.set(id, opts[r % opts.length])
        r = Math.floor(r / opts.length)
      }
      const sc = score(evalAll(a, null))
      if (sc > bestScore) { bestScore = sc; best = a }
    }
    if (best) best.forEach((gid, id) => assign.set(id, gid))
  } else {
    for (const id of free) {
      let bestGid = options.get(id)![0]
      let bestScore = -1
      for (const gid of options.get(id)!) {
        const a = new Map(assign).set(id, gid)
        const sc = score(evalAll(a, null))
        if (sc > bestScore) { bestScore = sc; bestGid = gid }
      }
      assign.set(id, bestGid)
    }
  }

  const result: ChainAlloc = { assign, options, pinned, plan: evalAll(assign, null), done: evalAll(assign, doneIds) }
  cache.set(state, result)
  return result
}
