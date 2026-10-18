// Shapes of the hub's dashboard routes (hub/src/dashboard.ts). Postgres numerics arrive as
// numbers, dates as 'YYYY-MM-DD', timestamps as ISO strings.

export type Goals = Partial<Record<
  | 'kcal_target' | 'protein_target' | 'steps_target' | 'sleep_target' | 'weight_target'
  | 'weekly_run_km_target' | 'weekly_gym_sessions_target', number>>

export type SyncSource = {
  id: number
  source: 'google_health' | 'opengym'
  status: 'queued' | 'running' | 'ok' | 'error'
  error: string | null
  queued_at: string
  finished_at: string | null
  last_ok: string | null
}

export type SyncJob = Omit<SyncSource, 'last_ok'> & { rows: number | null }

export type Analysis = {
  id: number
  date: string
  kind: 'daily' | 'run' | 'workout' | 'weekly' | 'meal'
  title: string
  summary_md: string
  scores: Record<string, number> | null
  recommendations: string[] | null
  created_at: string
}

export type MealItem = { name: string; portion?: string; kcal?: number; protein_g?: number; carb_g?: number; fat_g?: number }

export type Meal = {
  id: number
  eaten_at: string
  name: string
  items: MealItem[]
  kcal: number
  protein_g: number
  carb_g: number
  fat_g: number
  confidence: number
  photo_url: string | null
  note: string | null
}

type Recovery = { value: number | null; avg_7d: number | null; last_recorded: string | null }

export type TodayData = {
  today: string
  date: string
  goals: Goals
  meals: Meal[]
  totals: { kcal: number; protein_g: number; carb_g: number; fat_g: number }
  activity: { steps: number | null; steps_avg_7d: number | null; kcal_out: number | null; active_kcal: number | null }
  recovery: { sleep_min: Recovery; hrv_ms: Recovery; resting_hr: Recovery }
  week: { start: string; gym_sessions: number; run_km: number }
  analysis: Analysis | null
  sync: SyncSource[]
}

export type GymSet = {
  exercise: string
  muscle: string | null
  set_no: number
  weight_kg: number | null
  reps: number | null
  rir: number | null
  is_warmup: boolean
}

export type Workout = {
  id: string
  date: string
  routine: string | null
  duration_s: number | null
  total_volume_kg: number | null
  prs: { name: string }[] | null
}

export type TrainingData = {
  today: string
  goals: Goals
  week_start: string
  workouts: Workout[]
  latest: (Workout & { sets: GymSet[] }) | null
  weeks: { week: string; sessions: number; volume_kg: number }[]
  muscles: { muscle: string; sets_this_week: number; sets_avg_4w: number }[]
  analysis: Analysis | null
}

export type HrZones = { light?: number; moderate?: number; vigorous?: number; peak?: number }

export type Run = {
  id: string
  date: string
  start_at: string
  duration_s: number
  distance_m: number | null
  avg_pace_s_per_km: number | null
  avg_hr: number | null
  max_hr: number | null
  hr_zone_min: HrZones | null
  kcal: number | null
  elevation_m: number | null
}

export type RunningData = {
  today: string
  goals: Goals
  runs: Run[]
  latest: (Run & { hr: { min: number; bpm: number }[] }) | null
  weeks: { week: string; runs: number; km: number }[]
  vo2max: { date: string; vo2max: number }[]
  analysis: Analysis | null
}

export type BodyData = {
  today: string
  goals: Goals
  weight: { date: string; weight_kg: number }[]
  energy: {
    date: string
    kcal_in: number | null
    kcal_out: number | null
    steps: number | null
    kcal_in_7d: number | null
    kcal_out_7d: number | null
    kcal_in_days: number
  }[]
}

export type InsightsData = { analyses: Analysis[]; more: boolean }
