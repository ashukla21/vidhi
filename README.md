# Vidhi — Vedic Investment AI

A full-stack AI system for investment analysis using Vedic astrology data (1990–2031), powered by Claude claude-sonnet-4-6.

## Features

- **AI Chat** — Claude claude-sonnet-4-6 with direct access to vedic planetary data via tool use
- **Saved Threads & Folders** — organize ongoing investment discussions (e.g., "Bitcoin Strategy")
- **Astro Data Tools** — Claude can query planetary positions, retrograde periods, sign transits, and run custom SQL
- **Portfolio Viewer** — IBKR Client Portal API integration (Phase 3)
- **Dark Purple UI** — RobinHood-inspired aesthetic

---

## Setup

> **Important:** This project uses **Prisma 7** (installed locally via npm). Always use
> `npm run db:migrate` / `npm run db:generate` instead of running `npx prisma` directly —
> `npx` may pick up a different global version and fail.

### 1. Install dependencies

```bash
npm install
# This also runs `prisma generate` automatically via the postinstall hook
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

### 3. Set up the app database

```bash
npm run db:migrate
# Equivalent to: ./node_modules/.bin/prisma migrate dev
```

### 4. Get the raw astro data (CSVs)

> **Skip this step if you already have `data/raw/` populated.**
> The folder should contain year subfolders (`1990/`, `1991/`, ... `2031/`) each
> with monthly CSV files (e.g. `1990_1.csv`, `1990_2.csv`, ...).
> If that structure is already present on your machine, go straight to Step 5.

Install `gdown` and download from Google Drive:

```bash
pip install gdown
python3 scripts/download_raw_data.py
```

This downloads the raw CSV dataset (~1990–2031) from Google Drive into `data/raw/`.
The script automatically skips if `data/raw/` already contains CSV files.

### 5. Build the astro SQLite database

```bash
pip install pandas pyarrow   # skip if already installed
python3 scripts/download_astro_data.py
```

Reads all CSVs from `data/raw/`, processes them into long format, and writes
`data/astro_planet_data.sqlite` (the file Claude queries at runtime).

### 6. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Quick-start summary

```
# First-time setup (no existing data)
npm install
cp .env.example .env          # add ANTHROPIC_API_KEY
npm run db:migrate
pip install gdown pandas pyarrow
python3 scripts/download_raw_data.py      # download CSVs from Drive
python3 scripts/download_astro_data.py   # build SQLite from CSVs
npm run dev

# If you already have data/raw/ with the year folders
npm install
cp .env.example .env          # add ANTHROPIC_API_KEY
npm run db:migrate
pip install pandas pyarrow
python3 scripts/download_astro_data.py   # build SQLite directly
npm run dev
```

---

## Project Structure

```
src/
  app/
    page.tsx              # Main shell (sidebar + chat)
    api/
      chat/route.ts       # Claude chat API with astro tool use
      threads/            # Thread CRUD
      folders/            # Folder CRUD
  components/
    layout/Sidebar.tsx    # Left sidebar with folders & threads
    chat/
      ChatWindow.tsx      # Chat messages + streaming
      ToolCallBadge.tsx   # Shows Claude data queries inline
  lib/
    prisma.ts             # Prisma client (SQLite via better-sqlite3)
    astro-db.ts           # Astro data queries
    utils.ts              # Utilities
  types/index.ts          # TypeScript types

scripts/
  download_raw_data.py    # Google Drive → data/raw/ (CSVs)
  download_astro_data.py  # data/raw/ CSVs → data/astro_planet_data.sqlite

data/
  raw/                      # (gitignored) Year subfolders with monthly CSVs
    1990/ … 2031/
  astro_planet_data.sqlite  # (gitignored) Built by download_astro_data.py
  astro_data_summary.json   # Dataset metadata

prisma/
  schema.prisma           # Folder / Thread / Message models
```

---

## Astrology Tools Available to Claude

| Tool | Description |
|---|---|
| `get_planetary_positions` | Positions for a date range + planet filter |
| `get_planet_in_sign` | All dates a planet was in a given sign |
| `get_retrograde_periods` | Retrograde windows for any planet |
| `get_planetary_transits` | Sign-change events (major turning points) |
| `run_custom_query` | Arbitrary SQL SELECT against the dataset |
| `get_data_summary` | Column names, date range, available planets |

## Example Questions

- "What does Jupiter in Taurus mean for Bitcoin in 2025?"
- "Show me every Saturn retrograde from 2010-2024"
- "What are the most auspicious windows to buy BTC in Q1 2026?"
- "Compare Rahu/Ketu axis shifts vs Bitcoin cycle tops/bottoms"
