import path from "path";
import fs from "fs";

const SQLITE_PATH = path.join(process.cwd(), "data", "crude_prices.sqlite");

type SQLiteDB = import("better-sqlite3").Database;
let db: SQLiteDB | null = null;
let dbPath: string | null = null;

function getDb(): SQLiteDB {
  if (!db || dbPath !== SQLITE_PATH) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3");
    db = new Database(SQLITE_PATH, { readonly: true }) as SQLiteDB;
    dbPath = SQLITE_PATH;
  }
  return db;
}

export function invalidateCrudeDb(): void {
  try { db?.close(); } catch { /* ignore */ }
  db = null;
  dbPath = null;
}

export function isCrudeDataReady(): boolean {
  return fs.existsSync(SQLITE_PATH);
}

function querySync(sql: string, params: unknown[] = []): Record<string, unknown>[] {
  if (!isCrudeDataReady()) {
    throw new Error("Crude Oil price data not loaded. Upload a CSV via the sidebar.");
  }
  const database = getDb();
  const stmt = database.prepare(sql);
  return stmt.all(...params) as Record<string, unknown>[];
}

export function getCrudePrices(params: {
  startDate: string;
  endDate: string;
  limit?: number;
}): Record<string, unknown>[] {
  const { startDate, endDate, limit = 500 } = params;
  return querySync(
    `SELECT date, open, high, low, close, volume, pct_change
     FROM crude_prices
     WHERE date >= ? AND date <= ?
     ORDER BY date ASC
     LIMIT ?`,
    [startDate, endDate, limit]
  );
}

export function getCrudeDateRange(): { earliest: string; latest: string } | null {
  if (!isCrudeDataReady()) return null;
  try {
    const row = querySync(
      "SELECT MIN(date) as earliest, MAX(date) as latest FROM crude_prices"
    )[0];
    if (!row?.earliest) return null;
    return { earliest: row.earliest as string, latest: row.latest as string };
  } catch {
    return null;
  }
}
