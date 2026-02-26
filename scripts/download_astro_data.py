#!/usr/bin/env python3
"""
Download the vedastro-org/Astro_Planet_Data dataset from HuggingFace
and store it in a local SQLite database for fast querying via better-sqlite3.

Uses huggingface_hub to fetch raw CSV files directly, bypassing the datasets
library's strict schema validation (which fails on mixed-type columns like
time strings stored in numeric columns).

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
        # Fallback: grab everything
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
            # Read everything as strings first to avoid type inference failures
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
    print(f"Total rows before dedup: {len(full_df):,}")

    # Drop fully duplicate rows
    full_df = full_df.drop_duplicates()
    print(f"Total rows after dedup:  {len(full_df):,}")
    return full_df


def normalize_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """
    Normalize column names and clean up values.
    All columns arrive as strings; we selectively parse what we need.
    """
    # Normalize column names
    df.columns = [c.lower().strip().replace(" ", "_") for c in df.columns]
    print(f"Columns: {list(df.columns)}")

    # Parse date column to YYYY-MM-DD
    date_col = None
    for col in df.columns:
        if col == "date" or col.endswith("_date"):
            date_col = col
            break
    # Broader fallback
    if date_col is None:
        candidates = [c for c in df.columns if "date" in c]
        if candidates:
            date_col = candidates[0]

    if date_col:
        parsed = pd.to_datetime(df[date_col], errors="coerce")
        valid_mask = parsed.notna()
        if valid_mask.sum() > 0:
            df[date_col] = parsed.dt.strftime("%Y-%m-%d")
            df = df[valid_mask].copy()
            print(f"Parsed date column '{date_col}': {valid_mask.sum():,} valid rows")
        else:
            print(f"Warning: could not parse any dates from column '{date_col}'")

    # Normalize retrograde boolean
    for col in ["is_retrograde", "retrograde"]:
        if col in df.columns:
            df[col] = (
                df[col]
                .str.lower()
                .str.strip()
                .map({"true": "1", "false": "0", "1": "1", "0": "0",
                      "yes": "1", "no": "0", "r": "1", "": "0"})
                .fillna("0")
            )

    # Normalize planet/sign to title-case
    for col in ["planet", "sign"]:
        if col in df.columns:
            df[col] = df[col].str.strip().str.title()

    # Strip whitespace from all remaining string columns
    for col in df.columns:
        if df[col].dtype == object:
            df[col] = df[col].str.strip()

    return df


def save_to_sqlite(df: pd.DataFrame):
    DATA_DIR.mkdir(exist_ok=True)

    print(f"\nWriting {len(df):,} rows to SQLite at {SQLITE_PATH}...")
    conn = sqlite3.connect(SQLITE_PATH)

    df.to_sql(TABLE_NAME, conn, if_exists="replace", index=False, chunksize=10000)

    print("Creating indexes...")
    cursor = conn.cursor()
    for col in ["date", "planet", "sign"]:
        if col in df.columns:
            cursor.execute(
                f"CREATE INDEX IF NOT EXISTS idx_{col} ON {TABLE_NAME}({col})"
            )

    if "planet" in df.columns and "date" in df.columns:
        cursor.execute(
            f"CREATE INDEX IF NOT EXISTS idx_planet_date ON {TABLE_NAME}(planet, date)"
        )
    if "planet" in df.columns and "sign" in df.columns:
        cursor.execute(
            f"CREATE INDEX IF NOT EXISTS idx_planet_sign ON {TABLE_NAME}(planet, sign)"
        )

    conn.commit()
    conn.close()

    size_mb = SQLITE_PATH.stat().st_size / 1e6
    print(f"SQLite database saved: {SQLITE_PATH} ({size_mb:.1f} MB)")


def save_summary(df: pd.DataFrame):
    summary: dict = {
        "row_count": len(df),
        "columns": list(df.columns),
        "dtypes": {col: str(dtype) for col, dtype in df.dtypes.items()},
        "sqlite_path": str(SQLITE_PATH),
        "table_name": TABLE_NAME,
    }

    # Date range
    for col in df.columns:
        if "date" in col:
            valid = df[col].dropna()
            if not valid.empty:
                summary["date_min"] = str(valid.min())
                summary["date_max"] = str(valid.max())
                summary["date_column"] = col
                break

    # Unique values for key columns
    for col in ["planet", "sign", "house"]:
        if col in df.columns:
            unique_vals = sorted([str(v) for v in df[col].dropna().unique().tolist()])
            summary[f"unique_{col}s"] = unique_vals

    with open(SUMMARY_PATH, "w") as f:
        json.dump(summary, f, indent=2, default=str)

    print(f"Saved summary: {SUMMARY_PATH}")
    print("\nDataset summary:")
    print(f"  Total rows  : {summary['row_count']:,}")
    print(f"  Columns     : {summary['columns']}")
    if "date_min" in summary:
        print(f"  Date range  : {summary['date_min']} -> {summary['date_max']}")
    if "unique_planets" in summary:
        print(f"  Planets     : {summary['unique_planets']}")
    if "unique_signs" in summary:
        print(f"  Signs       : {summary['unique_signs']}")


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
