import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { AnalysisView } from '../components/AnalysisView.tsx'
import { Columns, Legend, TableView } from '../components/charts.tsx'
import { dayLong, dayMonth, dayShort, n0 } from '../format.ts'
import type { GymSet, TrainingData } from '../types.ts'

const GYM_URL = import.meta.env.VITE_GYM_URL || 'https://gym.ittyy.dev'

// Working sets per exercise, in the order they were done, with the heaviest set.
function exercises(sets: GymSet[]) {
  const out = new Map<string, { sets: number; top: GymSet | null; muscle: string | null }>()
  for (const s of sets) {
    if (s.is_warmup) continue
    const e = out.get(s.exercise) ?? { sets: 0, top: null, muscle: s.muscle }
    e.sets += 1
    if (s.weight_kg != null && (!e.top || s.weight_kg > (e.top.weight_kg ?? 0)
      || (s.weight_kg === e.top.weight_kg && (s.reps ?? 0) > (e.top.reps ?? 0)))) e.top = s
    out.set(s.exercise, e)
  }
  return [...out]
}

// 12 Mondays ending with this week's, so weeks without a session show as zero.
function twelveWeeks(data: TrainingData) {
  const weeks: { week: string; sessions: number; volume_kg: number }[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(data.week_start + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() - 7 * i)
    const week = d.toISOString().slice(0, 10)
    weeks.push(data.weeks.find((w) => w.week === week) ?? { week, sessions: 0, volume_kg: 0 })
  }
  return weeks
}

export function Training({ data }: { data: TrainingData }) {
  const [all, setAll] = useState(false)
  const latest = data.latest
  const weeks = twelveWeeks(data)
  const maxSets = Math.max(1, ...data.muscles.map((m) => Math.max(m.sets_this_week, m.sets_avg_4w)))
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Training</h1>
        <a className="pill-link" href={GYM_URL} target="_blank" rel="noreferrer">
          Open openGym <ExternalLink size={14} aria-hidden />
        </a>
      </div>

      <section className="section" aria-labelledby="latest-title">
        <div className="section-head">
          <h2 className="section-title" id="latest-title">{latest ? latest.routine ?? 'Workout' : 'Latest workout'}</h2>
          {latest && <span className="section-note">{dayLong(latest.date)}</span>}
        </div>
        {!latest ? (
          <p className="empty"><strong>No workouts yet.</strong>Log a session in openGym; it shows up here after the next sync.</p>
        ) : (
          <>
            <div className="figures">
              <div className="figure"><span className="fig">{latest.duration_s ? Math.round(latest.duration_s / 60) : '–'}<span className="unit">min</span></span><span className="label">Duration</span></div>
              <div className="figure"><span className="fig">{n0(latest.total_volume_kg)}<span className="unit">kg</span></span><span className="label">Volume</span></div>
              <div className="figure"><span className="fig">{latest.prs?.length ?? 0}</span><span className="label">Personal records</span></div>
            </div>
            <table className="data">
              <thead><tr><th>Exercise</th><th className="num">Sets</th><th className="num">Top set</th></tr></thead>
              <tbody>
                {exercises(latest.sets).map(([name, e]) => (
                  <tr key={name}>
                    <td>
                      {name}
                      {latest.prs?.some((p) => p.name === name) && <span className="kind"> · PR</span>}
                    </td>
                    <td className="num">{e.sets}</td>
                    <td className="num">{e.top ? `${e.top.weight_kg} kg × ${e.top.reps ?? '–'}` : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      {data.analysis && (
        <section className="section" aria-labelledby="w-analysis">
          <AnalysisView analysis={data.analysis} headingId="w-analysis" byline={`Claude on the ${dayShort(data.analysis.date)} session`} />
        </section>
      )}

      <section className="section" aria-labelledby="muscle-title">
        <div className="section-head">
          <h2 className="section-title" id="muscle-title">Working sets per muscle</h2>
          <span className="section-note">This week</span>
        </div>
        {data.muscles.length === 0 ? (
          <p className="section-note">No working sets in the last five weeks.</p>
        ) : (
          <>
            <Legend items={[{ name: 'This week', color: 'var(--series-1)' }, { name: 'Average of the 4 weeks before', color: 'var(--series-2)' }]} />
            <div className="muscles">
              {data.muscles.map((m) => (
                <div className="muscle" key={m.muscle}>
                  <span className="muscle-name">{m.muscle}</span>
                  <span className="muscle-track" aria-hidden>
                    {m.sets_this_week > 0 && <span className="bar" style={{ width: `${(m.sets_this_week / maxSets) * 100}%` }} />}
                    <span className="tick" style={{ left: `${(m.sets_avg_4w / maxSets) * 100}%` }} />
                  </span>
                  <span className="muscle-fig">{m.sets_this_week} <span className="muted">/ {m.sets_avg_4w}</span></span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="section" aria-labelledby="weeks-title">
        <h2 className="section-title" id="weeks-title">Sessions per week</h2>
        <Columns data={weeks} x="week" y="sessions" name="Sessions" unit="sessions"
          xFormat={dayMonth} labelFormat={(w) => `Week of ${dayMonth(w)}`}
          goal={data.goals.weekly_gym_sessions_target} goalLabel={data.goals.weekly_gym_sessions_target != null ? `Goal ${data.goals.weekly_gym_sessions_target}` : undefined} />
        <TableView head={['Week of', 'Sessions', 'Volume (kg)']}
          rows={weeks.map((w) => [dayMonth(w.week), w.sessions, n0(w.volume_kg)])} />
      </section>

      {data.workouts.length > 1 && (
        <section className="section" aria-labelledby="history-title">
          <h2 className="section-title" id="history-title">Earlier sessions</h2>
          <ul className="rows">
            {data.workouts.slice(1, all ? undefined : 7).map((w) => (
              <li key={w.id} className="row">
                <span className="row-title">{w.routine ?? 'Workout'}</span>
                <span className="row-fig">{n0(w.total_volume_kg)} kg</span>
                <span className="row-sub">
                  {dayShort(w.date)}{w.duration_s ? ` · ${Math.round(w.duration_s / 60)} min` : ''}{w.prs?.length ? ` · ${w.prs.length} PR` : ''}
                </span>
              </li>
            ))}
          </ul>
          {!all && data.workouts.length > 8 && (
            <button className="text-button" onClick={() => setAll(true)}>Show all {data.workouts.length - 1} sessions</button>
          )}
        </section>
      )}
    </>
  )
}
