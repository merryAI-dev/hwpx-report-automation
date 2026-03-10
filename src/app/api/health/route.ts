import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

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
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "0.0.0",
    checks: {
      storage: {
        ok: storage.ok,
        driver: storage.driver,
        writable: storage.writable,
      },
      ai: {
        ok: hasAnyAI,
        anthropic: hasAnthropic,
        openai: hasOpenAI,
        model: hasAnthropic
          ? (process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6")
          : (process.env.OPENAI_MODEL || "gpt-4.1-mini"),
      },
    },
  });
}
