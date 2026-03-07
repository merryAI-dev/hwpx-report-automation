import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { createSignedBlobDownload, saveBlobObject } from "@/lib/server/blob-store";

export const POST = withApiAuth(async (request: NextRequest, session) => {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    if (!session.activeTenant) {
      return NextResponse.json({ error: "Active tenant is required." }, { status: 403 });
    }

    const fileName = String(formData.get("fileName") || file.name || "document.hwpx").trim();
    const descriptor = await saveBlobObject({
      tenantId: session.activeTenant.tenantId,
      fileName,
      contentType: file.type || "application/octet-stream",
      buffer: await file.arrayBuffer(),
    });
    const signed = createSignedBlobDownload({ descriptor });

    return NextResponse.json({
      ...descriptor,
      downloadUrl: signed.url,
      expiresAt: signed.expiresAt,
      activeTenant: session.activeTenant,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "blob upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, { requireTenant: true });
