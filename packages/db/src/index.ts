import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import pg from "pg";
import type { DB } from "./generated";

export type { DB } from "./generated";
export * from "./generated";
export { sql };

// numeric/decimal als JS-number (prijzen en scores passen ruim binnen float64)
pg.types.setTypeParser(1700, (v) => Number.parseFloat(v));
// date als ISO-string (geen tijdzone-verschuiving)
pg.types.setTypeParser(1082, (v) => v);

const globalForDb = globalThis as unknown as { __trendscopeDb?: Kysely<DB> };

export function getDb(): Kysely<DB> {
  if (!globalForDb.__trendscopeDb) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL ontbreekt (zie .env.example)");
    globalForDb.__trendscopeDb = new Kysely<DB>({
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max: 10 }) }),
    });
  }
  return globalForDb.__trendscopeDb;
}

/**
 * Voert `fn` uit in een transactie met `app.workspace_id` gezet, zodat Row Level Security
 * als vangnet werkt voor de niet-eigenaar app-rol. De applicatielaag filtert daarnaast zelf.
 */
export async function withWorkspace<T>(workspaceId: string, fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return getDb()
    .transaction()
    .execute(async (trx) => {
      await sql`select set_config('app.workspace_id', ${workspaceId}, true)`.execute(trx);
      return fn(trx);
    });
}
