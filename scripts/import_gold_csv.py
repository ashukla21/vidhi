#!/usr/bin/env python3
"""
Import Gold price data from a CSV or Numbers file into
data/gold_prices.sqlite.

Handles common source formats:
  Investing.com:  Date, Price, Open, High, Low, Vol., Change %
  Yahoo Finance:  Date, Open, High, Low, Close, Adj Close, Volume
  Macrotrends:    date, open, high, low, close
  Quandl/NYMEX:   Date, Open, High, Low, Settle, Volume, Prev. Day Open Interest
  LBMA/WGC:       Date, USD (AM), USD (PM)  — London fix prices
  Simple:         Date, Price  (or Date, Close)

Multiple files covering different date ranges can be uploaded one at a time —
rows are upserted so existing dates are updated and new dates are inserted.

Usage:
  python3 scripts/import_gold_csv.py path/to/gold_data.csv
  python3 scripts/import_gold_csv.py path/to/gold_data.numbers
"""

import re
import sqlite3
import sys
from pathlib import Path

DATA_DIR    = Path(__file__).parent.parent / "data"
SQLITE_PATH = DATA_DIR / "gold_prices.sqlite"
TABLE_NAME  = "gold_prices"


# ── Parsing helpers ────────────────────────────────────────────────────────────

def parse_number(val: str) -> float | None:
    v = str(val).strip().replace(",", "").replace(" ", "").replace("$", "")
    if v in ("", "-", "N/A", "null", "None", "—", "nan"):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def parse_volume(val: str) -> float | None:
    v = str(val).strip().replace(",", "")
    if v in ("", "-", "N/A", "nan"):
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
    if v in ("", "-", "N/A", "nan"):
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
    # Mon DD, YYYY  e.g. "Jan 7, 1970"
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

# Maps lowercased, stripped header → internal key
COLUMN_MAP = {
    # Date
    "date":                          "date",
    "timestamp":                     "date",
    "time":                          "date",
    "datetime":                      "date",
    "week":                          "date",
    "day":                           "date",
    # Price / close (most common formats for gold)
    "price":                         "close",
    "close":                         "close",
    "close price":                   "close",
    "closing price":                 "close",
    "last":                          "close",
    "settlement":                    "close",
    "settle":                        "close",
    "spot price":                    "close",
    "gold price":                    "close",
    "gold spot price":               "close",
    "gold":                          "close",
    "gc price":                      "close",
    "xau price":                     "close",
    "xau":                           "close",
    "xau/usd":                       "close",
    "value":                         "close",
    "adj close":                     "close",
    "adjusted close":                "close",
    "last price":                    "close",
    "futures price":                 "close",
    "gold futures":                  "close",
    # LBMA London fix formats
    "usd (pm)":                      "close",
    "usd (am)":                      "open",   # AM fix → treat as open proxy
    "london pm fix":                 "close",
    "london am fix":                 "open",
    "pm fix":                        "close",
    "am fix":                        "open",
    "usd":                           "close",
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
    "prev. day open interest":       "volume",
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
        if raw_key is None:
            continue
        key = COLUMN_MAP.get(raw_key.strip().lower())
        if key and key not in mapped:  # first-match wins (PM fix before AM fix if both present)
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
    conn.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS idx_gold_date ON {TABLE_NAME}(date)")
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
        print("Usage: python3 scripts/import_gold_csv.py <path/to/file.csv|.numbers>")
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
        detected   = list(raw_rows[0].keys())
        recognised = [k for k in detected if k is not None and k.strip().lower() in COLUMN_MAP]
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
