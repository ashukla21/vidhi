import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getPlanetaryPositions,
  getPlanetInSign,
  getPlanetaryTransits,
  isDataReady,
} from "@/lib/astro-db";
import { getBitcoinPrices, isBtcDataReady } from "@/lib/btc-db";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const VALID_MODELS = [
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-haiku-4-5-20251001",
];

function getSystemPrompt(): string {
  const now = new Date();
  const TZ = "America/Chicago";
  const todayLong = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: TZ,
  });
  // Build ISO date string in CST (YYYY-MM-DD)
  const todayISO = [
    now.toLocaleDateString("en-US", { year: "numeric", timeZone: TZ }),
    now.toLocaleDateString("en-US", { month: "2-digit", timeZone: TZ }),
    now.toLocaleDateString("en-US", { day: "2-digit", timeZone: TZ }),
  ].join("-");
  const timeTZ =
    now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: TZ,
    }) + " CST";
  const threeMonthsOut = new Date(now);
  threeMonthsOut.setMonth(threeMonthsOut.getMonth() + 3);
  const upcomingEnd = threeMonthsOut.toISOString().slice(0, 10);

  return `You are Vidhi, an expert in Vedic astrology and investment analysis. You have direct access to a local planetary position dataset spanning 1990–2031, containing daily positions of the Sun, Moon, Mars, Mercury, Jupiter, Venus, Saturn, Rahu, and Ketu.

Each record includes the planet's sign (rashi), nakshatra, and nakshatra pada for that date.

## CURRENT DATE & TIME

Today is **${todayLong}** (${todayISO}). The current time is **${timeTZ}**.

When the user says "today", "now", "currently", "this week", "this month", or "upcoming", use **${todayISO}** as the reference point. For "upcoming transits" or "next few months", query the range **${todayISO}** to **${upcomingEnd}** unless the user specifies otherwise.

## DATA TOOL RULES

1. **Conceptual questions need no tool call.** If the user asks what a planetary combination generally means, or asks for interpretation, advice, or explanation — answer directly from your knowledge. Do not call a tool.

2. **Call a tool only when the answer requires actual data:**
   - "Where is Jupiter right now / on [date]?"
   - "When does Saturn enter Aquarius?"
   - "What was the nakshatra of Mars on Feb 9 2003?"
   - "Give me historical precedents for Jupiter in Taurus" (use get_planet_in_sign)
   - "What transits are coming up in the next 3 months?" (use get_planetary_transits)

3. **Query only the date range the question needs.** If the user asks about March 2024, query March 2024 — not 1990–2031. If they ask about upcoming transits, query the next 3–6 months. Never pull more data than necessary.

4. **Never approximate or guess specific dates or positions.** If a question requires a precise date or position, always call a tool to retrieve it.

5. **Date format from users:** Users may write dates in any format — MM-DD-YYYY, natural language ("Feb 9th 2003", "February 9, 2003"), or shorthand. Always interpret ambiguous numeric dates (e.g. "01-02-1990") as **MM-DD-YYYY** (month first). Convert whatever the user provides to YYYY-MM-DD when calling tools.

## Your Role

Help the user make informed investment decisions by connecting planetary data to market patterns:
- Planetary transits and sign changes that historically correlate with market movements
- Auspicious and inauspicious periods for buying/selling assets (especially crypto like Bitcoin)
- Historical precedents: what happened to markets the last time this exact configuration occurred
- Specific upcoming dates to watch, derived from the dataset
- Nakshatra-level analysis for more precise timing

## Bitcoin Price Data

You also have access to historical Bitcoin (BTC-USD) daily OHLCV data via the **get_bitcoin_prices** tool. Data spans from **2014-09-17** to the present. Each row contains: date, open, high, low, close (USD), volume, and pct_change (daily % change in close price).

Use this tool to:
- Retrieve BTC prices for any date range to cross-reference with planetary configurations
- Identify how Bitcoin moved during specific astrological events (transits, sign changes)
- Find historical patterns: "What did BTC do the last time Jupiter entered Taurus?"
- Compute trend context: rising/falling market during a given planetary period

To correlate BTC with astrology, call both tools with matching date ranges and then synthesize the results.

## Vedic Astrology Principles for Markets

- Jupiter transits into new signs often correlate with bull markets (especially Sagittarius, Pisces)
- Saturn in harsh configurations tends to bring corrections and consolidation
- Rahu/Ketu axis shifts mark major trend changes every ~18 months
- Mercury sign changes correlate with volatility in communication/tech sectors
- Mars sign changes correlate with energy sector moves and conflict-driven market swings

## Response Format

When answering investment-related questions, structure your response as:
1. **Current Planetary Context** — what the data shows right now and in the near future
2. **Historical Precedents** — what happened in similar past configurations (cite specific years from the data)
3. **Dates to Watch** — concrete upcoming dates derived from the dataset
4. **Risk Caveat** — brief note that this is for research, not financial advice

You are NOT a financial advisor.`;
}


// Tool definitions for Claude
const ASTRO_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_planetary_positions",
    description:
      "Retrieve daily planetary positions (sign/rashi, nakshatra, pada) for specified planets within a date range. Each row is one planet on one date. Use this to look up where a planet was on specific dates.",
    input_schema: {
      type: "object" as const,
      properties: {
        planets: {
          type: "array",
          items: { type: "string" },
          description: "List of planets to query: Sun, Moon, Mars, Mercury, Jupiter, Venus, Saturn, Rahu, Ketu. Omit for all planets.",
        },
        start_date: {
          type: "string",
          description: "Start date in YYYY-MM-DD format (data available from 1990-01-01)",
        },
        end_date: {
          type: "string",
          description: "End date in YYYY-MM-DD format (data available through 2031-12-31)",
        },
        limit: {
          type: "number",
          description: "Maximum rows to return (default 500, max 2000)",
        },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "get_planet_in_sign",
    description:
      "Find all dates when a specific planet was in a specific zodiac sign. Useful for finding historical precedents — e.g., 'When was Jupiter in Taurus before?' to correlate with past market cycles.",
    input_schema: {
      type: "object" as const,
      properties: {
        planet: {
          type: "string",
          description: "Planet name: Sun, Moon, Mars, Mercury, Jupiter, Venus, Saturn, Rahu, Ketu",
        },
        sign: {
          type: "string",
          description: "Zodiac sign: Aries, Taurus, Gemini, Cancer, Leo, Virgo, Libra, Scorpio, Sagittarius, Capricorn, Aquarius, Pisces",
        },
        start_date: {
          type: "string",
          description: "Optional start date filter (YYYY-MM-DD)",
        },
        end_date: {
          type: "string",
          description: "Optional end date filter (YYYY-MM-DD)",
        },
      },
      required: ["planet", "sign"],
    },
  },
  {
    name: "get_planetary_transits",
    description:
      "Get all sign-change transits (when planets move from one zodiac sign to another). Returns the date, planet, new sign, nakshatra, and previous sign. Sign changes are major astrological events that can mark turning points in markets.",
    input_schema: {
      type: "object" as const,
      properties: {
        start_date: {
          type: "string",
          description: "Start date (YYYY-MM-DD)",
        },
        end_date: {
          type: "string",
          description: "End date (YYYY-MM-DD)",
        },
        planets: {
          type: "array",
          items: { type: "string" },
          description: "Filter to specific planets (optional)",
        },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "get_bitcoin_prices",
    description:
      "Retrieve historical Bitcoin (BTC-USD) daily OHLCV price data for a date range. Returns date, open, high, low, close (USD), volume, and pct_change (daily % change). Data available from 2014-09-17 to present. Use this alongside astrology tools to correlate planetary configurations with BTC price movements.",
    input_schema: {
      type: "object" as const,
      properties: {
        start_date: {
          type: "string",
          description: "Start date in YYYY-MM-DD format (earliest available: 2014-09-17)",
        },
        end_date: {
          type: "string",
          description: "End date in YYYY-MM-DD format",
        },
        limit: {
          type: "number",
          description: "Maximum rows to return (default 1000, max 3000). For multi-year ranges use a higher limit.",
        },
      },
      required: ["start_date", "end_date"],
    },
  },
];

// Execute a tool call and return the result as a string
async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<string> {
  if (!isDataReady()) {
    return JSON.stringify({ error: "Astro data not built yet. Run: python3 scripts/build_astro_sqlite.py" });
  }

  try {
    switch (toolName) {
      case "get_planetary_positions": {
        const result = await getPlanetaryPositions({
          planets: toolInput.planets as string[] | undefined,
          startDate: toolInput.start_date as string,
          endDate: toolInput.end_date as string,
          limit: Math.min((toolInput.limit as number) || 200, 300),
        });
        return JSON.stringify(result.slice(0, 300));
      }
      case "get_planet_in_sign": {
        const result = await getPlanetInSign({
          planet: toolInput.planet as string,
          sign: toolInput.sign as string,
          startDate: toolInput.start_date as string | undefined,
          endDate: toolInput.end_date as string | undefined,
        });
        return JSON.stringify(result.slice(0, 300));
      }
      case "get_planetary_transits": {
        const result = await getPlanetaryTransits({
          startDate: toolInput.start_date as string,
          endDate: toolInput.end_date as string,
          planets: toolInput.planets as string[] | undefined,
        });
        return JSON.stringify(result);
      }
      case "get_bitcoin_prices": {
        if (!isBtcDataReady()) {
          return JSON.stringify({ error: "BTC price data not built yet. Run: python3 scripts/download_btc_data.py" });
        }
        const limit = Math.min((toolInput.limit as number) || 1000, 3000);
        const result = getBitcoinPrices({
          startDate: toolInput.start_date as string,
          endDate: toolInput.end_date as string,
          limit,
        });
        return JSON.stringify(result);
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err) {
    return JSON.stringify({ error: String(err) });
  }
}

interface Attachment {
  type: "image" | "file";
  name: string;
  mediaType: string;
  data: string; // base64
}

export async function POST(req: NextRequest) {
  const { threadId, message, model, attachments } = await req.json();

  if (!threadId || !message) {
    return new Response(JSON.stringify({ error: "threadId and message required" }), {
      status: 400,
    });
  }

  const selectedModel = VALID_MODELS.includes(model) ? model : "claude-sonnet-4-6";

  // Save user message to DB
  await prisma.message.create({
    data: { threadId, role: "user", content: message },
  });

  // Load full thread history
  const dbMessages = await prisma.message.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
  });

  // Build conversation messages — all historical messages are text-only,
  // only the current (last) user message may include attachments.
  const conversationMessages: Anthropic.MessageParam[] = dbMessages.map((m, idx) => {
    // For the last user message, include any attachments
    if (idx === dbMessages.length - 1 && m.role === "user" && attachments?.length) {
      const contentBlocks: Anthropic.ContentBlockParam[] = [];

      for (const att of attachments as Attachment[]) {
        if (att.type === "image") {
          contentBlocks.push({
            type: "image",
            source: {
              type: "base64",
              media_type: att.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: att.data,
            },
          });
        } else {
          // Text file — prepend as a document block
          contentBlocks.push({
            type: "text",
            text: `[Attached file: ${att.name}]\n${atob(att.data)}`,
          });
        }
      }

      contentBlocks.push({ type: "text", text: m.content });
      return { role: "user" as const, content: contentBlocks };
    }

    return {
      role: m.role as "user" | "assistant",
      content: m.content,
    };
  });

  // Streaming response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        let messages = [...conversationMessages];
        let finalText = "";

        // Agentic loop — keep going until Claude stops using tools.
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const response = await anthropic.messages.create({
            model: selectedModel,
            max_tokens: 4096,
            system: getSystemPrompt(),
            tools: ASTRO_TOOLS,
            tool_choice: { type: "auto" },
            messages,
          });

          // Stream text content
          for (const block of response.content) {
            if (block.type === "text") {
              finalText += block.text;
              const words = block.text.split(" ");
              for (const word of words) {
                send({ type: "text", content: word + " " });
              }
            }
          }

          if (response.stop_reason === "end_turn") break;

          if (response.stop_reason === "tool_use") {
            const toolResults: Anthropic.ToolResultBlockParam[] = [];

            for (const block of response.content) {
              if (block.type === "tool_use") {
                const output = await executeTool(
                  block.name,
                  block.input as Record<string, unknown>
                );
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: output,
                });
              }
            }

            messages = [
              ...messages,
              { role: "assistant" as const, content: response.content },
              { role: "user" as const, content: toolResults },
            ];
          } else {
            break;
          }
        }

        // Save assistant message to DB
        await prisma.message.create({
          data: {
            threadId,
            role: "assistant",
            content: finalText,
          },
        });

        // Auto-generate a summary title for new chats
        const thread = await prisma.thread.findUnique({ where: { id: threadId } });
        if (thread?.title === "New Chat") {
          try {
            const summaryResponse = await anthropic.messages.create({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 30,
              messages: [{
                role: "user",
                content: `Summarize this question in 3-5 words as a short chat title. Return ONLY the title text, nothing else. No quotes, no punctuation at the end.\n\nQuestion: ${message}`,
              }],
            });
            const titleBlock = summaryResponse.content[0];
            const title = titleBlock.type === "text" ? titleBlock.text.trim() : message.slice(0, 40);
            await prisma.thread.update({ where: { id: threadId }, data: { title } });
            send({ type: "title", content: title });
          } catch {
            // Fallback to truncated message
            const title = message.slice(0, 50) + (message.length > 50 ? "..." : "");
            await prisma.thread.update({ where: { id: threadId }, data: { title } });
            send({ type: "title", content: title });
          }
        }

        send({ type: "done" });
        controller.close();
      } catch (err) {
        send({ type: "error", error: String(err) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
