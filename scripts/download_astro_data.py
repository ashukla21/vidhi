#!/usr/bin/env python3
"""
Build the astro SQLite database from local CSV files.

Place your CSV files in data/raw/ (any folder depth), then run:
  python3 scripts/download_astro_data.py

The CSVs must be in the wide format produced by vedastro:
  Date | Time | Tithi | Paksha | Hora | Panchak | Lagna |
  Moon Rashi | Moon Nakshatra | Moon Pada |
  Sun Rashi  | Sun Nakshatra  | Sun Pada  | ... (one group per planet)

Output:
  data/astro_planet_data.sqlite  — SQLite DB (table: astro_planet_data)
  data/astro_data_summary.json   — stats summary
"""

import json
import sys
import sqlite3
import pandas as pd
from pathlib import Path

DATA_DIR   = Path(__file__).parent.parent / "data"
RAW_DIR    = DATA_DIR / "raw"
SQLITE_PATH = DATA_DIR / "astro_planet_data.sqlite"
SUMMARY_PATH = DATA_DIR / "astro_data_summary.json"
TABLE_NAME  = "astro_planet_data"

PLANETS = ["Moon", "Sun", "Mars", "Mercury", "Jupiter", "Venus", "Saturn", "Rahu", "Ketu"]


def load_raw_csvs() -> pd.DataFrame:
    """Read all CSVs from data/raw/ (recursively)."""
    csv_files = sorted(RAW_DIR.rglob("*.csv"))

    if not csv_files:
        print(f"ERROR: No CSV files found in {RAW_DIR}")
        print(f"  Create the folder and drop your CSV files there:")
        print(f"    mkdir -p {RAW_DIR}")
        print(f"    cp /path/to/your/csvs/*.csv {RAW_DIR}/")
        sys.exit(1)

    print(f"Found {len(csv_files)} CSV file(s) in {RAW_DIR}:")
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
    Wide-format, minute-by-minute → long-format, one row per (date, planet).
    """
    # ── 1. Normalize column names ─────────────────────────────────────────────
    df.columns = [c.lower().strip().replace(" ", "_") for c in df.columns]
    print(f"\nColumns found: {list(df.columns)}")

    # ── 2. Parse dates ────────────────────────────────────────────────────────
    date_col = next(
        (c for c in df.columns if c == "date" or c.endswith("_date")),
        next((c for c in df.columns if "date" in c), None),
    )
    if date_col is None:
        print("ERROR: No date column found.")
        sys.exit(1)

    # Source format: M/D/YY  e.g. "1/1/90" = Jan 1 1990
    parsed = pd.to_datetime(df[date_col], format="%m/%d/%y", errors="coerce")
    if parsed.isna().all():
        parsed = pd.to_datetime(df[date_col], errors="coerce")

    df["date"] = parsed.dt.strftime("%Y-%m-%d")
    df = df[parsed.notna()].copy()
    if date_col != "date":
        df = df.drop(columns=[date_col])

    print(f"Valid rows after date parse: {len(df):,}  |  unique dates: {df['date'].nunique():,}")

    # ── 3. One row per date (keep earliest time = midnight snapshot) ──────────
    if "time" in df.columns:
        df["_t"] = pd.to_numeric(df["time"], errors="coerce").fillna(float("inf"))
        df = df.sort_values(["date", "_t"]).drop_duplicates(subset=["date"], keep="first")
        df = df.drop(columns=["_t", "time"])
        print(f"After dedup (one row per date): {len(df):,} rows")

    # ── 4. Rename conflicting 'planet' column (Hora ruler) ───────────────────
    if "planet" in df.columns:
        df = df.rename(columns={"planet": "hora_planet"})

    meta_cols = [c for c in ["tithi", "paksha", "lagna", "hora", "hora_planet", "panchak"] if c in df.columns]

    # ── 5. Melt: one row per (date, planet) ──────────────────────────────────
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
    return result


def save_to_sqlite(df: pd.DataFrame):
    DATA_DIR.mkdir(exist_ok=True)
    print(f"\nWriting to {SQLITE_PATH} ...")
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
        "row_count":   len(df),
        "columns":     list(df.columns),
        "sqlite_path": str(SQLITE_PATH),
        "table_name":  TABLE_NAME,
        "date_min":    str(df["date"].min()),
        "date_max":    str(df["date"].max()),
        "unique_dates": int(df["date"].nunique()),
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
    if SQLITE_PATH.exists():
        print(f"SQLite DB already exists: {SQLITE_PATH}")
        print("Delete it and re-run to rebuild.")
        return

    df = load_raw_csvs()
    df = normalize_dataframe(df)
    save_to_sqlite(df)
    save_summary(df)
    print("\nDone.")


if __name__ == "__main__":
    main()
