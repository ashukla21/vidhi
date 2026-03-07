#!/usr/bin/env python3
"""
Build the astro SQLite database from local CSV files.

Place your CSV files in data/raw/ named as YYYY_M.csv  (e.g. 1990_1.csv = Jan 1990).
Then run:
  python3 scripts/download_astro_data.py

The CSVs are in wide format produced by vedastro:
  Date | Time | Tithi | Paksha | Hora | Panchak | Lagna |
  Moon Rashi | Moon Nakshatra | Moon Pada |
  Sun Rashi  | Sun Nakshatra  | Sun Pada  | ... (one group per planet)

Date column format in source CSVs: DD-MM-YYYY  (e.g. 01-01-1990)

Output:
  data/astro_planet_data.sqlite  — SQLite DB (table: astro_planet_data)
                                   Schema: date, planet, sign, nakshatra, pada,
                                           tithi, paksha, lagna, hora, panchak
  data/astro_data_summary.json   — stats summary
"""

import json
import sys
import sqlite3
import pandas as pd
from pathlib import Path

DATA_DIR    = Path(__file__).parent.parent / "data"
RAW_DIR     = DATA_DIR / "raw"
SQLITE_PATH = DATA_DIR / "astro_planet_data.sqlite"
SUMMARY_PATH = DATA_DIR / "astro_data_summary.json"
TABLE_NAME  = "astro_planet_data"

PLANETS = ["Moon", "Sun", "Mars", "Mercury", "Jupiter", "Venus", "Saturn", "Rahu", "Ketu"]


def load_raw_csvs() -> pd.DataFrame:
    """Read all CSVs from data/raw/ and combine them."""
    csv_files = sorted(RAW_DIR.rglob("*.csv"))

    if not csv_files:
        print(f"ERROR: No CSV files found in {RAW_DIR}")
        print(f"  Drop your CSV files there:  cp /path/to/*.csv {RAW_DIR}/")
        sys.exit(1)

    print(f"Found {len(csv_files)} CSV file(s):")
    for f in csv_files:
        print(f"  {f.name}")

    dfs = []
    for csv_path in csv_files:
        try:
            df = pd.read_csv(csv_path, dtype=str, on_bad_lines="skip")
            if not df.empty:
                dfs.append(df)
                print(f"  Loaded {len(df):,} rows from {csv_path.name}")
        except Exception as e:
            print(f"  WARNING: skipping {csv_path.name}: {e}")

    if not dfs:
        print("ERROR: All CSV files failed to load.")
        sys.exit(1)

    combined = pd.concat(dfs, ignore_index=True)
    print(f"\nTotal rows loaded: {len(combined):,}")
    return combined


def normalize_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """
    Wide-format CSV → long-format DB (one row per date × planet).
    This is the schema the query layer expects:
      date, planet, sign, nakshatra, pada, tithi, paksha, lagna, hora, panchak
    """
    # ── 1. Normalize column names ─────────────────────────────────────────────
    df.columns = [c.lower().strip().replace(" ", "_") for c in df.columns]
    print(f"\nColumns found: {list(df.columns)}")

    # ── 2. Parse dates — source format is DD-MM-YYYY (e.g. 01-01-1990) ────────
    date_col = next(
        (c for c in df.columns if c == "date" or c.endswith("_date")),
        next((c for c in df.columns if "date" in c), None),
    )
    if date_col is None:
        print("ERROR: No date column found.")
        sys.exit(1)

    parsed = pd.to_datetime(df[date_col], format="%d-%m-%Y", errors="coerce")
    if parsed.isna().all():
        print("WARNING: DD-MM-YYYY parse failed, trying dayfirst inference...")
        parsed = pd.to_datetime(df[date_col], dayfirst=True, errors="coerce")

    df = df.copy()
    df["date"] = parsed.dt.strftime("%Y-%m-%d")
    df = df[parsed.notna()].copy()
    if date_col != "date":
        df = df.drop(columns=[date_col])

    invalid = parsed.isna().sum()
    if invalid:
        print(f"  WARNING: {invalid:,} rows had unparseable dates and were dropped.")

    print(f"Valid rows after date parse: {len(df):,}  |  unique dates: {df['date'].nunique():,}")

    # ── 3. One row per date (keep earliest time = midnight snapshot) ──────────
    if "time" in df.columns:
        df["_t"] = pd.to_numeric(df["time"], errors="coerce").fillna(float("inf"))
        df = df.sort_values(["date", "_t"]).drop_duplicates(subset=["date"], keep="first")
        df = df.drop(columns=["_t", "time"])
        print(f"After dedup (one row per date): {len(df):,} rows")

    # ── 4. Rename conflicting 'planet' column (Hora ruler) if present ─────────
    if "planet" in df.columns:
        df = df.rename(columns={"planet": "hora_planet"})

    meta_cols = [c for c in ["tithi", "paksha", "lagna", "hora", "hora_planet", "panchak"] if c in df.columns]

    # ── 5. Melt: one row per (date, planet) ──────────────────────────────────
    # The query layer (astro-db.ts) expects columns: date, planet, sign, nakshatra, pada
    long_rows = []
    for planet in PLANETS:
        p = planet.lower()
        rashi_col     = f"{p}_rashi"
        nakshatra_col = f"{p}_nakshatra"
        pada_col      = f"{p}_pada"

        if rashi_col not in df.columns:
            print(f"  WARNING: no columns found for {planet} (expected '{rashi_col}')")
            continue

        row = {
            "date":      df["date"].values,
            "planet":    planet,
            "sign":      df[rashi_col].values,
            "nakshatra": df[nakshatra_col].values if nakshatra_col in df.columns else None,
            "pada":      df[pada_col].values      if pada_col      in df.columns else None,
        }
        for col in meta_cols:
            row[col] = df[col].values

        long_rows.append(pd.DataFrame(row))

    if not long_rows:
        print("ERROR: No planetary columns found. Expected 'moon_rashi', 'sun_rashi', etc.")
        sys.exit(1)

    result = pd.concat(long_rows, ignore_index=True)

    # ── 6. Clean text ─────────────────────────────────────────────────────────
    for col in ["planet", "sign", "nakshatra"]:
        if col in result.columns:
            result[col] = result[col].str.strip().str.title()
    for col in result.columns:
        if result[col].dtype == object:
            result[col] = result[col].str.strip()

    before = len(result)
    result = result[result["sign"].notna() & (result["sign"] != "")].copy()
    dropped = before - len(result)
    if dropped:
        print(f"  Dropped {dropped:,} rows with missing sign")

    print(f"\nFinal: {len(result):,} rows  ({result['planet'].nunique()} planets × {result['date'].nunique():,} dates)")
    print(f"Date range: {result['date'].min()} → {result['date'].max()}")
    return result


def save_to_sqlite(df: pd.DataFrame):
    DATA_DIR.mkdir(exist_ok=True)

    # Always rebuild from scratch
    if SQLITE_PATH.exists():
        SQLITE_PATH.unlink()
        print(f"\nRemoved old DB: {SQLITE_PATH}")

    print(f"Writing to {SQLITE_PATH} ...")
    conn = sqlite3.connect(SQLITE_PATH)
    df.to_sql(TABLE_NAME, conn, if_exists="replace", index=False, chunksize=10_000)

    cur = conn.cursor()
    for col in ["date", "planet", "sign", "nakshatra"]:
        if col in df.columns:
            cur.execute(f"CREATE INDEX IF NOT EXISTS idx_{col} ON {TABLE_NAME}({col})")
    cur.execute(f"CREATE INDEX IF NOT EXISTS idx_planet_date ON {TABLE_NAME}(planet, date)")
    cur.execute(f"CREATE INDEX IF NOT EXISTS idx_planet_sign ON {TABLE_NAME}(planet, sign)")
    conn.commit()
    conn.close()

    size_mb = SQLITE_PATH.stat().st_size / 1e6
    print(f"Saved: {SQLITE_PATH} ({size_mb:.1f} MB)")


def save_summary(df: pd.DataFrame):
    summary: dict = {
        "row_count":        len(df),
        "columns":          list(df.columns),
        "sqlite_path":      str(SQLITE_PATH),
        "table_name":       TABLE_NAME,
        "date_min":         str(df["date"].min()),
        "date_max":         str(df["date"].max()),
        "unique_dates":     int(df["date"].nunique()),
        "note_date_format": "Source CSVs use DD-MM-YYYY. Stored in DB as YYYY-MM-DD.",
        "note_schema":      "Long format: one row per (date x planet). Columns: date, planet, sign, nakshatra, pada + meta.",
    }
    for col in ["planet", "sign", "nakshatra"]:
        if col in df.columns:
            summary[f"unique_{col}s"] = sorted(df[col].dropna().unique().tolist())

    with open(SUMMARY_PATH, "w") as f:
        json.dump(summary, f, indent=2)

    print(f"\nSummary saved: {SUMMARY_PATH}")
    print(f"  Rows        : {summary['row_count']:,}")
    print(f"  Unique dates: {summary['unique_dates']:,}")
    print(f"  Date range  : {summary['date_min']} → {summary['date_max']}")
    if "unique_planets" in summary:
        print(f"  Planets     : {summary['unique_planets']}")


def main():
    df = load_raw_csvs()
    df = normalize_dataframe(df)
    save_to_sqlite(df)
    save_summary(df)
    print("\nDone.")


if __name__ == "__main__":
    main()
