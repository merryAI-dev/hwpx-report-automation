#!/usr/bin/env node
/**
 * HWPX 파일 검사 스크립트.
 * 사용법: node scripts/inspect-hwpx.mjs <file.hwpx>
 *
 * 한컴 독스에서 열리지 않는 파일의 문제를 진단합니다.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/inspect-hwpx.mjs <file.hwpx>");
  process.exit(1);
}

const buf = readFileSync(resolve(file));

async function main() {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);

  console.log("=== HWPX File Structure ===");
  console.log("Entries:", names.length);
  for (const name of names) {
    const f = zip.files[name];
    const data = await f.async("uint8array");
    const compression = f._data?.compression?.magic === 0 ? "STORE" : "DEFLATE";
    console.log(`  ${name} (${data.length} bytes, ${compression})`);
  }

  // Check mimetype
  if (zip.files["mimetype"]) {
    const mime = await zip.files["mimetype"].async("string");
    console.log("\nmimetype:", JSON.stringify(mime.trim()));
  } else {
    console.log("\n[ERROR] mimetype file missing!");
  }

  // Check section0.xml
  const sectionFile = zip.file("Contents/section0.xml");
  if (!sectionFile) {
    console.log("\n[ERROR] Contents/section0.xml missing!");
    return;
  }

  const xml = await sectionFile.async("string");
  console.log(`\n=== section0.xml (${xml.length} chars) ===`);

  // Check XML validity
  // (Simple check: well-formed tags)
  const openTags = (xml.match(/<[a-z][^/]*?>/gi) || []).length;
  const closeTags = (xml.match(/<\/[^>]+>/gi) || []).length;
  const selfClose = (xml.match(/<[^>]+\/>/gi) || []).length;
  console.log(`Open tags: ${openTags}, Close tags: ${closeTags}, Self-closing: ${selfClose}`);

  // Check for tables
  const tblMatches = [...xml.matchAll(/<([a-z]+):tbl[\s>]/g)];
  console.log(`\nTables found: ${tblMatches.length}`);

  // Check for duplicate paragraph IDs
  const paraIdMatches = [...xml.matchAll(/<[a-z]+:p\s[^>]*id="(\d+)"/g)];
  const paraIds = paraIdMatches.map((m) => m[1]);
  const dupIds = paraIds.filter((id, i) => paraIds.indexOf(id) !== i);
  if (dupIds.length) {
    console.log(`\n[WARNING] Duplicate paragraph IDs: ${[...new Set(dupIds)].join(", ")}`);
  } else {
    console.log(`\nParagraph IDs: ${paraIds.length} total, all unique`);
  }

  // Check for empty <hp:t> tags vs tags with content
  const tTagsEmpty = (xml.match(/<[a-z]+:t\s*\/>/g) || []).length;
  const tTagsWithContent = [...xml.matchAll(/<[a-z]+:t>(.*?)<\/[a-z]+:t>/gs)];
  console.log(`\nText nodes: ${tTagsWithContent.length} with content, ${tTagsEmpty} self-closing`);

  // Check for namespace issues
  const nsDeclarations = [...xml.matchAll(/xmlns:([a-z]+)="([^"]+)"/g)];
  const nsByPrefix = new Map();
  for (const [, prefix, uri] of nsDeclarations) {
    if (!nsByPrefix.has(prefix)) nsByPrefix.set(prefix, new Set());
    nsByPrefix.get(prefix).add(uri);
  }
  console.log("\nNamespace declarations:");
  for (const [prefix, uris] of nsByPrefix) {
    const uriArr = [...uris];
    if (uriArr.length > 1) {
      console.log(`  [WARNING] ${prefix}: multiple URIs: ${uriArr.join(", ")}`);
    } else {
      console.log(`  ${prefix}: ${uriArr[0]}`);
    }
  }

  // Check for Korean text in table cells
  const cellTexts = [...xml.matchAll(/<[a-z]+:subList[^>]*>([\s\S]*?)<\/[a-z]+:subList>/g)];
  let emptyCells = 0;
  let filledCells = 0;
  for (const m of cellTexts) {
    const inner = m[1];
    const texts = [...inner.matchAll(/<[a-z]+:t>(.*?)<\/[a-z]+:t>/gs)];
    const hasText = texts.some((t) => t[1].trim().length > 0);
    if (hasText) filledCells++;
    else emptyCells++;
  }
  console.log(`\nTable cells: ${filledCells} filled, ${emptyCells} empty`);

  // Print first 200 chars of the XML to check encoding
  console.log("\n=== First 200 chars ===");
  console.log(xml.slice(0, 200));

  // Check for malformed XML near table patches
  // Look for xmlns:hp redeclarations inside tables
  const tblChunks = [...xml.matchAll(/<([a-z]+):tbl[\s>][\s\S]*?<\/\1:tbl>/g)];
  for (const [i, chunk] of tblChunks.entries()) {
    const innerNs = [...chunk[0].matchAll(/xmlns:([a-z]+)="([^"]+)"/g)];
    if (innerNs.length > 0) {
      console.log(`\n[INFO] Table ${i} has ${innerNs.length} namespace declaration(s): ${innerNs.map((m) => `${m[1]}=${m[2]}`).join(", ")}`);
    }
  }
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
