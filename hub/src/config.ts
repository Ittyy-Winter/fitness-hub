// All settings come from the environment (compose passes them through from .env).

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`missing env ${name}`)
  return value
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  // 32 bytes as hex. Encrypts OAuth tokens at rest (spec: Non-functional → Security).
  encryptionKey: () => Buffer.from(required('HUB_ENCRYPTION_KEY'), 'hex'),
  opengymUrl: process.env.OPENGYM_URL ?? 'http://opengym-api:3000',
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:8081/auth/google/callback',
  },
  apiPort: Number(process.env.PORT ?? 8081),
  // Nightly sync time, Asia/Bangkok (spec: Data sources → ความถี่).
  nightlySyncAt: process.env.NIGHTLY_SYNC_AT ?? '21:00',
  timeZone: 'Asia/Bangkok',
}
