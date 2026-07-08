// Browser database factory: sqlocal persists SQLite into OPFS (requires
// cross-origin isolation; vite dev/preview set the COOP/COEP headers).

import { Kysely } from 'kysely';
import { SQLocalKysely } from 'sqlocal/kysely';
import type { Database } from './schema';
import { GameStore } from './repo';

export interface BrowserStore {
  store: GameStore;
  /** Underlying sqlocal handle (deleteDatabaseFile, getDatabaseFile, ...). */
  sqlocal: SQLocalKysely;
}

/** One database file per game keeps OPFS access-handle locking per-game. */
export function gameDbName(gameId: string): string {
  return `moo2v2-${gameId}.sqlite3`;
}

/** Shared database for prefs and the saved-games index. */
export const META_DB_NAME = 'moo2v2-meta.sqlite3';

export async function openBrowserStore(dbName: string): Promise<BrowserStore> {
  const sqlocal = new SQLocalKysely(dbName);
  const db = new Kysely<Database>({ dialect: sqlocal.dialect });
  const store = new GameStore(db);
  await store.init();
  return { store, sqlocal };
}

export function isOpfsLikelyAvailable(): boolean {
  return (
    typeof crossOriginIsolated !== 'undefined' &&
    crossOriginIsolated === true &&
    typeof navigator !== 'undefined' &&
    !!navigator.storage?.getDirectory
  );
}
