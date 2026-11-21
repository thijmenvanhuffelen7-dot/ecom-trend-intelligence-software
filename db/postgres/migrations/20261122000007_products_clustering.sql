-- migrate:up
-- Fase 4: productdatabase, clustering (tekst + beeld), marktplaatsen, leveranciers

-- Productkenmerken voor matching + marktplaatsvelden
ALTER TABLE products
  ADD COLUMN embedding         vector(256),          -- tekstembedding (genormaliseerde titel)
  ADD COLUMN image_phash       bigint,               -- 64-bit perceptual hash van de hoofdafbeelding
  ADD COLUMN orders_30d        integer,              -- AliExpress: verkochte stuks laatste 30 dagen
  ADD COLUMN rating            real,
  ADD COLUMN reviews_count     integer,
  ADD COLUMN sales_rank        integer,              -- Amazon Best Sellers Rank (hoofdcategorie)
  ADD COLUMN sales_rank_category text,
  ADD COLUMN est_monthly_sales jsonb,                -- Estimate (bv. uit BSR)
  ADD COLUMN seller_id         text,
  ADD COLUMN seller_name       text,
  ADD COLUMN shipping_cost     numeric(12, 2),
  ADD COLUMN shipping_days     int4range,
  ADD COLUMN ships_from        char(2),
  ADD COLUMN clustered_at      timestamptz;          -- laatste keer dat de clustering dit product bekeek
-- Marktplaatslistings hebben geen winkel: uniciteit op (bron, extern id)
CREATE UNIQUE INDEX products_marketplace_uniq ON products (source, external_id) WHERE store_id IS NULL;
CREATE INDEX products_embedding_idx ON products USING hnsw (embedding vector_cosine_ops);
CREATE INDEX products_unclustered_idx ON products (first_seen) WHERE clustered_at IS NULL;

-- Clusters: embedding naar 256 dimensies (was nog leeg), beeldhash en aggregaten
DROP INDEX IF EXISTS clusters_embedding_idx;
ALTER TABLE product_clusters ALTER COLUMN embedding TYPE vector(256) USING NULL;
CREATE INDEX clusters_embedding_idx ON product_clusters USING hnsw (embedding vector_cosine_ops);
ALTER TABLE product_clusters
  ADD COLUMN image_phash             bigint,
  ADD COLUMN source_count            integer NOT NULL DEFAULT 0,   -- aantal verschillende bronnen
  ADD COLUMN marketplace_orders_30d  integer NOT NULL DEFAULT 0,
  ADD COLUMN min_supplier_cost       numeric(12, 2),
  ADD COLUMN created_by              text NOT NULL DEFAULT 'seed';  -- seed | clustering | manual

ALTER TABLE cluster_members ADD COLUMN evidence jsonb NOT NULL DEFAULT '{}';  -- {text, trgm, image, price_ratio}

ALTER TABLE suppliers
  ADD COLUMN store_url     text,
  ADD COLUMN country       char(2),
  ADD COLUMN positive_rate real,
  ADD COLUMN orders_total  integer;

ALTER TABLE supplier_offers ADD COLUMN product_id bigint REFERENCES products(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX supplier_offers_product_uniq ON supplier_offers (product_id) WHERE product_id IS NOT NULL;

-- Audit van samengevoegde clusters (merge is onomkeerbaar in de data, dus altijd herleidbaar)
CREATE TABLE cluster_merges (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_cluster bigint NOT NULL,
  into_cluster bigint NOT NULL REFERENCES product_clusters(id) ON DELETE CASCADE,
  score        real NOT NULL,
  evidence     jsonb NOT NULL DEFAULT '{}',
  merged_at    timestamptz NOT NULL DEFAULT now()
);

-- migrate:down
DROP TABLE cluster_merges;
DROP INDEX IF EXISTS supplier_offers_product_uniq;
ALTER TABLE supplier_offers DROP COLUMN product_id;
ALTER TABLE suppliers DROP COLUMN store_url, DROP COLUMN country, DROP COLUMN positive_rate, DROP COLUMN orders_total;
ALTER TABLE cluster_members DROP COLUMN evidence;
ALTER TABLE product_clusters
  DROP COLUMN image_phash, DROP COLUMN source_count, DROP COLUMN marketplace_orders_30d, DROP COLUMN min_supplier_cost,
  DROP COLUMN created_by;
DROP INDEX IF EXISTS clusters_embedding_idx;
ALTER TABLE product_clusters ALTER COLUMN embedding TYPE vector(512) USING NULL;
CREATE INDEX clusters_embedding_idx ON product_clusters USING hnsw (embedding vector_cosine_ops);
DROP INDEX IF EXISTS products_unclustered_idx;
DROP INDEX IF EXISTS products_embedding_idx;
DROP INDEX IF EXISTS products_marketplace_uniq;
ALTER TABLE products
  DROP COLUMN embedding, DROP COLUMN image_phash, DROP COLUMN orders_30d, DROP COLUMN rating, DROP COLUMN reviews_count,
  DROP COLUMN sales_rank, DROP COLUMN sales_rank_category, DROP COLUMN est_monthly_sales, DROP COLUMN seller_id,
  DROP COLUMN seller_name, DROP COLUMN shipping_cost, DROP COLUMN shipping_days, DROP COLUMN ships_from, DROP COLUMN clustered_at;
