/**
 * 이미지 라운드트립 검증 스크립트
 *
 * 1. base.hwpx를 파싱
 * 2. 이미지를 추가
 * 3. HWPX로 내보내기
 * 4. 한컴오피스에서 열기
 *
 * 실행: npx tsx scripts/verify-image-roundtrip.ts
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { JSDOM } from "jsdom";
import type { JSONContent } from "@tiptap/core";

// Polyfill browser globals for Node.js
const dom = new JSDOM("");
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;
globalThis.Document = dom.window.Document as unknown as typeof Document;
globalThis.Element = dom.window.Element as unknown as typeof Element;
globalThis.NodeFilter = dom.window.NodeFilter as unknown as typeof NodeFilter;

import { parseHwpxToProseMirror } from "../src/lib/editor/hwpx-to-prosemirror";
import { applyProseMirrorDocToHwpx } from "../src/lib/editor/prosemirror-to-hwpx";

// Generate a visible 400x300 PNG using pure Node.js (no external deps)
import { deflateSync } from "node:zlib";

function generateColorPngDataUrl(width: number, height: number): string {
  // Build raw pixel data: filter byte (0) + RGB per pixel per row
  const rowBytes = 1 + width * 3; // filter + RGB
  const raw = Buffer.alloc(rowBytes * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowBytes;
    raw[rowOffset] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const px = rowOffset + 1 + x * 3;
      // Blue-to-purple gradient with a white cross pattern
      const isCross =
        (x > width / 2 - 4 && x < width / 2 + 4) ||
        (y > height / 2 - 4 && y < height / 2 + 4);
      const isBorder =
        x < 6 || x >= width - 6 || y < 6 || y >= height - 6;
      if (isBorder) {
        // White border
        raw[px] = 255;
        raw[px + 1] = 255;
        raw[px + 2] = 255;
      } else if (isCross) {
        // Yellow cross
        raw[px] = 255;
        raw[px + 1] = 220;
        raw[px + 2] = 50;
      } else {
        // Gradient: blue → purple
        const t = x / width;
        raw[px] = Math.round(37 + t * 87);     // R: 37→124
        raw[px + 1] = Math.round(99 - t * 41);  // G: 99→58
        raw[px + 2] = Math.round(235 + t * 2);  // B: 235→237
      }
    }
  }

  const compressed = deflateSync(raw);

  // Assemble PNG
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function crc32(buf: Buffer): number {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let j = 0; j < 8; j++) {
        c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
      }
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type: string, data: Buffer): Buffer {
    const typeBytes = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crcInput = Buffer.concat([typeBytes, data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(crcInput));
    return Buffer.concat([len, typeBytes, data, crcBuf]);
  }

  // IHDR: width, height, bitDepth=8, colorType=2(RGB), compression=0, filter=0, interlace=0
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const png = Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);

  return `data:image/png;base64,${png.toString("base64")}`;
}

const IMAGE_DATA_URL = generateColorPngDataUrl(400, 300);

async function main() {
  console.log("=== 이미지 라운드트립 검증 ===\n");

  // 1. base.hwpx 읽기
  const basePath = join(__dirname, "../public/base.hwpx");
  console.log(`1. base.hwpx 읽기: ${basePath}`);
  const baseBuffer = readFileSync(basePath).buffer as ArrayBuffer;

  // 2. 파싱
  console.log("2. HWPX 파싱...");
  const parsed = await parseHwpxToProseMirror(baseBuffer);
  console.log(`   - 세그먼트 수: ${parsed.segments.length}`);
  console.log(`   - 문서 노드 수: ${parsed.doc.content?.length ?? 0}`);

  // 3. 이미지 노드 추가
  console.log("3. 이미지 노드 추가...");
  const docWithImage: JSONContent = {
    ...parsed.doc,
    content: [
      ...(parsed.doc.content ?? []),
      {
        type: "image",
        attrs: {
          src: IMAGE_DATA_URL,
          alt: "테스트 이미지",
          width: 200,
          height: 150,
          mimeType: "image/png",
          fileName: "test-image.png",
        },
      },
    ],
  };
  console.log(`   - 수정된 문서 노드 수: ${docWithImage.content?.length ?? 0}`);

  // 4. HWPX 내보내기
  console.log("4. HWPX 내보내기...");
  const result = await applyProseMirrorDocToHwpx(
    baseBuffer,
    docWithImage,
    parsed.segments,
    parsed.extraSegmentsMap,
    parsed.hwpxDocumentModel,
  );
  console.log(`   - 경고: ${result.warnings.length > 0 ? result.warnings.join(", ") : "없음"}`);

  // 5. 파일 저장
  const tempDir = mkdtempSync(join(tmpdir(), "hwpx-image-verify-"));
  const outputPath = join(tempDir, "image-roundtrip-test.hwpx");
  const blob = result.blob;
  const arrayBuffer = await blob.arrayBuffer();
  writeFileSync(outputPath, new Uint8Array(arrayBuffer));
  console.log(`5. 저장 완료: ${outputPath}`);
  console.log(`   - 파일 크기: ${new Uint8Array(arrayBuffer).length} bytes`);

  // 6. ZIP 내용 검사
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(arrayBuffer);
  const binDataFiles = Object.keys(zip.files).filter(
    (f) => f.startsWith("BinData/") && !zip.files[f].dir,
  );
  console.log(`6. ZIP 검사:`);
  console.log(`   - BinData 파일: ${binDataFiles.length > 0 ? binDataFiles.join(", ") : "없음"}`);

  const sectionFile = zip.files["Contents/section0.xml"];
  if (sectionFile) {
    const sectionXml = await sectionFile.async("string");
    const hasPic = sectionXml.includes("hp:pic");
    const hasBinRef = sectionXml.includes("binaryItemIDRef");
    console.log(`   - section0.xml에 hp:pic: ${hasPic ? "✅" : "❌"}`);
    console.log(`   - section0.xml에 binaryItemIDRef: ${hasBinRef ? "✅" : "❌"}`);
  }

  const hpfFile = zip.files["Contents/content.hpf"];
  if (hpfFile) {
    const hpfXml = await hpfFile.async("string");
    const hasImageItem = hpfXml.includes("image/png");
    console.log(`   - content.hpf에 image/png 항목: ${hasImageItem ? "✅" : "❌"}`);
  }

  // 7. 한컴오피스에서 열기
  console.log(`\n7. 한컴오피스에서 열기...`);
  execFile("open", ["-a", "Hancom Office HWP", outputPath], (error) => {
    if (error) {
      console.error(`   ❌ 열기 실패: ${error.message}`);
    } else {
      console.log(`   ✅ 한컴오피스에서 열렸습니다.`);
      console.log(`\n파일 위치: ${outputPath}`);
      console.log("한컴오피스에서 이미지가 표시되는지 확인해주세요.");
    }
  });
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
