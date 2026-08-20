-- Mirrors cloudflare/src/ingest/run.ts syncPackLayers INSERT.
-- Existing empty table used hash/size_bytes; ingest binds sha256/bytes.
DROP TABLE IF EXISTS pack_layers;
CREATE TABLE pack_layers (
  pack_id TEXT NOT NULL,
  layer_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  source TEXT,
  updated_at TEXT,
  PRIMARY KEY (pack_id, layer_id)
);
