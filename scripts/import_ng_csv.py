#!/usr/bin/env python3
"""
Import Natural Gas spot price data from a CSV or Numbers file into
data/ng_prices.sqlite.

Handles common source formats:
  EIA:          Date, Henry Hub Natural Gas Spot Price Dollars per Million Btu
  Investing.com: Date, Price, Open, High, Low, Vol., Change %
  Simple:       Date, Price  (or Date, Close)
  OHLCV:        Date, Open, High, Low, Close, Volume

Usage:
  python3 scripts/import_ng_csv.py path/to/ng_data.csv
  python3 scripts/import_ng_csv.py path/to/ng_data.numbers

Rows are upserted — existing dates are updated, new dates are inserted.
"""

import re
import sqlite3
import sys
from pathlib import Path

DATA_DIR    = Path(__file__).parent.parent / "data"
SQLITE_PATH = DATA_DIR / "ng_prices.sqlite"
TABLE_NAME  = "ng_prices"


# ── Parsing helpers ────────────────────────────────────────────────────────────

def parse_number(val: str) -> float | None:
    v = str(val).strip().replace(",", "").replace(" ", "").replace("$", "")
    if v in ("", "-", "N/A", "null", "None", "—"):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def parse_volume(val: str) -> float | None:
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
    v = str(val).strip().replace("%", "").replace(",", "")
    if v in ("", "-", "N/A"):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def parse_date(val: str) -> str | None:
    v = str(val).strip()
    # Unix timestamp (10 or 13 digits)
    m = re.match(r"^(\d{10})(\d{3})?$", v)
    if m:
        import datetime
        return datetime.datetime.utcfromtimestamp(int(m.group(1))).strftime("%Y-%m-%d")
    # MM/DD/YYYY
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", v)
    if m:
        return f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    # YYYY-MM-DD (optionally with time)
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", v)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    # Mon DD, YYYY  e.g. "Jan 7, 1997"
    m = re.match(r"^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$", v)
    if m:
        try:
            import datetime
            return datetime.datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}", "%b %d %Y").strftime("%Y-%m-%d")
        except ValueError:
            pass
    # Pandas fallback for anything else
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
        print("numbers-parser not found — installing…")
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "numbers-parser", "-q"])
        from numbers_parser import Document

    doc = Document(str(path))
    sheet = doc.sheets[0]
    table = sheet.tables[0]
    rows_data = list(table.iter_rows())
    if not rows_data:
        print("ERROR: Numbers file appears to be empty.")
        sys.exit(1)
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

# Maps lowercased header → internal key
# Natural Gas sources use many different column names for the same thing
COLUMN_MAP = {
    # Date
    "date":                          "date",
    "timestamp":                     "date",
    "time":                          "date",
    "datetime":                      "date",
    "week":                          "date",
    "day":                           "date",
    # Price / close (EIA uses long descriptive headers)
    "price":                         "close",
    "close":                         "close",
    "close price":                   "close",
    "closing price":                 "close",
    "last":                          "close",
    "settlement":                    "close",
    "settle":                        "close",
    "spot price":                    "close",
    "henry hub natural gas spot price dollars per million btu": "close",
    "henry hub natural gas spot price (dollars per million btu)": "close",
    "henry hub":                     "close",
    "ng spot":                       "close",
    "natural gas price":             "close",
    "ng price":                      "close",
    "value":                         "close",
    # Open
    "open":                          "open",
    "open price":                    "open",
    # High / Low
    "high":                          "high",
    "low":                           "low",
    # Volume
    "vol.":                          "volume",
    "vol":                           "volume",
    "volume":                        "volume",
    # % change
    "change %":                      "pct_change",
    "change%":                       "pct_change",
    "chg%":                          "pct_change",
    "% change":                      "pct_change",
    "change":                        "pct_change",
}


def normalise_row(raw: dict) -> dict | None:
    mapped = {}
    for raw_key, value in raw.items():
        key = COLUMN_MAP.get(raw_key.strip().lower())
        if key:
            mapped[key] = value

    date = parse_date(mapped.get("date", ""))
    if not date:
        return None

    close      = parse_number(mapped.get("close", ""))
    open_      = parse_number(mapped.get("open", ""))
    high       = parse_number(mapped.get("high", ""))
    low        = parse_number(mapped.get("low", ""))
    volume     = parse_volume(mapped.get("volume", ""))
    pct_change = parse_pct(mapped.get("pct_change", ""))

    if close is None:
        return None  # must have a price

    return {
        "date":       date,
        "open":       open_,
        "high":       high,
        "low":        low,
        "close":      close,
        "volume":     volume,
        "pct_change": pct_change,
    }


# ── SQLite ─────────────────────────────────────────────────────────────────────

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
    conn.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS idx_ng_date ON {TABLE_NAME}(date)")
    conn.commit()


def upsert_rows(conn: sqlite3.Connection, rows: list[dict]):
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
    """, rows)
    conn.commit()


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/import_ng_csv.py <path/to/file.csv|.numbers>")
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
        print(f"ERROR: Unsupported file type '{suffix}'. Use .csv or .numbers")
        sys.exit(1)

    print(f"Read {len(raw_rows):,} raw rows")

    if raw_rows:
        detected  = list(raw_rows[0].keys())
        recognised = [k for k in detected if k.strip().lower() in COLUMN_MAP]
        print(f"Detected columns:   {detected}")
        print(f"Recognised columns: {recognised}")

    good, skipped = [], 0
    for row in raw_rows:
        normed = normalise_row(row)
        if normed:
            good.append(normed)
        else:
            skipped += 1

    if not good:
        print("ERROR: No valid rows found.")
        print("       Expected a 'Date' column and at least one price column.")
        print(f"       Your columns: {list(raw_rows[0].keys()) if raw_rows else 'none'}")
        sys.exit(1)

    good.sort(key=lambda r: r["date"])
    print(f"Valid rows: {len(good):,}  |  Skipped: {skipped}")
    print(f"Date range: {good[0]['date']} → {good[-1]['date']}")

    DATA_DIR.mkdir(exist_ok=True)
    conn = sqlite3.connect(SQLITE_PATH)
    ensure_table(conn)
    upsert_rows(conn, good)

    total = conn.execute(f"SELECT COUNT(*) FROM {TABLE_NAME}").fetchone()[0]
    conn.close()

    size_kb = SQLITE_PATH.stat().st_size / 1_000
    print(f"Saved: {SQLITE_PATH} ({size_kb:.0f} KB)  |  Total rows in DB: {total:,}")


if __name__ == "__main__":
    main()
