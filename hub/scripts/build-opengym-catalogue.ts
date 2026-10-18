// Builds src/sources/opengym-exercises.json (exercise id → [name, target muscle]) from an
// openGym checkout, so synced sets carry names instead of bare catalogue ids.
// Re-run after bumping OPENGYM_VERSION:
//   git -C <openGym repo> checkout v<version>
//   node scripts/build-opengym-catalogue.ts <openGym repo>/catalogue/exercises
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const dir = process.argv[2]
if (!dir) throw new Error('usage: build-opengym-catalogue.ts <catalogue/exercises dir>')

const out: Record<string, [string, string | null]> = {}
for (const file of (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()) {
  const ex = JSON.parse(await readFile(path.join(dir, file), 'utf8'))
  out[ex.id] = [ex.name, ex.target ?? ex.bodyPart ?? null]
}

const target = new URL('../src/sources/opengym-exercises.json', import.meta.url)
await writeFile(target, JSON.stringify(out) + '\n')
console.log(`${Object.keys(out).length} exercises → ${target.pathname}`)
