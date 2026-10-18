// Fills a database whose name ends in _demo with synthetic data, for screenshots and for trying
// the dashboard without a watch or a gym log. Every value here is made up.
//   docker compose exec db createdb -U hub hub_demo
//   HUB_DEV_DB=hub_demo scripts/hub-dev.sh node scripts/seed-demo.ts
import { pool } from '../src/db.ts'
import { addDays, today } from '../src/dates.ts'
import { migrate } from '../src/migrate.ts'

if (!/\/\w+_demo$/.test(process.env.DATABASE_URL ?? '')) {
  console.error('refusing: DATABASE_URL must point at a database whose name ends in _demo')
  process.exit(1)
}

// Deterministic, so screenshots are reproducible.
let seed = 42
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
const between = (a: number, b: number) => a + rnd() * (b - a)
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00+07:00`

const DAYS = 120
const end = today()
const start = addDays(end, -(DAYS - 1))
const days = Array.from({ length: DAYS }, (_, i) => addDays(start, i))
const dow = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()

await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
await migrate(pool, () => {})

const q = (sql: string, params: unknown[] = []) => pool.query(sql, params)
// Bulk rows go in without waiting one by one; awaited together before the summary refresh.
const pending: Promise<unknown>[] = []
const later = (sql: string, params: unknown[]) => { pending.push(q(sql, params)) }

for (const [key, value, unit] of [
  ['kcal_target', 2600, 'kcal/day'], ['protein_target', 150, 'g/day'], ['steps_target', 9000, 'steps/day'],
  ['weight_target', 72, 'kg'], ['weekly_run_km_target', 15, 'km/week'], ['weekly_gym_sessions_target', 3, 'sessions/week'],
] as const) await q('INSERT INTO goal (key, value, unit) VALUES ($1, $2, $3)', [key, value, unit])

// --- Watch: daily metrics, sleep, runs ---------------------------------------------------------

days.forEach((d, i) => {
  const t = i / DAYS
  const worn = d === end || rnd() > 0.15
  if (!worn) return
  const steps = Math.round(between(4500, 12500))
  const metrics: [string, number][] = [
    ['steps', d === end ? 6240 : steps],
    ['total_kcal_out', d === end ? 1850 : Math.round(2250 + steps * 0.06 + between(-80, 120))],
    ['active_kcal', Math.round(steps * 0.05)],
  ]
  const night = d === end || rnd() > 0.45
  if (night) {
    metrics.push(['resting_hr', Math.round(62 - t * 4 + between(-2, 2))], ['hrv_ms', Math.round(38 + t * 8 + between(-5, 5))])
  }
  if (i % 4 === 0) metrics.push(['vo2max', Math.round((44.2 + t * 2.3 + between(-0.3, 0.3)) * 10) / 10])
  if (i % 3 === 1) metrics.push(['weight_kg', Math.round((75.1 - t * 2.4 + between(-0.4, 0.4)) * 10) / 10])
  for (const [metric, value] of metrics) later('INSERT INTO gh_daily (date, metric, value) VALUES ($1, $2, $3)', [d, metric, value])
  if (night) {
    const asleep = d === end ? 412 : Math.round(between(330, 470))
    later(`INSERT INTO sleep_session (source_id, date, start_at, end_at, stages) VALUES ($1, $2, $3, $4, $5)`,
      [`sleep-${d}`, d, at(addDays(d, -1), '23:40'), new Date(Date.parse(at(addDays(d, -1), '23:40')) + (asleep + 25) * 60_000),
        JSON.stringify({ type: 'STAGES', minutesAsleep: asleep, minutesAwake: 25 })])
  }
})

for (const d of days.filter((d) => [2, 6].includes(dow(d)) && d !== end)) {
  const long = dow(d) === 6
  const distance = long ? between(7000, 9500) : between(4200, 5600)
  const paceS = Math.round(between(345, 395) - (long ? -15 : 0))
  const duration = Math.round((distance / 1000) * paceS)
  const startAt = new Date(at(d, long ? '06:10' : '18:30'))
  const zones = { light: Math.round(duration / 60 * 0.08), moderate: Math.round(duration / 60 * 0.42), vigorous: Math.round(duration / 60 * 0.42), peak: Math.round(duration / 60 * 0.08) }
  const id = `run-${d}`
  let sum = 0
  let max = 0
  const samples = Math.floor(duration / 10)
  for (let k = 0; k < samples; k++) {
    const warm = Math.min(k / 30, 1)
    const bpm = Math.round(118 + warm * 40 + (k / samples) * 9 + Math.sin(k / 7) * 3 + between(-2, 2))
    sum += bpm
    max = Math.max(max, bpm)
    later('INSERT INTO hr_sample (ts, bpm) VALUES ($1, $2) ON CONFLICT DO NOTHING', [new Date(startAt.getTime() + k * 10_000), bpm])
  }
  later(`INSERT INTO run_session (source_id, date, start_at, end_at, duration_s, distance_m, avg_pace_s_per_km, avg_hr, max_hr, hr_zone_min, kcal, elevation_m)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [id, d, startAt, new Date(startAt.getTime() + duration * 1000), duration, Math.round(distance), paceS,
      Math.round(sum / samples), max, JSON.stringify(zones), Math.round(distance * 0.065), Math.round(between(8, 45))])
}

// --- Gym ----------------------------------------------------------------------------------------

const ROUTINES: Record<string, [string, string, number][]> = {
  Push: [['Bench Press', 'chest', 62.5], ['Overhead Press', 'shoulders', 37.5], ['Incline Dumbbell Press', 'chest', 24], ['Triceps Pushdown', 'triceps', 27.5]],
  Pull: [['Deadlift', 'back', 110], ['Lat Pulldown', 'back', 55], ['Seated Cable Row', 'back', 50], ['Dumbbell Curl', 'biceps', 12]],
  Legs: [['Back Squat', 'quads', 85], ['Romanian Deadlift', 'hamstrings', 70], ['Leg Press', 'quads', 140], ['Standing Calf Raise', 'calves', 60]],
}
const order = ['Push', 'Pull', 'Legs']
let session = 0
for (const d of days.filter((d) => [1, 3, 5].includes(dow(d)) || d === end)) {
  if (d !== end && rnd() < 0.15) continue
  const routine = order[session++ % 3]!
  const progress = days.indexOf(d) / DAYS
  const id = `w-${d}`
  let volume = 0
  const prs: { name: string }[] = []
  const sets: unknown[][] = []
  for (const [exercise, muscle, base] of ROUTINES[routine]!) {
    const w = Math.round((base * (0.9 + progress * 0.12)) / 2.5) * 2.5
    sets.push([`${id}-${exercise}-0`, id, exercise, muscle, 1, Math.round(w * 0.5 / 2.5) * 2.5, 10, null, true])
    for (let s = 1; s <= 3; s++) {
      const reps = Math.round(between(6, 10))
      volume += w * reps
      sets.push([`${id}-${exercise}-${s}`, id, exercise, muscle, s + 1, w, reps, Math.round(between(1, 3)), false])
    }
    if (progress > 0.85 && rnd() > 0.6) prs.push({ name: exercise })
  }
  await q('INSERT INTO gym_workout (opengym_id, date, routine, duration_s, total_volume_kg, prs) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, d, routine, Math.round(between(48, 70)) * 60, Math.round(volume), JSON.stringify(prs)])
  for (const s of sets) {
    await q('INSERT INTO gym_set (id, workout_id, exercise, muscle, set_no, weight_kg, reps, rir, is_warmup) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', s)
  }
}

// --- Meals --------------------------------------------------------------------------------------

type Dish = [string, number, number, number, number, [string, string, number][]]
const DISHES: Dish[] = [
  ['ข้าวมันไก่', 620, 32, 72, 21, [['ข้าวมัน', '1 จาน', 380], ['ไก่ต้ม', '~100 g', 180], ['น้ำจิ้มเต้าเจี้ยว', '2 ช้อนโต๊ะ', 60]]],
  ['กะเพราหมูสับไข่ดาว', 710, 34, 68, 32, [['ข้าวสวย', '1 ทัพพีพูน', 240], ['กะเพราหมูสับ', '~120 g รวมน้ำมัน', 300], ['ไข่ดาว', '1 ฟอง', 170]]],
  ['โจ๊กหมูใส่ไข่', 380, 22, 48, 10, [['โจ๊กหมู', '1 ชาม', 300], ['ไข่ลวก', '1 ฟอง', 80]]],
  ['ส้มตำไทย + ไก่ย่าง', 540, 41, 38, 22, [['ส้มตำไทย', '1 จาน', 140], ['ไก่ย่าง', '1 น่อง', 280], ['ข้าวเหนียว', '1 ห่อเล็ก', 120]]],
  ['ก๋วยเตี๋ยวต้มยำหมู', 480, 26, 55, 16, [['เส้นเล็ก', '1 ชาม', 220], ['หมูชิ้น + ลูกชิ้น', '~90 g', 190], ['น้ำซุปต้มยำ', '1 ชาม', 70]]],
  ['เวย์โปรตีน + กล้วย', 230, 26, 30, 2, [['เวย์โปรตีน', '1 สกู๊ป', 120], ['กล้วยหอม', '1 ลูก', 110]]],
  ['ข้าวผัดกุ้ง', 650, 24, 82, 24, [['ข้าวผัด', '1 จาน', 520], ['กุ้ง', '5 ตัว', 90], ['แตงกวา', '3 ชิ้น', 10]]],
  ['อกไก่ย่าง + ข้าวกล้อง', 520, 48, 52, 12, [['อกไก่ย่าง', '~150 g', 250], ['ข้าวกล้อง', '1 ทัพพี', 200], ['ผักลวก', '1 ถ้วย', 70]]],
]
const meal = (d: string, hhmm: string, dish: Dish, confidence: number) =>
  q(`INSERT INTO meal (eaten_at, name, items, kcal, protein_g, carb_g, fat_g, confidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [at(d, hhmm), dish[0], JSON.stringify(dish[5].map(([name, portion, kcal]) => ({ name, portion, kcal }))),
      dish[1], dish[2], dish[3], dish[4], confidence])

for (const d of days.slice(-35, -1)) {
  if (rnd() < 0.2) continue
  await meal(d, '08:05', DISHES[2]!, 0.8)
  await meal(d, '12:20', DISHES[Math.floor(between(0, 5))]!, 0.7)
  if (rnd() > 0.3) await meal(d, '16:30', DISHES[5]!, 0.9)
  await meal(d, '19:15', DISHES[Math.floor(between(3, 8))]!, 0.65)
}
await meal(end, '07:40', DISHES[0]!, 0.8)
await meal(end, '12:15', DISHES[1]!, 0.7)
await meal(end, '15:50', DISHES[5]!, 0.9)

// --- Analyses (synthetic Thai text, like the scheduled task writes) ----------------------------

const analysis = (date: string, kind: string, title: string, summary: string, scores: object | null, recs: string[] | null) =>
  q('INSERT INTO analysis (date, kind, title, summary_md, scores, recommendations, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [date, kind, title, summary, scores && JSON.stringify(scores), recs && JSON.stringify(recs), at(addDays(date, 1), '09:02')])

const y = addDays(end, -1)
await analysis(y, 'daily', 'โปรตีนถึงเป้า แต่ kcal ต่ำกว่าที่ใช้ไปเกือบ 400',
  `**พลังงาน**\n- กินไป 2,190 kcal เทียบกับที่ใช้ไป 2,580 kcal ขาดประมาณ 390 kcal ซึ่งยังอยู่ในช่วงลดน้ำหนักแบบค่อยเป็นค่อยไป\n- มื้อเย็นเป็นมื้อใหญ่สุด (710 kcal)\n\n**โปรตีน**\n- 152 g ถึงเป้า 150 g เป็นวันที่ 4 ติดกัน\n\n**การซ้อม**\n- วิ่ง 5.1 km pace 6:08/km HR เฉลี่ย 151 bpm อยู่โซน moderate–vigorous เกือบทั้งหมด\n- ครึ่งหลัง HR สูงขึ้น 6 bpm (cardiac drift ปกติสำหรับวันที่อากาศร้อน)\n\n**การฟื้นตัว**\n- นอน 6 ชม. 52 นาที HRV 45 ms ใกล้ค่าเฉลี่ย 7 วัน`,
  { nutrition: 78, training: 82, recovery: 70 },
  ['เพิ่มของว่างก่อนเล่นเวทวันนี้ประมาณ 300 kcal เช่น ข้าวเหนียว + ไก่ย่าง', 'วันนี้เป็นวัน Legs เน้น squat 3 เซ็ตหนักตามแผน', 'เข้านอนก่อนเที่ยงคืนเพื่อให้ได้ 7 ชั่วโมง'])
for (let k = 2; k <= 12; k++) {
  const d = addDays(end, -k)
  await analysis(d, 'daily', k % 3 ? 'วันพักที่เดินเยอะ kcal ใกล้เคียงเป้า' : 'บันทึกอาหารไม่ครบ ประเมินสมดุลพลังงานไม่ได้',
    '**พลังงาน**\n- ข้อมูลตัวอย่างสำหรับ dashboard\n\n**กิจกรรม**\n- เดินเกินค่าเฉลี่ย 7 วันเล็กน้อย',
    { nutrition: 60 + k, training: 55 + k }, ['บันทึกอาหารให้ครบทุกมื้อ'])
}
await analysis(addDays(end, -((dow(end) + 6) % 7) - 1), 'weekly', 'สัปดาห์ที่ซ้อมครบ 3 วัน น้ำหนักลง 0.3 kg',
  '**น้ำหนัก**\n- ค่าเฉลี่ย 7 วันลดลง 0.3 kg ตรงกับเป้าที่ตั้งไว้\n\n**ยิม**\n- ครบ 3 sessions volume รวมเพิ่ม 4% จาก 4 สัปดาห์ก่อน\n\n**วิ่ง**\n- 13.6 km จากเป้า 15 km',
  { nutrition: 74, training: 85, running: 72, recovery: 66 }, ['เพิ่มวิ่งช้าโซน 2 อีก 1 ครั้ง', 'คงโปรตีน 150 g ต่อวัน'])
await analysis(y, 'run', 'วิ่ง 5.1 km pace คงที่ HR drift ต่ำ',
  '- pace ครึ่งแรกและครึ่งหลังต่างกันไม่ถึง 5 วินาที/km\n- HR เฉลี่ยต่ำกว่าวิ่งระยะเดียวกันเมื่อ 2 สัปดาห์ก่อน 3 bpm', null, null)

// --- Sync history -------------------------------------------------------------------------------

for (const source of ['google_health', 'opengym']) {
  await q(`INSERT INTO sync_log (source, trigger, status, queued_at, started_at, finished_at, rows)
           VALUES ($1, 'dashboard', 'ok', $2, $2, $2, 12)`, [source, at(end, '08:12')])
}

await Promise.all(pending)
await pool.query('SELECT refresh_daily_summary($1::date[])', [days])
console.log(`seeded ${DAYS} days of synthetic data ending ${end}`)
await pool.end()
