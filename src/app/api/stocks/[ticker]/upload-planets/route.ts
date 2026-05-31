import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getStock, saveNatalPlanets, NatalPlanet } from "@/lib/stock-db";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PROMPT = `You are reading a Vedic astrology D1 (natal) planetary positions TABLE using Lahiri Ayanamsha.
Each ROW belongs to exactly one planet. Each COLUMN holds one field.

═══ ROW DISCIPLINE (CRITICAL) ═══
Process ONE ROW AT A TIME, top to bottom.
The planet name in the leftmost column is the ROW ANCHOR for that row.
Every field you output for that planet (degrees, sign, nakshatra, pada, RC) MUST come
from that planet's OWN horizontal row — never from the row above or below.
If a cell appears empty, output null for that field; do NOT copy a value from another row.

STEP 1 — Identify every planet row.

The table has one row per body. You MUST include Ascendant (also labelled Lagna / Asc / Asc. / Lg).
Standardise each name to exactly one of:
  Sun, Moon, Mars, Mercury, Jupiter, Venus, Saturn, Rahu, Ketu, Ascendant

Some software prefixes planet names with a Unicode astrological symbol (e.g. ♀ Venus, ♂ Mars, ☿ Mercury).
Output ONLY the plain text name — strip any leading/trailing symbols or whitespace before outputting.

Skip rows that are not one of these 10 bodies (e.g. MC, Vertex, Part of Fortune, column headers).

STEP 2 — For each planet read these fields from that planet's own row:

degrees:
  • D°M'S" or D:M:S or D-M-S format → decimal = D + M/60 + S/3600, round to 2 dp
  • Already decimal → use as-is
  • Always 0.00–29.99 (within-sign degrees only, NOT absolute longitude 0–360)

rashi — sign cell in that row. Map abbreviations:
  Ari/Mes=Aries   Tau/Vri=Taurus   Gem/Mit=Gemini   Can/Kar=Cancer
  Leo/Sin=Leo     Vir/Kan=Virgo    Lib/Tul=Libra    Sco/Vrc/Vsc=Scorpio
  Sag/Dha=Sagittarius  Cap/Mak=Capricorn  Aqu/Kum=Aquarius  Pis/Min=Pisces

nakshatra — copy the nakshatra name from that row's nakshatra cell (full name preferred):
  Ashwini, Bharani, Krittika, Rohini, Mrigashira, Ardra, Punarvasu, Pushya, Ashlesha,
  Magha, Purva Phalguni, Uttara Phalguni, Hasta, Chitra, Swati, Vishakha, Anuradha,
  Jyeshtha, Mula, Purva Ashadha, Uttara Ashadha, Shravana, Dhanishtha, Shatabhisha,
  Purva Bhadrapada, Uttara Bhadrapada, Revati

nakshatra_pada — integer 1–4 from that row's pada/quarter cell (null if absent)

RC STATUS — read ONLY the RC (or R/C or Status) column cell for this planet's row.
Do NOT read the column header; read only the data cell that sits in this planet's row.
Matching is CASE-INSENSITIVE (R, r, C, c are treated the same).
Check the cell for the presence of R and C independently, then apply all three rules:

  Does the cell contain the letter R (or Rx)? → is_retrograde = true, else false
  Does the cell contain the letter C?          → is_combust    = true, else false

  Examples:
    "R"  or "Rx"         → is_retrograde=true,  is_combust=false
    "C"                  → is_retrograde=false, is_combust=true
    "RC" or "Rc" or "rC" → is_retrograde=true,  is_combust=true
    blank, "-", "."      → is_retrograde=false, is_combust=false

ALWAYS output both is_retrograde and is_combust for every planet row.
Never omit either field. Use false (not null) when the status is not set.

  ⚠ "C" alone = COMBUST ONLY. "C" never sets is_retrograde.
  ⚠ "R" alone = RETROGRADE ONLY. "R" never sets is_combust.
  ⚠ The letter R inside a planet name (Rahu) or nakshatra (Rohini, Revati) is NOT retrograde.
  ⚠ Sun and Moon are never combust. Rahu and Ketu are never retrograde.

STEP 3 — Return ONLY valid JSON, no markdown fences, no explanation:
{
  "planets": [
    {"planet": "Sun",       "degrees": 25.31, "rashi": "Scorpio",    "nakshatra": "Jyeshtha",       "nakshatra_pada": 2, "is_retrograde": false, "is_combust": false},
    {"planet": "Moon",      "degrees":  8.24, "rashi": "Taurus",     "nakshatra": "Krittika",        "nakshatra_pada": 3, "is_retrograde": false, "is_combust": false},
    {"planet": "Ascendant", "degrees": 10.22, "rashi": "Libra",      "nakshatra": "Swati",           "nakshatra_pada": 1, "is_retrograde": false, "is_combust": false},
    {"planet": "Saturn",    "degrees": 14.07, "rashi": "Capricorn",  "nakshatra": "Shravana",        "nakshatra_pada": 2, "is_retrograde": true,  "is_combust": false},
    {"planet": "Mercury",   "degrees":  2.55, "rashi": "Scorpio",    "nakshatra": "Vishakha",        "nakshatra_pada": 4, "is_retrograde": false, "is_combust": true},
    {"planet": "Venus",     "degrees": 18.40, "rashi": "Sagittarius","nakshatra": "Purva Ashadha",   "nakshatra_pada": 1, "is_retrograde": false, "is_combust": false},
    {"planet": "Rahu",      "degrees":  5.12, "rashi": "Aries",      "nakshatra": "Ashwini",         "nakshatra_pada": 2, "is_retrograde": false, "is_combust": false},
    ...
  ]
}`;

function extractJSON(text: string): unknown {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  throw new Error("Could not extract valid JSON from Claude response");
}

function mediaType(filename: string): "image/jpeg" | "image/png" | "image/webp" | "image/gif" {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/png";
}

// Strip Unicode astrological glyphs (☉☽♂☿♃♀♄☊☋ and similar) from planet names
function cleanPlanetName(raw: string): string {
  return raw.replace(/[☀-⛿♀♂♃♄♅♆♇♈-♓]/gu, "").trim();
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    const upper = ticker.toUpperCase();

    if (!getStock(upper)) {
      return Response.json({ error: `Stock ${upper} not found. Create it first.` }, { status: 404 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return Response.json({ error: "No file provided" }, { status: 400 });

    const bytes  = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType(file.name), data: base64 } },
          { type: "text", text: PROMPT },
        ],
      }],
    });

    const rawText = response.content.find(b => b.type === "text")?.text ?? "";
    const parsed  = extractJSON(rawText) as { planets: NatalPlanet[] };

    if (!Array.isArray(parsed?.planets) || parsed.planets.length === 0) {
      return Response.json(
        { error: "Claude could not find any planetary positions in the image. Make sure this is the tabular position view, not the chart diagram.", raw: rawText },
        { status: 422 }
      );
    }

    const planets: NatalPlanet[] = parsed.planets.map(p => ({
      ...p,
      planet:        cleanPlanetName(String(p.planet)),
      house:         null,       // not extracted — table doesn't show house
      is_retrograde: p.is_retrograde === true,   // null/undefined/false → false
      is_combust:    p.is_combust === true,       // null/undefined/false → false
    }));
    saveNatalPlanets(upper, planets);

    return Response.json({
      success: true,
      ticker: upper,
      planets_saved: planets.length,
      planets: planets.map(p => {
        const flags = [p.is_retrograde ? "R" : "", p.is_combust ? "C" : ""].filter(Boolean).join(",");
        return `${p.planet}${flags ? `(${flags})` : ""} ${p.degrees}° ${p.rashi} — ${p.nakshatra}${p.nakshatra_pada ? ` pada ${p.nakshatra_pada}` : ""}`;
      }),
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
