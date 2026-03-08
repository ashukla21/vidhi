import path from "path";
import fs from "fs";

const SQLITE_PATH = path.join(process.cwd(), "data", "btc_prices.sqlite");

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

export function invalidateBtcDb(): void {
  try { db?.close(); } catch { /* ignore */ }
  db = null;
  dbPath = null;
}

export function isBtcDataReady(): boolean {
  return fs.existsSync(SQLITE_PATH);
}

function querySync(sql: string, params: unknown[] = []): Record<string, unknown>[] {
  if (!isBtcDataReady()) {
    throw new Error(
      "BTC price data not built yet. Run: python3 scripts/download_btc_data.py"
    );
  }
  const database = getDb();
  const stmt = database.prepare(sql);
  return stmt.all(...params) as Record<string, unknown>[];
}

// ─── BTC Query Functions ──────────────────────────────────────────────────────
// Schema: date TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL, pct_change REAL

export function getBitcoinPrices(params: {
  startDate: string;
  endDate: string;
  limit?: number;
}): Record<string, unknown>[] {
  const { startDate, endDate, limit = 1000 } = params;
  const sql = `
    SELECT date, open, high, low, close, volume, pct_change
    FROM btc_prices
    WHERE date >= ? AND date <= ?
    ORDER BY date ASC
    LIMIT ?
  `;
  return querySync(sql, [startDate, endDate, limit]);
}

export function getBtcDateRange(): { earliest: string; latest: string } | null {
  if (!isBtcDataReady()) return null;
  try {
    const row = querySync(
      "SELECT MIN(date) as earliest, MAX(date) as latest FROM btc_prices"
    )[0];
    if (!row?.earliest) return null;
    return { earliest: row.earliest as string, latest: row.latest as string };
  } catch {
    return null;
  }
}

