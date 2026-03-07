#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';
import { collectComplexObjectReport } from '../src/lib/editor/hwpx-complex-objects.ts';

const SECTION_FILE_RE = /^Contents\/section\d+\.xml$/;

function parseArgs(argv) {
  const inputs = [];
  let mdOut = null;
  let jsonOut = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--md-out') {
      mdOut = argv[++index] ?? null;
      continue;
    }
    if (arg === '--json-out') {
      jsonOut = argv[++index] ?? null;
      continue;
    }
    inputs.push(arg);
  }

  return { inputs, mdOut, jsonOut };
}

async function collectHwpxFiles(entryPath, bucket) {
  const stat = await fs.stat(entryPath);
  if (stat.isDirectory()) {
    const children = await fs.readdir(entryPath);
    for (const child of children) {
      await collectHwpxFiles(path.join(entryPath, child), bucket);
    }
    return;
  }

  if (entryPath.toLowerCase().endsWith('.hwpx')) {
    bucket.push(path.resolve(entryPath));
  }
}

async function buildFileReport(filePath, domParser) {
  const buffer = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const sectionDocs = [];

  for (const fileName of Object.keys(zip.files).filter((name) => SECTION_FILE_RE.test(name)).sort()) {
    const sectionXml = await zip.file(fileName)?.async('string');
    if (!sectionXml) {
      continue;
    }
    const doc = domParser.parseFromString(sectionXml, 'application/xml');
    if (doc.querySelector('parsererror') || !doc.documentElement) {
      continue;
    }
    sectionDocs.push({ fileName, doc });
  }

  const report = collectComplexObjectReport(sectionDocs);
  return {
    filePath,
    fileName: path.basename(filePath),
    report,
  };
}

function sumCounts(entries) {
  const total = {
    image: 0,
    drawing: 0,
    bookmark: 0,
    field: 0,
    footnote: 0,
    endnote: 0,
    pageControl: 0,
  };

  for (const entry of entries) {
    for (const [key, value] of Object.entries(entry.report.counts)) {
      total[key] += value;
    }
  }

  return total;
}

function toMarkdown(entries, aggregateCounts) {
  const lines = [];
  lines.push('# Complex Object Warning Corpus');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Files scanned: ${entries.length}`);
  lines.push('');
  lines.push('## Aggregate Counts');
  lines.push('');
  lines.push('| Type | Count |');
  lines.push('| --- | ---: |');
  for (const [type, count] of Object.entries(aggregateCounts)) {
    lines.push(`| ${type} | ${count} |`);
  }
  lines.push('');
  lines.push('## File Results');
  lines.push('');
  for (const entry of entries) {
    lines.push(`### ${entry.fileName}`);
    lines.push('');
    lines.push(`- Path: \`${entry.filePath}\``);
    lines.push(`- Sections: ${entry.report.sectionCount}`);
    lines.push(`- Complex objects: ${entry.report.totalCount}`);
    const nonZeroCounts = Object.entries(entry.report.counts).filter(([, value]) => value > 0);
    if (nonZeroCounts.length) {
      lines.push(`- Counts: ${nonZeroCounts.map(([type, value]) => `${type}=${value}`).join(', ')}`);
    } else {
      lines.push('- Counts: none');
    }
    if (entry.report.warnings.length) {
      lines.push('- Warnings:');
      for (const warning of entry.report.warnings) {
        lines.push(`  - ${warning}`);
      }
    } else {
      lines.push('- Warnings: none');
    }
    if (entry.report.occurrences.length) {
      lines.push('- Occurrences:');
      for (const occurrence of entry.report.occurrences.slice(0, 12)) {
        lines.push(`  - ${occurrence.fileName}: ${occurrence.localName} x ${occurrence.count}`);
      }
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const { inputs, mdOut, jsonOut } = parseArgs(process.argv.slice(2));
  if (!inputs.length) {
    console.error('Usage: node --experimental-strip-types scripts/collect-complex-object-corpus.mjs <dir-or-file> [more...] [--md-out path] [--json-out path]');
    process.exit(1);
  }

  const files = [];
  for (const input of inputs) {
    await collectHwpxFiles(input, files);
  }

  files.sort();
  const dom = new JSDOM('');
  const domParser = new dom.window.DOMParser();
  const reports = [];
  for (const filePath of files) {
    reports.push(await buildFileReport(filePath, domParser));
  }

  const aggregateCounts = sumCounts(reports);
  const payload = {
    generatedAt: new Date().toISOString(),
    fileCount: reports.length,
    aggregateCounts,
    entries: reports,
  };

  if (jsonOut) {
    await fs.mkdir(path.dirname(jsonOut), { recursive: true });
    await fs.writeFile(jsonOut, JSON.stringify(payload, null, 2));
  }
  if (mdOut) {
    await fs.mkdir(path.dirname(mdOut), { recursive: true });
    await fs.writeFile(mdOut, toMarkdown(reports, aggregateCounts));
  }

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
