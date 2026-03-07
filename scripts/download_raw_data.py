#!/usr/bin/env python3
"""
Download the raw Vedic astrology CSV dataset from Google Drive into data/raw/.

The Drive folder contains year subfolders (1990/, 1991/, ... 2031/),
each with monthly CSV files (e.g. 1990_1.csv, 1990_2.csv, ...).

Usage:
    pip install gdown
    python3 scripts/download_raw_data.py

If you already have data/raw/ populated with the year folders and CSV files,
you can skip this step entirely.
"""

import sys
import subprocess
from pathlib import Path

GDRIVE_FOLDER_ID = "1q2aNjsXiTUK4c3Dgf6HZZi21Ab1rxEs2"
RAW_DIR = Path(__file__).parent.parent / "data" / "raw"


def check_gdown():
    try:
        import gdown  # noqa: F401
    except ImportError:
        print("ERROR: gdown is not installed.")
        print("  Run: pip install gdown")
        sys.exit(1)


def already_populated():
    """Return True if data/raw/ already has at least one CSV file."""
    return RAW_DIR.exists() and any(RAW_DIR.rglob("*.csv"))


def download():
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    url = f"https://drive.google.com/drive/folders/{GDRIVE_FOLDER_ID}"
    print(f"Downloading raw data from Google Drive into {RAW_DIR} ...")
    print(f"  Source: {url}")
    print("  This may take a few minutes depending on your connection.\n")

    result = subprocess.run(
        [
            sys.executable, "-m", "gdown",
            "--folder",
            "--output", str(RAW_DIR),
            url,
        ],
        check=False,
    )

    if result.returncode != 0:
        print("\nERROR: gdown failed. Common fixes:")
        print("  1. Make sure the folder is shared as 'Anyone with the link can view'")
        print("  2. Try: pip install --upgrade gdown")
        print("  3. If rate-limited by Google, wait a few minutes and retry")
        sys.exit(1)

    csv_count = len(list(RAW_DIR.rglob("*.csv")))
    if csv_count == 0:
        print("\nERROR: Download completed but no CSV files were found in data/raw/")
        print("  Check that the Drive folder contains year subfolders with CSV files.")
        sys.exit(1)

    print(f"\nDownload complete. Found {csv_count} CSV files in {RAW_DIR}")
    print("Next step: python3 scripts/download_astro_data.py")


def main():
    check_gdown()

    if already_populated():
        csv_count = len(list(RAW_DIR.rglob("*.csv")))
        print(f"data/raw/ already contains {csv_count} CSV file(s). Skipping download.")
        print("If you want to re-download, delete data/raw/ and run this script again.")
        print("Next step: python3 scripts/download_astro_data.py")
        return

    download()


if __name__ == "__main__":
    main()
