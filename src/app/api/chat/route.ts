import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getPlanetaryPositions,
  getPlanetInSign,
  getPlanetaryTransits,
  isDataReady,
} from "@/lib/astro-db";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are Vidhi, an expert in Vedic astrology and investment analysis. You have direct access to a local planetary position dataset spanning 1990–2031, containing daily positions of the Sun, Moon, Mars, Mercury, Jupiter, Venus, Saturn, Rahu, and Ketu.

Each record includes the planet's sign (rashi), nakshatra, and nakshatra pada for that date.

## CRITICAL DATA RULES — READ FIRST

These rules are non-negotiable. Your value comes entirely from grounding every claim in the actual dataset, not your training knowledge.

1. **NEVER state a planetary position, sign placement, nakshatra, or date from memory.** Your training data contains approximate or outdated planetary information. Always query the dataset instead.

2. **Before answering ANY question that involves:**
   - Where a planet currently is or was on a specific date
   - What nakshatra a planet was in on any date
   - When a planet enters/leaves a sign
   - A date range for any astrological event
   - Historical precedents ("last time Jupiter was in Taurus")
   — you MUST call the appropriate data tool first. Do not respond until you have real data from the query.

3. **If the user asks a purely conceptual question** (e.g., "What does Jupiter in Taurus generally mean?") you may answer conceptually, but you must still ground the answer by querying when those periods actually occurred in the dataset and citing the real dates.

4. **Never approximate or guess dates.** If you do not have the data to answer precisely, say so and call a tool to retrieve it.

5. **Date format from users:** Users may write dates in any format — MM-DD-YYYY, natural language ("Feb 9th 2003", "February 9, 2003"), or shorthand. Always interpret ambiguous numeric dates (e.g. "01-02-1990") as **MM-DD-YYYY** (month first). Convert whatever the user provides to YYYY-MM-DD when calling tools.

## Your Role

Help the user make informed investment decisions by connecting planetary data to market patterns:
- Planetary transits and sign changes that historically correlate with market movements
- Auspicious and inauspicious periods for buying/selling assets (especially crypto like Bitcoin)
- Historical precedents: what happened to markets the last time this exact configuration occurred
- Specific upcoming dates to watch, derived from the dataset
- Nakshatra-level analysis for more precise timing

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
];

// Execute a tool call and return the result as a string
async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<string> {
  if (!isDataReady()) {
    return JSON.stringify({ error: "Data not downloaded yet. Run: python3 scripts/download_astro_data.py" });
  }

  try {
    switch (toolName) {
      case "get_planetary_positions": {
        const result = await getPlanetaryPositions({
          planets: toolInput.planets as string[] | undefined,
          startDate: toolInput.start_date as string,
          endDate: toolInput.end_date as string,
          limit: (toolInput.limit as number) || 500,
        });
        return JSON.stringify(result.slice(0, 1000));
      }
      case "get_planet_in_sign": {
        const result = await getPlanetInSign({
          planet: toolInput.planet as string,
          sign: toolInput.sign as string,
          startDate: toolInput.start_date as string | undefined,
          endDate: toolInput.end_date as string | undefined,
        });
        return JSON.stringify(result.slice(0, 1000));
      }
      case "get_planetary_transits": {
        const result = await getPlanetaryTransits({
          startDate: toolInput.start_date as string,
          endDate: toolInput.end_date as string,
          planets: toolInput.planets as string[] | undefined,
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

export async function POST(req: NextRequest) {
  const { threadId, message } = await req.json();

  if (!threadId || !message) {
    return new Response(JSON.stringify({ error: "threadId and message required" }), {
      status: 400,
    });
  }

  // Save user message to DB
  await prisma.message.create({
    data: { threadId, role: "user", content: message },
  });

  // Load full thread history
  const dbMessages = await prisma.message.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
  });

  const conversationMessages: Anthropic.MessageParam[] = dbMessages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

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
        // Force a tool call on the first turn to ensure planetary claims are
        // always grounded in the dataset before Claude writes a response.
        let isFirstTurn = true;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const response = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 4096,
            system: SYSTEM_PROMPT,
            tools: ASTRO_TOOLS,
            tool_choice: isFirstTurn ? { type: "any" } : { type: "auto" },
            messages,
          });
          isFirstTurn = false;

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

        // Auto-update thread title from first user message if still default
        const thread = await prisma.thread.findUnique({ where: { id: threadId } });
        if (thread?.title === "New Chat") {
          const title = message.slice(0, 60) + (message.length > 60 ? "..." : "");
          await prisma.thread.update({ where: { id: threadId }, data: { title } });
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
