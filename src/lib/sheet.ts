import { BUILTIN_SHEET, type GradeSheet, type SheetRecord } from '../data/student'
import { TRACK } from '../data/track'
import type { Category } from './catalog'

/** הגיליון הפעיל – זה שהועלה מהממשק, או המובנה. הספק מעדכן אותו בכל שינוי מצב */
let active: GradeSheet = BUILTIN_SHEET
export const activeSheet = () => active
export const setActiveSheet = (s: GradeSheet) => { active = s }

export const sheetOf = (state: { sheet?: GradeSheet }) => state.sheet ?? BUILTIN_SHEET
export const lastSheetSem = (s: GradeSheet = active) => s.records.map((r) => r.sem).sort().pop() ?? ''
export const fmtDate = (iso: string) => iso.split('-').reverse().join('.')
/** זיהוי גיליון ברשימת ההיסטוריה */
export const sheetId = (s: GradeSheet) => `${s.issued}|${s.file ?? ''}|${s.loadedAt ?? ''}`

/** נקודות "פעילות חברתית" (0320) – זיכוי פעילות חברתית ומילואים, וגם קיצור התואר לפי מתווה המילואים */
export const isSocialCredit = (id: string) => id.startsWith('0320')
/** 032002xx – קיצור התואר לפי מתווה המילואים ("פטור") */
export const isReserveShortening = (id: string) => id.startsWith('032002')

/** לאן מותר לשייך כל שורה (לפי הבירור מול הפקולטה): קיצור התואר – פקולטית או כלל-טכניונית; זיכוי פעילות – מל"ג או כלל-טכניונית */
export const reserveOptions = (id: string): Category[] => (isReserveShortening(id) ? ['faculty', 'free'] : ['enrichment', 'free'])

/**
 * לאן נספרות נקודות המילואים – ברירת מחדל (ניתנת לשינוי בממשק):
 * קיצור התואר (032002xx) → בחירה פקולטית; זיכוי פעילות חברתית/מילואים (032001xx) → מל"ג
 * עד 6 נק', ומה שמעבר – כלל-טכניונית חופשית.
 */
export function reserveCategories(records: SheetRecord[]): Map<string, Category> {
  let enrNeed = TRACK.enrichmentPoints
  const out = new Map<string, Category>()
  for (const r of records.filter((x) => isSocialCredit(x.id) && x.points > 0).sort((a, b) => b.points - a.points)) {
    if (isReserveShortening(r.id)) out.set(r.id, 'faculty')
    else if (r.points <= enrNeed + 1e-9) {
      out.set(r.id, 'enrichment')
      enrNeed -= r.points
    } else out.set(r.id, 'free')
  }
  return out
}
