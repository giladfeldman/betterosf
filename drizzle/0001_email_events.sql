-- email_events — SES suppression + idempotency (BetterOSF)
BEGIN;

CREATE TABLE IF NOT EXISTS email_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL,
  type            text NOT NULL,
  bounce_type     text,
  message_id      text,
  reason          text,
  payload         jsonb,
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_events_email_idx ON email_events (email);
CREATE INDEX IF NOT EXISTS email_events_type_idx ON email_events (type);

CREATE UNIQUE INDEX IF NOT EXISTS email_events_idempotency_key_unique
  ON email_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMIT;
