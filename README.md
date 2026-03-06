# Vidhi — Vedic Investment AI

A full-stack AI system for investment analysis using Vedic astrology data (1990–2031), powered by Claude claude-sonnet-4-6.

## Features

- **AI Chat** — Claude claude-sonnet-4-6 with direct access to vedic planetary data via tool use
- **Saved Threads & Folders** — organize ongoing investment discussions (e.g., "Bitcoin Strategy")
- **Astro Data Tools** — Claude can query planetary positions, sign transits, and nakshatra data
- **Dark Purple UI** — RobinHood-inspired aesthetic

---

## Setup

> **Important:** Always use `npm run db:migrate` / `npm run db:generate` instead of `npx prisma` directly — `npx` may pick up a different global Prisma version and fail.

### 1. Install dependencies

```bash
npm install
npm run db:generate
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

### 3. Set up the app database

Creates `prisma/dev.db` — stores chat threads, folders, and messages.

```bash
npm run db:migrate
```

### 4. Get the raw astro data (CSVs)

> **Skip if you already have `data/raw/` populated** with year subfolders
> (`1990/`, `1991/`, ... `2031/`) each containing monthly CSV files
> (`1990_1.csv`, `1990_2.csv`, ...). Jump straight to Step 5.

```bash
pip install gdown
python3 scripts/download_raw_data.py
```

Downloads the raw CSV dataset (~1990–2031) from Google Drive into `data/raw/`.

### 5. Build the astro SQLite database

```bash
pip install pandas
python3 scripts/build_astro_sqlite.py
```

Reads all CSVs from `data/raw/`, processes them into `data/astro_planet_data.sqlite` — the file Claude queries at runtime. This step takes a few minutes (21M+ rows).

### 6. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Quick-start summary

```bash
# First-time setup (no existing data)
npm install
npm run db:generate
cp .env.example .env          # add ANTHROPIC_API_KEY
npm run db:migrate
pip install gdown pandas
python3 scripts/download_raw_data.py   # download CSVs from Drive (~few GB)
python3 scripts/build_astro_sqlite.py  # build SQLite from CSVs (~few min)
npm run dev

# If you already have data/raw/ with the year folders
npm install
npm run db:generate
cp .env.example .env          # add ANTHROPIC_API_KEY
npm run db:migrate
pip install pandas
python3 scripts/build_astro_sqlite.py  # build SQLite directly
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
  lib/
    prisma.ts             # Prisma client (SQLite via better-sqlite3)
    astro-db.ts           # Astro data queries (reads astro_planet_data.sqlite)
    utils.ts              # Utilities
  types/index.ts          # TypeScript types

scripts/
  download_raw_data.py    # Google Drive → data/raw/ (monthly CSVs)
  build_astro_sqlite.py   # data/raw/ CSVs → data/astro_planet_data.sqlite

data/
  raw/                        # (gitignored) Year subfolders with monthly CSVs
    1990/ … 2031/
  astro_planet_data.sqlite    # (gitignored) Built by build_astro_sqlite.py
  astro_data_summary.json     # Dataset stats (date range, planets, row count)

prisma/
  schema.prisma           # Folder / Thread / Message models
  dev.db                  # (gitignored) App database — created by db:migrate
```

---

## Astrology Tools Available to Claude

| Tool | Description |
|---|---|
| `get_planetary_positions` | Daily positions (sign, nakshatra, pada) for any planet and date range |
| `get_planet_in_sign` | All dates a planet was in a given zodiac sign |
| `get_planetary_transits` | Sign-change events (when planets move between signs) |

## Example Questions

- "What does Jupiter in Taurus mean for Bitcoin in 2025?"
- "Show me every Saturn sign change from 2010–2024"
- "What are the most auspicious windows to buy BTC in Q1 2026?"
- "Compare Rahu/Ketu axis shifts vs Bitcoin cycle tops/bottoms"
