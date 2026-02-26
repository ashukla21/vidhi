import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getPlanetaryPositions,
  getPlanetInSign,
  getRetrogradePeriods,
  getPlanetaryTransits,
  runCustomQuery,
  getDataSummary,
  isDataReady,
} from "@/lib/astro-db";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are Vidhi, an expert in Vedic astrology and investment analysis. You have direct access to a comprehensive planetary position dataset spanning 1990–2031, containing daily positions of the Sun, Moon, Mars, Mercury, Jupiter, Venus, Saturn, Rahu, and Ketu.

Your role is to help the user make informed investment decisions by:
1. Analyzing planetary transits, retrograde periods, and sign changes that historically correlate with market movements
2. Identifying auspicious and inauspicious periods for buying/selling assets (especially crypto like Bitcoin)
3. Connecting current/upcoming planetary events to historical patterns in the dataset
4. Providing specific date ranges and actionable insights

Vedic astrology principles relevant to markets:
- Jupiter transits to new signs often correlate with bull markets (especially in Sagittarius, Pisces)
- Saturn in harsh aspects can bring corrections and consolidation
- Rahu/Ketu axis shifts mark major trend changes every ~18 months
- Mercury retrograde periods can bring volatility and reversals
- Mars retrograde correlates with energy sector and conflict-driven market moves

Always use your data tools to back up your analysis with actual planetary data. When asked about investments, provide:
- Current planetary context
- Historical precedents from the dataset
- Specific upcoming dates to watch
- Risk caveats

You are NOT a financial advisor. Always note that this is for informational/research purposes only.`;

// Tool definitions for Claude
const ASTRO_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_planetary_positions",
    description:
      "Retrieve planetary positions (longitude, sign, house, retrograde status) for specified planets within a date range. Use this to analyze where planets were/are during specific market events.",
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
      "Find all dates when a specific planet was in a specific zodiac sign. Useful for finding historical precedents — e.g., 'When was Jupiter in Taurus before?' to correlate with past Bitcoin cycles.",
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
    name: "get_retrograde_periods",
    description:
      "Get all retrograde periods for a planet. Retrograde motion often correlates with market reversals, delays, and re-evaluation of trends.",
    input_schema: {
      type: "object" as const,
      properties: {
        planet: {
          type: "string",
          description: "Planet name: Mars, Mercury, Venus, Jupiter, Saturn, Rahu, Ketu",
        },
        start_date: {
          type: "string",
          description: "Start date filter (YYYY-MM-DD)",
        },
        end_date: {
          type: "string",
          description: "End date filter (YYYY-MM-DD)",
        },
      },
      required: ["planet"],
    },
  },
  {
    name: "get_planetary_transits",
    description:
      "Get all sign-change transits (when planets move from one zodiac sign to another). Sign changes are major astrological events that can mark turning points in markets.",
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
    name: "run_custom_query",
    description:
      "Run a custom SQL SELECT query against the astro dataset. Table name is 'astro_data'. Use this for complex analyses like counting Jupiter-Saturn conjunctions, finding specific degree ranges, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        sql: {
          type: "string",
          description: "SQL SELECT statement. Use 'astro_data' as the table name. Available columns depend on the dataset schema.",
        },
      },
      required: ["sql"],
    },
  },
  {
    name: "get_data_summary",
    description:
      "Get a summary of the available astro dataset: columns, date range, unique planets/signs, row count. Call this first to understand what data is available.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

// Execute a tool call and return the result as a string
async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<string> {
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
      case "get_retrograde_periods": {
        const result = await getRetrogradePeriods({
          planet: toolInput.planet as string,
          startDate: toolInput.start_date as string | undefined,
          endDate: toolInput.end_date as string | undefined,
        });
        return JSON.stringify(result);
      }
      case "get_planetary_transits": {
        const result = await getPlanetaryTransits({
          startDate: toolInput.start_date as string,
          endDate: toolInput.end_date as string,
          planets: toolInput.planets as string[] | undefined,
        });
        return JSON.stringify(result);
      }
      case "run_custom_query": {
        const result = await runCustomQuery(toolInput.sql as string);
        return JSON.stringify(result.slice(0, 1000));
      }
      case "get_data_summary": {
        if (!isDataReady()) {
          return JSON.stringify({
            error: "Data not downloaded yet. Run: python3 scripts/download_astro_data.py",
          });
        }
        return JSON.stringify(getDataSummary());
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
        const toolCallsForSave: { toolName: string; input: Record<string, unknown>; output: string }[] = [];
        let finalText = "";

        // Agentic loop — keep going until Claude stops using tools
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const response = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 4096,
            system: SYSTEM_PROMPT,
            tools: ASTRO_TOOLS,
            messages,
          });

          // Stream text content
          for (const block of response.content) {
            if (block.type === "text") {
              finalText += block.text;
              // Stream in chunks
              const words = block.text.split(" ");
              for (const word of words) {
                send({ type: "text", content: word + " " });
              }
            } else if (block.type === "tool_use") {
              send({
                type: "tool_start",
                toolName: block.name,
                toolInput: block.input,
              });
            }
          }

          if (response.stop_reason === "end_turn") break;

          if (response.stop_reason === "tool_use") {
            // Execute all tool calls
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
                toolCallsForSave.push({
                  toolName: block.name,
                  input: block.input as Record<string, unknown>,
                  output,
                });
                send({
                  type: "tool_end",
                  toolName: block.name,
                  toolOutput: output.slice(0, 200) + (output.length > 200 ? "..." : ""),
                });
              }
            }

            // Add assistant response + tool results to message history
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
            toolCalls: toolCallsForSave.length > 0 ? JSON.stringify(toolCallsForSave) : null,
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
