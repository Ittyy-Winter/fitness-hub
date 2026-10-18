import { useState } from 'react'
import { AnalysisView } from '../components/AnalysisView.tsx'
import { Columns, Legend, LineTrend, TableView } from '../components/charts.tsx'
import { dayLong, dayMonth, dayShort, duration, km, n0, n1, pace } from '../format.ts'
import type { HrZones, RunningData } from '../types.ts'

// Google Health's four heart-rate zones, light to peak, on one violet ramp.
const ZONES = [
  { key: 'light', name: 'Light', color: 'var(--zone-1)' },
  { key: 'moderate', name: 'Moderate', color: 'var(--zone-2)' },
  { key: 'vigorous', name: 'Vigorous', color: 'var(--zone-3)' },
  { key: 'peak', name: 'Peak', color: 'var(--zone-4)' },
] as const

function Zones({ zones }: { zones: HrZones }) {
  const total = ZONES.reduce((a, z) => a + (zones[z.key] ?? 0), 0)
  if (!total) return null
  return (
    <div className="section" style={{ gap: 8 }}>
      <div className="zones" role="img" aria-label={ZONES.map((z) => `${z.name} ${zones[z.key] ?? 0} min`).join(', ')}>
        {ZONES.map((z) => (zones[z.key] ?? 0) > 0 && (
          <span key={z.key} title={`${z.name}: ${zones[z.key]} min`} style={{ flex: zones[z.key], background: z.color }} />
        ))}
      </div>
      <Legend items={ZONES.map((z) => ({ name: `${z.name} ${zones[z.key] ?? 0} min`, color: z.color }))} />
    </div>
  )
}

function twelveWeeks(data: RunningData) {
  const monday = (() => {
    const d = new Date(data.today + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
    return d
  })()
  const out: { week: string; km: number; runs: number }[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(monday)
    d.setUTCDate(d.getUTCDate() - 7 * i)
    const week = d.toISOString().slice(0, 10)
    out.push(data.weeks.find((w) => w.week === week) ?? { week, km: 0, runs: 0 })
  }
  return out
}

export function Running({ data }: { data: RunningData }) {
  const [all, setAll] = useState(false)
  const run = data.latest
  const weeks = twelveWeeks(data)
  return (
    <>
      <div className="page-head"><h1 className="page-title">Running</h1></div>

      <section className="section" aria-labelledby="run-title">
        <div className="section-head">
          <h2 className="section-title" id="run-title">Latest run</h2>
          {run && <span className="section-note">{dayLong(run.date)}</span>}
        </div>
        {!run ? (
          <p className="empty"><strong>No runs yet.</strong>Record a run on the watch; it arrives with the next Google Health sync.</p>
        ) : (
          <>
            <div className="figures">
              <div className="figure"><span className="fig">{km(run.distance_m)}<span className="unit">km</span></span><span className="label">Distance</span></div>
              <div className="figure"><span className="fig">{pace(run.avg_pace_s_per_km)}<span className="unit">/km</span></span><span className="label">Pace</span></div>
              <div className="figure"><span className="fig">{duration(run.duration_s)}</span><span className="label">Time</span></div>
            </div>
            {run.hr_zone_min && <Zones zones={run.hr_zone_min} />}
            <p className="section-note">
              Average HR {n0(run.avg_hr)} bpm · max {n0(run.max_hr)} bpm · climb {n0(run.elevation_m)} m
            </p>
            {run.hr.length > 1 && (
              <>
                <LineTrend data={run.hr} x="min" xFormat={(m) => `${Math.round(Number(m))}′`}
                  labelFormat={(m) => `${n1(Number(m))} min in`}
                  series={[{ key: 'bpm', name: 'Heart rate', color: 'var(--series-1)', unit: 'bpm' }]} />
                <TableView head={['Minute', 'bpm']} rows={run.hr.map((p) => [n1(p.min), p.bpm])} />
              </>
            )}
          </>
        )}
      </section>

      {data.analysis && (
        <section className="section" aria-labelledby="r-analysis">
          <AnalysisView analysis={data.analysis} headingId="r-analysis" byline={`Claude on the ${dayShort(data.analysis.date)} run`} />
        </section>
      )}

      <section className="section" aria-labelledby="km-title">
        <h2 className="section-title" id="km-title">Distance per week</h2>
        <Columns data={weeks} x="week" y="km" name="Distance" unit="km" digits={1}
          xFormat={dayMonth} labelFormat={(w) => `Week of ${dayMonth(w)}`}
          goal={data.goals.weekly_run_km_target} goalLabel={data.goals.weekly_run_km_target != null ? `Goal ${data.goals.weekly_run_km_target} km` : undefined} />
        <TableView head={['Week of', 'km', 'Runs']} rows={weeks.map((w) => [dayMonth(w.week), n1(w.km), w.runs])} />
      </section>

      <section className="section" aria-labelledby="vo2-title">
        <div className="section-head">
          <h2 className="section-title" id="vo2-title">VO2 max</h2>
          {data.vo2max.length > 0 && <span className="section-note mono">{n1(data.vo2max.at(-1)!.vo2max)} now</span>}
        </div>
        {data.vo2max.length < 2 ? (
          <p className="section-note">Not enough readings yet. The watch estimates it after outdoor runs.</p>
        ) : (
          <>
            <LineTrend data={data.vo2max} x="date" xFormat={dayMonth} labelFormat={dayShort}
              series={[{ key: 'vo2max', name: 'VO2 max', color: 'var(--series-1)', unit: 'ml/kg/min', digits: 1 }]} />
            <TableView head={['Day', 'VO2 max']} rows={data.vo2max.map((v) => [dayShort(v.date), n1(v.vo2max)])} />
          </>
        )}
      </section>

      {data.runs.length > 1 && (
        <section className="section" aria-labelledby="runs-title">
          <h2 className="section-title" id="runs-title">Earlier runs</h2>
          <ul className="rows">
            {data.runs.slice(1, all ? undefined : 7).map((r) => (
              <li key={r.id} className="row">
                <span className="row-title">{km(r.distance_m)} km</span>
                <span className="row-fig">{pace(r.avg_pace_s_per_km)} /km</span>
                <span className="row-sub">{dayShort(r.date)} · {duration(r.duration_s)}{r.avg_hr ? ` · ${r.avg_hr} bpm` : ''}</span>
              </li>
            ))}
          </ul>
          {!all && data.runs.length > 8 && (
            <button className="text-button" onClick={() => setAll(true)}>Show all {data.runs.length - 1} runs</button>
          )}
        </section>
      )}
    </>
  )
}
