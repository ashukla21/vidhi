import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getStock, saveNatalPlanets, NatalPlanet } from "@/lib/stock-db";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Targeted at the tabular planet-position view (Jagannatha Hora, Kala, Parashara's Light, AstroSage, etc.)
// More reliable than reading degrees off the visual chart boxes.
const PROMPT = `You are reading a Vedic astrology D1 (natal) planetary positions TABLE using Lahiri Ayanamsha.
This is a DATA TABLE — each ROW belongs to exactly one planet, each COLUMN holds one field.

═══ ROW DISCIPLINE (CRITICAL) ═══
Process the table ONE ROW AT A TIME.
The planet name in the leftmost column is the ROW ANCHOR.
Every value you record for a planet — degrees, sign, nakshatra, pada, house, RC flag —
MUST come from that planet's OWN horizontal row.
NEVER borrow a value from the row above or below, even if the current cell looks empty.

STEP 1 — Identify every planet row. Standardise the planet name to one of:
  Sun, Moon, Mars, Mercury, Jupiter, Venus, Saturn, Rahu, Ketu, Ascendant
  (Lagna / Asc / Lg = Ascendant. Skip any other points like MC, Vertex, etc.)

STEP 2 — For each planet, read these fields from that planet's own row:

degrees (read exactly what is printed in that row's degree cell):
  • D°M'S" format (e.g. "25°18'43"") → decimal: D + M/60 + S/3600, round to 2 dp → 25.31
  • "25:18:43" or "25-18-43" → same conversion
  • Already decimal "25.31" → use as-is
  • Always 0.00–29.99 (degrees within the sign, not absolute longitude 0–360)

rashi — sign column in that row. Map abbreviations to English:
  Ari/Mes=Aries  Tau/Vri=Taurus  Gem/Mit=Gemini  Can/Kar=Cancer
  Leo/Sin=Leo    Vir/Kan=Virgo   Lib/Tul=Libra   Sco/Vrc/Vsc=Scorpio
  Sag/Dha=Sagittarius  Cap/Mak=Capricorn  Aqu/Kum=Aquarius  Pis/Min=Pisces

nakshatra — copy nakshatra name from that row's nakshatra cell:
  Ashwini, Bharani, Krittika, Rohini, Mrigashira, Ardra, Punarvasu, Pushya, Ashlesha,
  Magha, Purva Phalguni, Uttara Phalguni, Hasta, Chitra, Swati, Vishakha, Anuradha,
  Jyeshtha, Mula, Purva Ashadha, Uttara Ashadha, Shravana, Dhanishtha, Shatabhisha,
  Purva Bhadrapada, Uttara Bhadrapada, Revati

nakshatra_pada — integer 1–4 from the pada/quarter column in that row (null if absent)
house — integer 1–12 from the house column in that row (null if absent)

is_retrograde / is_combust — read ONLY from the RC (or R/C) status column in that row:
  • RC column shows "R" or "Rx" or "(R)" → is_retrograde: true, is_combust: false
  • RC column shows "C" or "(C)"          → is_combust: true,    is_retrograde: false
  • RC column shows "RC" or "R,C"         → both true
  • RC column is blank or absent          → both false
  IMPORTANT: "R" appearing in a planet name (Rahu) or nakshatra name (Rohini, Revati)
  does NOT indicate retrograde — only count R/C in the dedicated RC/status column.
  Sun and Moon are never combust; Rahu and Ketu are never retrograde.

STEP 3 — Return ONLY this JSON (no markdown, no explanation):
{
  "planets": [
    {"planet": "Sun",       "degrees": 25.31, "rashi": "Scorpio",   "nakshatra": "Jyeshtha",  "nakshatra_pada": 2, "house": 2, "is_retrograde": false, "is_combust": false},
    {"planet": "Moon",      "degrees":  8.24, "rashi": "Taurus",    "nakshatra": "Krittika",  "nakshatra_pada": 3, "house": 8, "is_retrograde": false, "is_combust": false},
    {"planet": "Ascendant", "degrees": 10.22, "rashi": "Libra",     "nakshatra": "Swati",     "nakshatra_pada": 1, "house": 1, "is_retrograde": false, "is_combust": false},
    {"planet": "Saturn",    "degrees": 14.07, "rashi": "Capricorn", "nakshatra": "Shravana",  "nakshatra_pada": 2, "house": 4, "is_retrograde": true,  "is_combust": false},
    {"planet": "Mercury",   "degrees":  2.55, "rashi": "Scorpio",   "nakshatra": "Vishakha",  "nakshatra_pada": 4, "house": 2, "is_retrograde": false, "is_combust": true},
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

    // Ensure boolean fields default to false if absent
    const planets: NatalPlanet[] = parsed.planets.map(p => ({
      ...p,
      is_retrograde: Boolean(p.is_retrograde),
      is_combust:    Boolean(p.is_combust),
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
