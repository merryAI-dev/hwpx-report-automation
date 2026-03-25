import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import { readFileSync } from "node:fs";

export const runtime = "nodejs";

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../../../../package.json", import.meta.url), "utf-8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function checkStorage(): Promise<{ ok: boolean; driver: string; writable: boolean }> {
  const driver = process.env.BLOB_STORAGE_DRIVER || "fs";
  if (driver !== "fs") {
    return { ok: true, driver, writable: true };
  }
  const root = process.env.BLOB_STORAGE_FS_ROOT || ".blob-storage";
  try {
    await fs.mkdir(root, { recursive: true });
    const probe = path.join(root, ".health-probe");
    await fs.writeFile(probe, "ok");
    await fs.unlink(probe);
    return { ok: true, driver, writable: true };
  } catch {
    return { ok: false, driver, writable: false };
  }
}

export async function GET() {
  const storage = await checkStorage();
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasAnyAI = hasAnthropic || hasOpenAI;

  const allOk = storage.ok && hasAnyAI;

  // Always return 200 — liveness probe must not fail due to missing AI keys.
  // Use status field to signal degraded state to monitoring dashboards.
  return NextResponse.json({
    status: allOk ? "ok" : "degraded",
    version: getVersion(),
    timestamp: new Date().toISOString(),
    checks: {
      storage: { ok: storage.ok },
      ai: { ok: hasAnyAI },
    },
  });
}
