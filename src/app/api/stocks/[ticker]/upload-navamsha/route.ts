import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getStock, saveNavamsha, NavamshaPlacement } from "@/lib/stock-db";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PROMPT = `You are parsing a Vedic Navamsha (D9) chart screenshot using Lahiri Ayanamsha.

Extract the Navamsha placement for each planet visible:
Sun, Moon, Mars, Mercury, Jupiter, Venus, Saturn, Rahu, Ketu, Ascendant (Lagna).

For each planet:
- planet: full name (Sun, Moon, Mars, Mercury, Jupiter, Venus, Saturn, Rahu, Ketu, Ascendant)
- rashi: English sign name in the Navamsha (Aries, Taurus, Gemini, Cancer, Leo, Virgo, Libra, Scorpio, Sagittarius, Capricorn, Aquarius, Pisces)
- house: house number 1–12 in the Navamsha chart

Return ONLY valid JSON, no other text:
{
  "navamsha_planets": [
    {"planet": "Sun", "rashi": "Scorpio", "house": 3},
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
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType(file.name), data: base64 } },
          { type: "text", text: PROMPT },
        ],
      }],
    });

    const rawText = response.content.find(b => b.type === "text")?.text ?? "";
    const parsed = extractJSON(rawText) as { navamsha_planets: NavamshaPlacement[] };

    if (!Array.isArray(parsed?.navamsha_planets) || parsed.navamsha_planets.length === 0) {
      return Response.json({ error: "Claude could not find any planets in the Navamsha image", raw: rawText }, { status: 422 });
    }

    saveNavamsha(upper, parsed.navamsha_planets);

    return Response.json({
      success: true,
      ticker: upper,
      planets_saved: parsed.navamsha_planets.length,
      planets: parsed.navamsha_planets.map(p => `${p.planet} in ${p.rashi} (H${p.house})`),
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
