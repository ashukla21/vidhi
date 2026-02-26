import path from "path";
import fs from "fs";

const SQLITE_PATH = path.join(process.cwd(), "data", "astro_planet_data.sqlite");

type SQLiteDB = import("better-sqlite3").Database;
let db: SQLiteDB | null = null;

function getDb(): SQLiteDB {
  if (!db) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3");
    db = new Database(SQLITE_PATH, { readonly: true }) as SQLiteDB;
  }
  return db;
}

export function isDataReady(): boolean {
  return fs.existsSync(SQLITE_PATH);
}

function querySync(sql: string, params: unknown[] = []): Record<string, unknown>[] {
  if (!isDataReady()) {
    throw new Error(
      "Astro data not downloaded yet. Run: python3 scripts/download_astro_data.py"
    );
  }
  const database = getDb();
  const stmt = database.prepare(sql);
  return stmt.all(...params) as Record<string, unknown>[];
}

function query(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  return Promise.resolve(querySync(sql, params));
}

// ─── Astrology Query Functions ────────────────────────────────────────────────
// Schema: date, planet, sign, nakshatra, pada, tithi, paksha, lagna

export async function getPlanetaryPositions(params: {
  planets?: string[];
  startDate: string;
  endDate: string;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const { planets, startDate, endDate, limit = 500 } = params;

  if (planets && planets.length > 0) {
    const placeholders = planets.map(() => "?").join(", ");
    const sql = `
      SELECT date, planet, sign, nakshatra, pada, tithi, paksha, lagna
      FROM astro_planet_data
      WHERE date >= ? AND date <= ?
        AND lower(planet) IN (${placeholders})
      ORDER BY date ASC
      LIMIT ?
    `;
    return query(sql, [startDate, endDate, ...planets.map((p) => p.toLowerCase()), limit]);
  }

  const sql = `
    SELECT date, planet, sign, nakshatra, pada, tithi, paksha, lagna
    FROM astro_planet_data
    WHERE date >= ? AND date <= ?
    ORDER BY date ASC
    LIMIT ?
  `;
  return query(sql, [startDate, endDate, limit]);
}

export async function getPlanetInSign(params: {
  planet: string;
  sign: string;
  startDate?: string;
  endDate?: string;
}): Promise<Record<string, unknown>[]> {
  const { planet, sign, startDate = "1990-01-01", endDate = "2031-12-31" } = params;
  const sql = `
    SELECT date, planet, sign, nakshatra, pada, tithi, paksha, lagna
    FROM astro_planet_data
    WHERE lower(planet) = ?
      AND lower(sign) = ?
      AND date >= ? AND date <= ?
    ORDER BY date ASC
  `;
  return query(sql, [planet.toLowerCase(), sign.toLowerCase(), startDate, endDate]);
}

export async function getPlanetaryTransits(params: {
  startDate: string;
  endDate: string;
  planets?: string[];
}): Promise<Record<string, unknown>[]> {
  const { startDate, endDate, planets } = params;

  if (planets && planets.length > 0) {
    const placeholders = planets.map(() => "?").join(", ");
    const sql = `
      WITH ranked AS (
        SELECT date, planet, sign, nakshatra, pada,
          LAG(sign) OVER (PARTITION BY planet ORDER BY date) AS prev_sign
        FROM astro_planet_data
        WHERE date >= ? AND date <= ?
          AND lower(planet) IN (${placeholders})
      )
      SELECT planet, date, sign, nakshatra, pada, prev_sign
      FROM ranked
      WHERE sign != prev_sign AND prev_sign IS NOT NULL
      ORDER BY date ASC
    `;
    return query(sql, [startDate, endDate, ...planets.map((p) => p.toLowerCase())]);
  }

  const sql = `
    WITH ranked AS (
      SELECT date, planet, sign, nakshatra, pada,
        LAG(sign) OVER (PARTITION BY planet ORDER BY date) AS prev_sign
      FROM astro_planet_data
      WHERE date >= ? AND date <= ?
    )
    SELECT planet, date, sign, nakshatra, pada, prev_sign
    FROM ranked
    WHERE sign != prev_sign AND prev_sign IS NOT NULL
    ORDER BY date ASC
  `;
  return query(sql, [startDate, endDate]);
}
