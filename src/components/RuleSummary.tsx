import { COURSES } from '../lib/catalog'
import { chainRules, freeSlots } from '../lib/chains'
import type { SpecGroup } from '../data/track'

/** "מה חובה" בשרשרת – בשמות ומספרי קורס, כולל כמה קורסים בסך הכל */
export function RuleSummary({ g, double, compact }: { g: SpecGroup; double: boolean; compact?: boolean }) {
  const rules = chainRules(g, double)
  const free = freeSlots(g, double)
  const count = double && g.double ? g.double.count : g.single.count
  const name = (id: string) => COURSES[id]?.name ?? 'קורס שלא נפתח לאחרונה'
  return (
    <div className={`rule-sum ${compact ? 'compact' : ''}`}>
      {rules.map((r, k) => (
        <div key={k} className="rs-line">
          <span className="role must">חובה</span>
          {r.kind !== 'all' && <b className="rs-kind">{r.kind === 'oneOf' ? 'אחד מ:' : `${r.n} מתוך:`}</b>}
          <span className="rs-courses">
            {r.ids.map((id, i) => (
              <span key={id} className="rs-c">
                {i > 0 && <span className="rs-sep">{r.kind === 'all' ? '+' : '/'}</span>}
                {name(id)} <span className="mono">{id}</span>
              </span>
            ))}
          </span>
        </div>
      ))}
      <div className="rs-line rs-total">
        + {free} קורסים נוספים מרשימת השרשרת · <b>סה"כ {count} קורסים</b>{double ? ' · נספרת כשתי קבוצות' : ''}
      </div>
    </div>
  )
}
