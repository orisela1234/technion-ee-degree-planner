import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileText, History, Loader2, RefreshCw, ShieldCheck, Upload, UserPlus, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { useUi } from '../lib/ui'
import { askConfirm } from '../lib/confirm'
import { CATEGORY_ORDER, CATEGORY_TITLE, categoryOfCourse, fmtPts, semLabel, type Category } from '../lib/catalog'
import { itemCategory } from '../lib/requirements'
import { fmtDate, lastSheetSem, reserveCategories, sheetId, sheetOf } from '../lib/sheet'
import { isChartRecord } from '../lib/integrity'
import type { ParsedSheet } from '../lib/sheetParse'
import type { GradeSheet, SheetRecord } from '../data/student'
import type { AppState } from '../lib/types'
import { ReserveCreditsPanel } from './ReserveCredits'
import { clearNewUserRequest, confirmNewUser, isOtherStudent, newUserRequested } from '../lib/switchUser'
import { resetBackupMarks } from '../lib/persist'

type Mode = 'update' | 'fresh'

const recKey = (r: SheetRecord) => `${r.id}|${r.sem}`

export function resultText(r: SheetRecord) {
  return r.kind === 'grade' ? String(r.grade) : r.kind === 'pass' ? 'עובר' : r.kind === 'exempt-credit' ? 'פטור עם ניקוד' : 'פטור ללא ניקוד'
}

/** האם השורה נספרת בנקודות: לא נכשל, לא פטור ללא ניקוד, והניסיון האחרון בקורס */
function countedSet(records: SheetRecord[]) {
  const latest = new Map<string, SheetRecord>()
  for (const r of [...records].sort((a, b) => a.sem.localeCompare(b.sem))) latest.set(r.id, r)
  return new Set([...latest.values()]
    .filter((r) => r.kind !== 'exempt-nocredit' && !(r.kind === 'grade' && (r.grade ?? 0) < 55) && r.points > 0)
    .map(recKey))
}

/** הסיווג של שורה מהגיליון – כמו שהמערכת סופרת אותה (כולל שינויי סיווג שעשית) */
function recordCategory(r: SheetRecord, sheet: GradeSheet, state?: AppState): Category {
  if (state) {
    const item = state.items.find((i) => i.courseId === r.id && i.sem === r.sem)
    if (item) return itemCategory(item)
    const credit = state.credits.find((c) => c.id === r.id)
    if (credit?.category) return credit.category
  }
  // פעילות חברתית ומילואים – קודם קיזוז המל"ג, היתר כלל-טכניונית חופשית
  return r.id.startsWith('0320') ? reserveCategories(sheet.records).get(r.id) ?? 'free' : categoryOfCourse(r.id)
}

function sumsByCategory(sheet: GradeSheet, state?: AppState) {
  const counted = countedSet(sheet.records)
  const sums = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])) as Record<Category, number>
  for (const r of sheet.records) if (counted.has(recKey(r))) sums[recordCategory(r, sheet, state)] += r.points
  const total = Object.values(sums).reduce((a, b) => a + b, 0)
  return { sums, total: Math.round(total * 10) / 10, counted }
}

function diffSheets(cur: GradeSheet, next: GradeSheet) {
  const curMap = new Map(cur.records.map((r) => [recKey(r), r]))
  const nextKeys = new Set(next.records.map(recKey))
  const added = next.records.filter((r) => !curMap.has(recKey(r)))
  const removed = cur.records.filter((r) => !nextKeys.has(recKey(r)))
  const changed = next.records
    .map((r) => ({ r, was: curMap.get(recKey(r)) }))
    .filter((x): x is { r: SheetRecord; was: SheetRecord } => !!x.was && (x.was.kind !== x.r.kind || x.was.grade !== x.r.grade || x.was.points !== x.r.points))
  return { added, removed, changed }
}

export function SheetView({ onboarding }: { onboarding?: boolean } = {}) {
  const { state, dispatch } = useStore()
  const ui = useUi()
  const current = sheetOf(state)
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedSheet | null>(null)
  const [over, setOver] = useState(false)
  // עדכון התכנון הקיים, או משתמש אחר – תכנון חדש מאפס
  const [mode, setMode] = useState<Mode>(() => (newUserRequested() ? 'fresh' : 'update'))
  const zoneRef = useRef<HTMLElement>(null)

  useEffect(() => {
    clearNewUserRequest()
    const on = () => { clearNewUserRequest(); setMode('fresh'); setParsed(null); zoneRef.current?.scrollIntoView({ block: 'center' }) }
    window.addEventListener('degree:newuser', on)
    return () => window.removeEventListener('degree:newuser', on)
  }, [])

  const cur = useMemo(() => sumsByCategory(current, state), [current, state])
  const history = (state.sheetHistory ?? []).filter((h) => h.records.length > 0)

  const readFile = async (file?: File) => {
    if (!file) return
    setError(null)
    setParsed(null)
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      setError('צריך קובץ PDF – "תעודת ציונים" כפי שמורידים מהטכניון.')
      return
    }
    setBusy(true)
    try {
      const { readSheetPdf } = await import('../lib/sheetPdf')
      const res = await readSheetPdf(file)
      if (!res.sheet.records.length) setError(res.warnings[0] ?? 'לא הצלחתי לקרוא קורסים מהקובץ.')
      else {
        setParsed(res)
        if (!onboarding && isOtherStudent(current, res.sheet)) setMode('fresh')
      }
    } catch {
      setError('לא הצלחתי לקרוא את הקובץ. ודאו שזה ה-PDF המקורי של תעודת הציונים (לא צילום מסך).')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const startFresh = async (sheet: GradeSheet) => {
    if (!(await confirmNewUser(state, sheet))) return
    resetBackupMarks()
    dispatch({ type: 'newUser', sheet })
    setParsed(null)
    setMode('update')
    ui.toast(`נבנה תכנון חדש לפי הגיליון של ${sheet.student || 'המשתמש החדש'}`, 'ok',
      ['התכנון הקודם נמחק – אפשר לבטל מיד, או לטעון את הגיבוי שלו'], { label: 'בטל', run: () => dispatch({ type: 'undo' }) })
  }

  const apply = async (sheet: GradeSheet, check?: ParsedSheet) => {
    const warn: string[] = []
    if (sheet.issued < current.issued) warn.push(`הגיליון הזה (${fmtDate(sheet.issued)}) ישן יותר מהגיליון הנוכחי (${fmtDate(current.issued)}).`)
    if (check && Math.abs(check.computedPoints - sheet.accumulated) > 0.05) {
      warn.push(`סכום השורות שנקראו (${fmtPts(check.computedPoints)}) לא תואם ל-${fmtPts(sheet.accumulated)} נק' שבכותרת הגיליון.`)
    }
    if (warn.length && !(await askConfirm({ title: 'לעדכן בכל זאת?', lines: warn, confirmLabel: 'עדכן בכל זאת', tone: 'danger' }))) return
    dispatch({ type: 'applySheet', sheet })
    setParsed(null)
    ui.toast(`התכנון עודכן לפי גיליון הציונים מ-${fmtDate(sheet.issued)}`, 'info',
      ['ציונים וקורסים שבוצעו נלקחו מהגיליון; התכנון שלך נשמר'], { label: 'בטל', run: () => dispatch({ type: 'undo' }) })
  }

  return (
    <div className="sheet-view">
      {/* ---------- העלאה ---------- */}
      <section className="panel" ref={zoneRef}>
        <div className="panel-head">
          <h3><Upload size={16} aria-hidden /> {onboarding ? 'העלאת תעודת הציונים שלך' : mode === 'fresh' ? 'העלאת תעודת ציונים של משתמש אחר' : 'העלאת גיליון ציונים מעודכן'}</h3>
          <span className="muted small"><ShieldCheck size={13} aria-hidden /> הקובץ נקרא רק במחשב שלך ולא נשלח לשום מקום. מספר תעודת הזהות לא נשמר.</span>
        </div>
        {!onboarding && (
          <div className="sheet-mode">
            <div className="seg" role="radiogroup" aria-label="מה לעשות עם הגיליון">
              <button role="radio" aria-checked={mode === 'update'} className={mode === 'update' ? 'on' : ''} onClick={() => setMode('update')}>
                <RefreshCw size={14} aria-hidden /> עדכון התכנון שלי
              </button>
              <button role="radio" aria-checked={mode === 'fresh'} className={mode === 'fresh' ? 'on' : ''} onClick={() => setMode('fresh')}>
                <UserPlus size={14} aria-hidden /> משתמש אחר – תכנון חדש
              </button>
            </div>
            <span className="muted small">
              {mode === 'update'
                ? 'הציונים והקורסים שבוצעו יילקחו מהגיליון, והתכנון שלך נשמר.'
                : 'התכנון הנוכחי יימחק (אחרי הצעה לגבות אותו), וייבנה תכנון חדש מאפס לפי הגיליון שתעלו.'}
            </span>
          </div>
        )}
        <button
          type="button"
          className={`dropzone ${over ? 'over' : ''} ${busy ? 'busy' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); readFile(e.dataTransfer.files[0]) }}
          disabled={busy}
        >
          {busy ? <Loader2 size={26} className="spin" aria-hidden /> : <FileText size={26} aria-hidden />}
          <b>{busy ? 'קורא את הגיליון…' : 'גררו לכאן את קובץ ה-PDF של תעודת הציונים, או לחצו לבחירה'}</b>
          <span className="muted small">הקובץ שמורידים מהטכניון (כמו "תדפיס"). לפני העדכון תראו בדיוק מה השתנה.</span>
        </button>
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => readFile(e.target.files?.[0])} />
        {error && <div className="sheet-error"><AlertTriangle size={15} aria-hidden /> {error}</div>}
      </section>

      {/* ---------- תצוגה מקדימה לפני עדכון ---------- */}
      {parsed && (
        <SheetPreview
          parsed={parsed} current={current} onboarding={onboarding} mode={mode}
          onApply={() => (!onboarding && mode === 'fresh' ? startFresh(parsed.sheet) : apply(parsed.sheet, parsed))}
          onCancel={() => setParsed(null)}
        />
      )}

      {!onboarding && <>

      {/* ---------- הגיליון הפעיל ---------- */}
      <section className="panel">
        <div className="panel-head">
          <h3><FileText size={16} aria-hidden /> הגיליון שלפיו המערכת עובדת עכשיו</h3>
          <span className="muted small">
            הופק {fmtDate(current.issued)} · {state.sheet ? <>הועלה מהקובץ <bdi>{current.file}</bdi></> : 'הגיליון המובנה במערכת'}
            {current.loadedAt ? ` · ${fmtDate(current.loadedAt.slice(0, 10))}` : ''}
          </span>
        </div>
        <div className="gh-kpis sheet-kpis">
          <div className="gk primary"><span>נק"ז שנצברו</span><b>{fmtPts(current.accumulated)}</b><small>מתוך {fmtPts(current.required)}</small></div>
          <div className="gk"><span>ממוצע</span><b>{current.gpa.toFixed(1)}</b><small>לפי הגיליון</small></div>
          <div className="gk"><span>שורות בגיליון</span><b>{current.records.length}</b><small>עד {semLabel(lastSheetSem(current))}</small></div>
        </div>
        <div className={`sheet-check ${Math.abs(cur.total - current.accumulated) < 0.05 ? 'ok' : 'bad'}`}>
          {Math.abs(cur.total - current.accumulated) < 0.05
            ? <><CheckCircle2 size={15} aria-hidden /> כל {fmtPts(cur.total)} הנקודות שבגיליון נספרות במערכת – תואם בדיוק לכותרת הגיליון.</>
            : <><AlertTriangle size={15} aria-hidden /> סכום השורות {fmtPts(cur.total)} לעומת {fmtPts(current.accumulated)} בכותרת.</>}
        </div>
        <div className="cat-sums" aria-label="איך נספרות הנקודות מהגיליון">
          <span className="muted small">איך נספרות הנקודות מהגיליון:</span>
          {CATEGORY_ORDER.map((c) => (
            <span key={c} className={`lg-cat cat-${c} ${cur.sums[c] ? '' : 'zero'}`}>
              <i aria-hidden /><b>{CATEGORY_TITLE[c]}</b><small>{fmtPts(cur.sums[c])}</small>
            </span>
          ))}
        </div>
        <SheetTable sheet={current} state={state} counted={cur.counted} />
      </section>

      <ReserveCreditsPanel />

      {/* ---------- גיליונות קודמים ---------- */}
      {history.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h3><History size={16} aria-hidden /> גיליונות קודמים</h3></div>
          <ul className="sheet-history">
            {history.map((h) => (
              <li key={sheetId(h)}>
                <span><b>{fmtDate(h.issued)}</b> · {fmtPts(h.accumulated)} נק"ז · ממוצע {h.gpa.toFixed(1)} · {h.records.length} שורות{h.file ? <> · <bdi>{h.file}</bdi></> : ''}</span>
                <button
                  className="btn ghost"
                  onClick={async () => {
                    if (await askConfirm({ title: `לחזור לגיליון מ-${fmtDate(h.issued)}?`, lines: ['הציונים והקורסים שבוצעו יילקחו מהגיליון הזה; התכנון שלך נשמר.'], confirmLabel: 'חזור לגיליון הזה' })) apply(h)
                  }}
                >חזור לגיליון הזה</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      </>}
    </div>
  )
}

function SheetPreview({ parsed, current, onApply, onCancel, onboarding, mode }: { parsed: ParsedSheet; current: GradeSheet; onApply: () => void; onCancel: () => void; onboarding?: boolean; mode: Mode }) {
  const next = parsed.sheet
  // תכנון חדש (מסך הפתיחה או משתמש אחר) – אין טעם להשוות לגיליון הקודם
  const fresh = onboarding || mode === 'fresh'
  const other = !onboarding && isOtherStudent(current, next)
  const d = useMemo(() => diffSheets(current, next), [current, next])
  const sums = useMemo(() => sumsByCategory(next), [next])
  const pointsOk = Math.abs(parsed.computedPoints - next.accumulated) < 0.05
  const same = !d.added.length && !d.removed.length && !d.changed.length
  const delta = (a: number, b: number) => `${b - a >= 0 ? '+' : ''}${(b - a).toFixed(1)}`
  return (
    <section className="panel sheet-preview" aria-label="תצוגה מקדימה של הגיליון החדש">
      <div className="panel-head">
        <h3>גיליון חדש מ-{fmtDate(next.issued)} <span className="muted small">· <bdi>{next.file}</bdi></span></h3>
        <button className="icon-btn" aria-label="ביטול" onClick={onCancel}><X size={16} /></button>
      </div>
      <div className="gh-kpis sheet-kpis">
        <div className="gk primary"><span>נק"ז שנצברו</span><b>{fmtPts(next.accumulated)}</b><small>{fresh ? `מתוך ${fmtPts(next.required)}` : `${delta(current.accumulated, next.accumulated)} מהגיליון הנוכחי`}</small></div>
        <div className="gk"><span>ממוצע</span><b>{next.gpa.toFixed(1)}</b><small>{fresh ? 'לפי הגיליון' : delta(current.gpa, next.gpa)}</small></div>
        <div className="gk"><span>שורות בגיליון</span><b>{next.records.length}</b><small>עד {semLabel(lastSheetSem(next))}</small></div>
      </div>
      <div className={`sheet-check ${pointsOk ? 'ok' : 'bad'}`}>
        {pointsOk
          ? <><CheckCircle2 size={15} aria-hidden /> נקראו {next.records.length} שורות, וסכום הנקודות ({fmtPts(parsed.computedPoints)}) תואם בדיוק לכותרת הגיליון.</>
          : <><AlertTriangle size={15} aria-hidden /> סכום השורות שנקראו ({fmtPts(parsed.computedPoints)}) לא תואם ל-{fmtPts(next.accumulated)} שבכותרת – כדאי לבדוק את הטבלה.</>}
      </div>
      {parsed.warnings.map((w) => <div key={w} className="sheet-error"><AlertTriangle size={15} aria-hidden /> {w}</div>)}

      {other && (
        <div className={`sheet-other ${mode === 'fresh' ? '' : 'warn'}`}>
          <UserPlus size={15} aria-hidden />
          <span>
            הגיליון הזה של <b>{next.student}</b>, והתכנון הנוכחי של <b>{current.student}</b>.{' '}
            {mode === 'fresh' ? 'לכן הוא ייטען כתכנון חדש למשתמש אחר.' : 'במצב "עדכון" התכנון הנוכחי יעודכן לפי גיליון של סטודנט אחר – כנראה עדיף "משתמש אחר".'}
          </span>
        </div>
      )}
      {fresh && !/הנדסת חשמל/.test(next.program) && (
        <div className="sheet-error"><AlertTriangle size={15} aria-hidden /> התכנית בגיליון: "{next.program || 'לא זוהתה'}". המערכת בנויה למסלול הנדסת חשמל (004004-1-000) – בתכנית אחרת הדרישות עשויות להיות שונות.</div>
      )}
      {fresh ? null : same ? <p className="muted">זהה לגיליון הנוכחי – אין מה לעדכן.</p> : (
        <div className="sheet-diff">
          {d.added.length > 0 && (
            <div><h4 className="ok">נוספו לגיליון ({d.added.length})</h4>
              <ul>{d.added.map((r) => <li key={recKey(r)}><span className="mono">{r.id}</span> {r.name} · {semLabel(r.sem)} · <b>{resultText(r)}</b> · {fmtPts(r.points)} נק'</li>)}</ul></div>
          )}
          {d.changed.length > 0 && (
            <div><h4 className="warn">השתנו ({d.changed.length})</h4>
              <ul>{d.changed.map(({ r, was }) => <li key={recKey(r)}><span className="mono">{r.id}</span> {r.name}: {resultText(was)} ← <b>{resultText(r)}</b></li>)}</ul></div>
          )}
          {d.removed.length > 0 && (
            <div><h4 className="bad">לא מופיעים בגיליון החדש ({d.removed.length})</h4>
              <ul>{d.removed.map((r) => <li key={recKey(r)}><span className="mono">{r.id}</span> {r.name} · {semLabel(r.sem)}</li>)}</ul></div>
          )}
        </div>
      )}
      <div className="cat-sums">
        <span className="muted small">בגיליון החדש:</span>
        {CATEGORY_ORDER.map((c) => (
          <span key={c} className={`lg-cat cat-${c} ${sums.sums[c] ? '' : 'zero'}`}><i aria-hidden /><b>{CATEGORY_TITLE[c]}</b><small>{fmtPts(sums.sums[c])}</small></span>
        ))}
      </div>
      <details className="sheet-details">
        <summary>כל השורות שנקראו מהקובץ</summary>
        <SheetTable sheet={next} counted={sums.counted} />
      </details>
      {!onboarding && mode === 'fresh' && <p className="muted small">
        מה יקרה: התכנון הנוכחי נמחק, ונבנה תכנון חדש לפי הגיליון הזה – קורסי החובה שנשארו משובצים לפי הקטלוג, והשרשראות נבחרות מחדש.
        לפני כן תוצע הורדת גיבוי, ואפשר גם לבטל מיד.
      </p>}
      {!onboarding && mode === 'update' && <p className="muted small">
        מה יקרה: הקורסים שבוצעו והציונים יילקחו מהגיליון. קורסי החובה והבחירה שתכננת, המשבצות, השרשראות, ההערות ועובר בינארי – נשמרים.
        אפשר לבטל מיד, או לחזור לגיליון הקודם מהרשימה למטה.
      </p>}
      <div className="sheet-actions">
        <button className="btn" onClick={onApply} disabled={!fresh && same}>
          {onboarding ? 'בנה את התכנון שלי' : mode === 'fresh' ? 'התחל תכנון חדש לפי הגיליון הזה' : 'עדכן את התכנון לפי הגיליון הזה'}
        </button>
        <button className="btn ghost" onClick={onCancel}>ביטול</button>
      </div>
    </section>
  )
}

function SheetTable({ sheet, state, counted }: { sheet: GradeSheet; state?: AppState; counted: Set<string> }) {
  const bySem = useMemo(() => {
    const m = new Map<string, SheetRecord[]>()
    for (const r of [...sheet.records].sort((a, b) => a.sem.localeCompare(b.sem) || a.id.localeCompare(b.id))) {
      if (!m.has(r.sem)) m.set(r.sem, [])
      m.get(r.sem)!.push(r)
    }
    return [...m.entries()]
  }, [sheet])
  return (
    <table className="grade-table sheet-table">
      <thead>
        <tr><th>מספר</th><th>מקצוע</th><th>נק"ז</th><th>ציון</th><th>נספר כ-</th><th>במערכת</th></tr>
      </thead>
      {bySem.map(([sem, recs]) => (
        <tbody key={sem}>
          <tr className="sem-sep"><td colSpan={6}>{semLabel(sem)}</td></tr>
          {recs.map((r) => {
            const cat = recordCategory(r, sheet, state)
            const isCounted = counted.has(recKey(r))
            const failed = r.kind === 'grade' && (r.grade ?? 0) < 55
            return (
              <tr key={recKey(r)} className={failed ? 'failed' : ''}>
                <td className="mono">{r.id}</td>
                <td className="name">{r.name}</td>
                <td className={isCounted ? '' : 'not-counted'} title={isCounted ? undefined : failed ? 'נכשל – לא נספר' : 'לא מקנה נקודות'}>{fmtPts(r.points)}</td>
                <td>{resultText(r)}</td>
                <td>{isCounted ? <span className={`cat-chip cat-${cat}`}>{CATEGORY_TITLE[cat]}</span> : <span className="muted small">לא נספר</span>}</td>
                <td className="muted small">{isChartRecord(r) ? 'בתרשים' : 'פטורים וזיכויים'}</td>
              </tr>
            )
          })}
        </tbody>
      ))}
    </table>
  )
}
