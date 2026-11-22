-- migrate:up
-- Fase 10: teamleden uitnodigen (begrensd door het aantal seats van het plan)

CREATE TABLE workspace_invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email        text NOT NULL CHECK (email = lower(email)),
  role         workspace_role NOT NULL DEFAULT 'member' CHECK (role <> 'owner'),
  token_hash   text NOT NULL UNIQUE,      -- sha256 van het token; het token zelf staat alleen in de uitnodigingslink
  invited_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_at  timestamptz,
  revoked_at   timestamptz
);
-- Hooguit één openstaande uitnodiging per e-mailadres per workspace
CREATE UNIQUE INDEX workspace_invitations_open_idx ON workspace_invitations (workspace_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
ALTER TABLE workspace_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_invitations USING (workspace_id::text = current_setting('app.workspace_id', true));

-- Uitnodigingsmails lopen via dezelfde uitgaande wachtrij als digests (worker: send_outbound_emails)
ALTER TABLE outbound_emails DROP CONSTRAINT outbound_emails_kind_check;
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_emails_kind_check CHECK (kind IN ('digest', 'alert', 'system', 'invite'));

-- migrate:down
ALTER TABLE outbound_emails DROP CONSTRAINT outbound_emails_kind_check;
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_emails_kind_check CHECK (kind IN ('digest', 'alert', 'system'));
DROP TABLE workspace_invitations;
