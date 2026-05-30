import path from "path";
import fs from "fs";

const SQLITE_PATH = path.join(process.cwd(), "data", "stock_profiles.sqlite");

type SQLiteDB = import("better-sqlite3").Database;
let db: SQLiteDB | null = null;

function getDb(): SQLiteDB {
  if (!db) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3");
    const dir = path.dirname(SQLITE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new Database(SQLITE_PATH) as SQLiteDB;
    ensureSchema(db);
  }
  return db;
}

function ensureSchema(conn: SQLiteDB): void {
  conn.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS stocks (
      ticker       TEXT PRIMARY KEY,
      company_name TEXT,
      ipo_date     TEXT,
      ipo_time     TEXT,
      ipo_timezone TEXT NOT NULL DEFAULT 'America/New_York',
      ipo_city     TEXT NOT NULL DEFAULT 'New York',
      ipo_state    TEXT NOT NULL DEFAULT 'NY',
      ipo_country  TEXT NOT NULL DEFAULT 'USA',
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stock_natal_planets (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker         TEXT NOT NULL REFERENCES stocks(ticker) ON DELETE CASCADE,
      planet         TEXT NOT NULL,
      degrees        REAL,
      rashi          TEXT,
      nakshatra      TEXT,
      nakshatra_pada INTEGER,
      house          INTEGER,
      UNIQUE(ticker, planet)
    );

    CREATE TABLE IF NOT EXISTS stock_dasha_periods (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker               TEXT NOT NULL REFERENCES stocks(ticker) ON DELETE CASCADE,
      mahadasha_lord       TEXT NOT NULL,
      antardasha_lord      TEXT,
      pratyantardasha_lord TEXT,
      start_date           TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dasha_ticker_date
      ON stock_dasha_periods(ticker, start_date);

    CREATE TABLE IF NOT EXISTS stock_navamsha (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL REFERENCES stocks(ticker) ON DELETE CASCADE,
      planet TEXT NOT NULL,
      rashi  TEXT,
      house  INTEGER,
      UNIQUE(ticker, planet)
    );
  `);

  // Safe migrations for existing DBs — ALTER TABLE ADD COLUMN is a no-op if column exists (caught below)
  for (const [col, def] of [
    ["ipo_city",    "TEXT NOT NULL DEFAULT 'New York'"],
    ["ipo_state",   "TEXT NOT NULL DEFAULT 'NY'"],
    ["ipo_country", "TEXT NOT NULL DEFAULT 'USA'"],
  ] as [string, string][]) {
    try { conn.exec(`ALTER TABLE stocks ADD COLUMN ${col} ${def}`); } catch { /* already exists */ }
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Stock {
  ticker: string;
  company_name: string | null;
  ipo_date: string | null;
  ipo_time: string | null;
  ipo_timezone: string;
  ipo_city: string;
  ipo_state: string;
  ipo_country: string;
  created_at: string;
  has_natal_chart: boolean;
  has_dasha: boolean;
  has_navamsha: boolean;
}

export interface NatalPlanet {
  planet: string;
  degrees: number | null;
  rashi: string | null;
  nakshatra: string | null;
  nakshatra_pada: number | null;
  house: number | null;
}

export interface DashaPeriod {
  mahadasha_lord: string;
  antardasha_lord: string | null;
  pratyantardasha_lord: string | null;
  start_date: string;
}

export interface NavamshaPlacement {
  planet: string;
  rashi: string | null;
  house: number | null;
}

// ── Stocks CRUD ────────────────────────────────────────────────────────────────

export function listStocks(): Stock[] {
  const rows = getDb().prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM stock_natal_planets WHERE ticker = s.ticker) > 0 AS has_natal_chart,
      (SELECT COUNT(*) FROM stock_dasha_periods   WHERE ticker = s.ticker) > 0 AS has_dasha,
      (SELECT COUNT(*) FROM stock_navamsha        WHERE ticker = s.ticker) > 0 AS has_navamsha
    FROM stocks s ORDER BY s.created_at DESC
  `).all() as (Stock & { has_natal_chart: number; has_dasha: number; has_navamsha: number })[];
  return rows.map(r => ({
    ...r,
    has_natal_chart: Boolean(r.has_natal_chart),
    has_dasha:       Boolean(r.has_dasha),
    has_navamsha:    Boolean(r.has_navamsha),
  }));
}

export function getStock(ticker: string): Stock | null {
  const row = getDb().prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM stock_natal_planets WHERE ticker = s.ticker) > 0 AS has_natal_chart,
      (SELECT COUNT(*) FROM stock_dasha_periods   WHERE ticker = s.ticker) > 0 AS has_dasha,
      (SELECT COUNT(*) FROM stock_navamsha        WHERE ticker = s.ticker) > 0 AS has_navamsha
    FROM stocks s WHERE s.ticker = ?
  `).get(ticker) as (Stock & { has_natal_chart: number; has_dasha: number; has_navamsha: number }) | undefined;
  if (!row) return null;
  return {
    ...row,
    has_natal_chart: Boolean(row.has_natal_chart),
    has_dasha:       Boolean(row.has_dasha),
    has_navamsha:    Boolean(row.has_navamsha),
  };
}

export function createStock(params: {
  ticker: string;
  company_name?: string | null;
  ipo_date?: string | null;
  ipo_time?: string | null;
  ipo_timezone?: string;
  ipo_city?: string | null;
  ipo_state?: string | null;
  ipo_country?: string | null;
}): void {
  getDb().prepare(`
    INSERT INTO stocks (ticker, company_name, ipo_date, ipo_time, ipo_timezone, ipo_city, ipo_state, ipo_country)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ticker) DO UPDATE SET
      company_name = excluded.company_name,
      ipo_date     = excluded.ipo_date,
      ipo_time     = excluded.ipo_time,
      ipo_timezone = excluded.ipo_timezone,
      ipo_city     = excluded.ipo_city,
      ipo_state    = excluded.ipo_state,
      ipo_country  = excluded.ipo_country
  `).run(
    params.ticker.toUpperCase(),
    params.company_name ?? null,
    params.ipo_date ?? null,
    params.ipo_time?.trim() || null,
    params.ipo_timezone ?? "America/New_York",
    params.ipo_city?.trim()    || "New York",
    params.ipo_state?.trim()   || "NY",
    params.ipo_country?.trim() || "USA",
  );
}

export function deleteStock(ticker: string): void {
  getDb().prepare("DELETE FROM stocks WHERE ticker = ?").run(ticker.toUpperCase());
}

// ── Natal chart ────────────────────────────────────────────────────────────────

export function saveNatalPlanets(ticker: string, planets: NatalPlanet[]): void {
  const conn = getDb();
  conn.prepare("DELETE FROM stock_natal_planets WHERE ticker = ?").run(ticker);
  const ins = conn.prepare(`
    INSERT OR REPLACE INTO stock_natal_planets
      (ticker, planet, degrees, rashi, nakshatra, nakshatra_pada, house)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  conn.transaction(() => { for (const p of planets) ins.run(ticker, p.planet, p.degrees, p.rashi, p.nakshatra, p.nakshatra_pada, p.house); })();
}

export function getNatalPlanets(ticker: string): NatalPlanet[] {
  return getDb().prepare(
    "SELECT planet, degrees, rashi, nakshatra, nakshatra_pada, house FROM stock_natal_planets WHERE ticker = ? ORDER BY house, degrees"
  ).all(ticker) as NatalPlanet[];
}

// ── Dasha periods ──────────────────────────────────────────────────────────────

export function saveDashaPeriods(ticker: string, periods: DashaPeriod[]): void {
  const conn = getDb();
  conn.prepare("DELETE FROM stock_dasha_periods WHERE ticker = ?").run(ticker);
  const ins = conn.prepare(`
    INSERT INTO stock_dasha_periods
      (ticker, mahadasha_lord, antardasha_lord, pratyantardasha_lord, start_date)
    VALUES (?, ?, ?, ?, ?)
  `);
  conn.transaction(() => { for (const p of periods) ins.run(ticker, p.mahadasha_lord, p.antardasha_lord ?? null, p.pratyantardasha_lord ?? null, p.start_date); })();
}

export function getDashaPeriods(ticker: string): DashaPeriod[] {
  return getDb().prepare(`
    SELECT mahadasha_lord, antardasha_lord, pratyantardasha_lord, start_date
    FROM stock_dasha_periods WHERE ticker = ? ORDER BY start_date ASC
  `).all(ticker) as DashaPeriod[];
}

export function getCurrentDasha(ticker: string, date: string): {
  mahadasha:       { lord: string; started: string } | null;
  antardasha:      { lord: string; started: string } | null;
  pratyantardasha: { lord: string; started: string } | null;
} {
  const conn = getDb();

  const md = conn.prepare(`
    SELECT mahadasha_lord AS lord, start_date AS started
    FROM stock_dasha_periods
    WHERE ticker = ? AND antardasha_lord IS NULL AND pratyantardasha_lord IS NULL
      AND start_date <= ?
    ORDER BY start_date DESC LIMIT 1
  `).get(ticker, date) as { lord: string; started: string } | undefined;

  const ad = md ? conn.prepare(`
    SELECT antardasha_lord AS lord, start_date AS started
    FROM stock_dasha_periods
    WHERE ticker = ? AND mahadasha_lord = ?
      AND antardasha_lord IS NOT NULL AND pratyantardasha_lord IS NULL
      AND start_date <= ?
    ORDER BY start_date DESC LIMIT 1
  `).get(ticker, md.lord, date) as { lord: string; started: string } | undefined : undefined;

  const pd = (md && ad) ? conn.prepare(`
    SELECT pratyantardasha_lord AS lord, start_date AS started
    FROM stock_dasha_periods
    WHERE ticker = ? AND mahadasha_lord = ? AND antardasha_lord = ?
      AND pratyantardasha_lord IS NOT NULL AND start_date <= ?
    ORDER BY start_date DESC LIMIT 1
  `).get(ticker, md.lord, ad.lord, date) as { lord: string; started: string } | undefined : undefined;

  return { mahadasha: md ?? null, antardasha: ad ?? null, pratyantardasha: pd ?? null };
}

export function getUpcomingDashaChanges(ticker: string, fromDate: string, months = 12): DashaPeriod[] {
  const to = new Date(fromDate);
  to.setMonth(to.getMonth() + months);
  return getDb().prepare(`
    SELECT mahadasha_lord, antardasha_lord, pratyantardasha_lord, start_date
    FROM stock_dasha_periods
    WHERE ticker = ? AND start_date > ? AND start_date <= ?
    ORDER BY start_date ASC
  `).all(ticker, fromDate, to.toISOString().slice(0, 10)) as DashaPeriod[];
}

// ── Navamsha ───────────────────────────────────────────────────────────────────

export function saveNavamsha(ticker: string, planets: NavamshaPlacement[]): void {
  const conn = getDb();
  conn.prepare("DELETE FROM stock_navamsha WHERE ticker = ?").run(ticker);
  const ins = conn.prepare("INSERT OR REPLACE INTO stock_navamsha (ticker, planet, rashi, house) VALUES (?, ?, ?, ?)");
  conn.transaction(() => { for (const p of planets) ins.run(ticker, p.planet, p.rashi, p.house); })();
}

export function getNavamsha(ticker: string): NavamshaPlacement[] {
  return getDb().prepare(
    "SELECT planet, rashi, house FROM stock_navamsha WHERE ticker = ? ORDER BY house"
  ).all(ticker) as NavamshaPlacement[];
}
