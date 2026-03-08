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


def get_latest_date_in_db() -> str | None:
    """Return the most recent date already stored in the DB, or None if DB doesn't exist."""
    if not SQLITE_PATH.exists():
        return None
    try:
        conn = sqlite3.connect(SQLITE_PATH)
        row = conn.execute(f"SELECT MAX(date) FROM {TABLE_NAME}").fetchone()
        conn.close()
        return row[0] if row and row[0] else None
    except Exception:
        return None


def download(start_date: str | None = None) -> "pd.DataFrame":
    try:
        import yfinance as yf
    except ImportError:
        print("ERROR: yfinance not installed. Run: pip install yfinance")
        sys.exit(1)

    import pandas as pd

    if start_date:
        print(f"Downloading {SYMBOL} from {start_date} → today (incremental)...")
        ticker = yf.Ticker(SYMBOL)
        df = ticker.history(start=start_date, interval="1d", auto_adjust=True)
    else:
        print(f"Downloading {SYMBOL} full history from Yahoo Finance...")
        ticker = yf.Ticker(SYMBOL)
        df = ticker.history(period="max", interval="1d", auto_adjust=True)

    if df.empty:
        print("No new data returned from Yahoo Finance.")
        return pd.DataFrame()

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


def ensure_table(conn: sqlite3.Connection):
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
            date       TEXT PRIMARY KEY,
            open       REAL,
            high       REAL,
            low        REAL,
            close      REAL,
            volume     REAL,
            pct_change REAL
        )
    """)
    conn.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS idx_date ON {TABLE_NAME}(date)")
    conn.commit()


def save(df: "pd.DataFrame"):
    import pandas as pd

    DATA_DIR.mkdir(exist_ok=True)
    conn = sqlite3.connect(SQLITE_PATH)
    ensure_table(conn)

    # Upsert — preserve any rows already imported from the Numbers file
    records = df.to_dict(orient="records")
    conn.executemany(f"""
        INSERT INTO {TABLE_NAME} (date, open, high, low, close, volume, pct_change)
        VALUES (:date, :open, :high, :low, :close, :volume, :pct_change)
        ON CONFLICT(date) DO UPDATE SET
            open       = excluded.open,
            high       = excluded.high,
            low        = excluded.low,
            close      = excluded.close,
            volume     = excluded.volume,
            pct_change = excluded.pct_change
    """, records)
    conn.commit()

    total = conn.execute(f"SELECT COUNT(*) FROM {TABLE_NAME}").fetchone()[0]
    conn.close()

    size_kb = SQLITE_PATH.stat().st_size / 1_000
    print(f"Saved: {SQLITE_PATH} ({size_kb:.0f} KB)  |  Total rows in DB: {total:,}")


def main():
    latest = get_latest_date_in_db()
    if latest:
        print(f"Existing DB found. Latest date: {latest}")
        # Fetch from one day after the latest stored date
        import pandas as pd
        from datetime import date, timedelta
        next_day = (pd.to_datetime(latest) + timedelta(days=1)).strftime("%Y-%m-%d")
        df = download(start_date=next_day)
    else:
        df = download()

    if df.empty:
        print("DB is already up to date.")
        return

    save(df)
    print("Done.")


if __name__ == "__main__":
    main()
