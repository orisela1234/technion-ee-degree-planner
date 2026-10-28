// גרסת השיתוף: אין כאן נתונים של אף סטודנט. כל משתמש מעלה את תעודת הציונים שלו במסך הפתיחה,
// והיא נשמרת רק בדפדפן שלו (localStorage) – לא נשלחת לשום מקום.

export const GRADE_SHEET = {
  issued: '',
  student: '',
  program: '',
  accumulated: 0,
  required: 157.5,
  gpa: 0,
}

export type SheetKind = 'grade' | 'pass' | 'exempt-credit' | 'exempt-nocredit'

export interface SheetRecord {
  id: string
  name: string
  sem: string
  points: number
  kind: SheetKind
  grade?: number
}

/** גיליון ציונים שלם – המובנה כאן, או אחד שהועלה מהממשק (נשמר בדפדפן) */
export interface GradeSheet {
  issued: string
  student: string
  program: string
  accumulated: number
  required: number
  gpa: number
  records: SheetRecord[]
  /** שם הקובץ שהועלה ומתי */
  file?: string
  loadedAt?: string
}

export const SHEET_RECORDS: SheetRecord[] = []

export const BUILTIN_SHEET: GradeSheet = { ...GRADE_SHEET, records: SHEET_RECORDS }
