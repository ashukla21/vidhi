import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// DELETE /api/threads/[id]/messages
// Body: { fromMessageId: string, inclusive: boolean }
// Deletes fromMessageId + all after (inclusive=true) or only messages after (inclusive=false)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { fromMessageId, inclusive } = await req.json();

  const messages = await prisma.message.findMany({
    where: { threadId: id },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  const idx = messages.findIndex((m) => m.id === fromMessageId);
  if (idx === -1)
    return NextResponse.json({ error: "Message not found" }, { status: 404 });

  const toDelete = inclusive ? messages.slice(idx) : messages.slice(idx + 1);
  if (toDelete.length > 0) {
    await prisma.message.deleteMany({
      where: { id: { in: toDelete.map((m) => m.id) } },
    });
  }

  return NextResponse.json({ deleted: toDelete.length });
}
