import { NextRequest } from "next/server";
import { getStock, deleteStock } from "@/lib/stock-db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    const stock = getStock(ticker.toUpperCase());
    if (!stock) return Response.json({ error: "Stock not found" }, { status: 404 });
    return Response.json(stock);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    deleteStock(ticker.toUpperCase());
    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
