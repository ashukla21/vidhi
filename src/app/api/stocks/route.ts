import { NextRequest } from "next/server";
import { listStocks, createStock } from "@/lib/stock-db";

export const dynamic = "force-dynamic";

// GET /api/stocks — list all saved stock profiles
export async function GET() {
  try {
    return Response.json(listStocks());
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/stocks — create or update a stock profile
export async function POST(req: NextRequest) {
  try {
    const { ticker, company_name, ipo_date, ipo_time, ipo_timezone } = await req.json();
    if (!ticker || typeof ticker !== "string") {
      return Response.json({ error: "ticker is required" }, { status: 400 });
    }
    createStock({ ticker, company_name, ipo_date, ipo_time, ipo_timezone });
    return Response.json({ success: true, ticker: ticker.toUpperCase() });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
