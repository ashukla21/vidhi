#!/usr/bin/env python3
"""
Download the vedastro-org/Astro_Planet_Data dataset from HuggingFace
and store it in a local SQLite database for fast querying via better-sqlite3.

Usage:
  python3 scripts/download_astro_data.py

Output:
  data/astro_planet_data.sqlite  — SQLite database (table: astro_planet_data)
  data/astro_data_summary.json   — date range, row count, unique planets/signs
"""

import json
import sys
import sqlite3
import pandas as pd
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"
SQLITE_PATH = DATA_DIR / "astro_planet_data.sqlite"
SUMMARY_PATH = DATA_DIR / "astro_data_summary.json"

DATASET_NAME = "vedastro-org/Astro_Planet_Data"
TABLE_NAME = "astro_planet_data"


def download_dataset() -> pd.DataFrame:
    print(f"Downloading {DATASET_NAME} from HuggingFace...")
    try:
        from datasets import load_dataset
    except ImportError:
        print("ERROR: 'datasets' package not found. Run: pip install datasets")
        sys.exit(1)

    dataset = load_dataset(DATASET_NAME, trust_remote_code=True)
    print(f"Available splits: {list(dataset.keys())}")

    dfs = []
    for split_name, split_data in dataset.items():
        df = split_data.to_pandas()
        df["_split"] = split_name
        dfs.append(df)
        print(f"  Split '{split_name}': {len(df):,} rows, columns: {list(df.columns)}")

    full_df = pd.concat(dfs, ignore_index=True)
    print(f"Total rows: {len(full_df):,}")
    return full_df


def normalize_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize column names for consistent querying."""
    df.columns = [c.lower().strip().replace(" ", "_") for c in df.columns]

    # Parse date columns to YYYY-MM-DD strings
    for col in df.columns:
        if "date" in col or "time" in col:
            try:
                df[col] = pd.to_datetime(df[col], errors="coerce").dt.strftime("%Y-%m-%d")
            except Exception:
                pass

    # Normalize boolean retrograde column if present
    for col in ["is_retrograde", "retrograde"]:
        if col in df.columns:
            df[col] = (
                df[col]
                .astype(str)
                .str.lower()
                .map({"true": 1, "false": 0, "1": 1, "0": 0, "yes": 1, "no": 0})
                .fillna(0)
                .astype(int)
            )

    return df


def save_to_sqlite(df: pd.DataFrame):
    DATA_DIR.mkdir(exist_ok=True)

    print(f"\nWriting {len(df):,} rows to SQLite at {SQLITE_PATH}...")
    conn = sqlite3.connect(SQLITE_PATH)

    df.to_sql(TABLE_NAME, conn, if_exists="replace", index=False, chunksize=10000)

    # Create indexes for common query patterns
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


def main():
    if SQLITE_PATH.exists():
        size_mb = SQLITE_PATH.stat().st_size / 1e6
        print(f"SQLite database already exists: {SQLITE_PATH} ({size_mb:.1f} MB)")
        print("Delete it and re-run to re-download.")
        return

    df = download_dataset()
    df = normalize_dataframe(df)
    save_to_sqlite(df)
    save_summary(df)
    print("\nDone! Data is ready for querying.")


if __name__ == "__main__":
    main()
