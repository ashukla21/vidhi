import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getStock, saveNatalPlanets, NatalPlanet } from "@/lib/stock-db";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PROMPT = `You are parsing a Vedic birth chart (Janma Kundali) using Lahiri Ayanamsha.

Extract planetary positions for ALL planets visible. Look for:
Sun (Su), Moon (Mo), Mars (Ma), Mercury (Me), Jupiter (Ju), Venus (Ve), Saturn (Sa), Rahu (Ra), Ketu (Ke), and Ascendant/Lagna (As/Lg/Asc/Lagna).

For each planet extract:
- planet: full name (Sun, Moon, Mars, Mercury, Jupiter, Venus, Saturn, Rahu, Ketu, Ascendant)
- degrees: decimal degrees within the sign, e.g. 15°30' = 15.5 (null if not shown)
- rashi: English sign name (Aries, Taurus, Gemini, Cancer, Leo, Virgo, Libra, Scorpio, Sagittarius, Capricorn, Aquarius, Pisces)
- nakshatra: nakshatra name (null if not shown)
- nakshatra_pada: pada 1–4 (null if not shown)
- house: house number 1–12 where the Ascendant sign = house 1

Return ONLY valid JSON, no other text:
{
  "planets": [
    {"planet": "Sun", "degrees": 15.5, "rashi": "Scorpio", "nakshatra": "Jyeshtha", "nakshatra_pada": 2, "house": 2},
    {"planet": "Ascendant", "degrees": 10.2, "rashi": "Libra", "nakshatra": "Swati", "nakshatra_pada": 1, "house": 1},
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

    const bytes = await file.arrayBuffer();
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
    const parsed = extractJSON(rawText) as { planets: NatalPlanet[] };

    if (!Array.isArray(parsed?.planets) || parsed.planets.length === 0) {
      return Response.json({ error: "Claude could not find any planets in the image", raw: rawText }, { status: 422 });
    }

    saveNatalPlanets(upper, parsed.planets);

    return Response.json({
      success: true,
      ticker: upper,
      planets_saved: parsed.planets.length,
      planets: parsed.planets.map(p => `${p.planet} in ${p.rashi} (house ${p.house})`),
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
