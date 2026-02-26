import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const threads = await prisma.thread.findMany({
    orderBy: { updatedAt: "desc" },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  return NextResponse.json(threads);
}

export async function POST(req: NextRequest) {
  const { folderId, title } = await req.json();
  const thread = await prisma.thread.create({
    data: { folderId: folderId || null, title: title || "New Chat" },
    include: { messages: true },
  });
  return NextResponse.json(thread);
}
