import type { GradeSheet, SheetKind, SheetRecord } from '../data/student'

/** פריט טקסט מתוך ה-PDF: x,y בפינה השמאלית-תחתונה, w רוחב */
export interface PdfItem { str: string; x: number; y: number; w: number; page: number }

export interface ParsedSheet {
  sheet: GradeSheet
  warnings: string[]
  /** סכום הנקודות שחושב מהשורות, לבדיקה מול "צבר X נקודות" */
  computedPoints: number
}

const SEASON: Record<string, string> = { 'חורף': '01', 'אביב': '02', 'קיץ': '03' }
const rev = (s: string) => [...s].reverse().join('')

function semCode(text: string): string | null {
  const y = text.match(/(\d{4})\s*-\s*(\d{4})/)
  if (!y) return null
  for (const [word, code] of Object.entries(SEASON)) {
    if (text.includes(word) || text.includes(rev(word))) return `${y[1]}${code}`
  }
  return null
}

function resultOf(text: string, points: number): { kind: SheetKind; grade?: number } | null {
  const t = text.replace(/\s+/g, ' ').trim()
  if (/^\d{1,3}$/.test(t)) return { kind: 'grade', grade: Number(t) }
  if (/פטור עם ניקוד/.test(t) || /דוקינ םע רוטפ/.test(t)) return { kind: 'exempt-credit' }
  if (/פטור ללא ניקוד/.test(t) || /דוקינ אלל רוטפ/.test(t)) return { kind: 'exempt-nocredit' }
  if (/פטור|רוטפ/.test(t)) return { kind: points > 0 ? 'exempt-credit' : 'exempt-nocredit' }
  if (/עובר|רבוע/.test(t)) return { kind: 'pass' }
  if (/נכשל|לשכנ/.test(t)) return { kind: 'grade', grade: 0 }
  return null
}

const isNum = (s: string) => /^\d+(\.\d+)?$/.test(s.trim())
const center = (i: PdfItem) => i.x + i.w / 2

/** קורא "תעודת ציונים" של הטכניון (PDF) לפי מיקומי העמודות – סמסטר, ציון, ניקוד, מקצוע */
export function parseSheetItems(items: PdfItem[]): ParsedSheet {
  const warnings: string[] = []
  // שורות לפי עמוד ו-y (סבלנות של 2.5 נק')
  const rows: PdfItem[][] = []
  const sorted = items.filter((i) => i.str.trim()).sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)
  for (const it of sorted) {
    const row = rows[rows.length - 1]
    if (row && row[0].page === it.page && Math.abs(row[0].y - it.y) <= 2.5) row.push(it)
    else rows.push([it])
  }

  let cols: { grade: number; points: number } | null = null
  const records: SheetRecord[] = []
  let accumulated: number | null = null
  let required: number | null = null
  let gpa: number | null = null
  let issued: string | null = null
  let student = ''
  let program = ''

  for (const row of rows) {
    const text = (s: string) => row.find((i) => i.str.includes(s))
    const gradeHead = text('ציון')
    const pointsHead = text('ניקוד')
    if (gradeHead && pointsHead && text('מקצוע')) {
      cols = { grade: center(gradeHead), points: center(pointsHead) }
      continue
    }
    const byRtl = [...row].sort((a, b) => center(b) - center(a))
    const joined = byRtl.map((i) => i.str).join(' ')

    if (accumulated == null && /ממוצע/.test(joined) && /נקודות/.test(joined)) {
      const nums = byRtl.filter((i) => isNum(i.str)).map((i) => Number(i.str))
      if (nums.length >= 3) [accumulated, required, gpa] = nums
      continue
    }
    if (!student && /תעודת ציונים/.test(joined)) {
      // שם בלבד – בלי מספר תעודת הזהות
      const head = row.find((i) => i.str.includes('תעודת ציונים'))!
      const idLabel = row.find((i) => i.str.includes('ת.ז'))
      student = byRtl
        .filter((i) => center(i) < center(head) && (!idLabel || center(i) > center(idLabel)) && !/\d/.test(i.str))
        .map((i) => i.str.trim()).join(' ')
      continue
    }
    if (!program && /^לתואר/.test(joined)) program = joined.replace(/^לתואר\s*/, '')
    if (!issued) {
      const d = joined.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
      if (d) issued = `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`
    }

    const idItem = row.find((i) => /^\d{8}$/.test(i.str.trim()))
    if (!idItem || !cols) continue
    const id = idItem.str.trim()
    const semItem = row.find((i) => semCode(i.str))
    const sem = semItem ? semCode(semItem.str) : semCode(joined)
    const rest = row.filter((i) => i !== idItem && i !== semItem)
    const nearest = (x: number) => rest.reduce<PdfItem | null>((best, i) => (Math.abs(center(i) - x) < 45 && (!best || Math.abs(center(i) - x) < Math.abs(center(best) - x)) ? i : best), null)
    const ptsItem = nearest(cols.points)
    const points = ptsItem && isNum(ptsItem.str) ? Number(ptsItem.str) : NaN
    const gradeItem = rest.filter((i) => i !== ptsItem).reduce<PdfItem | null>((best, i) => (Math.abs(center(i) - cols!.grade) < 60 && (!best || Math.abs(center(i) - cols!.grade) < Math.abs(center(best) - cols!.grade)) ? i : best), null)
    const name = rest
      .filter((i) => i !== ptsItem && i !== gradeItem && center(i) > cols!.points + 20 && center(i) < center(idItem))
      .sort((a, b) => center(b) - center(a))
      .map((i) => i.str.trim()).join(' ')
    const res = gradeItem ? resultOf(gradeItem.str, points) : null
    if (!sem || Number.isNaN(points) || !res) {
      warnings.push(`שורה לא מזוהה: ${id} ${name}`.trim())
      continue
    }
    records.push({ id, name, sem, points, ...res })
  }

  if (!records.length) warnings.unshift('לא נמצאו שורות קורסים – האם זה קובץ "תעודת ציונים" מהטכניון?')
  // נקודות שנצברו: הניסיון האחרון בכל קורס, בלי נכשלים
  const latest = new Map<string, SheetRecord>()
  for (const r of [...records].sort((a, b) => a.sem.localeCompare(b.sem))) latest.set(r.id, r)
  const computedPoints = Math.round([...latest.values()]
    .filter((r) => r.kind !== 'exempt-nocredit' && !(r.kind === 'grade' && (r.grade ?? 0) < 55))
    .reduce((a, r) => a + r.points, 0) * 10) / 10
  if (accumulated == null) warnings.push('לא נמצא סך הנקודות שנצברו בכותרת הגיליון')
  if (gpa == null) warnings.push('לא נמצא הממוצע בכותרת הגיליון')
  if (!issued) warnings.push('לא נמצא תאריך הפקה – נרשם התאריך של היום')

  return {
    sheet: {
      issued: issued ?? new Date().toISOString().slice(0, 10),
      student,
      program,
      accumulated: accumulated ?? computedPoints,
      required: required ?? 157.5,
      gpa: gpa ?? 0,
      records,
    },
    warnings,
    computedPoints,
  }
}
