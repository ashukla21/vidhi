import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getStock, saveDashaPeriods, DashaPeriod } from "@/lib/stock-db";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PROMPT = `You are parsing a Vimshottari Dasha table from a Vedic astrology software screenshot. The system uses Vimshottari Dashas with Lahiri Ayanamsha.

Extract ALL dasha periods visible in this image. For each row:
- mahadasha_lord: Mahadasha planet name
- antardasha_lord: Antardasha/Bhukti planet name — null if this row represents only the Mahadasha level
- pratyantardasha_lord: Pratyantardasha/Sub-sub period planet — null if not at this level
- start_date: start date in YYYY-MM-DD format

Rules:
- Include rows at ALL hierarchy levels shown (Mahadasha, Antardasha, Pratyantardasha)
- Planet names must be exactly: Sun, Moon, Mars, Mercury, Jupiter, Venus, Saturn, Rahu, Ketu
- Sort all periods by start_date ascending
- The end date of each period equals the start date of the next period at the same level

Return ONLY valid JSON, no other text:
{
  "periods": [
    {"mahadasha_lord": "Saturn", "antardasha_lord": null, "pratyantardasha_lord": null, "start_date": "2019-12-28"},
    {"mahadasha_lord": "Saturn", "antardasha_lord": "Saturn", "pratyantardasha_lord": null, "start_date": "2019-12-28"},
    {"mahadasha_lord": "Saturn", "antardasha_lord": "Saturn", "pratyantardasha_lord": "Saturn", "start_date": "2019-12-28"},
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
    const parsed = extractJSON(rawText) as { periods: DashaPeriod[] };

    if (!Array.isArray(parsed?.periods) || parsed.periods.length === 0) {
      return Response.json({ error: "Claude could not find any dasha periods in the image", raw: rawText }, { status: 422 });
    }

    // Sort by start_date ascending before saving
    const periods = parsed.periods.sort((a, b) => a.start_date.localeCompare(b.start_date));
    saveDashaPeriods(upper, periods);

    const mdCount = periods.filter(p => !p.antardasha_lord).length;
    const adCount = periods.filter(p => p.antardasha_lord && !p.pratyantardasha_lord).length;
    const pdCount = periods.filter(p => p.pratyantardasha_lord).length;

    return Response.json({
      success: true,
      ticker: upper,
      saved: periods.length,
      breakdown: { mahadasha: mdCount, antardasha: adCount, pratyantardasha: pdCount },
      date_range: { from: periods[0]?.start_date, to: periods[periods.length - 1]?.start_date },
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
