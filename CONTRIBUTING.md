# Contributing

Node 22. Do not start Flutter. Do not add Worker scoring. AIS stays the demo gateway.

## Run and test

```bash
npm install
npm run dev
```

```bash
npm test
```

```bash
npm run typecheck
```

## Pack-loop contract

1. GET /api/packs returns a manifest (bbox + window + layers + hashes).
2. GET /api/objects returns bodies.
3. Client SHA-256 verifies each body against the manifest.
4. Store in IndexedDB.
5. Ready-for-offshore is evaluated on the device after verify. Worker readyForOffshore is a hint.
6. Helm paints packed layers when present. Missing stays missing.
7. Scoring and go/no-go stay on-device. Workers package bytes.
8. AIS is a demo gateway (src/lib/data/ais.ts).
9. Preview packs are hashed fixtures. Live NDBC/CO-OPS is opt-in ingest and degrades to fixtures.
10. Domain types in src/lib/ahanu are additive-only. No silent unit changes.

See docs/DATA_PACKS.md and docs/ARCHITECTURE.md.
