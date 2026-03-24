# hwpx-report-automation

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/)
[![Node.js 18+](https://img.shields.io/badge/node-18+-green.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/merryAI-dev/hwpx-report-automation/issues)

**🌐 Language:** [English](#) | [한국어](README-ko.md)

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
├── scripts/
│   ├── fill_hwpx_template.py   Template placeholder substitution ({{KEY}} → value)
│   ├── hwpx_editor.py          Low-level text node inspection and editing
│   ├── build_report.py         AI-powered report generation pipeline
│   └── hancom-verify/          HWPX integrity verification tools (Swift/macOS)
│
└── web/                        Next.js web application
    ├── src/app/                Pages and API routes (27 endpoints)
    ├── src/lib/                Business logic — HWPX processing, AI integration
    └── prisma/                 SQLite database schema (via LibSQL)
```

---

## Quick Start

### Template Filling (Python, no dependencies)

```bash
# 1. Mark placeholders in your .hwpx file as {{KEY}}
#    (edit in Hancom Office, save as .hwpx)

# 2. Create your data file
cat > data.json << 'EOF'
{
  "TITLE": "2025 Annual Report",
  "SUMMARY": "Key highlights from Q1–Q4.",
  "AUTHOR": "Jane Doe"
}
EOF

# 3. Fill and export
python scripts/fill_hwpx_template.py \
  --template template.hwpx \
  --data-json data.json \
  --output output.hwpx
# → Created: output.hwpx
```

That's it. No Hancom Office. No COM automation. No Docker. Just Python's standard library.

---

### Inspect & Edit Text Nodes (Python)

```bash
# See every text node with its index and style attributes
python scripts/hwpx_editor.py --input report.hwpx --list

# Output:
# [{"file_name": "Contents/content0.xml", "text_index": 3, "text": "Title Here", ...}]

# Edit specific nodes by index
python scripts/hwpx_editor.py \
  --input report.hwpx \
  --edits-json edits.json \
  --output report_edited.hwpx
```

---

### AI Report Generation (Python + OpenAI/Anthropic)

```bash
pip install requests

export OPENAI_API_KEY=sk-...

python scripts/build_report.py \
  --template template.hwpx \
  --prompt "Write a Q3 business review for a SaaS company" \
  --output report.hwpx
```

---

### Web UI (Next.js)

```bash
cd web
cp .env.example .env.local   # add your API keys
npm install
npm run dev
# → http://localhost:3000
```

The web UI provides a rich editor, batch document generation, AI suggestions, HWPX integrity checks, and user/quota management.

---

## When to Use What

| Task | Tool | Command |
|------|------|---------|
| Fill a template once | Python script | `fill_hwpx_template.py` |
| Inspect what's inside an HWPX | Python script | `hwpx_editor.py --list` |
| Generate report content with AI | Python script | `build_report.py` |
| Batch-generate many documents | Web UI | `npm run dev` |
| Verify HWPX file integrity | hancom-verify | See `scripts/hancom-verify/` |
| Integrate into a pipeline | Python API | Import `apply_placeholders()` |

---

## Design Philosophy

> "Don't re-serialize. Don't re-open. Just find the node and swap the text."

HWPX stores every paragraph, run, and style definition as XML inside a ZIP archive. Most tools that programmatically "edit" HWPX re-serialize the entire document tree — which risks corrupting proprietary style references, losing embedded fonts, or breaking layout hints that only Hancom's renderer understands.

Our approach:

1. **Open** the ZIP — read all file entries into memory
2. **Parse** only the XML files — leave binary assets (images, fonts) untouched
3. **Find** text nodes matching your `{{PLACEHOLDER}}` pattern or target index
4. **Replace** the `.text` property only — attributes, siblings, parent structure: unchanged
5. **Repack** — write each entry back with its original metadata (filename, compression, timestamps)

The output `.hwpx` is byte-for-byte identical to the template except for the characters you replaced. Open it in Hancom Office and it looks exactly like the original — because structurally, it is.

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

## Use Cases

- **Government / public sector** — auto-fill standard report templates
- **Investment firms** — generate investment memos from structured data
- **Consulting** — batch-produce client deliverables from a master template
- **HR / admin teams** — automate repetitive document workflows
- **AI pipelines** — connect LLM output directly to formatted HWPX output

---

## Contributing

Issues and PRs are welcome.

For larger changes, open an issue first to align on approach. See the project structure above to find the right file to touch.

Ideas for contributions:
- Support for HWP (legacy binary format) alongside HWPX
- Better handling of multi-paragraph placeholder values
- CLI wrapper (`hwpx fill template.hwpx data.json`)
- GitHub Actions example for CI-based document generation

---

## FAQ

**Does this work with HWP (not HWPX)?**
Not currently. HWP uses a binary format; HWPX is the modern ZIP+XML format (Hancom Office 2014+).

**Will the output open correctly in Hancom Office?**
Yes. The output file is structurally identical to the input — only the text you replaced has changed.

**Can I use this on Linux / in CI?**
Yes, for the Python scripts. No Hancom Office installation required. The `hancom-verify` tool requires macOS.

**Does this handle tables, headers, footers?**
`hwpx_editor.py --list` shows all text nodes in all XML files, including those in headers, footers, and tables. `fill_hwpx_template.py` replaces `{{PLACEHOLDERS}}` wherever they appear across the entire document.

---

## Background

Built at [MYSC](https://mysc.kr) to automate the production of Korean-format reports — proposals, investment memos, impact assessments — that teams were previously filling out by hand.

The trigger: watching someone copy-paste ChatGPT output into a Hancom template for 45 minutes every week. There had to be a better way.

---

## License

[MIT](LICENSE) © 2025 MYSC
