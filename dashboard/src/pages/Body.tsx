import { LineTrend, TableView } from '../components/charts.tsx'
import { dayMonth, dayShort, n0, n1 } from '../format.ts'
import type { BodyData } from '../types.ts'

export function Body({ data }: { data: BodyData }) {
  const { weight, energy, goals } = data
  const last = weight.at(-1)
  // Change over roughly four weeks: the latest weigh-in against the one nearest 28 days before.
  const monthAgo = last && weight.findLast((w) => w.date <= new Date(Date.parse(last.date) - 28 * 864e5).toISOString().slice(0, 10))
  const change = last && monthAgo ? last.weight_kg - monthAgo.weight_kg : null

  // A 7-day food average needs most of the week logged, or it just measures logging gaps.
  // Today is still in progress, so its burn would drag the average down.
  const series = energy.filter((d) => d.date < data.today).map((d) => ({
    date: d.date,
    kcal_in_7d: d.kcal_in_days >= 5 ? d.kcal_in_7d : null,
    kcal_out_7d: d.kcal_out_7d,
  }))
  const loggedDays = energy.slice(-30).filter((d) => d.kcal_in != null).length

  return (
    <>
      <div className="page-head"><h1 className="page-title">Body</h1></div>

      <section className="section" aria-labelledby="weight-title">
        <div className="section-head">
          <h2 className="section-title" id="weight-title">Weight</h2>
          {last && <span className="section-note">Last weigh-in {dayMonth(last.date)}</span>}
        </div>
        {!last ? (
          <p className="empty"><strong>No weigh-ins yet.</strong>Weight comes from Google Health; log it in the app or a connected scale.</p>
        ) : (
          <>
            <div className="figures">
              <div className="figure"><span className="fig">{n1(last.weight_kg)}<span className="unit">kg</span></span><span className="label">Latest</span></div>
              <div className="figure">
                <span className="fig">{change == null ? '–' : `${change > 0 ? '+' : change < 0 ? '−' : ''}${n1(Math.abs(change))}`}<span className="unit">kg</span></span>
                <span className="label">Over 4 weeks</span>
              </div>
            </div>
            {weight.length > 1 && (
              <>
                <LineTrend data={weight} x="date" xFormat={dayMonth} labelFormat={dayShort}
                  series={[{ key: 'weight_kg', name: 'Weight', color: 'var(--series-1)', unit: 'kg', digits: 1 }]}
                  goal={goals.weight_target} goalLabel={goals.weight_target != null ? `Goal ${n1(goals.weight_target)} kg` : undefined} />
                <TableView head={['Day', 'kg']} rows={weight.map((w) => [dayShort(w.date), n1(w.weight_kg)])} />
              </>
            )}
          </>
        )}
      </section>

      <section className="section" aria-labelledby="energy-title">
        <div className="section-head">
          <h2 className="section-title" id="energy-title">Energy in and out</h2>
          <span className="section-note">7-day average</span>
        </div>
        <p className="section-note">
          Food logged on {loggedDays} of the last 30 days.
          {loggedDays < 20 && ' The intake line only appears for weeks with at least 5 days logged.'}
        </p>
        <LineTrend data={series} x="date" xFormat={dayMonth} labelFormat={dayShort}
          goal={goals.kcal_target} goalLabel={goals.kcal_target != null ? `Target ${n0(goals.kcal_target)}` : undefined}
          series={[
            { key: 'kcal_in_7d', name: 'Eaten', color: 'var(--series-1)', unit: 'kcal' },
            { key: 'kcal_out_7d', name: 'Burned', color: 'var(--series-2)', unit: 'kcal' },
          ]} />
        <TableView head={['Day', 'Eaten', 'Burned', 'Steps']}
          rows={energy.slice().reverse().map((d) => [dayShort(d.date), n0(d.kcal_in), n0(d.kcal_out), n0(d.steps)])} />
      </section>
    </>
  )
}
