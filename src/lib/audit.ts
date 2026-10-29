import { TRACK, GROUPS } from '../data/track'
import { COURSES, englishStatus, fmtPts, nCourses, semLabel } from './catalog'
import { ENGLISH_A, ENGLISH_B } from '../data/english'
import { computeRequirements, groupsSummary, gpa, itemCategory, itemName, itemPoints } from './requirements'
import { binaryUsage, fmtGpa, withinBinaryLimit, BINARY_MAX_COURSES, BINARY_MAX_POINTS } from './grades'
import { chainAllocation } from './chainAlloc'
import { variantLabel } from './chains'
import { findIssues } from './integrity'
import { itemValidity } from './prereq'
import { isSocialCredit, sheetOf } from './sheet'
import type { AppState } from './types'
import { isDone, isFailed } from './types'

export type CheckStatus = 'ok' | 'fail' | 'warn'
export type CheckGroup = 'points' | 'chains' | 'rules' | 'plan'

export interface AuditCheck {
  id: string
  group: CheckGroup
  title: string
  status: CheckStatus
  detail: string
  /** פירוט נוסף (שורות) */
  lines?: string[]
  /** מקור הכלל */
  source: string
  /** לאן ללכת כדי לתקן */
  go?: 'plan' | 'chains' | 'grades' | 'sheet' | 'reqs'
}

export interface Audit { mode: 'done' | 'plan'; checks: AuditCheck[]; closes: boolean; fails: number; warns: number }

export const GROUP_TITLE: Record<CheckGroup, string> = {
  points: 'נקודות ודרישות',
  chains: 'קבוצות התמחות (שרשראות)',
  rules: 'כללים ומגבלות',
  plan: 'תקינות התכנון',
}

const CAT = 'קטלוג תשפ"ו, המסלול בהנדסת חשמל (004004-1-000)'
const REGS = 'תקנות לימודי הסמכה, קטלוג תשפ"ו'

const cache = new WeakMap<AppState, { done?: Audit; plan?: Audit }>()

/**
 * בדיקת סגירת תואר – כל התנאים מהקטלוג ומתקנות הטכניון.
 * done: לפי מה שכבר הושלם; plan: אם כל מה שבתכנון יעבור בהצלחה.
 */
export function degreeAudit(state: AppState, mode: 'done' | 'plan'): Audit {
  const hit = cache.get(state)?.[mode]
  if (hit) return hit
  const req = computeRequirements(state, mode)
  const items = state.items.filter((i) => !isFailed(i) && (mode === 'plan' || isDone(i)))
  const checks: AuditCheck[] = []
  const add = (c: AuditCheck) => checks.push(c)
  const pts = (n: number) => fmtPts(Math.round(n * 10) / 10)

  // ---------- נקודות ודרישות ----------
  add({
    id: 'total', group: 'points', title: `סך הכול ${fmtPts(TRACK.totalPoints)} נק"ז`,
    status: req.raw >= TRACK.totalPoints - 1e-9 ? 'ok' : 'fail',
    detail: `${pts(req.raw)} מתוך ${fmtPts(TRACK.totalPoints)}${req.raw < TRACK.totalPoints ? ` · חסרות ${pts(TRACK.totalPoints - req.raw)}` : ''}`,
    source: CAT, go: 'plan',
  })
  const missingMand = req.remainingMandatory
  add({
    id: 'mandatory', group: 'points', title: 'כל מקצועות החובה',
    status: missingMand.length === 0 && req.mandatory.have >= req.mandatory.need - 1e-9 ? 'ok' : 'fail',
    detail: missingMand.length ? `חסרים ${missingMand.length} מקצועות חובה` : `${pts(req.mandatory.have)} / ${fmtPts(req.mandatory.need)} נק'`,
    lines: missingMand.map((m) => `${COURSES[m.id]?.name ?? m.id} (${m.id})`),
    source: `${CAT} – 106 נק' חובה`, go: 'plan',
  })
  add({
    id: 'labs', group: 'points', title: `מקצועות מעבדה מתוך רשימה – ${fmtPts(TRACK.labPoints)} נק'`,
    status: req.labs.have >= TRACK.labPoints - 1e-9 ? 'ok' : 'fail',
    detail: `${pts(req.labs.have)} / ${fmtPts(TRACK.labPoints)} נק' (00450100–00450121, עד ${fmtPts(TRACK.maxLabPoints)})`,
    source: `${CAT} – "מקצועות מעבדה מתוך רשימה"`, go: 'plan',
  })
  add({
    id: 'faculty', group: 'points', title: `בחירה פקולטית – לפחות ${fmtPts(TRACK.facultyElectivePoints)} נק'`,
    status: req.faculty.have >= TRACK.facultyElectivePoints - 1e-9 ? 'ok' : 'fail',
    detail: `${pts(req.faculty.have)} / ${fmtPts(TRACK.facultyElectivePoints)}${req.socialCredit.faculty ? ` (כולל ${pts(req.socialCredit.faculty)} קיזוז מילואים)` : ''}`,
    source: CAT, go: 'chains',
  })
  add({
    id: 'general', group: 'points', title: `בחירה כלל-טכניונית – ${fmtPts(TRACK.generalPoints)} נק'`,
    status: req.general.have >= TRACK.generalPoints - 1e-9 ? 'ok' : 'fail',
    detail: `${pts(req.general.have)} / ${fmtPts(TRACK.generalPoints)} (מל"ג + ספורט + בחירה חופשית)`,
    source: CAT, go: 'reqs',
  })
  add({
    id: 'enrichment', group: 'points', title: `לימודי העשרה (מל"ג) – ${fmtPts(TRACK.enrichmentPoints)} נק'`,
    status: req.enrichment.have >= TRACK.enrichmentPoints - 1e-9 ? 'ok' : 'fail',
    detail: `${pts(req.enrichment.have)} / ${fmtPts(TRACK.enrichmentPoints)}${req.socialCredit.enrichment ? ` (כולל ${pts(req.socialCredit.enrichment)} קיזוז)` : ''}`,
    source: `${CAT} – "6 נקודות במקצועות המוגדרים כלימודי העשרה"`, go: 'plan',
  })
  add({
    id: 'sport', group: 'points', title: `חינוך גופני – ${fmtPts(TRACK.sportPoints)} נק'`,
    status: req.sport.have >= TRACK.sportPoints - 1e-9 ? 'ok' : 'fail',
    detail: `${pts(req.sport.have)} / ${fmtPts(TRACK.sportPoints)}`,
    source: `${REGS} – 1.1.8`, go: 'plan',
  })

  // ---------- שרשראות ----------
  const gs = groupsSummary(state)
  const alloc = chainAllocation(state)
  const completed = mode === 'plan' ? gs.completedPlan : gs.completedDone
  const selLines = state.selectedGroups.map((s) => {
    const g = GROUPS.find((x) => x.id === s.id)!
    const ev = (mode === 'plan' ? alloc.plan : alloc.done).get(s.id)
    const bad = ev?.rules.filter((r) => !r.ok).map((r) => r.text) ?? []
    return `${variantLabel(g, s.double)}: ${ev?.count ?? 0}/${ev?.need ?? 0} קורסים${ev?.complete ? ' ✓' : bad.length ? ` · חסר: ${bad.join('; ')}` : ''}`
  })
  add({
    id: 'chains', group: 'chains', title: `לפחות ${TRACK.minGroups} קבוצות התמחות שלמות`,
    status: completed >= TRACK.minGroups ? 'ok' : 'fail',
    detail: state.selectedGroups.length === 0
      ? 'עוד לא נבחרו שרשראות'
      : `${completed} מתוך ${TRACK.minGroups} שלמות (קבוצה כפולה נספרת כשתיים)`,
    lines: selLines,
    source: `${CAT} – "יש להשלים לפחות שלוש קבוצות התמחות"`, go: 'chains',
  })
  const contested = [...alloc.options].filter(([, o]) => o.length > 1)
  add({
    id: 'distinct', group: 'chains', title: 'כל קורס נספר בשרשרת אחת בלבד',
    status: 'ok',
    detail: contested.length ? `${contested.length === 1 ? 'קורס משותף אחד – משויך' : `${contested.length} קורסים משותפים – כל אחד משויך`} לשרשרת אחת` : 'אין קורסים משותפים בין השרשראות שבחרת',
    lines: contested.map(([id]) => {
      const idx = state.selectedGroups.findIndex((s) => s.id === alloc.assign.get(id))
      return `${COURSES[id]?.name ?? id} → שרשרת ${idx + 1}${alloc.pinned.has(id) ? ' (ידני)' : ''}`
    }),
    source: 'קטלוג הפקולטה (תש"ף): "סה"כ 6 מקצועות שונים של שתי הקבוצות"', go: 'chains',
  })
  if (req.socialCredit.faculty > 0) {
    add({
      id: 'reserve-groups', group: 'chains', title: 'קיזוז מילואים לא מחליף קורסים בשרשראות',
      status: 'ok', detail: `${pts(req.socialCredit.faculty)} נק' נספרות כבחירה פקולטית – השרשראות נבדקות רק לפי קורסים`,
      source: 'מכתב דיקן לימודי הסמכה, 13.11.2023',
    })
  }

  // ---------- כללים ומגבלות ----------
  const g = mode === 'plan' ? gpa(state.items, state.expected, true) : gpa(state.items)
  add({
    id: 'gpa', group: 'rules', title: 'ממוצע מצטבר 65 ומעלה',
    status: g == null || g >= 65 ? 'ok' : 'fail',
    detail: g == null ? 'אין עדיין ציונים' : `ממוצע ${fmtGpa(g)}${mode === 'plan' ? ' (כולל ציונים צפויים)' : ''}`,
    source: `${REGS} – 3.2.1 "וממוצע ציוניו 65 ומעלה, זכאי לקבל את התואר"`, go: 'grades',
  })
  // ---- שני קורסים באנגלית (תקנה 1.3.3) – למי שהתחיל מתשפ"ב ----
  const sheet = sheetOf(state)
  const firstSem = sheet.records.map((r) => r.sem).sort()[0] ?? state.currentSem
  if (firstSem >= '202101') {
    const recB = sheet.records.find((r) => r.id === ENGLISH_B)
    const exemptEng = recB?.kind === 'exempt-credit' || recB?.kind === 'exempt-nocredit'
    // קורס הכשרה בלי נק"ז (למשל אנגלית למתקדמים א') לא נכנס לתרשים – נבדק גם מול הגיליון
    const took = (id: string) => items.some((i) => i.courseId === id && !(i.result?.kind === 'exempt'))
      || sheet.records.some((r) => r.id === id && (r.kind === 'grade' || r.kind === 'pass'))
    const training = exemptEng ? 0 : (took(ENGLISH_A) ? 1 : 0) + (took(ENGLISH_B) ? 1 : 0)
    const content = items
      .filter((i) => i.courseId && i.courseId !== ENGLISH_A && i.courseId !== ENGLISH_B && i.result?.kind !== 'exempt')
      .map((i) => ({ i, st: englishStatus(i.courseId, i.sem) }))
      .filter((x) => x.st)
    const yes = content.filter((x) => x.st === 'yes')
    const maybe = content.filter((x) => x.st === 'maybe')
    const have = training + yes.length
    add({
      id: 'english', group: 'rules', title: 'שני קורסים בשפה האנגלית',
      status: have >= 2 ? 'ok' : have + maybe.length >= 2 ? 'warn' : 'fail',
      detail: (exemptEng ? 'סיווג פטור – נדרשים 2 קורסי תוכן שנלמדים באנגלית' : `קורסי הכשרה: ${training}`)
        + ` · ${yes.length} קורסי תוכן באנגלית בסמסטר שבו הם בתכנון${maybe.length ? ` · ${maybe.length} שנלמדו באנגלית בסמסטרים אחרים – לוודא` : ''}`,
      lines: [
        ...yes.map((x) => `${itemName(x.i)} · ${semLabel(x.i.sem)} – באנגלית ✓`),
        ...maybe.map((x) => `${itemName(x.i)} · ${semLabel(x.i.sem)} – באנגלית רק בסמסטרים אחרים`),
        ...(have + maybe.length < 2 ? ['אפשר לסנן במאגר: "באנגלית"'] : []),
      ],
      source: 'תקנה 1.3.3 – "סטודנט שלא השלים שני קורסים באנגלית כאמור, לא יוכל לסיים את לימודי התואר"', go: 'plan',
    })
  }
  // ---- לומדה למניעת הטרדות מיניות ----
  const harass = sheet.records.some((r) => r.id === '03250000' && r.kind !== 'grade') || state.credits.some((c) => c.id === '03250000')
  add({
    id: 'harassment', group: 'rules', title: 'לומדה למניעת הטרדות מיניות',
    status: harass ? 'ok' : mode === 'plan' ? 'warn' : 'fail',
    detail: harass ? 'הושלמה (מופיעה בגיליון)' : 'לא מופיעה בגיליון – חובה לכל סטודנט מתשפ"ג',
    source: 'תקנות לימודי הסמכה – "החל משנה"ל תשפ"ג יחויב כל סטודנט בטכניון בביצוע ההדרכה במסגרת הלומדה"', go: 'sheet',
  })

  const ext = req.external
  add({
    id: 'external', group: 'rules', title: 'בחירה מפקולטות אחרות – עד 9 נק\' (ועד 2 קורסי 0048, סה"כ 3 קורסים)',
    status: ext.points > 9 + 1e-9 || ext.grad.length > 2 || ext.ids.length + ext.grad.length > 3 ? 'warn' : 'ok',
    detail: `${pts(ext.points)} נק' מפקולטות אחרות · ${ext.grad.length} קורסי 0048`
      + (ext.points > 9 ? ` · ${pts(ext.points - 9)} נק' מעבר לתקרה נספרות ככלל-טכניונית` : ''),
    lines: [...ext.ids, ...ext.grad].map((id) => `${COURSES[id]?.name ?? id} (${id})${id.startsWith('0048') ? ' – לימודי מוסמכים, דורש אישור' : ' – דורש אישור מזכירות הפקולטה'}`),
    source: CAT,
  })
  const sportBySem = new Map<string, number>()
  for (const i of items) if (itemCategory(i) === 'sport') sportBySem.set(i.sem, (sportBySem.get(i.sem) ?? 0) + itemPoints(i))
  const sportOver = [...sportBySem].filter(([, p]) => p > 1.5 + 1e-9)
  add({
    id: 'sport-sem', group: 'rules', title: 'חינוך גופני – עד 1.5 נק\' בסמסטר',
    status: sportOver.length ? 'fail' : 'ok',
    detail: sportOver.length ? sportOver.map(([s, p]) => `${semLabel(s)}: ${pts(p)} נק'`).join(' · ') : 'תקין',
    source: `${REGS} – 1.1.8 "לא יותר מנקודה וחצי לסמסטר"`, go: 'plan',
  })
  const bu = binaryUsage(state.items)
  add({
    id: 'binary', group: 'rules', title: `עובר בינארי – עד ${BINARY_MAX_COURSES} קורסים ו-${BINARY_MAX_POINTS} נק'`,
    status: withinBinaryLimit(bu.count, bu.points, state.binaryRule) ? 'ok' : 'fail',
    detail: `${nCourses(bu.count)} · ${pts(bu.points)} נק'`,
    source: 'מתווה המילואים – "לא יעלה על 10% מסך נקודות הזכות"', go: 'grades',
  })
  const social = state.credits.filter((c) => isSocialCredit(c.id)).reduce((a, c) => a + c.points, 0)
  if (social > 0) {
    add({
      id: 'reserve-cap', group: 'rules', title: 'קיזוז מילואים ופעילות חברתית – עד 10 נק\' בתואר',
      status: social <= 10 + 1e-9 ? 'ok' : 'warn',
      detail: `${pts(social)} / 10 נק'`,
      source: 'מתווה המילואים תשפ"ה – "תקרה מצטברת עד 10 נק"ז"', go: 'reqs',
    })
  }

  // ---------- תקינות התכנון ----------
  const issues = findIssues(state).filter((x) => x.kind === 'duplicate' || x.kind === 'no-credit')
  add({
    id: 'dups', group: 'plan', title: 'בלי כפילויות ובלי קורסים "ללא זיכוי נוסף"',
    status: issues.length ? 'fail' : 'ok',
    detail: issues.length ? `${issues.length} בעיות – נקודות שלא ייספרו פעמיים` : 'תקין',
    lines: issues.map((x) => x.title), source: CAT, go: 'reqs',
  })
  if (mode === 'plan') {
    const slots = state.items.filter((i) => i.slot)
    add({
      id: 'slots', group: 'plan', title: 'לכל משבצת כללית נבחר קורס',
      status: slots.length ? 'warn' : 'ok',
      detail: slots.length ? `${slots.length} משבצות כלליות נספרות כתכנון, אבל עוד צריך לבחור להן קורס ממשי` : 'כל הקורסים בתכנון ספציפיים',
      lines: slots.map((i) => `${itemName(i)} · ${fmtPts(itemPoints(i))} נק' · ${semLabel(i.sem)}`), source: 'בדיקת התכנון', go: 'plan',
    })
    const invalid = state.items.filter((i) => i.courseId && !i.result && !itemValidity(state, i).ok)
    const waived = invalid.filter((i) => i.waived)
    const blocked = invalid.filter((i) => !i.waived)
    add({
      id: 'prereq', group: 'plan', title: 'דרישות קדם מתקיימות בסדר הסמסטרים',
      status: blocked.length ? 'fail' : waived.length ? 'warn' : 'ok',
      detail: blocked.length ? `${nCourses(blocked.length)} בלי קדם` : waived.length ? `${nCourses(waived.length)} באישור חריג – לוודא שהאישור התקבל` : 'תקין',
      lines: invalid.map((i) => `${itemName(i)} · ${semLabel(i.sem)}${i.waived ? ' (אישור חריג)' : ''}`), source: 'קדמים מהקטלוג/צ\'יזפורק', go: 'plan',
    })
  }

  const fails = checks.filter((c) => c.status === 'fail').length
  const warns = checks.filter((c) => c.status === 'warn').length
  const audit: Audit = { mode, checks, closes: fails === 0, fails, warns }
  cache.set(state, { ...(cache.get(state) ?? {}), [mode]: audit })
  return audit
}
