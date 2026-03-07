#!/usr/bin/env node

import { access, copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const LEGACY_HWP_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function hasLegacySignature(buffer) {
  if (buffer.length < LEGACY_HWP_SIGNATURE.length) {
    return false;
  }
  return LEGACY_HWP_SIGNATURE.every((byte, index) => buffer[index] === byte);
}

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  fail("Usage: node scripts/mock-hwp-converter.mjs <input.hwp> <output.hwpx>");
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = process.env.MOCK_HWPX_FIXTURE || path.join(repoRoot, "public", "base.hwpx");

const input = await readFile(inputPath);
if (!hasLegacySignature(input)) {
  fail("Input file does not look like a legacy HWP compound file.");
}

try {
  await access(fixturePath);
} catch {
  fail(`Fixture not found: ${fixturePath}`);
}

await copyFile(fixturePath, outputPath);
console.log(`mock-converted ${path.basename(inputPath)} -> ${path.basename(outputPath)}`);
