import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.DATABASE_URL ??= 'postgres://unused'
const { transform, pieces, addDays, localDay } = await import('../src/sources/google.ts')

const day = (d: string) => {
  const [year, month, dd] = d.split('-').map(Number)
  return { date: { year, month, day: dd } }
}
const empty = { steps: [], totalCalories: [], activeEnergy: [], restingHr: [], hrv: [], vo2max: [], weight: [], exercise: [], sleep: [] }

test('reads daily rollups and daily metrics', () => {
  const { daily } = transform({
    ...empty,
    steps: [{ civilStartTime: day('2026-10-17'), steps: { countSum: '8123' } }],
    totalCalories: [{ civilStartTime: day('2026-10-17'), totalCalories: { kcalSum: 2310.6 } }],
    activeEnergy: [{ civilStartTime: day('2026-10-17'), activeEnergyBurned: { kcalSum: 512.2 } }],
    restingHr: [{ dailyRestingHeartRate: { date: day('2026-10-17').date, beatsPerMinute: '52' } }],
    hrv: [{ dailyHeartRateVariability: { date: day('2026-10-17').date, averageHeartRateVariabilityMilliseconds: 61.4 } }],
    vo2max: [{ dailyVo2Max: { date: day('2026-10-17').date, vo2Max: 47.2 } }],
  })
  assert.deepEqual(daily, [
    { date: '2026-10-17', metric: 'steps', value: 8123 },
    { date: '2026-10-17', metric: 'total_kcal_out', value: 2310.6 },
    { date: '2026-10-17', metric: 'active_kcal', value: 512.2 },
    { date: '2026-10-17', metric: 'resting_hr', value: 52 },
    { date: '2026-10-17', metric: 'hrv_ms', value: 61.4 },
    { date: '2026-10-17', metric: 'vo2max', value: 47.2 },
  ])
})

test('uses the first weigh-in of each day', () => {
  const w = (at: string, d: string, grams: number) => ({ weight: { sampleTime: { physicalTime: at, civilTime: day(d) }, weightGrams: grams } })
  const { daily } = transform({
    ...empty,
    weight: [w('2026-10-17T12:00:00Z', '2026-10-17', 71_200), w('2026-10-16T23:40:00Z', '2026-10-17', 70_450)],
  })
  assert.deepEqual(daily, [{ date: '2026-10-17', metric: 'weight_kg', value: 70.45 }])
})

test('keeps runs, skips other exercise, converts units', () => {
  const { runs } = transform({
    ...empty,
    exercise: [
      {
        name: 'users/1/dataTypes/exercise/dataPoints/abc',
        exercise: {
          exerciseType: 'RUNNING',
          // Real responses carry no civilStartTime, only the offset (+07:00 here).
          interval: { startTime: '2026-10-17T23:00:00Z', startUtcOffset: '25200s', endTime: '2026-10-17T23:35:00Z', endUtcOffset: '25200s' },
          activeDuration: '1800s',
          metricsSummary: {
            distanceMillimeters: 5_012_000, caloriesKcal: 402.7, averageHeartRateBeatsPerMinute: '151',
            elevationGainMillimeters: 23_400,
            heartRateZoneDurations: { lightTime: '300s', moderateTime: '900s', vigorousTime: '540s', peakTime: '60s' },
          },
        },
      },
      { name: 'users/1/dataTypes/exercise/dataPoints/gym', exercise: { exerciseType: 'WEIGHTLIFTING', interval: {} } },
    ],
  })
  assert.equal(runs.length, 1)
  assert.deepEqual(runs[0], {
    source_id: 'users/1/dataTypes/exercise/dataPoints/abc',
    date: '2026-10-18',
    start_at: '2026-10-17T23:00:00Z',
    end_at: '2026-10-17T23:35:00Z',
    duration_s: 1800,
    distance_m: 5012,
    avg_pace_s_per_km: 359, // 1800 s / 5.012 km
    avg_hr: 151,
    hr_zone_min: { light: 5, moderate: 15, vigorous: 9, peak: 1 },
    kcal: 403,
    elevation_m: 23.4,
  })
})

test('dates sleep by the wake-up day and keeps time asleep', () => {
  const { sleeps } = transform({
    ...empty,
    sleep: [{
      name: 'users/1/dataTypes/sleep/dataPoints/s1',
      sleep: {
        type: 'STAGES',
        interval: { startTime: '2026-10-17T16:10:00Z', startUtcOffset: '25200s', endTime: '2026-10-17T23:20:00Z', endUtcOffset: '25200s' },
        summary: { minutesAsleep: '401', minutesAwake: '29' },
        stages: [{ type: 'LIGHT', startTime: '2026-10-17T16:10:00Z', endTime: '2026-10-17T16:40:00Z' }],
      },
    }],
  })
  assert.equal(sleeps[0]!.date, '2026-10-18')
  assert.deepEqual(sleeps[0]!.stages, {
    type: 'STAGES', minutesAsleep: 401, minutesAwake: 29,
    stages: [{ type: 'LIGHT', start: '2026-10-17T16:10:00Z', end: '2026-10-17T16:40:00Z' }],
  })
})

test('derives the local day from an instant and its UTC offset', () => {
  assert.equal(localDay('2026-10-17T17:30:00Z', '25200s'), '2026-10-18') // 00:30 in Bangkok
  assert.equal(localDay('2026-10-17T17:30:00Z', '0s'), '2026-10-17')
  assert.equal(localDay('2026-10-17T02:00:00Z', '-18000s'), '2026-10-16') // travelling: UTC-5
  assert.equal(localDay('2026-10-17T17:30:00Z', '25200s', day('2026-10-20')), '2026-10-20') // civil wins
})

test('splits ranges into API-sized pieces', () => {
  assert.deepEqual(pieces('2026-10-01', '2026-10-20'), [['2026-10-01', '2026-10-15'], ['2026-10-15', '2026-10-20']])
  assert.deepEqual(pieces('2026-10-01', '2026-10-01'), [])
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
})
