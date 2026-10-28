import coursesRaw from '../data/courses.json?raw'
import histRaw from '../data/histograms.json?raw'
import metaRaw from '../data/meta.json?raw'
import { GROUPS, MANDATORY_IDS, isFacultyElective, isLabCourse, GROUP_COURSE_IDS } from '../data/track'
import { ENGLISH_TAUGHT } from '../data/english'

export type Tree = string | { op: 'and' | 'or'; args: Tree[] }

export interface ScheduleEntry { g: number; t: string; d: string; h: string; l: string; r: string }

export interface Course {
  id: string
  name: string
  points: number
  faculty: string
  syllabus?: string
  prereqRaw?: string
  prereq?: Tree
  coreq?: string[]
  noCredit?: string[]
  staff?: string
  notes?: string
  offered: string[]
  lastSem: string
  schedule?: ScheduleEntry[]
  scheduleSem?: string
  hours?: { lecture?: number; tutorial?: number; lab?: number; other?: number }
  exams?: { examA?: string; examB?: string; quizA?: string }
  examsSem?: string
}

export interface HistStat { avg: number | null; med: number | null; pass: number | null; n: number | null }
export interface HistSemester {
  sem: string
  staff?: { n: string; t: string }[]
  fin?: HistStat
  fa?: HistStat
  ea?: HistStat
  fb?: HistStat
  eb?: HistStat
}

export const COURSES: Record<string, Course> = JSON.parse(coursesRaw)
export const HIST: Record<string, HistSemester[]> = JSON.parse(histRaw)
export const DATA_META: { builtAt: string; semesters: string[] } = JSON.parse(metaRaw)

export const getCourse = (id?: string): Course | undefined => (id ? COURSES[id] : undefined)

// ---------- סמסטרים ----------

const HEB_ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט']
const HEB_TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ']
const HEB_HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק']

export function hebrewYear(year: number): string {
  const n = year % 1000
  let s = HEB_HUNDREDS[Math.floor(n / 100)]
  const rest = n % 100
  if (rest === 15) s += 'טו'
  else if (rest === 16) s += 'טז'
  else s += HEB_TENS[Math.floor(rest / 10)] + HEB_ONES[rest % 10]
  return s.length > 1 ? `${s.slice(0, -1)}"${s.slice(-1)}` : `${s}'`
}

export type Season = 'winter' | 'spring' | 'summer'
export const seasonOf = (code: string): Season =>
  code.endsWith('01') ? 'winter' : code.endsWith('02') ? 'spring' : 'summer'

export const SEASON_HE: Record<Season, string> = { winter: 'חורף', spring: 'אביב', summer: 'קיץ' }

export function semLabel(code: string): string {
  const year = parseInt(code.slice(0, 4), 10)
  return `${SEASON_HE[seasonOf(code)]} ${hebrewYear(year + 3761)}`
}

export function semYears(code: string): string {
  const year = parseInt(code.slice(0, 4), 10)
  const s = seasonOf(code)
  return s === 'winter' ? `${year}-${String(year + 1).slice(2)}` : `${year + 1}`
}

export function nextSemCode(code: string, includeSummer = false): string {
  const year = parseInt(code.slice(0, 4), 10)
  const s = seasonOf(code)
  if (s === 'winter') return `${year}02`
  if (s === 'spring') return includeSummer ? `${year}03` : `${year + 1}01`
  return `${year + 1}01`
}

/** הסמסטר הנוכחי לפי התאריך */
export function currentSemCode(today = new Date()): string {
  const y = today.getFullYear()
  const m = today.getMonth() + 1
  const d = today.getDate()
  if (m > 10 || (m === 10 && d >= 28)) return `${y}01`
  if (m <= 2) return `${y - 1}01`
  if (m <= 7) return `${y - 1}02`
  return `${y - 1}03`
}

// ---------- צבעים וסיווג ----------

export type Hue = 'cs' | 'ee' | 'phys' | 'math' | 'gen' | 'other'

export function hueOf(id?: string): Hue {
  if (!id) return 'gen'
  if (id.startsWith('0234') || id.startsWith('0236')) return 'cs'
  if (id.startsWith('0044') || id.startsWith('0045') || id.startsWith('0046') || id.startsWith('0048')) return 'ee'
  if (id.startsWith('0114') || id.startsWith('0116')) return 'phys'
  if (id.startsWith('0104') || id.startsWith('0106') || id.startsWith('0103')) return 'math'
  if (id.startsWith('032') || id.startsWith('0394')) return 'gen'
  return 'other'
}

export const HUE_LABEL: Record<Hue, string> = {
  cs: 'מדעי המחשב', ee: 'הנדסת חשמל', phys: 'פיזיקה', math: 'מתמטיקה', gen: 'כלל-טכניוני', other: 'פקולטות אחרות',
}

export type Category = 'mandatory' | 'lab' | 'faculty' | 'enrichment' | 'sport' | 'free'

export const CATEGORY_LABEL: Record<Category, string> = {
  mandatory: 'חובה',
  lab: 'מעבדה',
  faculty: 'בחירה פקולטית',
  enrichment: 'העשרה (מל"ג)',
  sport: 'חינוך גופני',
  free: 'בחירה חופשית',
}

/** תווית קצרה על כרטיס הקורס (חובה בלי תווית – הצבע מספיק) */
export const CATEGORY_SHORT: Record<Category, string> = {
  mandatory: 'חובה', lab: 'מעבדה', faculty: 'פקולטית', enrichment: 'מל"ג', sport: 'ספורט', free: 'כללי',
}

/** שמות הסיווגים כפי שמופיעים בפס "נשאר לתואר" ובמקרא – אותו שם, אותו צבע */
export const CATEGORY_TITLE: Record<Category, string> = {
  mandatory: 'חובה', faculty: 'בחירה פקולטית', lab: 'מעבדות', enrichment: 'העשרה (מל"ג)', sport: 'ספורט', free: 'כלל-טכניונית',
}

/** סדר קבוע של הסיווגים – זהה בפס "נשאר לתואר", במקרא ובדרישות */
export const CATEGORY_ORDER: Category[] = ['mandatory', 'faculty', 'lab', 'enrichment', 'sport', 'free']

export const isSportCourse = (c?: Course) =>
  !!c && (c.name.includes('חינוך גופני') || c.name.includes('נבחרות ספורט'))

const isSportId = (id: string) => /^03940[89]/.test(id) || isSportCourse(COURSES[id])

/**
 * "ללא זיכוי נוסף" כפי שהוא באמת חל: בצ'יזפורק כל מקצוע חינוך גופני מסומן כך מול כל מקצועות הספורט האחרים,
 * אבל לפי תקנה 1.1.8 צריך 2 נק' חינוך גופני (עד 1.5 בסמסטר) – כלומר שני מקצועות ספורט שונים נספרים שניהם.
 */
export function noCreditWith(id: string): string[] {
  const list = COURSES[id]?.noCredit ?? []
  return isSportId(id) ? list.filter((x) => !isSportId(x)) : list
}

export const isEnrichmentCourse = (c?: Course) =>
  !!c && !isSportCourse(c) &&
  ((c.faculty === 'המחלקה ללימודים הומניסטיים ואמנות' && !/אנגלית|עברית|קורס בסין/.test(c.name) && c.points > 0) ||
    /^039405\d\d$/.test(c.id))

export function categoryOfCourse(id: string): Category {
  if (MANDATORY_IDS.has(id)) return 'mandatory'
  if (isLabCourse(id)) return 'lab'
  if (isFacultyElective(id)) return 'faculty'
  const c = COURSES[id]
  if (isSportCourse(c)) return 'sport'
  if (isEnrichmentCourse(c)) return 'enrichment'
  return 'free'
}

export function groupsOf(id: string) {
  return GROUPS.filter((g) => g.courses.includes(id))
}

/** קורסים שרלוונטיים לסטודנט/ית בחשמל – לקטלוג ולמאגר */
export const isTrackRelevant = (id: string) =>
  MANDATORY_IDS.has(id) || isLabCourse(id) || isFacultyElective(id) || GROUP_COURSE_IDS.has(id)

// ---------- סטטיסטיקה ----------

export const finalStat = (h: HistSemester): HistStat | undefined => h.fin ?? h.fa ?? h.fb

export interface CourseStats {
  recentAvg: number | null
  recentPass: number | null
  semesters: number
  trend: { sem: string; avg: number; pass: number | null; med: number | null; n: number | null }[]
}

const statsCache = new Map<string, CourseStats>()

export function courseStats(id: string): CourseStats {
  const cached = statsCache.get(id)
  if (cached) return cached
  const hist = HIST[id] ?? []
  const trend = hist
    .map((h) => ({ sem: h.sem, s: finalStat(h) }))
    // ממוצע 0 = קורס עובר/נכשל, אין לו משמעות כציון
    .filter((x): x is { sem: string; s: HistStat } => !!x.s && x.s.avg != null && x.s.avg > 1)
    .map((x) => ({ sem: x.sem, avg: x.s.avg as number, pass: x.s.pass, med: x.s.med, n: x.s.n }))
    .sort((a, b) => a.sem.localeCompare(b.sem))
  const recent = trend.slice(-3)
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const res: CourseStats = {
    recentAvg: mean(recent.map((t) => t.avg)),
    recentPass: mean(recent.map((t) => t.pass).filter((p): p is number => p != null)),
    semesters: trend.length,
    trend,
  }
  statsCache.set(id, res)
  return res
}

// התפלגות ממוצעים של קורסי הפקולטה – לחישוב קושי יחסי
const facultyAverages = Object.keys(HIST)
  .filter((id) => id.startsWith('0044') || id.startsWith('0046') || MANDATORY_IDS.has(id))
  .map((id) => courseStats(id).recentAvg)
  .filter((x): x is number => x != null)
  .sort((a, b) => a - b)

export interface Difficulty { score: number; label: string; percentile: number }

export function difficultyOf(id: string): Difficulty | null {
  const { recentAvg, recentPass } = courseStats(id)
  if (recentAvg == null || facultyAverages.length === 0) return null
  let below = 0
  while (below < facultyAverages.length && facultyAverages[below] < recentAvg) below++
  const pct = below / facultyAverages.length // 0 = הממוצע הנמוך ביותר
  let score = 1 + 4 * (1 - pct)
  if (recentPass != null && recentPass < 80) score += (80 - recentPass) / 20
  score = Math.max(1, Math.min(5, score))
  const label = score >= 4.2 ? 'קשה' : score >= 3.4 ? 'מאתגר' : score >= 2.6 ? 'בינוני' : score >= 1.8 ? 'נוח' : 'קל'
  return { score, label, percentile: pct }
}

export interface Workload { hours: number; label: string; level: 1 | 2 | 3; hasLab: boolean; breakdown: string }

export function workloadOf(id: string): Workload | null {
  const c = COURSES[id]
  if (!c?.hours) return null
  const h = c.hours
  const hours = (h.lecture ?? 0) + (h.tutorial ?? 0) + (h.lab ?? 0) + (h.other ?? 0)
  const parts = [
    h.lecture ? `${h.lecture} הרצאה` : '',
    h.tutorial ? `${h.tutorial} תרגול` : '',
    h.lab ? `${h.lab} מעבדה` : '',
    h.other ? `${h.other} אחר` : '',
  ].filter(Boolean)
  const perPoint = c.points ? hours / c.points : hours
  const level: 1 | 2 | 3 = hours >= 6 || perPoint > 1.6 ? 3 : hours >= 4 ? 2 : 1
  return {
    hours,
    level,
    label: level === 3 ? 'עמוס' : level === 2 ? 'בינוני' : 'קליל',
    hasLab: !!h.lab,
    breakdown: parts.join(' · '),
  }
}

export function lecturersOf(id: string): string[] {
  const c = COURSES[id]
  const names = new Set<string>()
  c?.schedule?.forEach((s) => {
    if (s.t === 'הרצאה' && s.l) names.add(s.l)
  })
  if (names.size === 0 && c?.staff) c.staff.split(/,|\n/).map((s) => s.trim()).filter(Boolean).forEach((s) => names.add(s))
  return [...names]
}

export function staffHistory(id: string): { sem: string; lecturers: string[] }[] {
  return (HIST[id] ?? [])
    .map((h) => ({
      sem: h.sem,
      lecturers: (h.staff ?? []).filter((s) => s.t.startsWith('מרצה')).map((s) => s.n),
    }))
    .filter((x) => x.lecturers.length)
    .sort((a, b) => b.sem.localeCompare(a.sem))
}

export function offeredSeasons(id: string): Set<Season> {
  return new Set((COURSES[id]?.offered ?? []).map(seasonOf))
}

// ---------- קורסים תלויים (מה הקורס "פותח") ----------

function treeIds(t: Tree | undefined, out: Set<string> = new Set()): Set<string> {
  if (!t) return out
  if (typeof t === 'string') out.add(t)
  else t.args.forEach((a) => treeIds(a, out))
  return out
}

const dependentsIndex = new Map<string, string[]>()
for (const c of Object.values(COURSES)) {
  if (!isTrackRelevant(c.id)) continue
  for (const p of treeIds(c.prereq)) {
    const arr = dependentsIndex.get(p) ?? []
    arr.push(c.id)
    dependentsIndex.set(p, arr)
  }
}

export const dependentsOf = (id: string): string[] => dependentsIndex.get(id) ?? []

export const cheeseForkUrl = (id: string) => `https://cheesefork.cf/?course=${id}`
export const histogramsUrl = (id: string) => `https://michael-maltsev.github.io/technion-histograms/${id}/`

export const fmtPts = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${+n.toFixed(1)}`)

// ---------- קורסים שנלמדים באנגלית (תקנה 1.3.3) ----------

const HEB_YEAR: Record<string, number> = { 'תשפ"ב': 2021, 'תשפ"ג': 2022, 'תשפ"ד': 2023, 'תשפ"ה': 2024, 'תשפ"ו': 2025, 'תשפ"ז': 2026, 'תשפ"ח': 2027 }
const SEASON_CODE: Record<string, string> = { 'חורף': '01', 'אביב': '02', 'קיץ': '03' }
const englishCache = new Map<string, string[]>()

/** באילו סמסטרים הקורס נלמד באנגלית: מהרשימה הרשמית + מהערות הקורס ("יועבר באנגלית בסמסטר חורף תשפ"ז"). '*' = תמיד */
export function englishSems(id: string): string[] {
  const hit = englishCache.get(id)
  if (hit) return hit
  const out = new Set(ENGLISH_TAUGHT[id] ?? [])
  const notes = (COURSES[id]?.notes ?? '').replace(/״/g, '"')
  for (const m of notes.matchAll(/(?:יועבר|יינתן|ינתן|יילמד)\s+(?:ב|בשפה ה)אנגלית(?:\s+בסמסטר\s+(חורף|אביב|קיץ)\s+(תשפ"[א-ת]))?/g)) {
    if (m[1] && m[2] && HEB_YEAR[m[2]]) out.add(`${HEB_YEAR[m[2]]}${SEASON_CODE[m[1]]}`)
    else out.add('*')
  }
  const list = [...out].sort()
  englishCache.set(id, list)
  return list
}

/** האם הקורס נלמד באנגלית בסמסטר הזה: yes – מאושר לסמסטר; maybe – נלמד באנגלית בסמסטרים אחרים */
export function englishStatus(id: string | undefined, sem: string): 'yes' | 'maybe' | null {
  if (!id) return null
  const sems = englishSems(id)
  if (!sems.length) return null
  return sems.includes('*') || sems.includes(sem) ? 'yes' : 'maybe'
}
