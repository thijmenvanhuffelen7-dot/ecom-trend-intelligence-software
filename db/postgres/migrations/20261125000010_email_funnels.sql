-- migrate:up
-- Fase 7: e-mailmarketing (seed-mailboxen, archief) en funnel-analyse

-- Eigen mailboxen op eigen domeinen; elke inschrijving krijgt een uniek adres (plus-adressering) zodat we
-- weten welke winkel welke mail stuurt, ook als het afzenderadres afwijkt.
CREATE TABLE mailboxes (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  address    text NOT NULL UNIQUE,            -- bv. inbox@seeds.trendscope.example
  provider   text NOT NULL DEFAULT 'imap',
  is_active  boolean NOT NULL DEFAULT true,
  last_sync  timestamptz,
  last_uid   bigint NOT NULL DEFAULT 0,      -- IMAP-UID van de laatst verwerkte mail
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_subscriptions (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_id      bigint NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  mailbox_id    bigint NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  address       text NOT NULL UNIQUE,         -- plus-adres per winkel
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'subscribed', 'confirmed', 'manual', 'failed', 'unsubscribed')),
  method        text,                         -- shopify_form | manual
  error         text,
  subscribed_at timestamptz,
  confirmed_at  timestamptz,
  UNIQUE (store_id, mailbox_id)
);

CREATE TABLE emails (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id    text NOT NULL UNIQUE,         -- Message-ID-header (idempotent inlezen)
  store_id      bigint REFERENCES stores(id) ON DELETE CASCADE,
  subscription_id bigint REFERENCES email_subscriptions(id) ON DELETE SET NULL,
  received_at   timestamptz NOT NULL,
  sender        text NOT NULL,
  sender_name   text,
  subject       text NOT NULL,
  preheader     text,
  body_html     text,                         -- wordt alleen in een sandbox-iframe getoond, nooit als HTML in de app
  body_text     text,
  type          text NOT NULL CHECK (type IN ('welcome', 'confirmation', 'promotion', 'product_launch', 'newsletter', 'abandoned_cart', 'transactional', 'other')),
  discount_pct  real,                         -- hoogste genoemde procentkorting
  discount_code text,
  free_shipping boolean NOT NULL DEFAULT false,
  urgency       boolean NOT NULL DEFAULT false, -- "laatste kans", "eindigt vanavond", …
  links         jsonb NOT NULL DEFAULT '[]',  -- [{url, product_id?}]
  esp           text,                         -- verzendplatform uit de headers (Klaviyo, Omnisend, …)
  screenshot_url text
);
CREATE INDEX emails_store_idx ON emails (store_id, received_at DESC);
CREATE INDEX emails_type_idx ON emails (type, received_at DESC);
CREATE INDEX emails_subject_trgm ON emails USING gin (subject gin_trgm_ops);

ALTER TABLE stores
  ADD COLUMN emails_per_week real,            -- gemiddelde over de laatste 4 weken
  ADD COLUMN avg_discount_pct real,
  ADD COLUMN email_esp text;

-- migrate:down
ALTER TABLE stores DROP COLUMN emails_per_week, DROP COLUMN avg_discount_pct, DROP COLUMN email_esp;
DROP TABLE emails;
DROP TABLE email_subscriptions;
DROP TABLE mailboxes;
