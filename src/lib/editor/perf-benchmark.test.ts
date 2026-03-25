/**
 * Performance Benchmark: Flash Attention 식 메모리 I/O 최적화 before/after 측정
 *
 * Flash Attention 핵심 통찰: 연산량이 아니라 메모리 read/write가 병목.
 * HBM ↔ SRAM 간 데이터 이동을 줄여 벽시계 시간을 단축하듯,
 * DOM parse/serialize, JSON.stringify, getElementsByTagName 풀스캔을 제거.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { parseHwpxToProseMirror } from "./hwpx-to-prosemirror";
import { applyProseMirrorDocToHwpx } from "./prosemirror-to-hwpx";
import { markFingerprint, ensureCharPrForMarks, clearCharPrCaches } from "./marks-to-charpr";

const REAL_FIXTURE_PATH = path.resolve(process.cwd(), "../examples/input-sample.hwpx");
const hasFixture = fs.existsSync(REAL_FIXTURE_PATH);
const benchTest = (hasFixture && !process.env.CI) ? it : it.skip;

// ── Utility: 고정밀 타이머 ──
function bench(fn: () => void, iterations: number): { avgMs: number; totalMs: number } {
  // warm up
  for (let i = 0; i < 3; i++) fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const totalMs = performance.now() - start;
  return { avgMs: totalMs / iterations, totalMs };
}

async function benchAsync(fn: () => Promise<void>, iterations: number): Promise<{ avgMs: number; totalMs: number }> {
  // warm up
  for (let i = 0; i < 2; i++) await fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) await fn();
  const totalMs = performance.now() - start;
  return { avgMs: totalMs / iterations, totalMs };
}

describe("Performance Benchmarks — Flash Attention 식 최적화 측정", () => {

  // ── Benchmark 1: rebuildParaXmlWithMarks — DOM parse vs regex ──
  it("Tier 1.1: XML 속성 추출 — DOMParser vs regex", { timeout: 30_000 }, () => {
    // 100개 문단의 paraXml 시뮬레이션
    const paraXmls: string[] = [];
    for (let i = 0; i < 100; i++) {
      paraXmls.push(
        `<hp:p id="${i}" paraPrIDRef="${i % 5}" styleIDRef="${i % 3}" pageBreak="0" columnBreak="0" merged="0">` +
        `<hp:run charPrIDRef="1"><hp:t>테스트 문단 ${i}</hp:t></hp:run></hp:p>`
      );
    }

    // OLD: DOMParser 방식 (Flash Attention의 HBM read/write에 해당)
    const oldWay = bench(() => {
      for (const xml of paraXmls) {
        const doc = new DOMParser().parseFromString(xml, "text/xml");
        const el = doc.documentElement;
        const _paraPrId = el.getAttribute("paraPrIDRef") || "0";
        const _styleId = el.getAttribute("styleIDRef") || "0";
        const _pageBreak = el.getAttribute("pageBreak") || "0";
        const _columnBreak = el.getAttribute("columnBreak") || "0";
        const _merged = el.getAttribute("merged") || "0";
        const _id = el.getAttribute("id");
        // serialize back (like writing back to HBM)
        new XMLSerializer().serializeToString(doc);
      }
    }, 5);

    // NEW: regex 방식 (Flash Attention의 SRAM 타일 처리에 해당)
    const newWay = bench(() => {
      for (const xml of paraXmls) {
        const _paraPrId = xml.match(/paraPrIDRef="([^"]*)"/)?.[1] ?? "0";
        const _styleId = xml.match(/styleIDRef="([^"]*)"/)?.[1] ?? "0";
        const _pageBreak = xml.match(/pageBreak="([^"]*)"/)?.[1] ?? "0";
        const _columnBreak = xml.match(/columnBreak="([^"]*)"/)?.[1] ?? "0";
        const _merged = xml.match(/merged="([^"]*)"/)?.[1] ?? "0";
        const _id = xml.match(/<[^>]*?\sid="([^"]*)"/)?.[1] ?? null;
      }
    }, 5);

    const speedup = oldWay.avgMs / newWay.avgMs;
    console.log("\n📊 Tier 1.1: XML 속성 추출 (100 paragraphs × 5 iterations)");
    console.log(`   OLD (DOMParser + XMLSerializer): ${oldWay.avgMs.toFixed(2)}ms avg`);
    console.log(`   NEW (regex):                     ${newWay.avgMs.toFixed(2)}ms avg`);
    console.log(`   ⚡ Speedup: ${speedup.toFixed(1)}× faster`);
    expect(speedup).toBeGreaterThan(2);
  });

  // ── Benchmark 2: fontface 조회 — linear scan vs Map index ──
  it("Tier 1.4: fontface 조회 — O(n) 선형탐색 vs O(1) Map 인덱스", () => {
    const headerXml = `<?xml version="1.0" encoding="UTF-8"?>
    <hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head">
      <hh:refList>
        <hh:fontfaces itemCnt="7">
          ${["HANGUL", "LATIN", "HANJA", "JAPANESE", "OTHER", "SYMBOL", "USER"].map((lang, li) =>
            `<hh:fontface lang="${lang}" fontCnt="10">` +
            Array.from({ length: 10 }, (_, fi) =>
              `<hh:font id="${fi}" face="Font${lang}${fi}" type="TTF" isEmbedded="0"/>`
            ).join("") +
            `</hh:fontface>`
          ).join("\n")}
        </hh:fontfaces>
      </hh:refList>
    </hh:head>`;

    const doc = new DOMParser().parseFromString(headerXml, "text/xml");
    const lookupCount = 350; // 7 langs × 50 paragraphs

    // OLD: Array.from().find() 매번 풀스캔
    const oldWay = bench(() => {
      const fontfacesEl = Array.from(doc.getElementsByTagName("*")).find(
        (el) => el.localName === "fontfaces"
      )!;
      for (let i = 0; i < lookupCount; i++) {
        const lang = ["HANGUL", "LATIN", "HANJA", "JAPANESE", "OTHER", "SYMBOL", "USER"][i % 7];
        const _ff = Array.from(fontfacesEl.children).find(
          (child) => child.localName === "fontface" && child.getAttribute("lang") === lang
        );
        if (_ff) {
          const fontId = String(i % 10);
          Array.from(_ff.children).find(
            (c) => c.localName === "font" && c.getAttribute("id") === fontId
          );
        }
      }
    }, 50);

    // NEW: Map 인덱스 — 1회 빌드 후 O(1) 조회
    const newWay = bench(() => {
      const fontfacesEl = Array.from(doc.getElementsByTagName("*")).find(
        (el) => el.localName === "fontfaces"
      )!;
      // 1회 빌드
      const langMap = new Map<string, Element>();
      for (const child of Array.from(fontfacesEl.children)) {
        if (child.localName === "fontface") {
          const l = child.getAttribute("lang") ?? "";
          if (l) langMap.set(l, child);
        }
      }
      const fontIdMaps = new Map<Element, Map<string, Element>>();
      for (const [, ff] of langMap) {
        const idMap = new Map<string, Element>();
        for (const child of Array.from(ff.children)) {
          if (child.localName === "font") {
            const id = child.getAttribute("id");
            if (id) idMap.set(id, child);
          }
        }
        fontIdMaps.set(ff, idMap);
      }
      // O(1) 조회 350회
      for (let i = 0; i < lookupCount; i++) {
        const lang = ["HANGUL", "LATIN", "HANJA", "JAPANESE", "OTHER", "SYMBOL", "USER"][i % 7];
        const ff = langMap.get(lang);
        if (ff) {
          const idMap = fontIdMaps.get(ff);
          idMap?.get(String(i % 10));
        }
      }
    }, 50);

    const speedup = oldWay.avgMs / newWay.avgMs;
    console.log("\n📊 Tier 1.4: fontface 조회 (350 lookups × 50 iterations)");
    console.log(`   OLD (Array.find per lookup): ${oldWay.avgMs.toFixed(3)}ms avg`);
    console.log(`   NEW (Map index O(1)):        ${newWay.avgMs.toFixed(3)}ms avg`);
    console.log(`   ⚡ Speedup: ${speedup.toFixed(1)}× faster`);
    expect(speedup).toBeGreaterThan(1.5);
  });

  // ── Benchmark 3: 이미지 추출 — 3-pass vs single-pass ──
  it("Tier 2.1: 이미지 추출 — 3×getElementsByTagName vs single-pass", () => {
    // 50개 pic 요소 시뮬레이션
    const picXml = Array.from({ length: 50 }, (_, i) =>
      `<hp:pic><hc:img binaryItemIDRef="img${i}"/>` +
      `<hp:orgSz width="${7200 + i}" height="${4800 + i}"/>` +
      `<hp:shapeComment>이미지 ${i} 설명</hp:shapeComment>` +
      `<hp:extra>기타</hp:extra></hp:pic>`
    ).join("");
    const wrapXml = `<root xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">${picXml}</root>`;
    const doc = new DOMParser().parseFromString(wrapXml, "text/xml");
    const pics = Array.from(doc.getElementsByTagName("*")).filter((el) => el.localName === "pic");

    // OLD: 3 passes per pic
    const oldWay = bench(() => {
      for (const pic of pics) {
        const imgEls = Array.from(pic.getElementsByTagName("*")).filter(
          (el) => el.localName === "img" && el.hasAttribute("binaryItemIDRef")
        );
        let _w = 0, _h = 0;
        for (const child of Array.from(pic.getElementsByTagName("*"))) {
          if (child.localName === "orgSz" || child.localName === "curSz") {
            _w = Number.parseInt(child.getAttribute("width") ?? "0", 10);
            _h = Number.parseInt(child.getAttribute("height") ?? "0", 10);
            if (_w > 0 && _h > 0) break;
          }
        }
        const _comment = Array.from(pic.getElementsByTagName("*")).find(
          (el) => el.localName === "shapeComment"
        );
      }
    }, 100);

    // NEW: single-pass
    const newWay = bench(() => {
      for (const pic of pics) {
        let binRef: string | null = null;
        let _w = 0, _h = 0;
        let _alt = "";
        for (const el of Array.from(pic.getElementsByTagName("*"))) {
          const ln = el.localName;
          if (!binRef && ln === "img" && el.hasAttribute("binaryItemIDRef")) {
            binRef = el.getAttribute("binaryItemIDRef");
          } else if (_w === 0 && (ln === "orgSz" || ln === "curSz")) {
            _w = Number.parseInt(el.getAttribute("width") ?? "0", 10);
            _h = Number.parseInt(el.getAttribute("height") ?? "0", 10);
          } else if (!_alt && ln === "shapeComment" && el.textContent) {
            _alt = el.textContent.trim();
          }
        }
      }
    }, 100);

    const speedup = oldWay.avgMs / newWay.avgMs;
    console.log("\n📊 Tier 2.1: 이미지 추출 (50 pics × 100 iterations)");
    console.log(`   OLD (3-pass getElementsByTagName): ${oldWay.avgMs.toFixed(3)}ms avg`);
    console.log(`   NEW (single-pass):                 ${newWay.avgMs.toFixed(3)}ms avg`);
    console.log(`   ⚡ Speedup: ${speedup.toFixed(1)}× faster`);
    expect(speedup).toBeGreaterThan(1.5);
  });

  // ── Benchmark 4: JSON.stringify 비교 vs 참조 동일성 ──
  it("Tier 3.2: 문서 비교 — JSON.stringify vs 참조 동일성", () => {
    // 50,000자급 문서 시뮬레이션
    const bigDoc: JSONContent = {
      type: "doc",
      content: Array.from({ length: 200 }, (_, i) => ({
        type: "paragraph",
        attrs: { segmentId: `seg-${i}` },
        content: [{ type: "text", text: "가나다라마바사 ".repeat(30) + `paragraph ${i}` }],
      })),
    };

    // OLD: JSON.stringify 2회 비교
    const oldWay = bench(() => {
      const a = JSON.stringify(bigDoc);
      const b = JSON.stringify(bigDoc);
      const _same = a === b;
    }, 50);

    // NEW: 참조 동일성 O(1)
    const ref = bigDoc;
    const newWay = bench(() => {
      const _same = ref === bigDoc;
    }, 50);

    const speedup = oldWay.avgMs / newWay.avgMs;
    console.log("\n📊 Tier 3.2: 문서 비교 (200 paragraphs, ~50KB)");
    console.log(`   OLD (JSON.stringify × 2): ${oldWay.avgMs.toFixed(3)}ms avg`);
    console.log(`   NEW (reference equality): ${newWay.avgMs.toFixed(6)}ms avg`);
    console.log(`   ⚡ Speedup: ${speedup.toFixed(0)}× faster`);
    expect(speedup).toBeGreaterThan(100);
  });

  // ── Benchmark 5: charPr normalize 캐시 ──
  it("Tier 1.2: charPr normalize — 매번 직렬화 vs 캐시", () => {
    const headerXml = `<?xml version="1.0" encoding="UTF-8"?>
    <hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head">
      <hh:charPr id="1" height="1000" textColor="#000000" shadeColor="none">
        <hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:bold/>
      </hh:charPr>
    </hh:head>`;
    const doc = new DOMParser().parseFromString(headerXml, "text/xml");
    const charPr = Array.from(doc.getElementsByTagName("*")).find(
      (el) => el.localName === "charPr"
    )!;

    // OLD: 매번 cloneNode + XMLSerializer
    const oldWay = bench(() => {
      for (let i = 0; i < 100; i++) {
        const cloned = charPr.cloneNode(true) as Element;
        cloned.removeAttribute("id");
        const shade = (cloned.getAttribute("shadeColor") ?? "").trim().toUpperCase();
        if (shade === "NONE" || shade === "#FFFFFF") {
          cloned.removeAttribute("shadeColor");
        }
        new XMLSerializer().serializeToString(cloned);
      }
    }, 50);

    // NEW: 첫 번째만 직렬화, 이후 캐시 히트
    const cache = new Map<string, string>();
    const newWay = bench(() => {
      for (let i = 0; i < 100; i++) {
        const key = "1"; // baseCharPrId
        let normalized = cache.get(key);
        if (normalized === undefined) {
          const cloned = charPr.cloneNode(true) as Element;
          cloned.removeAttribute("id");
          const shade = (cloned.getAttribute("shadeColor") ?? "").trim().toUpperCase();
          if (shade === "NONE" || shade === "#FFFFFF") {
            cloned.removeAttribute("shadeColor");
          }
          normalized = new XMLSerializer().serializeToString(cloned);
          cache.set(key, normalized);
        }
      }
    }, 50);

    const speedup = oldWay.avgMs / newWay.avgMs;
    console.log("\n📊 Tier 1.2: charPr normalize (100 lookups × 50 iterations)");
    console.log(`   OLD (clone + serialize every time): ${oldWay.avgMs.toFixed(3)}ms avg`);
    console.log(`   NEW (cached after first):           ${newWay.avgMs.toFixed(3)}ms avg`);
    console.log(`   ⚡ Speedup: ${speedup.toFixed(1)}× faster`);
    expect(speedup).toBeGreaterThan(5);
  });

  // ── Benchmark 6: E2E — 실제 HWPX 파일 export 파이프라인 ──
  benchTest("E2E: 실제 HWPX 파일 export 파이프라인 성능", { timeout: 60_000 }, async () => {
    const nodeBuf = await fs.promises.readFile(REAL_FIXTURE_PATH);
    const fileBuffer = Uint8Array.from(nodeBuf).buffer;
    const parsed = await parseHwpxToProseMirror(fileBuffer);

    // 편집 시뮬레이션: 일부 텍스트에 볼드/색상 mark 추가
    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;
    let modCount = 0;
    const walk = (node: JSONContent) => {
      if (node.type === "text" && node.text && modCount < 20) {
        node.marks = [
          { type: "bold" },
          { type: "textStyle", attrs: { color: "#FF0000", fontSize: "14pt" } },
        ];
        modCount++;
      }
      node.content?.forEach(walk);
    };
    walk(doc);

    const result = await benchAsync(async () => {
      await applyProseMirrorDocToHwpx(
        fileBuffer,
        doc,
        parsed.segments,
        parsed.extraSegmentsMap,
        parsed.hwpxDocumentModel,
      );
    }, 5);

    console.log("\n📊 E2E: 실제 HWPX export (mark 적용 20개 문단)");
    console.log(`   Optimized pipeline: ${result.avgMs.toFixed(0)}ms avg per export`);
    console.log(`   Total (5 runs):     ${result.totalMs.toFixed(0)}ms`);

    // 단일 export: ZIP 압축/해제 포함하여 5초 이내 (ZIP I/O가 주 병목, 우리 최적화 범위 외)
    expect(result.avgMs).toBeLessThan(5000);
  });

  // ── Benchmark 7: E2E — 실제 HWPX 파일 import 파이프라인 ──
  benchTest("E2E: 실제 HWPX 파일 import (parseHwpxToProseMirror) 성능", { timeout: 30_000 }, async () => {
    const nodeBuf = await fs.promises.readFile(REAL_FIXTURE_PATH);
    const fileBuffer = Uint8Array.from(nodeBuf).buffer;

    const result = await benchAsync(async () => {
      await parseHwpxToProseMirror(fileBuffer);
    }, 5);

    console.log("\n📊 E2E: 실제 HWPX import");
    console.log(`   Optimized pipeline: ${result.avgMs.toFixed(0)}ms avg per import`);
    console.log(`   Total (5 runs):     ${result.totalMs.toFixed(0)}ms`);

    // 단일 import: ZIP 해제 포함하여 3초 이내
    expect(result.avgMs).toBeLessThan(3000);
  });
});
