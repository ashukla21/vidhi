#!/usr/bin/env python3
"""
Download historical Bitcoin (BTC-USD) price data via yfinance and store in SQLite.

BTC-USD data on Yahoo Finance goes back to 2014-09-17.

Usage:
  pip install yfinance
  python3 scripts/download_btc_data.py

Output:
  data/btc_prices.sqlite  — SQLite DB (table: btc_prices)
  Schema: date TEXT PRIMARY KEY, open REAL, high REAL, low REAL,
          close REAL, volume REAL, pct_change REAL
"""

import sqlite3
import sys
from pathlib import Path

DATA_DIR    = Path(__file__).parent.parent / "data"
SQLITE_PATH = DATA_DIR / "btc_prices.sqlite"
TABLE_NAME  = "btc_prices"
SYMBOL      = "BTC-USD"


def download() -> "pd.DataFrame":
    try:
        import yfinance as yf
    except ImportError:
        print("ERROR: yfinance not installed. Run: pip install yfinance")
        sys.exit(1)

    import pandas as pd

    print(f"Downloading {SYMBOL} history from Yahoo Finance...")
    ticker = yf.Ticker(SYMBOL)
    df = ticker.history(period="max", interval="1d", auto_adjust=True)

    if df.empty:
        print("ERROR: No data returned from Yahoo Finance.")
        sys.exit(1)

    # Normalize
    df = df.reset_index()
    df.columns = [c.lower().replace(" ", "_") for c in df.columns]

    # Date column — may be 'date' or 'datetime'
    date_col = next((c for c in df.columns if "date" in c), None)
    if date_col is None:
        print(f"ERROR: No date column found. Columns: {list(df.columns)}")
        sys.exit(1)

    df["date"] = pd.to_datetime(df[date_col]).dt.strftime("%Y-%m-%d")

    # Keep only the columns we need
    needed = ["date", "open", "high", "low", "close", "volume"]
    for col in ["open", "high", "low", "close", "volume"]:
        if col not in df.columns:
            print(f"WARNING: missing column '{col}'")
    df = df[[c for c in needed if c in df.columns]].copy()

    # Daily % change on close price
    df = df.sort_values("date").reset_index(drop=True)
    df["pct_change"] = df["close"].pct_change() * 100
    df["pct_change"] = df["pct_change"].round(4)

    # Drop any rows with no close price
    df = df[df["close"].notna()].copy()

    print(f"Downloaded {len(df):,} rows  |  {df['date'].min()} → {df['date'].max()}")
    return df


def save(df: "pd.DataFrame"):
    DATA_DIR.mkdir(exist_ok=True)

    if SQLITE_PATH.exists():
        SQLITE_PATH.unlink()
        print(f"Removed old DB: {SQLITE_PATH}")

    conn = sqlite3.connect(SQLITE_PATH)
    df.to_sql(TABLE_NAME, conn, if_exists="replace", index=False)

    cur = conn.cursor()
    cur.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS idx_date ON {TABLE_NAME}(date)")
    conn.commit()
    conn.close()

    size_kb = SQLITE_PATH.stat().st_size / 1_000
    print(f"Saved: {SQLITE_PATH} ({size_kb:.0f} KB)")


def main():
    df = download()
    save(df)
    print("Done.")


if __name__ == "__main__":
    main()
