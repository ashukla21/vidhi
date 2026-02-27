# Vidhi — Vedic Investment AI

A full-stack AI system for investment analysis using Vedic astrology data (1990–2031), powered by Claude claude-sonnet-4-6.

## Features

- **AI Chat** — Claude claude-sonnet-4-6 with direct access to vedic planetary data via tool use
- **Saved Threads & Folders** — organize ongoing investment discussions (e.g., "Bitcoin Strategy")
- **Astro Data Tools** — Claude can query planetary positions, retrograde periods, sign transits, and run custom SQL
- **Portfolio Viewer** — IBKR Client Portal API integration (Phase 3)
- **Dark Purple UI** — RobinHood-inspired aesthetic

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

### 3. Set up the database

```bash
npm run db:migrate
# Equivalent to: ./node_modules/.bin/prisma migrate dev
```

### 4. Download the astro dataset

```bash
pip install huggingface_hub pandas pyarrow
python3 scripts/download_astro_data.py
```

Downloads `vedastro-org/Astro_Planet_Data` from HuggingFace into `data/astro_planet_data.sqlite`.

### 5. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

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
  download_astro_data.py  # HuggingFace -> SQLite pipeline

data/
  astro_planet_data.sqlite  # (gitignored, run script above)
  astro_data_summary.json   # Dataset metadata

prisma/
  schema.prisma           # Folder / Thread / Message models
```

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
