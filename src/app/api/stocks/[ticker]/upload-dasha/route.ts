import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getStock, saveDashaPeriods, DashaPeriod } from "@/lib/stock-db";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PROMPT = `You are parsing a Vimshottari Dasha table from a Vedic astrology software screenshot (Lahiri Ayanamsha).

CRITICAL RULES — read carefully before extracting:

1. HIERARCHY: Every Mahadasha has Antardashas inside it; every Antardasha may have Pratyantar Dashas inside it.
   The Mahadasha lord is the OUTER period. The Antardasha lord is the INNER period. Never swap them.
   Example: "Jupiter/Rahu" means Jupiter = Mahadasha, Rahu = Antardasha.

2. ALWAYS emit a Mahadasha-level row (antardasha_lord=null, pratyantardasha_lord=null) for EVERY Mahadasha that appears.
   Use the date shown on the Mahadasha header line. If no separate header date is shown, use the start date of its first Antardasha.

3. For each row output:
   - mahadasha_lord: the OUTER / top-level planet
   - antardasha_lord: the middle planet — null for a Mahadasha-level row
   - pratyantardasha_lord: the innermost planet — null unless a 3rd level is shown
   - start_date: YYYY-MM-DD

4. Planet names must be exactly one of: Sun, Moon, Mars, Mercury, Jupiter, Venus, Saturn, Rahu, Ketu

5. Include ALL levels visible. Sort by start_date ascending within each level.

6. CONSISTENCY CHECK before outputting: every antardasha row must have a matching mahadasha row with the same lord and an equal or earlier start_date. If one is missing, add it using the first antardasha's start_date.

Example of correct output for a table showing Rahu MD then Jupiter MD:
{
  "periods": [
    {"mahadasha_lord": "Rahu",    "antardasha_lord": null,      "pratyantardasha_lord": null,    "start_date": "2006-03-15"},
    {"mahadasha_lord": "Rahu",    "antardasha_lord": "Rahu",    "pratyantardasha_lord": null,    "start_date": "2006-03-15"},
    {"mahadasha_lord": "Rahu",    "antardasha_lord": "Jupiter", "pratyantardasha_lord": null,    "start_date": "2008-10-03"},
    {"mahadasha_lord": "Rahu",    "antardasha_lord": "Saturn",  "pratyantardasha_lord": null,    "start_date": "2011-06-21"},
    {"mahadasha_lord": "Jupiter", "antardasha_lord": null,      "pratyantardasha_lord": null,    "start_date": "2024-03-15"},
    {"mahadasha_lord": "Jupiter", "antardasha_lord": "Jupiter", "pratyantardasha_lord": null,    "start_date": "2024-03-15"},
    {"mahadasha_lord": "Jupiter", "antardasha_lord": "Jupiter", "pratyantardasha_lord": "Saturn","start_date": "2024-07-20"},
    ...
  ]
}

Return ONLY valid JSON — no markdown fences, no explanation.`;

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
      periods,
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
