import { NextRequest } from "next/server";
import { writeFile, mkdir, unlink } from "fs/promises";
import { existsSync } from "fs";
import { spawn } from "child_process";
import path from "path";
import os from "os";

export const maxDuration = 120; // allow up to 2 min for large imports

function runScript(scriptPath: string, filePath: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn("python3", [scriptPath, filePath], {
      cwd: path.join(process.cwd()),
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
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

    // Save to a temp file
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `btc_import_${Date.now()}${ext}`);
    const bytes = await file.arrayBuffer();
    await writeFile(tmpFile, Buffer.from(bytes));

    // Run the import script
    const scriptPath = path.join(process.cwd(), "scripts", "import_btc_csv.py");
    if (!existsSync(scriptPath)) {
      return Response.json({ error: "Import script not found" }, { status: 500 });
    }

    const { stdout, stderr, code } = await runScript(scriptPath, tmpFile);

    // Clean up temp file
    await unlink(tmpFile).catch(() => {});

    if (code !== 0) {
      return Response.json(
        { error: "Import failed", details: stderr || stdout },
        { status: 500 }
      );
    }

    return Response.json({ success: true, output: stdout });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
