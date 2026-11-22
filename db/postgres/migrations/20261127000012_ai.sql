-- migrate:up
-- Fase 9: AI-assistent (gesprekken), AI-rapporten, ad-copy en creative-analyse (transcriptie/OCR/hook)

CREATE TABLE ai_conversations (
  id           uuid PRIMARY KEY DEFAULT uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  title        text NOT NULL,
  messages     jsonb NOT NULL DEFAULT '[]',   -- [{role, text, tools: [{name, input, summary}]}] (geen ruwe API-payloads)
  model        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_conversations_ws_idx ON ai_conversations (workspace_id, updated_at DESC);
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_conversations USING (workspace_id::text = current_setting('app.workspace_id', true));

-- Rapporten gaan over publieke data van een entiteit; gedeeld tussen workspaces en 7 dagen geldig
CREATE TABLE ai_reports (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type entity_type NOT NULL,
  entity_id   bigint NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('product_report', 'ad_copy')),
  locale      text NOT NULL DEFAULT 'nl',
  content     jsonb NOT NULL,
  model       text NOT NULL,             -- 'offline' als er geen API-sleutel is
  input_hash  text NOT NULL,             -- hash van de gebruikte data: nieuwe data → nieuw rapport
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_reports_lookup_idx ON ai_reports (entity_type, entity_id, kind, locale, created_at DESC);

ALTER TABLE ads
  ADD COLUMN hook          text,        -- de openingszin/-beeld die de aandacht pakt
  ADD COLUMN angle         text,        -- probleem/oplossing, social proof, korting, …
  ADD COLUMN ai_summary    jsonb,       -- {summary, hook_type, cta, claims[], model}
  ADD COLUMN analyzed_at   timestamptz;
CREATE INDEX ads_unanalyzed_idx ON ads (first_seen) WHERE analyzed_at IS NULL;

-- migrate:down
DROP INDEX IF EXISTS ads_unanalyzed_idx;
ALTER TABLE ads DROP COLUMN hook, DROP COLUMN angle, DROP COLUMN ai_summary, DROP COLUMN analyzed_at;
DROP TABLE ai_reports;
DROP TABLE ai_conversations;
