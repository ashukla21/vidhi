import path from "path";
import fs from "fs";

const SQLITE_PATH = path.join(process.cwd(), "data", "gold_prices.sqlite");

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

export function invalidateGoldDb(): void {
  try { db?.close(); } catch { /* ignore */ }
  db = null;
  dbPath = null;
}

export function isGoldDataReady(): boolean {
  return fs.existsSync(SQLITE_PATH);
}

function querySync(sql: string, params: unknown[] = []): Record<string, unknown>[] {
  if (!isGoldDataReady()) {
    throw new Error("Gold price data not loaded. Upload a CSV via the sidebar.");
  }
  const database = getDb();
  const stmt = database.prepare(sql);
  return stmt.all(...params) as Record<string, unknown>[];
}

// Schema: date TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL, pct_change REAL
// `close` holds the settlement/spot price (USD per troy ounce)

export function getGoldPrices(params: {
  startDate: string;
  endDate: string;
  limit?: number;
}): Record<string, unknown>[] {
  const { startDate, endDate, limit = 500 } = params;
  return querySync(
    `SELECT date, open, high, low, close, volume, pct_change
     FROM gold_prices
     WHERE date >= ? AND date <= ?
     ORDER BY date ASC
     LIMIT ?`,
    [startDate, endDate, limit]
  );
}

export function getGoldDateRange(): { earliest: string; latest: string } | null {
  if (!isGoldDataReady()) return null;
  try {
    const row = querySync(
      "SELECT MIN(date) as earliest, MAX(date) as latest FROM gold_prices"
    )[0];
    if (!row?.earliest) return null;
    return { earliest: row.earliest as string, latest: row.latest as string };
  } catch {
    return null;
  }
}
