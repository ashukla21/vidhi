import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const folders = await prisma.folder.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      threads: { orderBy: { updatedAt: "desc" } },
    },
  });
  return NextResponse.json(folders);
}

export async function POST(req: NextRequest) {
  const { name } = await req.json();
  const folder = await prisma.folder.create({
    data: { name: name || "New Folder" },
    include: { threads: true },
  });
  return NextResponse.json(folder);
}
