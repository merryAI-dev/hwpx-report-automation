import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { readBlobObject } from "@/lib/server/blob-store";
import { generateHwpxHtmlPreview } from "@/lib/server/hwpx-preview";

export const runtime = "nodejs";

export const GET = withApiAuth(
  async (request: Request, session, context?: { params?: Promise<{ blobId?: string }> }) => {
    if (!session.activeTenant) {
      return NextResponse.json({ error: "Active tenant is required." }, { status: 403 });
    }

    const url = new URL(request.url);
    const blobId = url.pathname.split("/").filter(Boolean).pop() ?? "";

    if (!blobId) {
      return NextResponse.json({ error: "blobId is required." }, { status: 400 });
    }

    const tenantId = session.activeTenant.tenantId;

    let blobData: Awaited<ReturnType<typeof readBlobObject>>;
    try {
      blobData = await readBlobObject(blobId, { tenantId });
    } catch {
      return NextResponse.json({ error: "Blob not found." }, { status: 404 });
    }

    let preview: Awaited<ReturnType<typeof generateHwpxHtmlPreview>>;
    try {
      const rawBuffer = blobData.buffer.buffer.slice(
        blobData.buffer.byteOffset,
        blobData.buffer.byteOffset + blobData.buffer.byteLength,
      );
      const arrayBuffer: ArrayBuffer = rawBuffer instanceof SharedArrayBuffer
        ? (new Uint8Array(rawBuffer).buffer as unknown as ArrayBuffer)
        : (rawBuffer as unknown as ArrayBuffer);
      preview = await generateHwpxHtmlPreview(arrayBuffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Preview generation failed.";
      return NextResponse.json({ error: message }, { status: 500 });
    }

    const acceptHeader = request.headers.get("Accept") ?? "";
    if (acceptHeader.includes("application/json")) {
      return NextResponse.json({ preview });
    }

    // Return the full HTML page
    return new NextResponse(preview.html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, max-age=300",
      },
    });
  },
  { requireTenant: true },
);
