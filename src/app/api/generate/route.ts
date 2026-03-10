import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { getWorkspaceTemplate } from "@/lib/server/workspace-store";
import { readBlobObject } from "@/lib/server/blob-store";
import { buildWorkspaceActorFromSession } from "@/lib/server/workspace-route-utils";
import { workspaceErrorResponse } from "@/lib/server/workspace-api";
import { parseHwpxTemplate, buildFieldCoordMap } from "@/lib/batch/hwpx-template-parser";
import { injectMultipleCells, type CellInjection } from "@/lib/batch/hwpx-cell-injector";

export const runtime = "nodejs";

async function generateHwpxFromTemplate(
  templateBuffer: Buffer,
  values: Record<string, string>,
): Promise<Uint8Array> {
  const arrayBuffer = templateBuffer.buffer.slice(
    templateBuffer.byteOffset,
    templateBuffer.byteOffset + templateBuffer.byteLength,
  ) as ArrayBuffer;

  const templateZip = await JSZip.loadAsync(arrayBuffer);
  const sectionFile = templateZip.file("Contents/section0.xml");
  if (!sectionFile) {
    throw new Error("section0.xml not found in HWPX template");
  }

  const sectionXml = await sectionFile.async("string");
  const parsedTemplate = parseHwpxTemplate(sectionXml);
  const coordMap = buildFieldCoordMap(parsedTemplate);

  const injections: CellInjection[] = [];
  for (const [fieldKey, value] of Object.entries(values)) {
    if (!value || !value.trim()) continue;
    const coord = coordMap.get(fieldKey);
    if (!coord) continue;
    injections.push({ col: coord.col, row: coord.row, text: value });
  }

  const outputZip = new JSZip();
  const STORE_FILES = new Set(["mimetype", "version.xml", "Preview/PrvImage.png"]);

  const patchedXml = injectMultipleCells(sectionXml, injections, 10000);

  for (const [name, file] of Object.entries(templateZip.files)) {
    if (file.dir) continue;
    const compression = STORE_FILES.has(name) ? "STORE" : "DEFLATE";
    if (name === "Contents/section0.xml") {
      outputZip.file(name, patchedXml, { compression, createFolders: false });
    } else {
      const content = await file.async("uint8array");
      outputZip.file(name, content, { compression, createFolders: false });
    }
  }

  return outputZip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

export const POST = withApiAuth(async (request: NextRequest, session) => {
  try {
    const actor = buildWorkspaceActorFromSession(session);

    let body: { templateId?: string; values?: Record<string, string>; outputFileName?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const { templateId, values = {}, outputFileName } = body;

    if (!templateId || typeof templateId !== "string") {
      return NextResponse.json({ error: "templateId is required." }, { status: 400 });
    }

    const template = await getWorkspaceTemplate({
      tenantId: actor.tenantId,
      actor,
      templateId,
    });

    if (!template) {
      return NextResponse.json({ error: "Template not found." }, { status: 404 });
    }

    if (!template.currentVersion) {
      return NextResponse.json({ error: "Template has no current version." }, { status: 400 });
    }

    const blobId = template.currentVersion.blob.blobId;
    const { buffer } = await readBlobObject(blobId, { tenantId: actor.tenantId });

    const hwpxBytes = await generateHwpxFromTemplate(buffer, values);

    const safeName = (outputFileName || template.currentVersion.fileName || "output.hwpx")
      .replace(/[^\w\-.가-힣]/g, "_")
      .replace(/\.hwpx$/i, "") + ".hwpx";

    const asciiFallback = safeName.replace(/[^\x20-\x7E]/g, "_");
    const encoded = encodeURIComponent(safeName);
    const contentDisposition = `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;

    return new NextResponse(Buffer.from(hwpxBytes), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": contentDisposition,
        "Content-Length": String(hwpxBytes.byteLength),
      },
    });
  } catch (error) {
    return workspaceErrorResponse(error, "Failed to generate document.");
  }
}, { requireTenant: true });
