import { NextRequest } from "next/server";
import { clearDashaPeriods } from "@/lib/stock-db";

export const dynamic = "force-dynamic";

// DELETE /api/stocks/[ticker]/clear-dasha — wipe dasha rows for a clean re-upload
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    const deleted = clearDashaPeriods(ticker.toUpperCase());
    return Response.json({ success: true, deleted });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
