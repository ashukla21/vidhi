#!/usr/bin/env python3
"""
Download the vedastro-org/Astro_Planet_Data dataset from HuggingFace
and store it in a local SQLite database for fast querying via better-sqlite3.

The source CSVs are in wide format (one row per minute, all planets as column
groups: "Mercury Rashi", "Mercury Nakshatra", "Mercury Pada", etc.).

This script:
  1. Downloads all CSVs from HuggingFace
  2. Keeps only the first row per calendar date (planetary positions don't
     change sign/nakshatra within minutes; minute-level data is noise)
  3. Melts wide → long format: one row per (date, planet) with columns
     date, planet, sign, nakshatra, pada, tithi, paksha, lagna

Usage:
  python3 scripts/download_astro_data.py

Output:
  data/astro_planet_data.sqlite  — SQLite database (table: astro_planet_data)
  data/astro_data_summary.json   — date range, row count, unique planets/signs
"""

import json
import sys
import glob
import sqlite3
import pandas as pd
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"
SQLITE_PATH = DATA_DIR / "astro_planet_data.sqlite"
SUMMARY_PATH = DATA_DIR / "astro_data_summary.json"

DATASET_NAME = "vedastro-org/Astro_Planet_Data"
TABLE_NAME = "astro_planet_data"

# Planets in the dataset, matching the column prefix (e.g. "Moon Rashi")
PLANETS = ["Moon", "Sun", "Mars", "Mercury", "Jupiter", "Venus", "Saturn", "Rahu", "Ketu"]


def download_raw_csvs() -> pd.DataFrame:
    """
    Download all CSV files from the HuggingFace dataset repo directly,
    bypassing the datasets library's type-casting step that fails when
    columns declared as 'double' contain time strings like '22:39'.
    """
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        print("ERROR: 'huggingface_hub' not found. Run: pip install huggingface-hub")
        sys.exit(1)

    print(f"Downloading raw files from {DATASET_NAME}...")
    print("(This may take a few minutes — ~500 CSV files, ~300 MB)")

    local_dir = snapshot_download(
        repo_id=DATASET_NAME,
        repo_type="dataset",
        ignore_patterns=["*.arrow", "*.parquet", "*.json", "*.md", "*.py", "*.lock"],
    )
    print(f"Files downloaded to: {local_dir}")

    csv_files = sorted(glob.glob(f"{local_dir}/**/*.csv", recursive=True))
    if not csv_files:
        csv_files = sorted(glob.glob(f"{local_dir}/**/*", recursive=True))
        csv_files = [f for f in csv_files if Path(f).suffix.lower() == ".csv"]

    if not csv_files:
        print(f"ERROR: No CSV files found in {local_dir}")
        print(f"Contents: {list(Path(local_dir).iterdir())[:20]}")
        sys.exit(1)

    print(f"Found {len(csv_files)} CSV files. Reading...")

    dfs = []
    errors = 0
    for i, csv_path in enumerate(csv_files):
        try:
            df = pd.read_csv(csv_path, dtype=str, on_bad_lines="skip")
            if not df.empty:
                dfs.append(df)
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"  Warning: skipping {Path(csv_path).name}: {e}")

        if (i + 1) % 50 == 0:
            print(f"  Read {i + 1}/{len(csv_files)} files...")

    if not dfs:
        print("ERROR: No data loaded from any CSV file.")
        sys.exit(1)

    print(f"Combining {len(dfs)} files ({errors} skipped due to errors)...")
    full_df = pd.concat(dfs, ignore_index=True)
    print(f"Total rows before processing: {len(full_df):,}")
    return full_df


def normalize_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """
    Transform the wide-format, minute-by-minute CSV data into a clean
    long-format table: one row per (date, planet).

    Source format (wide, per-minute):
      Date | Time | Tithi | Paksha | Hora | Panchak | Lagna |
      Moon Rashi | Moon Nakshatra | Moon Pada |
      Sun Rashi | Sun Nakshatra | Sun Pada | ... (repeat for each planet)

    Output format (long, per-day):
      date | planet | sign | nakshatra | pada | tithi | paksha | lagna
    """
    # ── 1. Normalize column names ────────────────────────────────────────────
    df.columns = [c.lower().strip().replace(" ", "_") for c in df.columns]
    print(f"Columns detected: {list(df.columns)}")

    # ── 2. Parse and normalize the date column ───────────────────────────────
    date_col = next(
        (c for c in df.columns if c == "date" or c.endswith("_date")),
        None,
    )
    if date_col is None:
        candidates = [c for c in df.columns if "date" in c]
        date_col = candidates[0] if candidates else None

    if date_col is None:
        print("ERROR: No date column found.")
        sys.exit(1)

    # Source dates are M/D/YY (e.g. "1/1/90" = Jan 1 1990)
    parsed = pd.to_datetime(df[date_col], format="%m/%d/%y", errors="coerce")
    if parsed.isna().all():
        # Fallback: let pandas infer the format
        parsed = pd.to_datetime(df[date_col], errors="coerce")

    df["date"] = parsed.dt.strftime("%Y-%m-%d")
    df = df[parsed.notna()].copy()
    if date_col != "date":
        df = df.drop(columns=[date_col])

    print(f"Valid date rows: {len(df):,}  |  unique dates: {df['date'].nunique():,}")

    # ── 3. Keep only the first row per date (time ≈ 0 / midnight) ───────────
    if "time" in df.columns:
        df["_time_num"] = pd.to_numeric(df["time"], errors="coerce").fillna(float("inf"))
        df = df.sort_values(["date", "_time_num"])
        df = df.drop_duplicates(subset=["date"], keep="first")
        df = df.drop(columns=["_time_num", "time"])
        print(f"After dedup to one row per date: {len(df):,} rows")

    # ── 4. Extract date-level metadata ───────────────────────────────────────
    # "planet" column in the source is the Hora ruler — rename to avoid clash
    if "planet" in df.columns:
        df = df.rename(columns={"planet": "hora_planet"})

    meta_cols = [c for c in ["tithi", "paksha", "lagna", "hora", "hora_planet", "panchak"] if c in df.columns]

    # ── 5. Melt planetary columns → long format ───────────────────────────────
    long_rows = []
    for planet in PLANETS:
        p = planet.lower()
        rashi_col     = f"{p}_rashi"
        nakshatra_col = f"{p}_nakshatra"
        pada_col      = f"{p}_pada"

        if rashi_col not in df.columns:
            print(f"  Warning: no columns found for {planet} (expected '{rashi_col}')")
            continue

        row_data: dict = {
            "date":      df["date"].values,
            "planet":    planet,
            "sign":      df[rashi_col].values,
            "nakshatra": df[nakshatra_col].values if nakshatra_col in df.columns else None,
            "pada":      df[pada_col].values      if pada_col      in df.columns else None,
        }
        for col in meta_cols:
            row_data[col] = df[col].values

        long_rows.append(pd.DataFrame(row_data))

    if not long_rows:
        print("ERROR: No planetary columns found. Expected columns like 'moon_rashi', 'sun_rashi', etc.")
        sys.exit(1)

    result = pd.concat(long_rows, ignore_index=True)

    # ── 6. Normalize text ─────────────────────────────────────────────────────
    for col in ["planet", "sign", "nakshatra"]:
        if col in result.columns:
            result[col] = result[col].str.strip().str.title()

    for col in result.columns:
        if result[col].dtype == object:
            result[col] = result[col].str.strip()

    # Drop rows with missing sign (should be rare)
    before = len(result)
    result = result[result["sign"].notna() & (result["sign"] != "")].copy()
    if len(result) < before:
        print(f"  Dropped {before - len(result):,} rows with missing sign")

    print(f"Final long-format rows: {len(result):,}  ({result['planet'].nunique()} planets × {result['date'].nunique():,} dates)")
    return result


def save_to_sqlite(df: pd.DataFrame):
    DATA_DIR.mkdir(exist_ok=True)

    print(f"\nWriting {len(df):,} rows to SQLite at {SQLITE_PATH}...")
    conn = sqlite3.connect(SQLITE_PATH)

    df.to_sql(TABLE_NAME, conn, if_exists="replace", index=False, chunksize=10000)

    print("Creating indexes...")
    cursor = conn.cursor()
    for col in ["date", "planet", "sign", "nakshatra"]:
        if col in df.columns:
            cursor.execute(
                f"CREATE INDEX IF NOT EXISTS idx_{col} ON {TABLE_NAME}({col})"
            )

    cursor.execute(
        f"CREATE INDEX IF NOT EXISTS idx_planet_date ON {TABLE_NAME}(planet, date)"
    )
    cursor.execute(
        f"CREATE INDEX IF NOT EXISTS idx_planet_sign ON {TABLE_NAME}(planet, sign)"
    )

    conn.commit()
    conn.close()

    size_mb = SQLITE_PATH.stat().st_size / 1e6
    print(f"SQLite database saved: {SQLITE_PATH} ({size_mb:.1f} MB)")


def save_summary(df: pd.DataFrame):
    summary: dict = {
        "row_count":  len(df),
        "columns":    list(df.columns),
        "dtypes":     {col: str(dtype) for col, dtype in df.dtypes.items()},
        "sqlite_path": str(SQLITE_PATH),
        "table_name": TABLE_NAME,
    }

    valid_dates = df["date"].dropna()
    if not valid_dates.empty:
        summary["date_min"]    = str(valid_dates.min())
        summary["date_max"]    = str(valid_dates.max())
        summary["date_column"] = "date"

    for col in ["planet", "sign", "nakshatra"]:
        if col in df.columns:
            summary[f"unique_{col}s"] = sorted(
                [str(v) for v in df[col].dropna().unique().tolist()]
            )

    with open(SUMMARY_PATH, "w") as f:
        json.dump(summary, f, indent=2, default=str)

    print(f"\nSaved summary: {SUMMARY_PATH}")
    print(f"  Total rows  : {summary['row_count']:,}")
    print(f"  Columns     : {summary['columns']}")
    if "date_min" in summary:
        print(f"  Date range  : {summary['date_min']} -> {summary['date_max']}")
    if "unique_planets" in summary:
        print(f"  Planets     : {summary['unique_planets']}")
    if "unique_signs" in summary:
        print(f"  Signs       : {summary['unique_signs']}")
    if "unique_nakshatras" in summary:
        print(f"  Nakshatras  : {len(summary['unique_nakshatras'])} unique")


def main():
    if SQLITE_PATH.exists():
        size_mb = SQLITE_PATH.stat().st_size / 1e6
        print(f"SQLite database already exists: {SQLITE_PATH} ({size_mb:.1f} MB)")
        print("Delete it and re-run to re-download.")
        return

    df = download_raw_csvs()
    df = normalize_dataframe(df)
    save_to_sqlite(df)
    save_summary(df)
    print("\nDone! Data is ready for querying.")


if __name__ == "__main__":
    main()
