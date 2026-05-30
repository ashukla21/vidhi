import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getStock, saveNavamshaPlants, NatalPlanet } from "@/lib/stock-db";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PROMPT = `You are reading a Vedic astrology Navamsha (D9) planetary positions TABLE using Lahiri Ayanamsha.
This is a DATA TABLE — columns contain explicit text values for degrees, sign, nakshatra etc.
Read each cell value EXACTLY as printed. Do not calculate or estimate — copy the numbers you see.

STEP 1 — Identify every planet row. Standardise the planet name to one of:
  Sun, Moon, Mars, Mercury, Jupiter, Venus, Saturn, Rahu, Ketu, Ascendant
  (Lagna / Asc / Lg = Ascendant. Skip any other points like MC, Vertex, etc.)

STEP 2 — For each planet read these fields directly from the table cells:

degrees (CRITICAL — read exactly what is printed):
  • If the column shows D°M'S" format (e.g. "25°18'43"") → convert to decimal: D + M/60 + S/3600, round to 2 dp → 25.31
  • If the column shows "25:18:43" or "25-18-43" format → same conversion
  • If the column already shows a decimal like "25.31" → use it as-is
  • This is degrees WITHIN the Navamsha sign (always 0.00–29.99)
  • DO NOT confuse with the absolute longitude (0–360); use only the within-sign portion

rashi — read the Navamsha sign column directly. Map to English if needed:
  Ari/Mes=Aries  Tau/Vri=Taurus  Gem/Mit=Gemini  Can/Kar=Cancer
  Leo/Sin=Leo    Vir/Kan=Virgo   Lib/Tul=Libra   Sco/Vri/Vsc=Scorpio
  Sag/Dha=Sagittarius  Cap/Mak=Capricorn  Aqu/Kum=Aquarius  Pis/Min=Pisces

nakshatra — copy the nakshatra name from the table cell exactly (full name preferred):
  Ashwini, Bharani, Krittika, Rohini, Mrigashira, Ardra, Punarvasu, Pushya, Ashlesha,
  Magha, Purva Phalguni, Uttara Phalguni, Hasta, Chitra, Swati, Vishakha, Anuradha,
  Jyeshtha, Mula, Purva Ashadha, Uttara Ashadha, Shravana, Dhanishtha, Shatabhisha,
  Purva Bhadrapada, Uttara Bhadrapada, Revati

nakshatra_pada — integer 1–4 from the pada/quarter column (null if absent)
house — integer 1–12 from the Navamsha house column (null if absent)
is_retrograde — true if the row shows R, Rx, (R), or "Retro"; false otherwise
is_combust — true if the row shows C, (C), or "Combust"; false otherwise
  (Sun and Moon are never combust; Rahu and Ketu are never retrograde)

STEP 3 — Return ONLY this JSON (no markdown, no explanation):
{
  "planets": [
    {"planet": "Sun",       "degrees": 12.44, "rashi": "Aries",     "nakshatra": "Ashwini",   "nakshatra_pada": 3, "house": 1, "is_retrograde": false, "is_combust": false},
    {"planet": "Moon",      "degrees": 22.10, "rashi": "Scorpio",   "nakshatra": "Jyeshtha",  "nakshatra_pada": 1, "house": 8, "is_retrograde": false, "is_combust": false},
    {"planet": "Ascendant", "degrees":  5.30, "rashi": "Sagittarius","nakshatra": "Mula",     "nakshatra_pada": 1, "house": 1, "is_retrograde": false, "is_combust": false},
    {"planet": "Saturn",    "degrees": 18.05, "rashi": "Libra",     "nakshatra": "Swati",     "nakshatra_pada": 3, "house": 11, "is_retrograde": true,  "is_combust": false},
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
      max_tokens: 2048,
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
        { error: "Claude could not find any Navamsha positions in the image. Make sure this is the tabular D9 position view.", raw: rawText },
        { status: 422 }
      );
    }

    const planets: NatalPlanet[] = parsed.planets.map(p => ({
      ...p,
      is_retrograde: Boolean(p.is_retrograde),
      is_combust:    Boolean(p.is_combust),
    }));
    saveNavamshaPlants(upper, planets);

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
