import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";

function createPrismaClient() {
  // Read the same DATABASE_URL that `prisma migrate dev` used, so the path
  // always matches regardless of where the file was created.
  const dbUrl = process.env.DATABASE_URL ?? "file:./dev.db";
  const dbRelPath = dbUrl.replace(/^file:/, "");
  const dbPath = path.resolve(process.cwd(), dbRelPath);
  const adapter = new PrismaBetterSqlite3({ url: dbPath });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PrismaClient({ adapter } as any);
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
