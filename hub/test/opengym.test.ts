import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.DATABASE_URL ??= 'postgres://unused'
const { workoutsFromState: fromState } = await import('../src/sources/opengym.ts')

// A slice of openGym's catalogue, so the tests do not depend on the generated file.
const CATALOGUE = { '0025': ['barbell bench press', 'pectorals'] as [string, string] }
const workoutsFromState = (state: Parameters<typeof fromState>[0]) => fromState(state, CATALOGUE)

const state = {
  unit: 'kg' as const,
  routines: [{ id: 'r1', name: 'Push A' }],
  customEx: [{ id: 'c_1', n: 'Cable fly (high)', bp: 'chest' }],
  workouts: [
    {
      id: 'w1', d: '2026-10-18', start: 1_792_300_000_000, end: 1_792_303_600_000, routineId: 'r1',
      vol: 1640, prs: ['0025'],
      entries: [
        {
          id: '0025', // catalogue: barbell bench press
          sets: [
            { w: 40, r: 10, done: true, phase: 'warmup' },
            { w: 60, r: 8, done: true, rir: 2 },
            { w: 60, r: 8, done: true, rpe: 9 },
            { w: 60, r: 8, done: false },
          ],
        },
        { id: 'c_1', sets: [{ w: 10, r: 12, done: true, warmup: false }] },
      ],
    },
  ],
}

test('maps a workout, its routine name and PRs', () => {
  const [{ workout }] = workoutsFromState(state)
  assert.equal(workout.opengym_id, 'w1')
  assert.equal(workout.date, '2026-10-18')
  assert.equal(workout.routine, 'Push A')
  assert.equal(workout.duration_s, 3600)
  assert.equal(workout.total_volume_kg, 1640) // openGym's own `vol` wins
  assert.deepEqual(workout.prs, [{ id: '0025', name: 'Barbell bench press' }])
})

test('keeps only completed sets, numbers them per exercise, flags warm-ups', () => {
  const [{ sets }] = workoutsFromState(state)
  assert.deepEqual(sets.map((s) => [s.exercise, s.set_no, s.weight_kg, s.reps, s.rir, s.is_warmup]), [
    ['Barbell bench press', 1, 40, 10, null, true],
    ['Barbell bench press', 2, 60, 8, 2, false],
    ['Barbell bench press', 3, 60, 8, 1, false], // RPE 9 → RIR 1
    ['Cable fly (high)', 1, 10, 12, null, false],
  ])
  assert.equal(sets[0]!.muscle, 'pectorals')
  assert.equal(sets[3]!.muscle, 'chest')
  assert.equal(new Set(sets.map((s) => s.id)).size, sets.length)
})

test('converts pounds and falls back to its own volume without warm-ups', () => {
  const [{ workout, sets }] = workoutsFromState({
    unit: 'lb',
    workouts: [{ id: 'w2', d: '2026-10-17', entries: [{ id: '0025', sets: [
      { w: 45, r: 10, done: true, phase: 'Warm-up' },
      { w: 135, r: 5, done: true },
    ] }] }],
  })
  assert.equal(sets[1]!.weight_kg, 61.23)
  assert.equal(workout.total_volume_kg, 306.2) // 135 lb × 5, warm-up excluded
  assert.equal(workout.duration_s, null)
})

test('changes the hash when a workout is edited', () => {
  const before = workoutsFromState(state)[0]!.workout.src_hash
  const edited = structuredClone(state)
  edited.workouts[0]!.entries[0]!.sets[1]!.r = 9
  assert.notEqual(workoutsFromState(edited)[0]!.workout.src_hash, before)
  assert.equal(workoutsFromState(state)[0]!.workout.src_hash, before)
})

test('dates a workout without `d` by its start in Bangkok', () => {
  // 2026-10-17 18:30 UTC is 01:30 on the 18th in Bangkok.
  const [{ workout }] = workoutsFromState({ workouts: [{ id: 'w3', start: Date.UTC(2026, 9, 17, 18, 30) }] })
  assert.equal(workout.date, '2026-10-18')
})
