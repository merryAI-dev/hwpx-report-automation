import { NextResponse } from "next/server";
import {
  readBlobObject,
  toContentDisposition,
  verifyBlobDownloadSignature,
} from "@/lib/server/blob-store";

export async function GET(
  request: Request,
  context: { params: Promise<{ blobId: string }> },
) {
  const { blobId } = await context.params;
  const url = new URL(request.url);
  const expires = url.searchParams.get("expires") || "";
  const signature = url.searchParams.get("sig") || "";

  const verification = verifyBlobDownloadSignature({
    blobId,
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
    const { metadata, buffer } = await readBlobObject(blobId);
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
}
