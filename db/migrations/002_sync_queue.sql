-- Sync worker support (spec: "Sync job" and "Data model → กติกา").
-- The queue rules and the daily_summary rebuild live in SQL so the worker, the Hub API and
-- the MCP server all run the exact same logic.

-- Raw per-day values from Google Health that have no table of their own
-- (steps, kcal, resting HR, HRV, VO2 max, weight). daily_summary is derived from this.
CREATE TABLE gh_daily (
  date        date NOT NULL,
  metric      text NOT NULL CHECK (metric IN ('steps', 'total_kcal_out', 'active_kcal', 'resting_hr', 'hrv_ms', 'vo2max', 'weight_kg')),
  value       numeric NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, metric)
);

-- Per-source sync position (openGym's last seen rev, Google backfill progress, ...).
CREATE TABLE sync_cursor (
  source      text PRIMARY KEY,
  cursor      jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Lets the openGym sync skip workouts whose content did not change.
ALTER TABLE gym_workout ADD COLUMN src_hash text;

-- openGym's bearer token renews itself and has no refresh token.
ALTER TABLE oauth_token ALTER COLUMN refresh_token_enc DROP NOT NULL;

-- Wake the worker whenever a job is queued, whoever queued it.
CREATE FUNCTION sync_log_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('sync_jobs', NEW.id::text);
  RETURN NEW;
END $$;

CREATE TRIGGER sync_log_notify AFTER INSERT ON sync_log
  FOR EACH ROW EXECUTE FUNCTION sync_log_notify();

-- Queue a sync and return the job id to watch. Returns the existing job instead of queueing
-- when the source already has one queued or running, or finished one successfully less than
-- `cooldown` ago (keeps us clear of Google's rate limit).
CREATE FUNCTION enqueue_sync(p_source text, p_trigger text, cooldown interval DEFAULT '5 minutes')
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  job bigint;
BEGIN
  SELECT id INTO job FROM sync_log
   WHERE source = p_source AND status IN ('queued', 'running');
  IF FOUND THEN RETURN job; END IF;

  SELECT id INTO job FROM sync_log
   WHERE source = p_source AND status = 'ok' AND finished_at > now() - cooldown
   ORDER BY finished_at DESC LIMIT 1;
  IF FOUND THEN RETURN job; END IF;

  INSERT INTO sync_log (source, trigger) VALUES (p_source, p_trigger)
  ON CONFLICT (source) WHERE status IN ('queued', 'running') DO NOTHING
  RETURNING id INTO job;
  IF job IS NOT NULL THEN RETURN job; END IF;

  -- Lost a race with another enqueuer: return the job it created.
  SELECT id INTO job FROM sync_log
   WHERE source = p_source AND status IN ('queued', 'running');
  RETURN job;
END $$;

-- Rebuild whole daily_summary rows from the source tables. Call with every date whose data
-- changed; a date with no data left at all loses its row.
CREATE FUNCTION refresh_daily_summary(dates date[]) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  n integer;
BEGIN
  WITH d AS (SELECT DISTINCT unnest(dates) AS date),
  gh AS (
    SELECT date,
           max(value) FILTER (WHERE metric = 'steps')          AS steps,
           max(value) FILTER (WHERE metric = 'total_kcal_out') AS total_kcal_out,
           max(value) FILTER (WHERE metric = 'active_kcal')    AS active_kcal,
           max(value) FILTER (WHERE metric = 'resting_hr')     AS resting_hr,
           max(value) FILTER (WHERE metric = 'hrv_ms')         AS hrv_ms,
           max(value) FILTER (WHERE metric = 'vo2max')         AS vo2max,
           max(value) FILTER (WHERE metric = 'weight_kg')      AS weight_kg
      FROM gh_daily WHERE date IN (SELECT date FROM d) GROUP BY date
  ),
  food AS (
    SELECT (eaten_at AT TIME ZONE 'Asia/Bangkok')::date AS date,
           sum(kcal) AS kcal_in, sum(protein_g) AS protein_g, sum(carb_g) AS carb_g, sum(fat_g) AS fat_g
      FROM meal
     WHERE (eaten_at AT TIME ZONE 'Asia/Bangkok')::date IN (SELECT date FROM d)
     GROUP BY 1
  ),
  slp AS (
    -- Time asleep as Google reports it; time in bed for a session without a summary.
    SELECT date, sum(coalesce((stages->>'minutesAsleep')::integer,
                              extract(epoch FROM end_at - start_at) / 60))::integer AS sleep_min
      FROM sleep_session WHERE date IN (SELECT date FROM d) GROUP BY date
  ),
  gym AS (
    SELECT date, sum(total_volume_kg) AS gym_volume_kg
      FROM gym_workout WHERE date IN (SELECT date FROM d) GROUP BY date
  ),
  run AS (
    SELECT date, round(sum(distance_m) / 1000, 2) AS run_km
      FROM run_session WHERE date IN (SELECT date FROM d) GROUP BY date
  ),
  rows AS (
    SELECT d.date,
           gh.steps::integer, gh.total_kcal_out::integer, gh.active_kcal::integer,
           food.kcal_in::integer, food.protein_g, food.carb_g, food.fat_g,
           slp.sleep_min, gh.resting_hr::integer, gh.hrv_ms, gh.vo2max, gh.weight_kg,
           gym.gym_volume_kg, run.run_km,
           (gh.date IS NOT NULL OR food.date IS NOT NULL OR slp.date IS NOT NULL
              OR gym.date IS NOT NULL OR run.date IS NOT NULL) AS has_data
      FROM d
      LEFT JOIN gh   USING (date)
      LEFT JOIN food USING (date)
      LEFT JOIN slp  USING (date)
      LEFT JOIN gym  USING (date)
      LEFT JOIN run  USING (date)
  ),
  gone AS (
    DELETE FROM daily_summary s USING rows r
     WHERE s.date = r.date AND NOT r.has_data
  ),
  upserted AS (
    INSERT INTO daily_summary AS s (date, steps, total_kcal_out, active_kcal, kcal_in, protein_g, carb_g,
                                    fat_g, sleep_min, resting_hr, hrv_ms, vo2max, weight_kg,
                                    gym_volume_kg, run_km, updated_at)
    SELECT date, steps, total_kcal_out, active_kcal, kcal_in, protein_g, carb_g, fat_g, sleep_min,
           resting_hr, hrv_ms, vo2max, weight_kg, gym_volume_kg, run_km, now()
      FROM rows WHERE has_data
    ON CONFLICT (date) DO UPDATE SET
      steps = EXCLUDED.steps, total_kcal_out = EXCLUDED.total_kcal_out,
      active_kcal = EXCLUDED.active_kcal, kcal_in = EXCLUDED.kcal_in,
      protein_g = EXCLUDED.protein_g, carb_g = EXCLUDED.carb_g, fat_g = EXCLUDED.fat_g,
      sleep_min = EXCLUDED.sleep_min, resting_hr = EXCLUDED.resting_hr,
      hrv_ms = EXCLUDED.hrv_ms, vo2max = EXCLUDED.vo2max, weight_kg = EXCLUDED.weight_kg,
      gym_volume_kg = EXCLUDED.gym_volume_kg, run_km = EXCLUDED.run_km, updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO n FROM upserted;
  RETURN n;
END $$;
