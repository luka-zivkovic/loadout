import type { DatabaseSync } from "node:sqlite";

/** The registry uses the small synchronous subset shared by Node SQLite and DO SQLite. */
export function durableDatabase(storage: DurableObjectStorage): DatabaseSync {
  const sql = storage.sql;
  const database = {
    exec(statement: string) {
      sql.exec(statement).toArray();
    },
    prepare(statement: string) {
      return {
        get(...values: unknown[]) {
          return sql.exec(statement, ...values).toArray()[0];
        },
        all(...values: unknown[]) {
          return sql.exec(statement, ...values).toArray();
        },
        run(...values: unknown[]) {
          const cursor = sql.exec(statement, ...values);
          cursor.toArray();
          return { changes: cursor.rowsWritten };
        },
      };
    },
    transactionSync<T>(action: () => T): T {
      return storage.transactionSync(action);
    },
    close() {},
  };
  // The registry never calls other DatabaseSync or StatementSync methods.
  return database as unknown as DatabaseSync;
}
