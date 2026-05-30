import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getStock, saveNatalPlanets, NatalPlanet } from "@/lib/stock-db";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Targeted at the tabular planet-position view (Jagannatha Hora, Kala, Parashara's Light, AstroSage, etc.)
// This is more reliable than parsing degrees from the visual chart boxes.
const PROMPT = `You are reading a Vedic astrology planetary positions table (Lahiri Ayanamsha). This is a tabular data view — NOT a chart diagram — so degrees and signs are written explicitly as numbers and text.

Extract every row. For each planet or point listed:
- planet: standardise to one of: Sun, Moon, Mars, Mercury, Jupiter, Venus, Saturn, Rahu, Ketu, Ascendant
  (Lagna = Ascendant; MC/Midheaven = skip; other points = skip)
- degrees: decimal degrees WITHIN the sign (0–30). If shown as D°M'S" convert: degrees + minutes/60 + seconds/3600. Round to 2 decimal places.
- rashi: English zodiac sign name — exactly one of:
  Aries, Taurus, Gemini, Cancer, Leo, Virgo, Libra, Scorpio, Sagittarius, Capricorn, Aquarius, Pisces
  (Accept Sanskrit/abbreviated equivalents: Mes=Aries, Vri=Taurus, Mit=Gemini, Kar=Cancer, Sin=Leo, Kan=Virgo, Tul=Libra, Vri/Vsc=Scorpio, Dha=Sagittarius, Mak=Capricorn, Kum=Aquarius, Min=Pisces)
- nakshatra: nakshatra name exactly as shown (e.g. Ashwini, Bharani, Krittika, Rohini, Mrigashira, Ardra, Punarvasu, Pushya, Ashlesha, Magha, Purva Phalguni, Uttara Phalguni, Hasta, Chitra, Swati, Vishakha, Anuradha, Jyeshtha, Mula, Purva Ashadha, Uttara Ashadha, Shravana, Dhanishtha, Shatabhisha, Purva Bhadrapada, Uttara Bhadrapada, Revati)
- nakshatra_pada: pada 1–4 as integer (null if not shown)
- house: house number 1–12 as integer (null if not shown in this table)
- is_retrograde: true if marked R, Rx, (R), or retrograde — otherwise false

Return ONLY valid JSON, no other text:
{
  "planets": [
    {"planet": "Sun",       "degrees": 25.30, "rashi": "Scorpio",  "nakshatra": "Jyeshtha",  "nakshatra_pada": 2, "house": 2,  "is_retrograde": false},
    {"planet": "Moon",      "degrees":  8.14, "rashi": "Taurus",   "nakshatra": "Krittika",  "nakshatra_pada": 3, "house": 8,  "is_retrograde": false},
    {"planet": "Ascendant", "degrees": 10.22, "rashi": "Libra",    "nakshatra": "Swati",     "nakshatra_pada": 1, "house": 1,  "is_retrograde": false},
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
    const parsed  = extractJSON(rawText) as { planets: (NatalPlanet & { is_retrograde?: boolean })[] };

    if (!Array.isArray(parsed?.planets) || parsed.planets.length === 0) {
      return Response.json(
        { error: "Claude could not find any planetary positions in the image. Make sure this is the tabular position view, not the chart diagram.", raw: rawText },
        { status: 422 }
      );
    }

    // Strip is_retrograde before saving (not in the DB schema yet — kept for display)
    const forDb: NatalPlanet[] = parsed.planets.map(({ is_retrograde: _r, ...rest }) => rest);
    saveNatalPlanets(upper, forDb);

    return Response.json({
      success: true,
      ticker: upper,
      planets_saved: parsed.planets.length,
      planets: parsed.planets.map(p =>
        `${p.planet}${(p as { is_retrograde?: boolean }).is_retrograde ? "(R)" : ""} ${p.degrees}° ${p.rashi} — ${p.nakshatra}${p.nakshatra_pada ? ` pada ${p.nakshatra_pada}` : ""}`
      ),
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
