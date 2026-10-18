import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AnalysisView, coverage } from '../components/AnalysisView.tsx'
import { addDays, clock, dayLong, dayMonth, minutes, n0, n1 } from '../format.ts'
import type { Meal, TodayData } from '../types.ts'

const CLAUDE_URL = import.meta.env.VITE_CLAUDE_PROJECT_URL || 'https://claude.ai/projects'
const SEEN_KEY = 'fh:seen-meals'

// Meals already shown once. Anything new since then prints onto the roll with the feed motion.
function useNewMeals(meals: Meal[] | undefined): Set<number> {
  const [fresh, setFresh] = useState<Set<number>>(new Set())
  const first = useRef(true)
  useEffect(() => {
    if (!meals) return
    let seen: number[] = []
    try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') } catch { /* no history */ }
    const known = new Set(seen)
    // On a device's very first open nothing is "new"; the whole roll is just there.
    setFresh(first.current && !seen.length ? new Set() : new Set(meals.filter((m) => !known.has(m.id)).map((m) => m.id)))
    first.current = false
    try { localStorage.setItem(SEEN_KEY, JSON.stringify([...known, ...meals.map((m) => m.id)].slice(-200))) } catch { /* fine */ }
  }, [meals])
  return fresh
}

function MealLine({ meal, target, isNew }: { meal: Meal; target: number | undefined; isNew: boolean }) {
  const [open, setOpen] = useState(false)
  const share = target ? Math.min(meal.kcal / target, 1) : null
  const photo = meal.photo_url && !meal.photo_url.endsWith('.heic') ? meal.photo_url : null
  return (
    <li className="line" data-new={isNew ? '' : undefined}>
      <button onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="line-time mono">{clock(meal.eaten_at)}</span>
        <span className="line-name">{meal.name}</span>
        <span className="line-kcal mono">{n0(meal.kcal)}</span>
        <ChevronDown className="line-cue" size={16} aria-hidden />
        {share != null && (
          <span className="line-rule" aria-hidden><span style={{ width: `${share * 100}%` }} /></span>
        )}
      </button>
      {open && (
        <div className="line-detail">
          <p className="line-macros mono">
            <span>P {n1(meal.protein_g)} g</span>
            <span>C {n1(meal.carb_g)} g</span>
            <span>F {n1(meal.fat_g)} g</span>
            <span className="muted">Confidence {Math.round(meal.confidence * 100)}%</span>
          </p>
          {photo && <img src={photo} alt={`Photo of ${meal.name}`} loading="lazy" />}
          {meal.items.length > 0 && (
            <ul className="line-items">
              {meal.items.map((it, i) => (
                <li key={i}>
                  <span>{it.name}{it.portion && <span className="portion">{it.portion}</span>}</span>
                  <span className="mono">{it.kcal != null ? n0(it.kcal) : ''}</span>
                </li>
              ))}
            </ul>
          )}
          {meal.note && <p className="line-note">{meal.note}</p>}
        </div>
      )}
    </li>
  )
}

function Slip({ data }: { data: TodayData }) {
  const { meals, totals, goals } = data
  const fresh = useNewMeals(data.meals)
  const kcalLeft = goals.kcal_target != null ? goals.kcal_target - totals.kcal : null
  const proteinLeft = goals.protein_target != null ? goals.protein_target - totals.protein_g : null
  // The end-of-roll stripe: under 10% of the day left, or over.
  const low = kcalLeft != null && goals.kcal_target != null && kcalLeft < goals.kcal_target * 0.1

  return (
    <div className="slip-wrap">
      <section className="slip" aria-labelledby="slip-title" data-low={low ? '' : undefined}>
        <header className="slip-head">
          <h1 id="slip-title">Today</h1>
          <p className="mono">{dayLong(data.date).toUpperCase()}</p>
        </header>
        <hr className="tear" />
        {meals.length === 0 ? (
          <div className="slip-empty">
            <p>Nothing logged yet today. Send Claude a photo of your next meal.</p>
            <a className="pill-link" href={CLAUDE_URL} target="_blank" rel="noreferrer">Open Claude</a>
          </div>
        ) : (
          <ol className="lines" aria-label="Meals">
            {meals.map((m) => <MealLine key={m.id} meal={m} target={goals.kcal_target} isNew={fresh.has(m.id)} />)}
          </ol>
        )}
        <hr className="tear" />
        <dl className="totals mono">
          <div>
            <dt>EATEN</dt>
            <dd>{n0(totals.kcal)}{goals.kcal_target != null && ` / ${n0(goals.kcal_target)}`} kcal</dd>
          </div>
          <div>
            <dt>PROTEIN</dt>
            <dd>{n0(totals.protein_g)}{goals.protein_target != null && ` / ${n0(goals.protein_target)}`} g</dd>
            {goals.protein_target != null && (
              <span className="meter" aria-hidden>
                <span style={{ width: `${Math.min(totals.protein_g / goals.protein_target, 1) * 100}%` }} />
              </span>
            )}
          </div>
          <div>
            <dt>CARBS · FAT</dt>
            <dd>{n0(totals.carb_g)} g · {n0(totals.fat_g)} g</dd>
          </div>
        </dl>
        {kcalLeft != null && (
          <>
            <hr className="tear" />
            <div className="change" data-over={kcalLeft < 0 ? '' : undefined}>
              <div className="change-main">
                <span className="change-figure">{n0(Math.abs(kcalLeft))}</span>
                <span className="change-label">{kcalLeft < 0 ? 'KCAL OVER' : 'KCAL LEFT'}</span>
              </div>
              {proteinLeft != null && (
                <div className="change-side">
                  <span className="fig">{n0(proteinLeft > 0 ? proteinLeft : totals.protein_g)}<span className="unit"> g</span></span>
                  <span className="change-label">{proteinLeft > 0 ? 'PROTEIN LEFT' : 'PROTEIN, TARGET HIT'}</span>
                </div>
              )}
            </div>
          </>
        )}
        {meals.length > 0 && (
          <a className="slip-foot mono" href={CLAUDE_URL} target="_blank" rel="noreferrer">LOG NEXT MEAL · OPEN CLAUDE</a>
        )}
      </section>
    </div>
  )
}

function Recovery({ data }: { data: TodayData }) {
  const r = data.recovery
  const rows = [
    { key: 'sleep_min', label: 'Sleep', fmt: (v: number) => minutes(v), unit: '' },
    { key: 'hrv_ms', label: 'HRV', fmt: (v: number) => n0(v), unit: 'ms' },
    { key: 'resting_hr', label: 'Resting HR', fmt: (v: number) => n0(v), unit: 'bpm' },
  ] as const
  const recorded = rows.filter((row) => r[row.key].value != null)
  const lastSleep = r.sleep_min.last_recorded
  return (
    <section className="section" aria-labelledby="recovery-title">
      <div className="section-head">
        <h2 className="section-title" id="recovery-title">Last night</h2>
      </div>
      {recorded.length === 0 ? (
        <p className="section-note">
          Not recorded last night.
          {lastSleep ? ` Last sleep on record: ${dayMonth(lastSleep)}.` : ''}
        </p>
      ) : (
        <dl className="stats">
          {rows.map((row) => {
            const v = r[row.key]
            return (
              <div className="stat" key={row.key}>
                <dt>{row.label}</dt>
                <dd>{v.value != null ? <>{row.fmt(v.value)}{row.unit && <span className="unit">{row.unit}</span>}</> : '–'}</dd>
                <span className="sub">
                  {v.value == null
                    ? `Not recorded${v.last_recorded ? `, last on ${dayMonth(v.last_recorded)}` : ''}`
                    : v.avg_7d != null ? `7-day average ${row.fmt(v.avg_7d)}${row.unit ? ` ${row.unit}` : ''}` : 'No 7-day average yet'}
                </span>
              </div>
            )
          })}
        </dl>
      )}
    </section>
  )
}

function Moving({ data }: { data: TodayData }) {
  const { activity: a, goals, week } = data
  const stepsRef = goals.steps_target ?? a.steps_avg_7d
  return (
    <section className="section" aria-labelledby="moving-title">
      <h2 className="section-title" id="moving-title">So far this week</h2>
      <dl className="stats">
        <div className="stat">
          <dt>Gym sessions</dt>
          <dd>{week.gym_sessions}{goals.weekly_gym_sessions_target != null && <span className="unit">of {goals.weekly_gym_sessions_target}</span>}</dd>
          {goals.weekly_gym_sessions_target != null && (
            <span className="meter" aria-hidden><span style={{ width: `${Math.min(week.gym_sessions / goals.weekly_gym_sessions_target, 1) * 100}%` }} /></span>
          )}
        </div>
        <div className="stat">
          <dt>Running</dt>
          <dd>{n1(week.run_km)}<span className="unit">km{goals.weekly_run_km_target != null && ` of ${goals.weekly_run_km_target}`}</span></dd>
          {goals.weekly_run_km_target != null && (
            <span className="meter" aria-hidden><span style={{ width: `${Math.min(week.run_km / goals.weekly_run_km_target, 1) * 100}%` }} /></span>
          )}
        </div>
        <div className="stat">
          <dt>Steps today</dt>
          <dd>{n0(a.steps)}</dd>
          {a.steps != null && stepsRef != null && (
            <span className="meter" aria-hidden><span style={{ width: `${Math.min(a.steps / stepsRef, 1) * 100}%` }} /></span>
          )}
          <span className="sub">
            {goals.steps_target != null ? `Target ${n0(goals.steps_target)}` : a.steps_avg_7d != null ? `7-day average ${n0(a.steps_avg_7d)}` : 'No watch data today'}
            {a.kcal_out != null && ` · ${n0(a.kcal_out)} kcal burned`}
          </span>
        </div>
      </dl>
    </section>
  )
}

export function Today({ data }: { data: TodayData }) {
  const yesterday = addDays(data.date, -1)
  return (
    <>
      <Slip data={data} />
      <section className="section" aria-labelledby="claude-title">
        {data.analysis ? (
          <AnalysisView analysis={data.analysis} headingId="claude-title"
            byline={coverage(data.analysis, yesterday, 'yesterday')} />
        ) : (
          <>
            <h2 className="section-title" id="claude-title">Claude on yesterday</h2>
            <p className="empty"><strong>No analysis yet.</strong>Claude writes one every morning at 09:00.</p>
          </>
        )}
      </section>
      <Recovery data={data} />
      <Moving data={data} />
    </>
  )
}
