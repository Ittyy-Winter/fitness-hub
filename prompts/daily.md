# Scheduled task: daily analysis, every day at 09:00

Spec: AI analysis workflows → 1. Analyses yesterday, including last night's sleep. Uses the
Fitness Hub connector.

---

Analyse yesterday for my Fitness Hub dashboard.

1. Call `trigger_sync`. If a job is still `queued` or `running`, call `get_sync_status` with its
   `sync_id`, at most twice. If it ends in `error` or never finishes, continue with the data you
   have and say in the summary that it may be incomplete. Take "today" from the response.
   Yesterday is the day before.
2. Call `get_day_summary(yesterday)`, `get_meals(yesterday)`, and `get_runs` and `get_workouts`
   for yesterday only.
3. Compare against my goals and the 7-day average:
   - Energy: kcal in vs out. Skip the balance if fewer than 2 meals were logged, and just say
     food logging was incomplete.
   - Protein: did I reach the target?
   - Training: what I did and how hard (volume, PRs, pace and HR zones).
   - Activity: steps vs target and vs the 7-day average.
   - Recovery: sleep, HRV and resting HR, only if recorded. I often don't wear the watch at night,
     so if they are missing, write one short line saying so. Don't treat it as an error and
     don't guess.
4. Save the result with `save_analysis(date: yesterday, kind: daily)`:
   - `title`: one line naming the main takeaway.
   - `summary_md`: under 150 words, with short sections or bullets.
   - `scores`: `nutrition` and `training`, plus `recovery` only if sleep was recorded, each 0–100.
   - `recommendations`: at most 3 concrete things for today.
5. If there was a run, also save `kind: run`. If there was a gym session, also save
   `kind: workout`. Each gets a short title and summary of its own.

Write in Thai: titles, summaries and recommendations. Keep units (kcal, g, km) as they are. The text is for me, so never mention tool names. If there is no data at all for yesterday, save a one-line daily analysis
saying so, so the dashboard shows the task ran.
