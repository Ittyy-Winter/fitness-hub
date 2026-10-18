import { createHash, randomBytes } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { config } from '../config.ts'
import type { Queryable } from '../db.ts'

// PUT /upload/<token>: the one-time photo link from create_photo_upload (spec: Meal logging
// step 5). The token is the only credential, so it is single-use, expires in 10 minutes and is
// bound to one meal. The file type is read from the bytes, not from the Content-Type header,
// because `curl --data-binary` labels everything as a form unless told otherwise.

const MAX_BYTES = 10 * 1024 * 1024

export function imageType(b: Uint8Array): string | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((x, k) => b[i + k] === x)
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpg'
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'png'
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp'
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'gif'
  if (at(4, 0x66, 0x74, 0x79, 0x70)) {
    const brand = String.fromCharCode(...b.subarray(8, 12))
    if (['heic', 'heix', 'mif1', 'msf1'].includes(brand)) return 'heic'
  }
  return null
}

export function uploadRoutes(app: Hono, db: Queryable): void {
  app.put('/upload/:token',
    bodyLimit({ maxSize: MAX_BYTES, onError: (c) => c.json({ error: 'image is larger than 10 MB' }, 413) }),
    async (c) => {
      const hash = createHash('sha256').update(c.req.param('token')).digest()
      // Claim the token first so two concurrent uploads cannot both use it.
      const { rows: [link] } = await db.query(
        `UPDATE photo_upload SET used_at = now()
          WHERE hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING meal_id`, [hash])
      if (!link) return c.json({ error: 'upload link is invalid, used or expired; ask for a new one' }, 403)

      const bytes = new Uint8Array(await c.req.arrayBuffer())
      const ext = imageType(bytes)
      if (!ext) return c.json({ error: 'not an image (jpeg, png, webp, gif or heic)' }, 415)

      await mkdir(config.photoDir, { recursive: true })
      const file = `${link.meal_id}-${randomBytes(6).toString('hex')}.${ext}`
      await writeFile(path.join(config.photoDir, file), bytes)
      const { rows: [old] } = await db.query(
        `UPDATE meal m SET photo_url = $2 FROM (SELECT photo_url FROM meal WHERE id = $1) prev
          WHERE m.id = $1 RETURNING prev.photo_url AS old`, [link.meal_id, `/photos/${file}`])
      if (old?.old) await unlink(path.join(config.photoDir, path.basename(old.old))).catch(() => {})
      return c.json({ ok: true, meal_id: link.meal_id, bytes: bytes.length })
    })
}
