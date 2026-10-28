import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'
import { COURSES, currentSemCode, nextSemCode, categoryOfCourse, isSportCourse, type Category } from './catalog'
import { MANDATORY, MANDATORY_IDS, MANDATORY_SLOTS, isLabCourse, type SlotType } from '../data/track'
import { evalPrereq, idsBefore, idsIn } from './prereq'
import { BUILTIN_SHEET, type GradeSheet, type SheetRecord } from '../data/student'
import { markBackup } from './persist'
import { fmtDate, lastSheetSem, reserveCategories, setActiveSheet, sheetId, sheetOf } from './sheet'
import type { AppState, ColorBy, Credit, PlanItem, Result } from './types'
import { isFailed } from './types'

const STORAGE_KEY = 'degree-planner:v1'
export const MAX_CHAINS = 3

export const newKey = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

export function buildInitialState(sheet: GradeSheet = BUILTIN_SHEET): AppState {
  const currentSem = currentSemCode()
  const firstSem = sheet.records.map((r) => r.sem).sort()[0] ?? currentSem
  const semesters: string[] = [firstSem]
  while (semesters.length < 8) semesters.push(nextSemCode(semesters[semesters.length - 1]))
  while (semesters[semesters.length - 1] < currentSem) semesters.push(nextSemCode(semesters[semesters.length - 1]))

  const items: PlanItem[] = []
  const credits: Credit[] = []
  const reserveCat = reserveCategories(sheet.records)
  for (const r of sheet.records) {
    const inChart = (r.kind === 'grade' || r.kind === 'pass') && (MANDATORY_IDS.has(r.id) || r.points > 0)
    const mandatoryExempt = r.kind === 'exempt-credit' && MANDATORY_IDS.has(r.id)
    if (inChart || mandatoryExempt) {
      const result: Result = r.kind === 'grade' ? { kind: 'grade', grade: r.grade ?? 0 }
        : r.kind === 'pass' ? { kind: 'pass' } : { kind: 'exempt' }
      items.push({ key: newKey(), courseId: r.id, sem: r.sem, result, points: r.points })
    } else {
      const cat: Category = r.id.startsWith('0320') ? reserveCat.get(r.id) ?? 'free' : categoryOfCourse(r.id)
      credits.push({ key: newKey(), id: r.id, name: r.name, points: r.points, kind: r.kind as Credit['kind'], sem: r.sem, category: cat })
    }
  }
  const creditIds = credits.map((c) => c.id)

  // הסמסטר הראשון שאין עליו ציונים בגיליון
  const firstOpen = sheet.records.length ? nextSemCode(lastSheetSem(sheet)) : currentSem

  // משבץ קורס בסמסטר המוקדם ביותר (מההמלצה והלאה) שבו הקדמים כבר מתקיימים
  const schedule = (courseId: string, from: string) => {
    let sem = from
    for (let guard = 0; guard < 8; guard++) {
      if (!semesters.includes(sem)) semesters.push(sem)
      const st = evalPrereq(courseId, idsBefore(items, sem, undefined, creditIds), idsIn(items, sem))
      if (st.ok && st.coreqOk) break
      sem = nextSemCode(sem)
    }
    return sem
  }

  // חובה שעוד לא עברה בהצלחה (כולל קורס שנכשל – מקבל מועד חוזר), לפי סדר הקטלוג
  const passed = new Set(items.filter((i) => !isFailed(i)).map((i) => i.courseId))
  for (const m of MANDATORY) {
    if ([m.id, ...(m.alternatives ?? [])].some((x) => passed.has(x))) continue
    let from = semesters[m.sem - 1] ?? semesters[semesters.length - 1]
    if (from < firstOpen) from = firstOpen
    items.push({ key: newKey(), courseId: m.id, sem: schedule(m.id, from) })
  }

  // משבצות חובה (חינוך גופני, מעבדות) – רק מה שעוד לא כוסה
  const coveredPts = (pred: (id: string) => boolean) =>
    items.filter((i) => i.courseId && !isFailed(i) && pred(i.courseId)).reduce((a, i) => a + (i.points ?? COURSES[i.courseId!]?.points ?? 0), 0)
  const covered: Record<string, number> = {
    sport: coveredPts((id) => isSportCourse(COURSES[id]) || id.startsWith('03940')),
    lab: coveredPts(isLabCourse),
  }
  let sportSem = firstOpen > currentSem ? firstOpen : currentSem
  for (const s of MANDATORY_SLOTS) {
    if ((covered[s.slot] ?? 0) >= s.points) {
      covered[s.slot] -= s.points
      continue
    }
    let sem: string
    if (s.slot === 'sport') {
      sem = sportSem
      sportSem = nextSemCode(sportSem)
    } else {
      sem = semesters[s.sem - 1] ?? semesters[semesters.length - 1]
      if (sem < currentSem) sem = currentSem
    }
    if (!semesters.includes(sem)) semesters.push(sem)
    items.push({ key: newKey(), slot: s.slot, points: s.points, sem })
  }

  return {
    v: 1,
    semesters: [...new Set(semesters)].sort(),
    currentSem,
    items,
    credits,
    selectedGroups: [],
    notes: {},
    expected: {},
    strict: true,
    arrows: 'all',
    sheetIssued: sheet.issued,
    reserveRuleV: RESERVE_RULE_V,
  }
}

function sheetResult(r: SheetRecord): Result {
  return r.kind === 'grade' ? { kind: 'grade', grade: r.grade ?? 0 } : r.kind === 'pass' ? { kind: 'pass' } : { kind: 'exempt' }
}


/**
 * גיליון ציונים חדש: בונים מחדש מהגיליון, ושומרים את התכנון של המשתמש –
 * איפה שיבץ קורסי חובה עתידיים, קורסי בחירה, משבצות, עובר בינארי, ציונים שהזין לקורסים שעוד לא בגיליון,
 * קבוצות, הערות, ציונים צפויים, סמסטרים נוספים והגדרות.
 */
function migrateToSheet(old: AppState, sheet: GradeSheet, uploaded: boolean): AppState {
  const fresh = buildInitialState(sheet)
  const oldSheet = sheetOf(old)
  const fromOldSheet = (i: PlanItem) => !!i.result && oldSheet.records.some((r) => r.id === i.courseId && r.sem === i.sem)
  const passedNow = new Set(fresh.items.filter((i) => i.result && !isFailed(i)).map((i) => i.courseId))
  const openFrom = sheet.records.length ? nextSemCode(lastSheetSem(sheet)) : fresh.currentSem
  const items = [...fresh.items]

  // עובר בינארי שסומן על קורס מהגיליון
  for (const o of old.items) {
    if (!o.binary || !o.courseId) continue
    const f = items.find((i) => i.courseId === o.courseId && i.sem === o.sem && i.result)
    if (f) f.binary = true
  }

  // קורסים שהמשתמש תכנן או הזין בעצמו
  for (const o of old.items) {
    if (!o.courseId || fromOldSheet(o) || passedNow.has(o.courseId)) continue
    if (MANDATORY_IDS.has(o.courseId)) {
      // קורס חובה: שומרים את המיקום שבחר המשתמש במקום השיבוץ האוטומטי
      const idx = items.findIndex((i) => i.courseId === o.courseId && !i.result)
      if (idx >= 0 && (o.result || o.sem >= openFrom)) items[idx] = { ...o }
      continue
    }
    items.push({ ...o })
  }

  // משבצות (ספורט, מעבדות…) – שומרים את המיקום של המשתמש, עד כמה שעוד חסר לפי הגיליון החדש
  const freshSlots = items.filter((i) => i.slot)
  const kept: PlanItem[] = []
  for (const type of new Set(freshSlots.map((i) => i.slot!))) {
    let need = freshSlots.filter((i) => i.slot === type).reduce((a, i) => a + (i.points ?? 0), 0)
    for (const o of old.items.filter((i) => i.slot === type && i.sem >= fresh.currentSem).sort((x, y) => x.sem.localeCompare(y.sem))) {
      if (need <= 0) break
      const pts = Math.min(o.points ?? 0, need)
      kept.push({ ...o, points: pts })
      need -= pts
    }
    for (const f of freshSlots.filter((i) => i.slot === type)) {
      if (need <= 0) break
      const pts = Math.min(f.points ?? 0, need)
      kept.push({ ...f, points: pts })
      need -= pts
    }
  }

  const keys = new Set(items.filter((i) => !i.slot).map((i) => i.key))
  const expected: Record<string, number> = {}
  Object.entries(old.expected ?? {}).forEach(([k, v]) => { if (keys.has(k)) expected[k] = v })
  const credits = fresh.credits.map((c) => ({ ...c, category: old.credits.find((o) => o.id === c.id)?.category ?? c.category }))
  const finalItems = [...items.filter((i) => !i.slot), ...kept]
  return {
    ...fresh,
    items: finalItems,
    credits,
    semesters: [...new Set([...fresh.semesters, ...old.semesters.filter((s) => s >= fresh.currentSem), ...finalItems.map((i) => i.sem)])].sort(),
    selectedGroups: old.selectedGroups ?? [],
    chainAssign: old.chainAssign,
    notes: old.notes ?? {},
    expected,
    strict: old.strict ?? true,
    arrows: old.arrows ?? 'all',
    lens: old.lens,
    density: old.density,
    colorBy: old.colorBy,
    binaryRule: old.binaryRule,
    sheet: uploaded ? sheet : undefined,
    sheetHistory: old.sheetHistory,
    notice: `התכנון עודכן לפי גיליון הציונים מ-${fmtDate(sheet.issued)}. התכנון שלך – קורסים, משבצות, שרשראות והערות – נשמר.`,
  }
}

const RESERVE_RULE_V = 2

/** חד-פעמי לתכנון שמור: מחילים את סיווג נקודות המילואים שנקבע מול הפקולטה (אפשר לשנות אחר כך ידנית) */
function withReserveRule(s: AppState): AppState {
  if ((s.reserveRuleV ?? 0) >= RESERVE_RULE_V) return s
  const m = reserveCategories(sheetOf(s).records)
  return {
    ...s,
    reserveRuleV: RESERVE_RULE_V,
    credits: s.credits.map((c) => {
      const cat = m.get(c.id)
      return cat ? { ...c, category: cat } : c
    }),
  }
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const s = JSON.parse(raw) as AppState
      if (s.v === 1 && Array.isArray(s.items)) {
        const next = !s.sheet && s.sheetIssued !== BUILTIN_SHEET.issued ? migrateToSheet(s, BUILTIN_SHEET, false) : { ...s, currentSem: currentSemCode() }
        return withReserveRule(next)
      }
    }
  } catch {
    // אחסון חסום או פגום – מתחילים מחדש
  }
  return buildInitialState()
}

export type Action =
  | { type: 'move'; key: string; sem: string; col?: number; waived?: boolean }
  | { type: 'add'; courseId: string; sem: string; replaceSlotKey?: string; col?: number; waived?: boolean }
  | { type: 'setWaived'; key: string; waived: boolean }
  | { type: 'unpinAll' }
  | { type: 'restoreSheetRecord'; id: string; sem: string }
  | { type: 'batch'; actions: Action[] }
  | { type: 'setBinary'; key: string; binary: boolean }
  | { type: 'setBinaryRule'; rule: 'strict' | 'lenient' }
  | { type: 'resetToSheet'; key?: string }
  | { type: 'applyMoves'; moves: { key: string; sem: string; col?: number | null; waived?: boolean }[]; addSems: string[] }
  | { type: 'setLens'; lens: boolean }
  | { type: 'setDensity'; density: 'comfortable' | 'compact' }
  | { type: 'setColorBy'; colorBy: ColorBy }
  | { type: 'applySheet'; sheet: GradeSheet }
  | { type: 'newUser'; sheet?: GradeSheet }
  | { type: 'assignChain'; courseId: string; groupId: number | null }
  | { type: 'remove'; key: string }
  | { type: 'setResult'; key: string; result?: Result }
  | { type: 'setCategory'; key: string; category?: Category }
  | { type: 'addSlot'; slot: SlotType; sem: string; points: number; col?: number | null }
  | { type: 'setSlotPoints'; key: string; points: number }
  | { type: 'addSem'; code: string }
  | { type: 'removeSem'; code: string }
  | { type: 'toggleGroup'; id: number }
  | { type: 'selectChain'; id: number; double: boolean }
  | { type: 'setGroupDouble'; id: number; double: boolean }
  | { type: 'setNote'; id: string; text: string }
  | { type: 'setExpected'; key: string; grade?: number }
  | { type: 'setCreditCategory'; key: string; category: Category }
  | { type: 'setStrict'; strict: boolean }
  | { type: 'setArrows'; arrows: AppState['arrows'] }
  | { type: 'import'; state: AppState }
  | { type: 'reset' }
  | { type: 'dismissNotice' }
  | { type: 'undo' }

function apply(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'move':
      return { ...s, items: s.items.map((i) => (i.key === a.key ? { ...i, sem: a.sem, col: a.col ?? (i.sem === a.sem ? i.col : undefined), waived: a.waived ?? i.waived } : i)) }
    case 'add': {
      const slot = s.items.find((i) => i.key === a.replaceSlotKey)
      // משבצת של 2 נק' שמולאה במעבדה של 1 נק' – היתרה נשארת כמשבצת פתוחה
      const rest = slot?.slot && slot.points != null ? Math.round((slot.points - (COURSES[a.courseId]?.points ?? 0)) * 10) / 10 : 0
      const items = rest > 0
        ? s.items.map((i) => (i.key === a.replaceSlotKey ? { ...i, points: rest } : i))
        : s.items.filter((i) => i.key !== a.replaceSlotKey)
      return { ...s, items: [...items, { key: newKey(), courseId: a.courseId, sem: a.sem, col: a.col ?? slot?.col, waived: a.waived || undefined }] }
    }
    case 'setWaived':
      return { ...s, items: s.items.map((i) => (i.key === a.key ? { ...i, waived: a.waived || undefined } : i)) }
    case 'applyMoves': {
      const m = new Map(a.moves.map((x) => [x.key, x]))
      return {
        ...s,
        semesters: [...new Set([...s.semesters, ...a.addSems])].sort(),
        items: s.items.map((i) => {
          const x = m.get(i.key)
          if (!x) return i
          return { ...i, sem: x.sem, col: x.col === null ? undefined : x.col ?? i.col, waived: x.waived ?? i.waived }
        }),
      }
    }
    case 'setBinary':
      return { ...s, items: s.items.map((i) => (i.key === a.key ? { ...i, binary: a.binary || undefined } : i)) }
    case 'setBinaryRule':
      return { ...s, binaryRule: a.rule }
    case 'resetToSheet':
      return {
        ...s,
        items: s.items.map((i) => {
          if (a.key && i.key !== a.key) return i
          const rec = sheetOf(s).records.find((r) => r.id === i.courseId && r.sem === i.sem)
          if (!rec) return a.key ? { ...i, result: undefined, binary: undefined } : i
          return { ...i, binary: undefined, result: sheetResult(rec) }
        }),
      }
    case 'restoreSheetRecord': {
      const rec = sheetOf(s).records.find((r) => r.id === a.id && r.sem === a.sem)
      if (!rec) return s
      return {
        ...s,
        semesters: [...new Set([...s.semesters, rec.sem])].sort(),
        items: [...s.items, { key: newKey(), courseId: rec.id, sem: rec.sem, points: rec.points, result: sheetResult(rec) }],
      }
    }
    case 'batch':
      return a.actions.reduce(apply, s)
    case 'unpinAll':
      return { ...s, items: s.items.map((i) => (i.col == null ? i : { ...i, col: undefined })) }
    case 'setLens':
      return { ...s, lens: a.lens }
    case 'setDensity':
      return { ...s, density: a.density }
    case 'setColorBy':
      return { ...s, colorBy: a.colorBy }
    case 'remove':
      return { ...s, items: s.items.filter((i) => i.key !== a.key) }
    case 'setResult':
      return { ...s, items: s.items.map((i) => (i.key === a.key ? { ...i, result: a.result } : i)) }
    case 'setCategory':
      return { ...s, items: s.items.map((i) => (i.key === a.key ? { ...i, category: a.category } : i)) }
    case 'addSlot':
      return { ...s, items: [...s.items, { key: newKey(), slot: a.slot, points: a.points, sem: a.sem, ...(a.col != null ? { col: a.col } : {}) }] }
    case 'setSlotPoints':
      return { ...s, items: s.items.map((i) => (i.key === a.key ? { ...i, points: a.points } : i)) }
    case 'addSem':
      return s.semesters.includes(a.code) ? s : { ...s, semesters: [...s.semesters, a.code].sort() }
    case 'removeSem':
      if (s.items.some((i) => i.sem === a.code)) return s
      return { ...s, semesters: s.semesters.filter((x) => x !== a.code) }
    case 'toggleGroup': {
      const has = s.selectedGroups.some((g) => g.id === a.id)
      if (!has && s.selectedGroups.length >= MAX_CHAINS) return s
      return {
        ...s,
        selectedGroups: has ? s.selectedGroups.filter((g) => g.id !== a.id) : [...s.selectedGroups, { id: a.id, double: false }],
      }
    }
    case 'selectChain': {
      const cur = s.selectedGroups.find((g) => g.id === a.id)
      if (cur && cur.double === a.double) return { ...s, selectedGroups: s.selectedGroups.filter((g) => g.id !== a.id) }
      if (cur) return { ...s, selectedGroups: s.selectedGroups.map((g) => (g.id === a.id ? { ...g, double: a.double } : g)) }
      if (s.selectedGroups.length >= MAX_CHAINS) return s
      return { ...s, selectedGroups: [...s.selectedGroups, { id: a.id, double: a.double }] }
    }
    case 'setGroupDouble':
      return { ...s, selectedGroups: s.selectedGroups.map((g) => (g.id === a.id ? { ...g, double: a.double } : g)) }
    case 'setNote':
      return { ...s, notes: { ...s.notes, [a.id]: a.text } }
    case 'setExpected': {
      const expected = { ...s.expected }
      if (a.grade == null) delete expected[a.key]
      else expected[a.key] = a.grade
      return { ...s, expected }
    }
    case 'setCreditCategory':
      return { ...s, credits: s.credits.map((c) => (c.key === a.key ? { ...c, category: a.category } : c)) }
    case 'setStrict':
      return { ...s, strict: a.strict }
    case 'setArrows':
      return { ...s, arrows: a.arrows }
    case 'import':
      return !a.state.sheet && a.state.sheetIssued !== BUILTIN_SHEET.issued ? migrateToSheet(a.state, BUILTIN_SHEET, false) : { ...a.state, currentSem: currentSemCode() }
    case 'dismissNotice':
      return { ...s, notice: undefined }
    case 'reset':
      return { ...buildInitialState(sheetOf(s)), sheet: s.sheet, sheetHistory: s.sheetHistory }
    case 'assignChain': {
      const chainAssign = { ...(s.chainAssign ?? {}) }
      if (a.groupId == null) delete chainAssign[a.courseId]
      else chainAssign[a.courseId] = a.groupId
      return { ...s, chainAssign }
    }
    case 'newUser':
      // משתמש אחר: תכנון חדש לגמרי מהגיליון, בלי שום דבר מהתכנון הקודם (בלי גיליון – חזרה למסך הפתיחה)
      return a.sheet ? withReserveRule({ ...buildInitialState(a.sheet), sheet: a.sheet }) : buildInitialState()
    case 'applySheet': {
      const prev = sheetOf(s)
      const history = [prev, ...(s.sheetHistory ?? [])]
        .filter((x) => x.records.length > 0) // בלי "גיליון" ריק של מסך הפתיחה
        .filter((x, i, arr) => sheetId(x) !== sheetId(a.sheet) && arr.findIndex((y) => sheetId(y) === sheetId(x)) === i)
        .slice(0, 6)
      return { ...migrateToSheet(s, a.sheet, a.sheet !== BUILTIN_SHEET), sheetHistory: history }
    }
    default:
      return s
  }
}

interface History { present: AppState; past: AppState[] }

const SILENT: Action['type'][] = ['setNote', 'setArrows', 'setExpected', 'dismissNotice', 'setLens', 'setDensity', 'setColorBy']

function reducer(h: History, a: Action): History {
  if (a.type === 'undo') {
    if (!h.past.length) return h
    return { present: h.past[h.past.length - 1], past: h.past.slice(0, -1) }
  }
  const next = apply(h.present, a)
  if (next === h.present) return h
  if (SILENT.includes(a.type)) return { ...h, present: next }
  return { present: next, past: [...h.past.slice(-49), h.present] }
}

interface Ctx { state: AppState; dispatch: (a: Action) => void; canUndo: boolean }

const StoreCtx = createContext<Ctx | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [h, dispatch] = useReducer(reducer, undefined, () => ({ present: loadState(), past: [] }))
  const saveTimer = useRef<number>()
  useEffect(() => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(h.present))
      } catch {
        // אין אחסון – ממשיכים בלי שמירה
      }
    }, 250)
  }, [h.present])
  // הגיליון הפעיל זמין לכל הפונקציות (אימות ציונים, בדיקות התאמה) לפני שהילדים מתרנדרים
  setActiveSheet(sheetOf(h.present))
  const value = useMemo(() => ({ state: h.present, dispatch, canUndo: h.past.length > 0 }), [h])
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

export function useStore() {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useStore outside provider')
  return ctx
}

export function exportState(state: AppState) {
  // הגיבוי כולל תמיד את תעודת הציונים, כדי שאפשר יהיה לטעון אותו גם בגרסת השיתוף
  const blob = new Blob([JSON.stringify({ ...state, sheet: state.sheet ?? sheetOf(state) }, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `תכנון-תואר-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  markBackup()
}
