import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronLeft, GraduationCap, XCircle } from 'lucide-react'
import { useStore } from '../lib/store'
import { degreeAudit, GROUP_TITLE, type AuditCheck, type CheckGroup } from '../lib/audit'

/** מעבר ללשונית אחרת מכל מקום באפליקציה */
export const goTab = (tab: string) => window.dispatchEvent(new CustomEvent('degree:tab', { detail: tab }))

const ICON = { ok: CheckCircle2, fail: XCircle, warn: AlertTriangle }
const GO_LABEL: Record<string, string> = { plan: 'לתרשים', chains: 'לשרשראות', grades: 'לציונים', sheet: 'לגיליון', reqs: 'לדרישות' }

/** תג קטן של מצב סגירת התואר – בתרשים ובפס העליון; לחיצה פותחת את הבדיקה המלאה */
export function DegreeStatusBadge({ compact }: { compact?: boolean }) {
  const { state } = useStore()
  const a = degreeAudit(state, 'plan')
  const Icon = a.closes ? GraduationCap : XCircle
  return (
    <button
      className={`degree-badge ${a.closes ? 'ok' : 'bad'} ${compact ? 'compact' : ''}`}
      onClick={() => goTab('audit')}
      title={a.closes ? 'כל תנאי סגירת התואר מתקיימים לפי התכנון – לחיצה לפירוט' : `${a.fails} תנאים לא מתקיימים – לחיצה לפירוט`}
    >
      <Icon size={compact ? 13 : 15} aria-hidden />
      {a.closes ? 'התכנון סוגר את התואר' : `התואר לא נסגר · ${a.fails} ${a.fails === 1 ? 'תנאי חסר' : 'תנאים חסרים'}`}
      {a.closes && a.warns > 0 && <small> · {a.warns} לבדיקה</small>}
    </button>
  )
}

export function AuditView() {
  const { state } = useStore()
  const [mode, setMode] = useState<'plan' | 'done'>('plan')
  const a = degreeAudit(state, mode)
  const groups: CheckGroup[] = ['points', 'chains', 'rules', 'plan']

  return (
    <div className="audit">
      <section className={`audit-hero ${a.closes ? 'ok' : 'bad'}`}>
        <div className="ah-icon">{a.closes ? <GraduationCap size={34} aria-hidden /> : <XCircle size={34} aria-hidden />}</div>
        <div className="ah-text">
          <h2>
            {mode === 'plan'
              ? a.closes ? 'התכנון סוגר את התואר' : 'התכנון עוד לא סוגר את התואר'
              : a.closes ? 'סיימת את כל דרישות התואר' : 'התואר עוד לא הושלם'}
          </h2>
          <p>
            {a.closes
              ? `כל ${a.checks.length - a.warns} התנאים מתקיימים${a.warns ? ` · ${a.warns} פריטים לבדיקה` : ''}`
              : `${a.fails} ${a.fails === 1 ? 'תנאי לא מתקיים' : 'תנאים לא מתקיימים'}${a.warns ? ` · ${a.warns} לבדיקה` : ''}`}
            {mode === 'plan' ? ' – בהנחה שכל הקורסים בתכנון יעברו בהצלחה.' : ' – לפי הקורסים שכבר הושלמו.'}
          </p>
        </div>
        <div className="seg" role="tablist" aria-label="מצב הבדיקה">
          <button className={mode === 'plan' ? 'on' : ''} onClick={() => setMode('plan')}>לפי התכנון</button>
          <button className={mode === 'done' ? 'on' : ''} onClick={() => setMode('done')}>לפי מה שהושלם</button>
        </div>
      </section>

      {groups.map((grp) => {
        const list = a.checks.filter((c) => c.group === grp)
        if (!list.length) return null
        return (
          <section key={grp} className="panel audit-group">
            <div className="panel-head"><h3>{GROUP_TITLE[grp]}</h3>
              <span className="muted small">{list.filter((c) => c.status === 'ok').length}/{list.length} תקינים</span>
            </div>
            {list.map((c) => <CheckRow key={c.id} c={c} />)}
          </section>
        )
      })}

      <p className="muted small audit-foot">
        התנאים לפי קטלוג הלימודים תשפ"ו (המסלול בהנדסת חשמל), תקנות לימודי הסמכה ומתווה המילואים. ההחלטה הסופית על זכאות לתואר – של מזכירות לימודי הסמכה בפקולטה.
      </p>
    </div>
  )
}

function CheckRow({ c }: { c: AuditCheck }) {
  const Icon = ICON[c.status]
  return (
    <div className={`audit-row st-${c.status}`}>
      <Icon size={18} className="ar-icon" aria-hidden />
      <div className="ar-main">
        <div className="ar-title">{c.title}</div>
        <div className="ar-detail">{c.detail}</div>
        {!!c.lines?.length && (
          <ul className="ar-lines">{c.lines.map((l) => <li key={l}>{l}</li>)}</ul>
        )}
        <div className="ar-source">מקור: {c.source}</div>
      </div>
      {c.go && c.status !== 'ok' && (
        <button className="btn ghost ar-go" onClick={() => goTab(c.go!)}>{GO_LABEL[c.go]} <ChevronLeft size={14} aria-hidden /></button>
      )}
    </div>
  )
}
