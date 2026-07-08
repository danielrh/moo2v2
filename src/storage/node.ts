// Node-only database factory (tests, headless drivers). Never import from ui.

import { Kysely, SqliteDialect } from 'kysely';
import BetterSqlite3 from 'better-sqlite3';
import type { Database } from './schema';
import { GameStore } from './repo';

export async function openNodeStore(path = ':memory:'): Promise<GameStore> {
  const db = new Kysely<Database>({
    dialect: new SqliteDialect({ database: new BetterSqlite3(path) }),
  });
  const store = new GameStore(db);
  await store.init();
  return store;
}
