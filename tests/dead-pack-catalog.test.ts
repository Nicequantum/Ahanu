import "./register-alias.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

describe("dead DEFAULT_PACK_LAYERS catalog", () => {
  it("is gone so leftover WW3/NDFD/GHRSST cannot be wired as ready", async () => {
    const catalog = fileURLToPath(new URL("../src/lib/data/trip-pack.ts", import.meta.url));
    assert.equal(existsSync(catalog), false, "unused leftover catalog must stay deleted");
    const store = await readFile(new URL("../src/lib/ahanu/store.ts", import.meta.url), "utf8");
    const client = await readFile(new URL("../src/lib/ahanu/pack-client.ts", import.meta.url), "utf8");
    const packs = await readFile(new URL("../src/components/panels/PacksPanel.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(store, /DEFAULT_PACK_LAYERS|data\/trip-pack/);
    assert.match(store, /packLayers: \[\]/);
    assert.doesNotMatch(client, /DEFAULT_PACK_LAYERS|data\/trip-pack/);
    assert.doesNotMatch(packs, /DEFAULT_PACK_LAYERS|data\/trip-pack/);
    assert.doesNotMatch(store, /ww3-grib-72h|ghrsst-1km/);
    assert.doesNotMatch(client, /ww3-grib-72h|ghrsst-1km/);
  });
});
