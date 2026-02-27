import { NextRequest, NextResponse } from "next/server";

const JAVA_API_URL = process.env.JAVA_API_URL || "http://localhost:8080";

/**
 * Proxy: POST /api/hwpx-render
 *
 * Accepts `multipart/form-data` with a `file` field (HWPX binary),
 * forwards it to the Java hwpxlib rendering server, and returns the
 * JSON payload `{ html, elementMap, outline }`.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const upstream = new FormData();
    upstream.append("file", file);

    const response = await fetch(`${JAVA_API_URL}/api/render`, {
      method: "POST",
      body: upstream,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return NextResponse.json(
        { error: `Java API error ${response.status}: ${text}` },
        { status: response.status },
      );
    }

    const data = (await response.json()) as unknown;
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Render failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
