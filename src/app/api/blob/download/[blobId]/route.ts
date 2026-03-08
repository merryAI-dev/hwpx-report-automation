import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import {
  readBlobObject,
  toContentDisposition,
  verifyBlobDownloadSignature,
} from "@/lib/server/blob-store";

export const GET = withApiAuth(async (
  request: Request,
  session,
) => {
  const url = new URL(request.url);
  const blobId = url.pathname.split("/").pop() || "";
  const expires = url.searchParams.get("expires") || "";
  const signature = url.searchParams.get("sig") || "";

  if (!session.activeTenant) {
    return NextResponse.json({ error: "Active tenant is required." }, { status: 403 });
  }

  const verification = verifyBlobDownloadSignature({
    blobId,
    tenantId: session.activeTenant.tenantId,
    expires,
    signature,
  });
  if (!verification.ok) {
    return NextResponse.json(
      {
        error:
          verification.reason === "expired"
            ? "signed download URL has expired"
            : "invalid signed download URL",
      },
      { status: verification.reason === "expired" ? 410 : 403 },
    );
  }

  try {
    const { metadata, buffer } = await readBlobObject(blobId, {
      tenantId: session.activeTenant.tenantId,
    });
    const requestedName = url.searchParams.get("name") || metadata.fileName;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": metadata.contentType || "application/octet-stream",
        "Content-Length": String(metadata.byteLength),
        "Content-Disposition": toContentDisposition(requestedName),
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "blob not found";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}, { requireTenant: true });
