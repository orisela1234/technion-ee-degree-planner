import { semLabel } from '../lib/catalog'

interface Point { sem: string; avg: number; pass: number | null; med: number | null; n: number | null }

/** גרף עמודות של הממוצע הסופי לאורך הסמסטרים (מהישן לחדש, מימין לשמאל) */
export function AvgChart({ trend }: { trend: Point[] }) {
  const pts = trend.slice(-8)
  const W = 420, H = 150, top = 18, bottom = 34
  const lo = Math.max(0, Math.min(60, Math.floor(Math.min(...pts.map((p) => p.avg)) / 10) * 10 - 10))
  const y = (v: number) => top + (H - top - bottom) * (1 - (v - lo) / (100 - lo))
  const slot = W / pts.length
  const bw = Math.min(38, slot * 0.55)
  return (
    <svg className="avg-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="ממוצע סופי לפי סמסטר">
      {[lo, (lo + 100) / 2, 100].map((g) => (
        <g key={g}>
          <line x1={0} x2={W} y1={y(g)} y2={y(g)} className="grid" />
          <text x={W - 2} y={y(g) - 3} className="axis" textAnchor="end">{Math.round(g)}</text>
        </g>
      ))}
      {pts.map((p, i) => {
        // RTL: הסמסטר הישן ביותר מימין
        const cx = W - slot * (i + 0.5)
        const yy = y(p.avg)
        return (
          <g key={p.sem}>
            <title>{`${semLabel(p.sem)}: ממוצע ${p.avg.toFixed(1)}${p.pass != null ? `, ${p.pass}% עוברים` : ''}${p.n ? `, ${p.n} נבחנים` : ''}`}</title>
            <rect x={cx - bw / 2} y={yy} width={bw} height={H - bottom - yy} rx={4} className="bar" />
            <text x={cx} y={yy - 4} textAnchor="middle" className="val">{Math.round(p.avg)}</text>
            <text x={cx} y={H - bottom + 14} textAnchor="middle" className="axis">{semLabel(p.sem).replace(' תש', ' ')}</text>
            {p.pass != null && <text x={cx} y={H - bottom + 27} textAnchor="middle" className="axis faint">{p.pass}%</text>}
          </g>
        )
      })}
    </svg>
  )
}
