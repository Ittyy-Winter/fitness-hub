import type { ReactNode } from 'react'
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

// Chart conventions (one system across pages): hairline horizontal grid, axis text in the
// secondary ink, 2px lines, columns at most 24px with a 4px rounded top, a dashed line only
// for a goal, and a tooltip that leads with the value. Each chart has a table view twin.

const axis = { stroke: 'var(--rule)', tickLine: false, tick: { fill: 'var(--ink-2)' } } as const
const compact = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}K` : String(v))
const yAxis = { ...axis, axisLine: false, width: 46, tickFormatter: compact } as const

// Four or five round ticks spanning the data (and the goal): steps of 1, 2 or 5 × 10^k.
export function niceTicks(values: number[]): number[] {
  if (!values.length) return [0, 1]
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  if (lo === hi) { lo -= 1; hi += 1 }
  const raw = (hi - lo) / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((x) => x >= raw)!
  const start = Math.floor(lo / step) * step
  const ticks: number[] = []
  for (let t = start; t < hi + step; t += step) ticks.push(Math.round(t * 1e6) / 1e6)
  return ticks
}

// The legend every chart carries: its series when there are several, and the goal line.
function ChartLegend({ series, goalLabel }: { series: Series[]; goalLabel?: string }) {
  const items = [
    ...(series.length > 1 ? series.map((s) => ({ name: s.name, color: s.color, line: true })) : []),
    ...(goalLabel ? [{ name: goalLabel, color: 'var(--ink-2)', line: true, dashed: true }] : []),
  ]
  return items.length ? <Legend items={items} /> : null
}

type Series = { key: string; name: string; color: string; unit: string; digits?: number }

function Tip({ active, payload, label, series, labelFormat }: {
  active?: boolean
  payload?: { dataKey?: unknown; value?: unknown }[]
  label?: unknown
  series: Series[]
  labelFormat: (v: string) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="tooltip">
      <span className="t-label">{labelFormat(String(label))}</span>
      {series.map((s) => {
        const v = payload.find((p) => p.dataKey === s.key)?.value
        if (v == null) return null
        return (
          <span className="t-row" key={s.key}>
            <span className="key-line" style={{ background: s.color }} />
            <strong>{Number(v).toFixed(s.digits ?? 0)}</strong> {s.unit}
            {series.length > 1 && <span className="muted">{s.name}</span>}
          </span>
        )
      })}
    </div>
  )
}

export function Legend({ items }: { items: { name: string; color: string; line?: boolean; dashed?: boolean }[] }) {
  return (
    <p className="legend">
      {items.map((i) => (
        <span key={i.name}>
          {i.line
            ? <span className="key-line" style={i.dashed
                ? { background: `repeating-linear-gradient(90deg, ${i.color} 0 4px, transparent 4px 7px)` }
                : { background: i.color }} />
            : <span className="key" style={{ background: i.color }} />}
          {i.name}
        </span>
      ))}
    </p>
  )
}

export function LineTrend<T extends Record<string, unknown>>({ data, x, series, xFormat, labelFormat, goal, goalLabel }: {
  data: T[]
  x: keyof T & string
  series: Series[]
  xFormat: (v: string) => string
  labelFormat: (v: string) => string
  goal?: number
  goalLabel?: string
}) {
  const values = data.flatMap((d) => series.map((s) => d[s.key])).filter((v): v is number => typeof v === 'number')
  const ticks = niceTicks(goal != null ? [...values, goal] : values)
  return (
    <>
    <ChartLegend series={series} goalLabel={goal != null ? goalLabel ?? 'Goal' : undefined} />
    <div className="chart">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 28, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--rule)" />
          <XAxis dataKey={x as string} {...axis} tickMargin={8} tickFormatter={xFormat} minTickGap={32} />
          <YAxis {...yAxis} domain={[ticks[0]!, ticks.at(-1)!]} ticks={ticks} />
          <Tooltip content={<Tip series={series} labelFormat={labelFormat} />} cursor={{ stroke: 'var(--faint)' }} />
          {goal != null && (
            <ReferenceLine y={goal} stroke="var(--ink-2)" strokeDasharray="4 3" ifOverflow="extendDomain" />
          )}
          {series.map((s) => (
            <Line key={s.key} dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false}
              activeDot={{ r: 4, stroke: 'var(--ground)', strokeWidth: 2 }} connectNulls isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
    </>
  )
}

export function Columns<T extends Record<string, unknown>>({ data, x, y, name, unit, xFormat, labelFormat, goal, goalLabel, digits }: {
  data: T[]
  x: keyof T & string
  y: keyof T & string
  name: string
  unit: string
  xFormat: (v: string) => string
  labelFormat: (v: string) => string
  goal?: number
  goalLabel?: string
  digits?: number
}) {
  const series = [{ key: y, name, color: 'var(--series-1)', unit, digits }]
  return (
    <>
    <ChartLegend series={series} goalLabel={goal != null ? goalLabel ?? 'Goal' : undefined} />
    <div className="chart">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 28, bottom: 0, left: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="var(--rule)" />
          <XAxis dataKey={x as string} {...axis} tickMargin={8} tickFormatter={xFormat} minTickGap={28} />
          <YAxis {...yAxis} allowDecimals={false} />
          <Tooltip content={<Tip series={series} labelFormat={labelFormat} />} cursor={{ fill: 'var(--rule)', opacity: 0.5 }} />
          {goal != null && (
            <ReferenceLine y={goal} stroke="var(--ink-2)" strokeDasharray="4 3" ifOverflow="extendDomain" />
          )}
          <Bar dataKey={y as string} fill="var(--series-1)" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
    </>
  )
}

/** The accessible twin of a chart, folded away by default. */
export function TableView({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <details className="table-view">
      <summary>Show as table</summary>
      <table className="data">
        <thead><tr>{head.map((h, i) => <th key={h} className={i ? 'num' : undefined}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className={j ? 'num' : undefined}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}
