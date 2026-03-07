import { NextRequest, NextResponse } from "next/server";
import { createSignedBlobDownload, saveBlobObject } from "@/lib/server/blob-store";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const fileName = String(formData.get("fileName") || file.name || "document.hwpx").trim();
    const descriptor = await saveBlobObject({
      fileName,
      contentType: file.type || "application/octet-stream",
      buffer: await file.arrayBuffer(),
    });
    const signed = createSignedBlobDownload({ descriptor });

    return NextResponse.json({
      ...descriptor,
      downloadUrl: signed.url,
      expiresAt: signed.expiresAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "blob upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
