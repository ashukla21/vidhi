#!/usr/bin/env python3
"""
Import Bitcoin historical data from a Numbers (.numbers) or CSV file into
data/btc_prices.sqlite.

Handles the Investing.com / Numbers export format:
  Date, Price, Open, High, Low, Vol., Change %

Usage:
  # From a Numbers file (requires: pip install numbers-parser):
  python3 scripts/import_btc_csv.py path/to/bitcoin_data.numbers

  # From a CSV exported from Numbers (File > Export To > CSV):
  python3 scripts/import_btc_csv.py path/to/bitcoin_data.csv

Rows are upserted — existing dates are updated, new dates are inserted.
Run scripts/download_btc_data.py afterwards to fill in any post-2024 gaps
from Yahoo Finance.
"""

import re
import sqlite3
import sys
from pathlib import Path

DATA_DIR    = Path(__file__).parent.parent / "data"
SQLITE_PATH = DATA_DIR / "btc_prices.sqlite"
TABLE_NAME  = "btc_prices"


# ── Parsing helpers ────────────────────────────────────────────────────────────

def parse_number(val: str) -> float | None:
    """Strip commas/spaces and convert to float. Returns None for empty."""
    v = str(val).strip().replace(",", "").replace(" ", "")
    if v in ("", "-", "N/A", "null", "None"):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def parse_volume(val: str) -> float | None:
    """Handle K / M / B suffixes  e.g. '65.59K' → 65590.0"""
    v = str(val).strip().replace(",", "")
    if v in ("", "-", "N/A"):
        return None
    multipliers = {"K": 1_000, "M": 1_000_000, "B": 1_000_000_000}
    suffix = v[-1].upper()
    if suffix in multipliers:
        try:
            return float(v[:-1]) * multipliers[suffix]
        except ValueError:
            return None
    return parse_number(v)


def parse_pct(val: str) -> float | None:
    """'4.96%' → 4.96"""
    v = str(val).strip().replace("%", "").replace(",", "")
    if v in ("", "-", "N/A"):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def parse_date(val: str) -> str | None:
    """
    Accepts multiple date formats and normalises to YYYY-MM-DD.
      03/24/2024  →  2024-03-24
      2024-03-24  →  2024-03-24  (already correct)
      Mar 24, 2024 → 2024-03-24
    """
    v = str(val).strip()
    # MM/DD/YYYY
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", v)
    if m:
        return f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    # YYYY-MM-DD
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", v)
    if m:
        return v
    # Try pandas as a fallback for other formats
    try:
        import pandas as pd
        return pd.to_datetime(v).strftime("%Y-%m-%d")
    except Exception:
        return None


# ── File readers ───────────────────────────────────────────────────────────────

def read_csv(path: Path) -> list[dict]:
    import csv
    rows = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return rows


def read_numbers(path: Path) -> list[dict]:
    try:
        from numbers_parser import Document
    except ImportError:
        print("numbers-parser not found — installing automatically…")
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "numbers-parser", "-q"])
        from numbers_parser import Document

    doc = Document(str(path))
    # Use the first sheet / first table
    sheet = doc.sheets[0]
    table = sheet.tables[0]

    rows_data = list(table.iter_rows())
    if not rows_data:
        print("ERROR: Numbers file appears to be empty.")
        sys.exit(1)

    # First row = headers
    headers = [str(cell.value).strip() if cell.value is not None else "" for cell in rows_data[0]]
    print(f"Detected columns: {headers}")

    rows = []
    for row in rows_data[1:]:
        d = {}
        for i, cell in enumerate(row):
            if i < len(headers):
                d[headers[i]] = str(cell.value) if cell.value is not None else ""
        rows.append(d)
    return rows


# ── Column mapping ─────────────────────────────────────────────────────────────

# Maps known header names (lowercase, stripped) → our internal key
COLUMN_MAP = {
    "date":      "date",
    "price":     "close",   # "Price" in Investing.com export = closing price
    "close":     "close",
    "open":      "open",
    "high":      "high",
    "low":       "low",
    "vol.":      "volume",
    "vol":       "volume",
    "volume":    "volume",
    "change %":  "pct_change",
    "change%":   "pct_change",
    "chg%":      "pct_change",
    "% change":  "pct_change",
}


def normalise_row(raw: dict) -> dict | None:
    """Map raw CSV/Numbers row → our schema dict. Returns None to skip row."""
    mapped = {}
    for raw_key, value in raw.items():
        key = COLUMN_MAP.get(raw_key.strip().lower())
        if key:
            mapped[key] = value

    date = parse_date(mapped.get("date", ""))
    if not date:
        return None  # skip header-repeat rows or blanks

    close     = parse_number(mapped.get("close", ""))
    open_     = parse_number(mapped.get("open", ""))
    high      = parse_number(mapped.get("high", ""))
    low       = parse_number(mapped.get("low", ""))
    volume    = parse_volume(mapped.get("volume", ""))
    pct_change = parse_pct(mapped.get("pct_change", ""))

    if close is None:
        return None  # can't use a row with no price

    return {
        "date":       date,
        "open":       open_,
        "high":       high,
        "low":        low,
        "close":      close,
        "volume":     volume,
        "pct_change": pct_change,
    }


# ── SQLite upsert ──────────────────────────────────────────────────────────────

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


def upsert_rows(conn: sqlite3.Connection, rows: list[dict]) -> int:
    sql = f"""
        INSERT INTO {TABLE_NAME} (date, open, high, low, close, volume, pct_change)
        VALUES (:date, :open, :high, :low, :close, :volume, :pct_change)
        ON CONFLICT(date) DO UPDATE SET
            open       = excluded.open,
            high       = excluded.high,
            low        = excluded.low,
            close      = excluded.close,
            volume     = excluded.volume,
            pct_change = excluded.pct_change
    """
    conn.executemany(sql, rows)
    conn.commit()
    return len(rows)


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/import_btc_csv.py <path/to/file.numbers|file.csv>")
        sys.exit(1)

    src = Path(sys.argv[1]).expanduser()
    if not src.exists():
        print(f"ERROR: File not found: {src}")
        sys.exit(1)

    print(f"Reading: {src}")
    suffix = src.suffix.lower()
    if suffix == ".numbers":
        raw_rows = read_numbers(src)
    elif suffix in (".csv", ".tsv", ".txt"):
        raw_rows = read_csv(src)
    else:
        print(f"ERROR: Unsupported file type '{suffix}'. Use .numbers or .csv")
        sys.exit(1)

    print(f"Read {len(raw_rows):,} raw rows")

    # Normalise
    good, skipped = [], 0
    for row in raw_rows:
        normed = normalise_row(row)
        if normed:
            good.append(normed)
        else:
            skipped += 1

    if not good:
        print("ERROR: No valid rows found. Check column names match expected format.")
        print(f"       Expected columns (case-insensitive): Date, Price, Open, High, Low, Vol., Change %")
        sys.exit(1)

    good.sort(key=lambda r: r["date"])
    print(f"Valid rows: {len(good):,}  |  Skipped: {skipped}")
    print(f"Date range: {good[0]['date']} → {good[-1]['date']}")

    # Write to SQLite
    DATA_DIR.mkdir(exist_ok=True)
    conn = sqlite3.connect(SQLITE_PATH)
    ensure_table(conn)
    upsert_rows(conn, good)
    conn.close()

    size_kb = SQLITE_PATH.stat().st_size / 1_000
    print(f"Saved to: {SQLITE_PATH} ({size_kb:.0f} KB)")
    print()
    print("Next step — fetch any missing post-2024 data from Yahoo Finance:")
    print("  python3 scripts/download_btc_data.py")


if __name__ == "__main__":
    main()
