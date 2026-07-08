// Storage: kysely schema + repositories persisting the command log, snapshots,
// replays, chat and prefs. May import from @engine only. Runtime dialects:
// sqlocal (browser OPFS), better-sqlite3 (node tests).

export const SCHEMA_VERSION = 1;
