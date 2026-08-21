-- Bind each catch row to SHA-256(device bearer), not the raw token.
-- Existing rows stay. NULL device_hash = unbound-once: the first
-- successful same-id POST binds. Do not drop catch rows.
ALTER TABLE catches ADD COLUMN device_hash TEXT;
