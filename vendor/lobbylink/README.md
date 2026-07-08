# Vendored lobbylink TS client

`index.js` / `index.d.ts` are the compiled output of the zero-dependency TypeScript
client from the lobbylink project (`clients/ts/src/index.ts`). It is vendored here
because the package is not published to npm and this repo must be self-contained.

- Source checkout: `~/dev/lobbylink` (override with `LOBBYLINK_DIR`)
- Source commit: see `SOURCE_COMMIT`
- To re-vendor after upstream changes: `scripts/update-lobbylink.sh`

Import it via the `@vendor/lobbylink/index` alias (protocol layer only — see
`scripts/check-boundaries.mjs`). Key API: `P2PGame.connect(...)`, `game.onEvent(...)`,
`game.sendReliable(to, bytes)` (ordered, ≤16 MiB), `game.broadcastBestEffort(bytes)`
(≤16 KB, droppable). The room creator receives `selfId 0` and acts as this game's
permanent host. Do not modify these files directly; patch upstream (keeping it
use-case-independent) and re-vendor.
