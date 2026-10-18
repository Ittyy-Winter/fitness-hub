-- Fitness Hub schema (spec: "Data model").
-- All `date` columns are calendar days in Asia/Bangkok.

CREATE TABLE daily_summary (
  date            date PRIMARY KEY,
  steps           integer,
  total_kcal_out  integer,
  active_kcal     integer,
  kcal_in         integer,
  protein_g       numeric(6,1),
  carb_g          numeric(6,1),
  fat_g           numeric(6,1),
  sleep_min       integer,
  sleep_score     integer,
  resting_hr      integer,
  hrv_ms          numeric(5,1),
  vo2max          numeric(4,1),
  weight_kg       numeric(5,2),  -- Google Health only, first reading of the day
  gym_volume_kg   numeric(9,1),
  run_km          numeric(6,2),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE run_session (
  source_id           text PRIMARY KEY,
  date                date NOT NULL,
  start_at            timestamptz NOT NULL,
  duration_s          integer NOT NULL,
  distance_m          numeric(9,1),
  avg_pace_s_per_km   integer,
  avg_hr              integer,
  max_hr              integer,
  hr_zone_min         jsonb,
  kcal                integer,
  elevation_m         numeric(7,1)
);
CREATE INDEX run_session_date_idx ON run_session (date);

-- Only kept for time ranges covered by a session.
CREATE TABLE hr_sample (
  ts   timestamptz PRIMARY KEY,
  bpm  smallint NOT NULL
);

CREATE TABLE sleep_session (
  source_id  text PRIMARY KEY,
  date       date NOT NULL,  -- the day the sleep ends (wake-up day)
  start_at   timestamptz NOT NULL,
  end_at     timestamptz NOT NULL,
  stages     jsonb
);
CREATE INDEX sleep_session_date_idx ON sleep_session (date);

CREATE TABLE gym_workout (
  opengym_id       text PRIMARY KEY,
  date             date NOT NULL,
  routine          text,
  duration_s       integer,
  total_volume_kg  numeric(9,1),
  prs              jsonb
);
CREATE INDEX gym_workout_date_idx ON gym_workout (date);

CREATE TABLE gym_set (
  id          text PRIMARY KEY,
  workout_id  text NOT NULL REFERENCES gym_workout (opengym_id) ON DELETE CASCADE,
  exercise    text NOT NULL,
  muscle      text,
  set_no      smallint NOT NULL,
  weight_kg   numeric(6,2),
  reps        smallint,
  rir         smallint,
  is_warmup   boolean NOT NULL DEFAULT false
);
CREATE INDEX gym_set_workout_idx ON gym_set (workout_id);

CREATE TABLE meal (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  eaten_at    timestamptz NOT NULL DEFAULT now(),
  name        text NOT NULL,
  items       jsonb NOT NULL DEFAULT '[]',
  kcal        integer NOT NULL,
  protein_g   numeric(6,1) NOT NULL,
  carb_g      numeric(6,1) NOT NULL,
  fat_g       numeric(6,1) NOT NULL,
  confidence  numeric(3,2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  photo_url   text,
  note        text
);
CREATE INDEX meal_eaten_at_idx ON meal (eaten_at);

CREATE TABLE analysis (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date             date NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('daily', 'run', 'workout', 'weekly', 'meal')),
  title            text NOT NULL,
  summary_md       text NOT NULL,
  scores           jsonb,
  recommendations  jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analysis_date_kind_idx ON analysis (date, kind, created_at DESC);

CREATE TABLE goal (
  key         text PRIMARY KEY,
  value       numeric NOT NULL,
  unit        text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Sync job queue + history (spec: "Sync job").
CREATE TABLE sync_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source       text NOT NULL CHECK (source IN ('google_health', 'opengym')),
  trigger      text NOT NULL CHECK (trigger IN ('cron', 'dashboard', 'mcp')),
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'ok', 'error')),
  queued_at    timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  rows         integer,
  error        text
);
-- At most one pending/running job per source.
CREATE UNIQUE INDEX sync_log_one_active_idx ON sync_log (source) WHERE status IN ('queued', 'running');
CREATE INDEX sync_log_source_finished_idx ON sync_log (source, finished_at DESC);

CREATE TABLE oauth_token (
  provider           text PRIMARY KEY,
  access_token_enc   bytea NOT NULL,
  refresh_token_enc  bytea NOT NULL,
  expires_at         timestamptz NOT NULL
);

-- Every MCP write (spec: "Auth & ความปลอดภัย").
CREATE TABLE mcp_audit (
  id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at    timestamptz NOT NULL DEFAULT now(),
  tool  text NOT NULL,
  args  jsonb NOT NULL
);
