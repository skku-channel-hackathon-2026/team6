import { AsyncLocalStorage } from "node:async_hooks";

// A small shared contract keeps local Node development independent of Workers types.
export interface DatabaseResult<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: { changes?: number; [key: string]: unknown };
}
export interface DatabaseStatement {
  bind(...values: (string | number | null)[]): DatabaseStatement;
  run<T = Record<string, unknown>>(): Promise<DatabaseResult<T>>;
  all<T = Record<string, unknown>>(): Promise<DatabaseResult<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}
export interface AppDatabase {
  prepare(sql: string): DatabaseStatement;
  batch<T = Record<string, unknown>>(
    statements: DatabaseStatement[],
  ): Promise<DatabaseResult<T>[]>;
}
const databaseContext = new AsyncLocalStorage<AppDatabase>();
export function withDatabase<T>(database: AppDatabase, callback: () => T): T {
  return databaseContext.run(database, callback);
}
export function getDatabase(): AppDatabase {
  const database = databaseContext.getStore();
  if (!database)
    throw new Error(
      "D1 requires the Cloudflare runtime; use pnpm dev:cloudflare",
    );
  return database;
}
