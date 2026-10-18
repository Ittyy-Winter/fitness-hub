-- Remote MCP server (spec: "MCP server"): its own OAuth 2.1 authorization server, one-time
-- photo upload links, and run splits for get_run_detail. Secrets are stored as SHA-256 hashes.

-- Clients registered through Dynamic Client Registration (RFC 7591). Only Claude's callback
-- URLs are accepted, so this holds a handful of rows.
CREATE TABLE oauth_client (
  client_id      text PRIMARY KEY,
  client_name    text,
  redirect_uris  text[] NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz
);

-- Authorization codes, access tokens and refresh tokens.
CREATE TABLE oauth_credential (
  hash            bytea PRIMARY KEY,
  kind            text NOT NULL CHECK (kind IN ('code', 'access', 'refresh')),
  client_id       text NOT NULL REFERENCES oauth_client (client_id) ON DELETE CASCADE,
  expires_at      timestamptz NOT NULL,
  -- codes only: what the token request has to match
  redirect_uri    text,
  code_challenge  text,
  resource        text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_credential_expires_idx ON oauth_credential (expires_at);

CREATE TABLE photo_upload (
  hash        bytea PRIMARY KEY,
  meal_id     bigint NOT NULL REFERENCES meal (id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);

-- Per-km splits as Google reports them (exercise.splitSummaries), for get_run_detail.
ALTER TABLE run_session ADD COLUMN splits jsonb;

-- Session end, so get_run_detail can slice hr_sample to the run.
ALTER TABLE run_session ADD COLUMN end_at timestamptz;
