# Scheduled task: weekly review, Mondays at 09:30

Spec: AI analysis workflows → 2. Reviews last Monday–Sunday after Monday's daily analysis has run.
Uses the Fitness Hub connector.

---

Review last week (Monday to Sunday) for my Fitness Hub dashboard.

1. Call `get_sync_status`. If a source's latest job is `error`, or finished more than 12 hours
   ago, call `trigger_sync`. Take "today" from the response. Last week ends yesterday (Sunday).
2. Gather:
   - `get_range_summary` for last week, and for the 4 weeks before it.
   - `get_workouts` and `get_runs` for last week.
   - `get_goals`.
   - `get_latest_analysis(kind: weekly, limit: 1)`, to check whether last week's
     recommendations were followed.
3. Cover each area, using `days_with_data`. Don't call a trend from fewer than 5 days of data. If
   more than 2 days are missing for an area, say so and leave that trend out.
   - Weight: 7-day average vs the week before, and the weekly rate of change vs the goal.
   - Energy: average kcal in vs out, days protein hit the target, days with food logged.
   - Gym: sessions, volume per muscle vs the 4-week average, new PRs, muscles not trained.
   - Running: total km, number of runs, time in zone 2 vs zones 4–5, VO2 max trend.
   - Recovery: sleep, HRV and resting HR vs the previous 4 weeks, only where recorded.
   - Last week's recommendations: followed or not.
4. Save with `save_analysis(date: <last Sunday>, kind: weekly)`:
   - `title`: the week in one line.
   - `summary_md`: under 300 words, one short section per area.
   - `scores`: `nutrition`, `training`, `running`, `recovery`, each 0–100. Leave a score out
     when its data is too thin to judge.
   - `recommendations`: at most 3 things for this week.

Write in Thai: titles, summaries and recommendations. Keep units (kcal, g, km) as they are. The text is for me, so never mention tool names.
