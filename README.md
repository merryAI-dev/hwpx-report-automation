# hwpx-report-automation

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**Generate AI-powered reports directly into HWPX (Hancom Office) templates — no manual copy-paste, no style breakage.**

> Korean: [한국어 README](README-ko.md)

---

## Why?

Hancom Office (HWP/HWPX) is the dominant document format in Korea — government reports, proposals, meeting minutes. But there's no public API to edit `.hwpx` files programmatically.

This project treats HWPX for what it actually is: **a ZIP archive containing XML files**. We unpack it, surgically replace only the text nodes you care about, and repack it — preserving every style, font, and layout attribute untouched.

---

## Features

- **Template placeholder substitution** — mark spots in your `.hwpx` file with `{{TITLE}}`, `{{CONTENT}}`, etc. and fill them from a JSON file
- **AI-powered report generation** — use OpenAI or Anthropic APIs to auto-generate structured report content
- **Style-safe editing** — text replacements never touch font, paragraph style, or layout attributes
- **HWPX integrity verification** — validates ZIP structure, mime type, and XML well-formedness
- **Web UI** — Next.js editor with batch processing, AI suggestions, and document management

---

## Quick Start

### Python (template filling)

No dependencies beyond the standard library for basic usage.

```bash
# 1. Create a data file
cat > data.json << 'EOF'
{
  "TITLE": "2025 Annual Report",
  "SUMMARY": "Key highlights from Q1-Q4.",
  "AUTHOR": "Jane Doe"
}
EOF

# 2. Fill placeholders in your template
python scripts/fill_hwpx_template.py \
  --template template.hwpx \
  --data-json data.json \
  --output output.hwpx
```

### Python (inspect / edit text nodes)

```bash
# List all text nodes in an HWPX file
python scripts/hwpx_editor.py --input report.hwpx --list

# Apply targeted edits by node index
python scripts/hwpx_editor.py \
  --input report.hwpx \
  --edits-json edits.json \
  --output report_edited.hwpx
```

### Web UI

```bash
cd web
cp .env.example .env.local   # add your API keys
npm install
npm run dev
# → http://localhost:3000
```

---

## Project Structure

```
scripts/
  fill_hwpx_template.py   Placeholder token replacement ({{KEY}} → value)
  hwpx_editor.py          Low-level text node inspection and editing
  build_report.py         AI-powered report generation pipeline
  hancom-verify/          HWPX integrity verification tools

web/                      Next.js web application
  src/app/                Pages and API routes
  src/lib/                Business logic (HWPX processing, AI integration)
  prisma/                 Database schema (SQLite via LibSQL)
```

---

## Design Philosophy

HWPX is a ZIP file. Inside that ZIP are XML files that encode every paragraph, run, and style in your document.

Most tools that "edit" HWPX re-serialize the entire document, which risks corrupting styles or losing metadata. We take a different approach:

1. **Open** the HWPX ZIP
2. **Find** only the XML text nodes that match your placeholders or edit targets
3. **Replace** the text content — nothing else
4. **Repack** the ZIP with the original file metadata intact

This means the output `.hwpx` file is byte-for-byte identical to the original except for the text you changed.

---

## Requirements

| Component | Requirement |
|-----------|-------------|
| Python scripts | Python 3.8+ |
| Web UI | Node.js 18+, npm |
| AI features | OpenAI or Anthropic API key |
| Database | SQLite (auto-created via Prisma) |

```bash
pip install requests   # only needed for build_report.py (AI generation)
```

---

## Contributing

Issues and PRs are welcome. For larger changes, please open an issue first to discuss the approach.

---

## License

[MIT](LICENSE) © 2025 MYSC
