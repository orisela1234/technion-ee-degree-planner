import { hueOf, type Hue } from './catalog'
import type { Edge } from './prereq'
import type { PlanItem } from './types'

// ---------- מידות הרשת ----------

export const GRID = {
  comfortable: { w: 152, gap: 38, pad: 22 },
  compact: { w: 128, gap: 32, pad: 18 },
}
export type Density = keyof typeof GRID

export interface CellPos { col: number; line: number }

const HUE_ORDER: Hue[] = ['math', 'phys', 'ee', 'cs', 'other', 'gen']

/**
 * מסדר את הקורסים בעמודות קבועות לרוחב כל התרשים, כך שקורס יושב מתחת לקורסי הקדם שלו
 * (חיצים אנכיים ישרים). קורס שנגרר למקום מסוים (col) מקבל עדיפות.
 */
export function computeLayout(bySem: Map<string, PlanItem[]>, semesters: string[], edges: Edge[], ncols: number) {
  const pos = new Map<string, CellPos>()
  const n = Math.max(1, ncols)
  const clamp = (c: number) => Math.min(n, Math.max(1, Math.round(c)))
  const eeAnchor = clamp(Math.ceil(n / 2) + 1)
  const anchor = (i: PlanItem): number => {
    if (i.slot === 'lab') return clamp(eeAnchor + 1)
    if (i.slot) return eeAnchor
    switch (hueOf(i.courseId)) {
      case 'math': return 1
      case 'phys': return clamp(3)
      case 'ee': return eeAnchor
      case 'cs': return n
      default: return clamp(n - 1)
    }
  }
  const incoming = new Map<string, string[]>()
  edges.forEach((e) => incoming.set(e.to, [...(incoming.get(e.to) ?? []), e.from]))

  for (const sem of semesters) {
    const items = bySem.get(sem) ?? []
    const taken = new Map<number, Set<number>>()
    const isFree = (line: number, col: number) => !taken.get(line)?.has(col)
    const put = (key: string, target: number) => {
      const t = clamp(target)
      for (let line = 1; line < 20; line++) {
        for (let d = 0; d < n; d++) {
          for (const c of d === 0 ? [t] : [t + d, t - d]) {
            if (c >= 1 && c <= n && isFree(line, c)) {
              if (!taken.has(line)) taken.set(line, new Set())
              taken.get(line)!.add(c)
              pos.set(key, { col: c, line })
              return
            }
          }
        }
      }
    }
    const pinned = items.filter((i) => i.col != null).sort((a, b) => a.col! - b.col!)
    pinned.forEach((i) => put(i.key, i.col!))

    const rest = items.filter((i) => i.col == null).map((i) => {
      const cols = (incoming.get(i.key) ?? []).map((k) => pos.get(k)?.col).filter((c): c is number => c != null).sort((a, b) => a - b)
      const pref = cols.length ? cols[Math.floor((cols.length - 1) / 2)] : null
      return { i, pref, nsrc: cols.length }
    })
    rest.sort((a, b) => {
      if ((a.pref == null) !== (b.pref == null)) return a.pref == null ? 1 : -1
      if (a.pref != null && b.pref != null && a.pref !== b.pref) return a.pref - b.pref
      if (a.nsrc !== b.nsrc) return b.nsrc - a.nsrc
      const ha = HUE_ORDER.indexOf(hueOf(a.i.courseId)), hb = HUE_ORDER.indexOf(hueOf(b.i.courseId))
      if (ha !== hb) return ha - hb
      return (a.i.courseId ?? 'z').localeCompare(b.i.courseId ?? 'z')
    })
    rest.forEach(({ i, pref }) => put(i.key, pref ?? anchor(i)))
  }
  return pos
}

// ---------- ניתוב חיצים אורתוגונלי ----------

export interface Rect { l: number; t: number; r: number; b: number }
export interface RowBox { cardsTop: number; cardsBottom: number }
export interface RoutedPath { edge: Edge; d: string; points: [number, number][] }

interface HReq { id: number; x1: number; x2: number; lane?: number }
interface VReq { id: number; y1: number; y2: number; lane?: number }

/**
 * מנתב כל חץ בקווים ישרים בלבד (אנכי/אופקי, פינות חדות):
 * יציאה מתחתית הקורס, מעבר אופקי ברווח שבין שורות הסמסטרים, ירידה במסדרון שבין העמודות
 * כשצריך לעבור מעל סמסטרים, וכניסה מלמעלה לקורס היעד. חיצים חופפים מקבלים "נתיבים" נפרדים.
 */
export function routeEdges(
  edges: Edge[],
  rects: Map<string, Rect>,
  rowOf: Map<string, number>,
  rows: RowBox[],
  gutters: number[],
  gutterHalf: number,
): RoutedPath[] {
  const valid = edges.filter((e) => rects.has(e.from) && rects.has(e.to) && rowOf.has(e.from) && rowOf.has(e.to))
  const cx = (r: Rect) => (r.l + r.r) / 2

  // נקודות עגינה: כמה חיצים מאותו קורס נפרסים לאורך הצלע
  const outs = new Map<string, Edge[]>(), ins = new Map<string, Edge[]>()
  valid.forEach((e) => {
    outs.set(e.from, [...(outs.get(e.from) ?? []), e])
    ins.set(e.to, [...(ins.get(e.to) ?? []), e])
  })
  const portX = new Map<Edge, { s: number; t: number }>()
  const spread = (r: Rect, k: number, n: number) => {
    if (n <= 1) return cx(r)
    const w = r.r - r.l, a = r.l + w * 0.2, b = r.r - w * 0.2
    return a + ((b - a) * k) / (n - 1)
  }
  valid.forEach((e) => portX.set(e, { s: 0, t: 0 }))
  outs.forEach((list, key) => {
    const r = rects.get(key)!
    list.sort((a, b) => cx(rects.get(a.to)!) - cx(rects.get(b.to)!))
    list.forEach((e, k) => { portX.get(e)!.s = spread(r, k, list.length) })
  })
  ins.forEach((list, key) => {
    const r = rects.get(key)!
    list.sort((a, b) => cx(rects.get(a.from)!) - cx(rects.get(b.from)!))
    list.forEach((e, k) => { portX.get(e)!.t = spread(r, k, list.length) })
  })

  const cardsInRows = (from: number, to: number) => {
    const out: Rect[] = []
    rects.forEach((r, key) => {
      const row = rowOf.get(key)
      if (row != null && row > from && row < to) out.push(r)
    })
    return out
  }
  const verticalFree = (x: number, fromRow: number, toRow: number) =>
    cardsInRows(fromRow, toRow).every((r) => x < r.l - 5 || x > r.r + 5)

  type Plan =
    | { kind: 'straight'; sx: number; sy: number; ty: number }
    | { kind: 'same'; sx: number; sy: number; tx: number; ty: number; y: number }
    | { kind: 'one'; sx: number; sy: number; tx: number; ty: number; ch: number; h: HReq }
    | { kind: 'gut'; sx: number; sy: number; tx: number; ty: number; ch1: number; h1: HReq; g: number; v: VReq; ch2: number; h2: HReq }

  const hByCh = new Map<number, HReq[]>()
  const vByG = new Map<number, VReq[]>()
  const addH = (ch: number, id: number, a: number, b: number) => {
    const req: HReq = { id, x1: Math.min(a, b), x2: Math.max(a, b) }
    hByCh.set(ch, [...(hByCh.get(ch) ?? []), req])
    return req
  }
  const plans: Plan[] = valid.map((e, id) => {
    const s = rects.get(e.from)!, t = rects.get(e.to)!
    const rs = rowOf.get(e.from)!, rt = rowOf.get(e.to)!
    const { s: sx0, t: tx } = portX.get(e)!
    if (rt <= rs) {
      // צמוד באותו סמסטר – מעל הכרטיסים
      return { kind: 'same', sx: sx0, sy: s.t, tx, ty: t.t, y: rows[rt].cardsTop - 12 - (id % 3) * 4 }
    }
    if (Math.abs(sx0 - tx) < 1.5 && (rt === rs + 1 || verticalFree(tx, rs, rt))) {
      return { kind: 'straight', sx: tx, sy: s.b, ty: t.t }
    }
    if (rt === rs + 1) return { kind: 'one', sx: sx0, sy: s.b, tx, ty: t.t, ch: rs, h: addH(rs, id, sx0, tx) }
    // אנכי מהמקור עד הרווח שמעל היעד
    if (verticalFree(sx0, rs, rt)) return { kind: 'one', sx: sx0, sy: s.b, tx, ty: t.t, ch: rt - 1, h: addH(rt - 1, id, sx0, tx) }
    // אופקי מיד מתחת למקור ואז אנכי עד היעד
    if (verticalFree(tx, rs, rt)) return { kind: 'one', sx: sx0, sy: s.b, tx, ty: t.t, ch: rs, h: addH(rs, id, sx0, tx) }
    // דרך מסדרון בין העמודות
    let g = gutters[0] ?? sx0, best = Infinity
    for (const x of gutters) {
      const cost = Math.abs(sx0 - x) + Math.abs(x - tx) + Math.abs(x - tx) * 0.01
      if (cost < best) { best = cost; g = x }
    }
    const v: VReq = { id, y1: 0, y2: 0 }
    vByG.set(g, [...(vByG.get(g) ?? []), v])
    return {
      kind: 'gut', sx: sx0, sy: s.b, tx, ty: t.t,
      ch1: rs, h1: addH(rs, id, sx0, g), g, v, ch2: rt - 1, h2: addH(rt - 1, id, g, tx),
    }
  })

  // נתיבים אופקיים בכל רווח בין שורות
  const chY = (ch: number, lane: number, lanes: number) => {
    const top = rows[ch].cardsBottom + 9
    const bottom = rows[ch + 1] ? rows[ch + 1].cardsTop - 9 : top + 40
    const span = Math.max(8, bottom - top)
    return top + (span * (lane + 1)) / (lanes + 1)
  }
  const laneCount = new Map<number, number>()
  hByCh.forEach((reqs, ch) => {
    const ends: number[] = []
    reqs.sort((a, b) => a.x1 - b.x1 || a.x2 - b.x2)
    for (const r of reqs) {
      let lane = ends.findIndex((end) => end + 10 < r.x1)
      if (lane < 0) { lane = ends.length; ends.push(r.x2) } else ends[lane] = r.x2
      r.lane = lane
    }
    laneCount.set(ch, ends.length)
  })
  const yOf = (ch: number, h: HReq) => chY(ch, h.lane ?? 0, laneCount.get(ch) ?? 1)

  // נתיבים אנכיים בכל מסדרון
  plans.forEach((p) => {
    if (p.kind === 'gut') {
      p.v.y1 = yOf(p.ch1, p.h1)
      p.v.y2 = yOf(p.ch2, p.h2)
    }
  })
  const gutX = new Map<VReq, number>()
  vByG.forEach((reqs, g) => {
    const ends: number[] = []
    reqs.sort((a, b) => a.y1 - b.y1)
    for (const r of reqs) {
      let lane = ends.findIndex((end) => end + 8 < r.y1)
      if (lane < 0) { lane = ends.length; ends.push(r.y2) } else ends[lane] = r.y2
      const k = Math.ceil(lane / 2) * (lane % 2 ? 1 : -1)
      gutX.set(r, g + Math.max(-gutterHalf, Math.min(gutterHalf, k * 5)))
    }
  })

  return plans.map((p, i) => {
    let pts: [number, number][]
    switch (p.kind) {
      case 'straight': pts = [[p.sx, p.sy], [p.sx, p.ty]]; break
      case 'same': pts = [[p.sx, p.sy], [p.sx, p.y], [p.tx, p.y], [p.tx, p.ty]]; break
      case 'one': {
        const y = yOf(p.ch, p.h)
        pts = [[p.sx, p.sy], [p.sx, y], [p.tx, y], [p.tx, p.ty]]
        break
      }
      case 'gut': {
        const y1 = yOf(p.ch1, p.h1), y2 = yOf(p.ch2, p.h2), x = gutX.get(p.v) ?? p.g
        pts = [[p.sx, p.sy], [p.sx, y1], [x, y1], [x, y2], [p.tx, y2], [p.tx, p.ty]]
        break
      }
    }
    // מסיר נקודות כפולות/קוליניאריות
    const clean: [number, number][] = []
    for (const pt of pts) {
      const last = clean[clean.length - 1]
      if (last && Math.abs(last[0] - pt[0]) < 0.5 && Math.abs(last[1] - pt[1]) < 0.5) continue
      clean.push(pt)
    }
    const d = clean.map(([x, y], k) => `${k ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
    return { edge: valid[i], d, points: clean }
  })
}
