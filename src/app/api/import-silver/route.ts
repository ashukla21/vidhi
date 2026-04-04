import { NextRequest } from "next/server";
import { writeFile, unlink } from "fs/promises";
import { existsSync } from "fs";
import { spawn } from "child_process";
import path from "path";
import os from "os";
import { invalidateSilverDb } from "@/lib/silver-db";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

function runScript(scriptPath: string, filePath: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn("python3", [scriptPath, filePath], { cwd: process.cwd() });
    let stdout = "", stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code: number | null) => resolve({ stdout, stderr, code: code ?? 1 }));
  });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }

    const ext = path.extname(file.name).toLowerCase();
    if (![".csv", ".numbers", ".tsv", ".txt"].includes(ext)) {
      return Response.json(
        { error: `Unsupported file type '${ext}'. Use .csv or .numbers` },
        { status: 400 }
      );
    }

    const tmpFile = path.join(os.tmpdir(), `silver_import_${Date.now()}${ext}`);
    const bytes = await file.arrayBuffer();
    await writeFile(tmpFile, Buffer.from(bytes));

    const scriptPath = path.join(process.cwd(), "scripts", "import_silver_csv.py");
    if (!existsSync(scriptPath)) {
      return Response.json({ error: "Import script not found" }, { status: 500 });
    }

    const { stdout, stderr, code } = await runScript(scriptPath, tmpFile);
    await unlink(tmpFile).catch(() => {});

    if (code !== 0) {
      return Response.json(
        { error: "Import failed", details: stderr || stdout },
        { status: 500 }
      );
    }

    invalidateSilverDb();
    return Response.json({ success: true, output: stdout });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
