import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { config } from './config.ts'
import type { Queryable } from './db.ts'

// AES-256-GCM. Stored layout: 12-byte IV | 16-byte auth tag | ciphertext.
export function encrypt(plain: string, key = config.encryptionKey()): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body])
}

export function decrypt(blob: Buffer, key = config.encryptionKey()): string {
  const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12))
  decipher.setAuthTag(blob.subarray(12, 28))
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString('utf8')
}

export type StoredToken = { accessToken: string; refreshToken: string | null; expiresAt: Date }

export async function saveToken(db: Queryable, provider: string, t: StoredToken): Promise<void> {
  await db.query(
    `INSERT INTO oauth_token (provider, access_token_enc, refresh_token_enc, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (provider) DO UPDATE SET access_token_enc = EXCLUDED.access_token_enc,
       refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, oauth_token.refresh_token_enc),
       expires_at = EXCLUDED.expires_at`,
    [provider, encrypt(t.accessToken), t.refreshToken ? encrypt(t.refreshToken) : null, t.expiresAt],
  )
}

export async function loadToken(db: Queryable, provider: string): Promise<StoredToken | null> {
  const { rows } = await db.query(
    'SELECT access_token_enc, refresh_token_enc, expires_at FROM oauth_token WHERE provider = $1',
    [provider],
  )
  if (!rows[0]) return null
  return {
    accessToken: decrypt(rows[0].access_token_enc),
    refreshToken: rows[0].refresh_token_enc ? decrypt(rows[0].refresh_token_enc) : null,
    expiresAt: rows[0].expires_at,
  }
}
