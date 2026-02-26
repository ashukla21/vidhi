import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "prisma", "@prisma/client"],
};

export default nextConfig;
