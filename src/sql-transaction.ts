import type { DatabaseSync } from "node:sqlite";

/** Node SQLite and SQLite-backed Durable Objects use different transaction APIs. */
export function sqlTransaction<T>(db: DatabaseSync, action: () => T): T {
  const durable = db as DatabaseSync & {
    transactionSync?: <V>(callback: () => V) => V;
  };
  if (durable.transactionSync) return durable.transactionSync(action);
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = action();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
