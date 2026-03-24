# hwpx-report-automation

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/)
[![Node.js 18+](https://img.shields.io/badge/node-18+-green.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/merryAI-dev/hwpx-report-automation/issues)

**🌐 Language:** [English](#) | [한국어](README.md)

---

The HWPX document automation system for AI-powered report generation.

No public API for HWPX? No problem. **HWPX is a ZIP file.** We open it, replace only what you need, and close it — styles intact, zero corruption.

> Built at [MYSC](https://mysc.kr) for real-world report automation. Battle-tested on government proposals, investment memos, and meeting minutes.

---

## What is this?

Hancom Office (HWP/HWPX) is the dominant document format in Korea — used in virtually every government agency, public institution, and enterprise. Yet there's **no public programmatic API** to edit `.hwpx` files.

Every workaround either:
- Opens Hancom Office via automation (requires a license, breaks on servers)
- Re-serializes the entire XML (corrupts styles, loses fonts)
- Exports to DOCX (destroys the original formatting)

This project does none of that. It treats HWPX as what it actually is — **a ZIP archive of XML files** — and surgically edits only the text nodes you specify. Everything else is untouched, byte for byte.

```
template.hwpx  →  fill_hwpx_template.py  →  output.hwpx
                        ↑
                  {"TITLE": "2025 Annual Report",
                   "AUTHOR": "Jane Doe"}
```

---

## What's Inside

```
hwpx-report-automation/
├── python/
│   ├── fill_hwpx_template.py   Template placeholder substitution ({{KEY}} → value)
│   ├── hwpx_editor.py          Low-level text node inspection and editing
│   ├── build_report.py         AI-powered report generation pipeline
│   └── hancom-verify/          HWPX integrity verification tools (Swift/macOS)
│
├── src/app/                    Next.js pages and API routes (27 endpoints)
├── src/lib/                    Business logic — HWPX processing, AI integration
├── scripts/                    Node.js utility scripts
└── prisma/                     SQLite database schema (via LibSQL)
```

---

## Quick Start

### Template Filling (Python, no dependencies)

```bash
# 1. Mark placeholders in your .hwpx file as {{KEY}}

# 2. Create your data file
cat > data.json << 'EOF'
{
  "TITLE": "2025 Annual Report",
  "SUMMARY": "Key highlights from Q1–Q4.",
  "AUTHOR": "Jane Doe"
}
EOF

# 3. Fill and export
python python/fill_hwpx_template.py \
  --template template.hwpx \
  --data-json data.json \
  --output output.hwpx
# → Created: output.hwpx
```

No Hancom Office. No COM automation. No Docker. Just Python's standard library.

---

### Inspect & Edit Text Nodes (Python)

```bash
# See every text node with its index and style attributes
python python/hwpx_editor.py --input report.hwpx --list

# Apply targeted edits by node index
python python/hwpx_editor.py \
  --input report.hwpx \
  --edits-json edits.json \
  --output report_edited.hwpx
```

---

### AI Report Generation

```bash
pip install requests
export OPENAI_API_KEY=sk-...

python python/build_report.py \
  --template template.hwpx \
  --prompt "Write a Q3 business review for a SaaS company" \
  --output report.hwpx
```

---

### HWPX Studio — Web UI

A full-featured web editor deployable to Vercel.

**Features:**
- Upload HWPX → browse and edit text nodes
- Legacy `.hwp` upload with external converter integration
- Style attribute catalog viewer
- Style-preserving edit queue with undo/redo
- AI suggestions (`/api/suggest`) and batch section rewriting (`/api/suggest-batch`)
- Original / suggestion diff preview
- `{{PLACEHOLDER}}` substitution
- Filesystem-based blob storage + signed download URLs
- Template metatag catalog extraction (`{{TITLE}}`, `{{date:report_date|required|label=보고일}}`)

**Local run:**

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
# → http://localhost:3000
```

**Deploy to Fly.io:**

```bash
cd web
fly launch --no-deploy   # picks up fly.toml automatically
fly secrets set OPENAI_API_KEY=sk-...
fly secrets set AUTH_SECRET=your-secret
fly secrets set BLOB_SIGNING_SECRET=your-secret
fly volumes create hwpx_data --region nrt --size 1
fly deploy
```

- Region: `nrt` (Tokyo) — closest to Korea
- Blob storage is persisted to a Fly volume at `/data/blob-storage`
- `auto_stop_machines = "off"` keeps the app always-on

**Deploy to Vercel (serverless, no persistent storage):**

1. Push this repo to GitHub
2. Import `hwpx-report-automation/web` in Vercel
3. Add `OPENAI_API_KEY` to Environment Variables
4. Deploy

> Note: Vercel doesn't support persistent filesystem volumes. Use Fly.io if you need blob storage to survive across requests.

**Optional environment variables:**

```bash
BLOB_STORAGE_FS_ROOT=/absolute/path/to/blob-storage
BLOB_SIGNING_SECRET=replace-this-in-production
BLOB_SIGNED_URL_TTL_SECONDS=900
AUTH_SECRET=replace-this-in-production
```

For OIDC authentication and multi-tenant setup, see [`web/README.md`](web/README.md).

**Legacy `.hwp` conversion:**

```bash
export HWP_CONVERTER_COMMAND='["node","scripts/mock-hwp-converter.mjs","{input}","{output}"]'
npm run dev
```

In production, point `HWP_CONVERTER_COMMAND` to a commercial or in-house converter. The command must include `{input}` and `{output}` placeholders.

**Tests:**

```bash
npm run lint
npm run test    # undo/redo, section selection, HWPX integrity
npm run build
```

Key test coverage: undo/redo queue consistency (`editor-workflows.test.ts`), section auto-selection, HWPX integrity after edits — `mimetype`, `version.xml`, `Contents/content.hpf` preserved, XML parseable (`hwpx.test.ts`).

---

## When to Use What

| Task | Tool |
|------|------|
| Fill a template once | `python/fill_hwpx_template.py` |
| Inspect what's inside an HWPX | `python/hwpx_editor.py --list` |
| Generate report content with AI | `python/build_report.py` |
| Interactive editing / batch generation | `web/` (HWPX Studio) |
| Verify HWPX file integrity | `python/hancom-verify/` |
| Integrate into a pipeline | Import `apply_placeholders()` |

---

## Design Philosophy

> "Don't re-serialize. Don't re-open. Just find the node and swap the text."

HWPX stores every paragraph, run, and style definition as XML inside a ZIP archive. Most tools re-serialize the entire document tree — risking corrupt style references, lost embedded fonts, or broken layout hints.

Our approach:

1. **Open** the ZIP — read all file entries into memory
2. **Parse** only XML files — leave binary assets untouched
3. **Find** text nodes matching your `{{PLACEHOLDER}}` pattern or target index
4. **Replace** the `.text` property only — attributes, siblings, parent structure: unchanged
5. **Repack** — write each entry back with its original metadata intact

The output `.hwpx` is byte-for-byte identical to the template except for the characters you replaced.

---

## Requirements

| Component | Requirement |
|-----------|-------------|
| `fill_hwpx_template.py` | Python 3.8+ (stdlib only) |
| `hwpx_editor.py` | Python 3.8+ (stdlib only) |
| `build_report.py` | Python 3.8+, `requests`, OpenAI/Anthropic key |
| Web UI | Node.js 18+, npm |
| `hancom-verify` | macOS + Hancom Office installed |

---

## FAQ

**Does this work with HWP (not HWPX)?**
Not natively. HWP uses a legacy binary format. For `.hwp` support, connect an external converter via `HWP_CONVERTER_COMMAND` in the web UI.

**Will the output open correctly in Hancom Office?**
Yes. The output is structurally identical to the input — only the replaced text has changed.

**Can I use this on Linux / in CI?**
Yes, for the Python scripts. No Hancom Office required. `hancom-verify` requires macOS.

**Does this handle tables, headers, footers?**
Yes. `--list` shows all text nodes across all XML files in the HWPX, including tables, headers, and footers. Placeholder substitution works document-wide.

**What's the difference between `fill_hwpx_template.py` and `hwpx_editor.py`?**
`fill_hwpx_template.py` is the high-level tool — mark `{{PLACEHOLDERS}}` in your template, provide a JSON file, done. `hwpx_editor.py` is the low-level tool — inspect every text node by index and apply surgical edits. Use the latter when you need precise control or don't want to modify the template itself.

---

## Background

Built at [MYSC](https://mysc.kr) to automate Korean-format reports — proposals, investment memos, impact assessments — that teams were filling out by hand.

The trigger: watching someone copy-paste ChatGPT output into a Hancom template for 45 minutes every week. There had to be a better way.

---

## Contributing

Issues and PRs welcome. For larger changes, open an issue first.

Ideas:
- Native HWP binary format support
- Better multi-paragraph placeholder values
- CLI wrapper (`hwpx fill template.hwpx data.json`)
- GitHub Actions example for CI-based document generation

---

## License

[MIT](LICENSE) © 2025 MYSC
