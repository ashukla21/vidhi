#!/usr/bin/env python3
"""
Build the astro SQLite database from local CSV files.

Place your CSV files in data/raw/ named as YYYY_M.csv  (e.g. 1990_1.csv = Jan 1990).
Then run:
  python3 scripts/download_astro_data.py

The CSVs are in wide format (one row per time slot):
  Date | Time | Tithi | Paksha | Hora | Panchak | Lagna |
  Moon Rashi | Moon Nakshatra | Moon Pada |
  Sun Rashi  | Sun Nakshatra  | Sun Pada  | ... (one group per planet)

Date column format: DD/MM/YYYY  (e.g. 01/01/1990)

Output:
  data/astro_planet_data.sqlite  — SQLite DB (table: astro_planet_data)
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
    Normalize column names and parse dates.
    Structure is kept as-is (wide format, one row per time slot).
    Date format in source CSVs: DD/MM/YYYY
    """
    # ── 1. Normalize column names ─────────────────────────────────────────────
    df.columns = [c.lower().strip().replace(" ", "_") for c in df.columns]
    print(f"\nColumns found: {list(df.columns)}")

    # ── 2. Parse dates (DD/MM/YYYY) ───────────────────────────────────────────
    date_col = next(
        (c for c in df.columns if c == "date" or c.endswith("_date")),
        next((c for c in df.columns if "date" in c), None),
    )
    if date_col is None:
        print("ERROR: No date column found.")
        sys.exit(1)

    # Source format: DD/MM/YYYY  e.g. "01/01/1990" = 1 Jan 1990
    parsed = pd.to_datetime(df[date_col], format="%d/%m/%Y", errors="coerce")
    if parsed.isna().all():
        print("WARNING: DD/MM/YYYY parse failed, trying automatic inference...")
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
    print(f"Date range: {df['date'].min()} → {df['date'].max()}")

    return df


def save_to_sqlite(df: pd.DataFrame):
    DATA_DIR.mkdir(exist_ok=True)

    # Always rebuild from scratch
    if SQLITE_PATH.exists():
        SQLITE_PATH.unlink()
        print(f"Removed old DB: {SQLITE_PATH}")

    print(f"\nWriting to {SQLITE_PATH} ...")
    conn = sqlite3.connect(SQLITE_PATH)
    df.to_sql(TABLE_NAME, conn, if_exists="replace", index=False, chunksize=10_000)

    cur = conn.cursor()
    cur.execute(f"CREATE INDEX IF NOT EXISTS idx_date   ON {TABLE_NAME}(date)")
    cur.execute(f"CREATE INDEX IF NOT EXISTS idx_time   ON {TABLE_NAME}(time)")
    conn.commit()
    conn.close()

    size_mb = SQLITE_PATH.stat().st_size / 1e6
    print(f"Saved: {SQLITE_PATH} ({size_mb:.1f} MB)")


def save_summary(df: pd.DataFrame):
    summary: dict = {
        "row_count":    len(df),
        "columns":      list(df.columns),
        "sqlite_path":  str(SQLITE_PATH),
        "table_name":   TABLE_NAME,
        "date_min":     str(df["date"].min()),
        "date_max":     str(df["date"].max()),
        "unique_dates": int(df["date"].nunique()),
        "note_date_format": "Source CSVs use DD/MM/YYYY. Stored in DB as YYYY-MM-DD.",
    }

    with open(SUMMARY_PATH, "w") as f:
        json.dump(summary, f, indent=2)

    print(f"\nSummary saved: {SUMMARY_PATH}")
    print(f"  Rows        : {summary['row_count']:,}")
    print(f"  Unique dates: {summary['unique_dates']:,}")
    print(f"  Date range  : {summary['date_min']} → {summary['date_max']}")
    print(f"  Columns     : {summary['columns']}")


def main():
    df = load_raw_csvs()
    df = normalize_dataframe(df)
    save_to_sqlite(df)
    save_summary(df)
    print("\nDone.")


if __name__ == "__main__":
    main()
