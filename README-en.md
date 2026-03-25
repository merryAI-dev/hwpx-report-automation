# hwpx-report-automation

[![CI](https://github.com/merryAI-dev/hwpx-report-automation/actions/workflows/ci.yml/badge.svg)](https://github.com/merryAI-dev/hwpx-report-automation/actions/workflows/ci.yml)
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

## Table of Contents

- [What is this?](#what-is-this)
- [What's Inside](#whats-inside)
- [Quick Start](#quick-start)
  - [Template Filling (Python Script)](#template-filling-python-no-dependencies)
  - [Inspect & Edit Text Nodes](#inspect--edit-text-nodes-python)
  - [AI Report Generation](#ai-report-generation-python--openaianthropic)
  - [pyhwpx — Python Package](#pyhwpx--python-package-pip)
  - [MCP Server — Claude / Cursor Integration](#mcp-server--claude--cursor-integration)
  - [Playground — Try it in the Browser](#playground--try-it-in-the-browser-no-auth-required)
  - [HWPX Studio — Web UI](#hwpx-studio--web-ui-nextjs)
- [Deployment](#deployment)
- [Environment Variables](#environment-variables)
- [When to Use What](#when-to-use-what)
- [Public REST API](#public-rest-api)
- [Design Philosophy](#design-philosophy)
- [Requirements](#requirements)
- [Use Cases](#use-cases)
- [Contributing](#contributing)
- [FAQ](#faq)
- [Background](#background)
- [License](#license)

---

## What is this?

Hancom Office (HWP/HWPX) is the dominant document format in Korea — used in virtually every government agency, public institution, and enterprise. Yet there's **no public programmatic API** to edit `.hwpx` files.

Every workaround has problems:

| Approach | Problem |
|----------|---------|
| Hancom Office COM automation | License required, Windows-only, no server support |
| Full XML re-serialization | Destroys Hancom-specific style references, loses embedded fonts |
| Export to DOCX then edit | Completely destroys original formatting, no round-trip |
| Commercial libraries | Cost, closed source, server environment restrictions |

This project does none of that. It treats HWPX as what it actually is — **a ZIP archive of XML files** — and surgically edits only the text nodes you specify. Everything else is untouched, byte for byte.

```
template.hwpx  →  fill_hwpx_template.py  →  output.hwpx
                        ↑
                  {"TITLE": "2025 Annual Report",
                   "AUTHOR": "Jane Doe"}
```

### HWPX Internal Structure

Open any HWPX file with `unzip` and you'll find:

```
document.hwpx (actually a ZIP)
├── mimetype                      # "application/hwp+zip"
├── META-INF/
│   └── container.xml
├── Contents/
│   ├── content.hpf               # Package root (OPF)
│   ├── header.xml                # Document properties, styles, font definitions
│   ├── section0.xml              # Body (1st section)
│   ├── section1.xml              # Body (2nd section, if present)
│   └── ...
└── BinData/
    ├── image1.png                # Embedded images (binary, never touched)
    └── ...
```

This project only replaces the text content of `<hp:t>` elements inside `section*.xml` files. Images, fonts, styles, and everything else are preserved byte-for-byte.

---

## What's Inside

```
hwpx-report-automation/
│
├── scripts/                        Python CLI scripts (zero dependencies)
│   ├── fill_hwpx_template.py       Template placeholder substitution ({{KEY}} → value)
│   ├── hwpx_editor.py              Low-level text node inspection and editing
│   ├── build_report.py             AI-powered report generation pipeline
│   └── hancom-verify/              HWPX integrity verification (Swift/macOS only)
│
├── mcp-server/                     MCP server (Claude / Cursor natural language integration)
│   ├── src/                        TypeScript source
│   ├── dist/index.js               Bundled ESM (esbuild)
│   └── package.json                hwpx-mcp v1.0.0
│
├── pyhwpx/                         Pure Python package (stdlib only)
│   ├── pyhwpx/
│   │   ├── __init__.py             Exposes fill_template, extract_nodes
│   │   └── core.py                 zipfile + xml.etree.ElementTree implementation
│   └── pyproject.toml
│
└── web/                            Next.js web application (HWPX Studio)
    ├── src/
    │   ├── app/                    App Router pages and API routes (64 endpoints)
    │   │   ├── (auth)/             Login, signup, OIDC callbacks
    │   │   ├── api/
    │   │   │   ├── public/         No-auth public API
    │   │   │   │   ├── health/     GET  — Health check
    │   │   │   │   ├── extract/    POST — Extract text nodes
    │   │   │   │   ├── fill/       POST — Fill placeholders
    │   │   │   │   ├── templates/  GET  — List built-in templates
    │   │   │   │   ├── docs/       GET  — OpenAPI 3.0.3 spec
    │   │   │   │   └── docs/ui/    GET  — Swagger UI
    │   │   │   └── ...             Auth-required APIs (documents, editing, AI, etc.)
    │   │   └── demo/               Playground (no auth required)
    │   ├── lib/                    Business logic
    │   │   ├── hwpx/               HWPX processing (node extraction, substitution, integrity checks)
    │   │   ├── ai/                 Anthropic/OpenAI/Gemini integration
    │   │   ├── auth/               Session management, OIDC
    │   │   └── blob/               File storage (FS / S3)
    │   └── components/             React components
    ├── prisma/
    │   └── schema.prisma           SQLite schema (users, documents, templates)
    ├── fly.toml                    Fly.io deployment config
    └── Dockerfile                  Docker image
```

---

## Quick Start

### Template Filling (Python, No Dependencies)

The simplest way to get started. Uses only Python's standard library — no installation required.

**Step 1: Prepare your template in Hancom Office**

Open your `.hwpx` file and type `{{KEY}}` placeholders wherever you want values substituted. Just type them as regular text.

```
Example: Type {{TITLE}} in the title cell
         Type {{AUTHOR}} in the author field
         Type {{DATE}} in the date field
```

**Step 2: Create a data file**

```bash
cat > data.json << 'EOF'
{
  "TITLE": "2025 Annual Report",
  "SUMMARY": "Key highlights from Q1–Q4.",
  "AUTHOR": "Jane Doe",
  "DATE": "December 31, 2025",
  "DEPARTMENT": "Strategy & Planning"
}
EOF
```

**Step 3: Run**

```bash
python scripts/fill_hwpx_template.py \
  --template template.hwpx \
  --data-json data.json \
  --output output.hwpx
```

```
✓ Replaced 5 placeholder(s)
✓ Created: output.hwpx
```

**Notes:**
- Keys are case-insensitive: `{"title": "..."}` matches `{{TITLE}}`
- Placeholder format: `{{KEY}}` — keys may contain letters, digits, and underscores
- XML special characters (`<`, `>`, `&`) in values are automatically escaped
- The same key in multiple places is replaced everywhere

No Hancom Office. No COM automation. No Docker. Just Python's standard library (`zipfile`, `xml.etree.ElementTree`).

---

### Inspect & Edit Text Nodes (Python)

Use this when you need to edit an HWPX file directly without placeholders. Identify every text node by index and replace only the ones you want.

**List all text nodes:**

```bash
python scripts/hwpx_editor.py --input report.hwpx --list
```

Example output:

```json
[
  {
    "file_name": "Contents/section0.xml",
    "text_index": 0,
    "text": "2024 Annual Business Report",
    "bold": true,
    "font_size": 22
  },
  {
    "file_name": "Contents/section0.xml",
    "text_index": 1,
    "text": "Date: 2024.12.31",
    "bold": false,
    "font_size": 10
  },
  {
    "file_name": "Contents/section0.xml",
    "text_index": 2,
    "text": "1. Business Overview",
    "bold": true,
    "font_size": 14
  }
]
```

**Edit nodes by index:**

```bash
# Write edits.json: which file, which node index, what new text
cat > edits.json << 'EOF'
[
  {
    "file_name": "Contents/section0.xml",
    "text_index": 0,
    "new_text": "2025 Annual Business Report"
  },
  {
    "file_name": "Contents/section0.xml",
    "text_index": 1,
    "new_text": "Date: 2025.12.31"
  }
]
EOF

python scripts/hwpx_editor.py \
  --input report.hwpx \
  --edits-json edits.json \
  --output report_edited.hwpx
```

```
✓ Applied 2 edit(s)
✓ Created: report_edited.hwpx
```

`hwpx_editor.py` handles text nodes across **all sections**, including headers, footers, and table cells. Use `--list` to find indices, then `--edits-json` for surgical edits.

---

### AI Report Generation (Python + OpenAI/Anthropic)

LLM generates the report content, which is automatically written into your HWPX template.

```bash
pip install requests

export OPENAI_API_KEY=sk-...
# or
export ANTHROPIC_API_KEY=sk-ant-...

python scripts/build_report.py \
  --template template.hwpx \
  --prompt "Write a Q3 business review for a SaaS company. Include key metrics, major achievements, and next quarter plans." \
  --output report_q3.hwpx
```

How it works:
1. Uses `--list` to understand the template's text node structure
2. Asks the LLM to fill in content that matches this structure
3. Parses the LLM response and applies it to each node
4. Saves the completed HWPX

---

### pyhwpx — Python Package (pip)

Import directly into your Python code without needing the `scripts/` folder. Zero external dependencies — stdlib only.

**Install:**

```bash
pip install pyhwpx
```

**`fill_template` — Fill placeholders:**

```python
from pyhwpx import fill_template

# Basic usage
count = fill_template(
    input_path="template.hwpx",
    placeholders={"TITLE": "2026 Annual Report", "AUTHOR": "Jane Doe"},
    output_path="output.hwpx",
)
print(f"Replaced {count} placeholder(s)")
# → Replaced 2 placeholder(s)
```

- `count` — returns the number of `{{PLACEHOLDER}}` occurrences actually replaced
- Keys are automatically uppercased: `{"title": "..."}` matches `{{TITLE}}`
- XML special characters in values are automatically escaped
- If `input_path` and `output_path` are the same, the file is edited in place

**`extract_nodes` — Extract text nodes:**

```python
from pyhwpx import extract_nodes

nodes = extract_nodes("document.hwpx")

for node in nodes:
    print(f"[{node['file_name']} #{node['text_index']}] {node['text']}")
# → [Contents/section0.xml #0] 2024 Annual Business Report
# → [Contents/section0.xml #1] Date: 2024.12.31
# → [Contents/section0.xml #2] 1. Business Overview
```

Return type: `list[{"file_name": str, "text_index": int, "text": str}]`

**Pipeline integration example:**

```python
from pyhwpx import fill_template, extract_nodes
import json

# 1. Understand the template structure
nodes = extract_nodes("template.hwpx")
placeholders = [n["text"] for n in nodes if n["text"].startswith("{{")]
print("Required fields:", placeholders)

# 2. Fetch data from an external system (e.g., DB, API)
data = fetch_report_data_from_db()

# 3. Fill and save
count = fill_template("template.hwpx", data, "output.hwpx")
print(f"{count} fields filled")
```

**Without pip:**

Copy the `pyhwpx/` directory into your project and import directly:

```python
import sys
sys.path.insert(0, "/path/to/hwpx-report-automation")
from pyhwpx import fill_template
```

---

### MCP Server — Claude / Cursor Integration

An MCP (Model Context Protocol) server that lets you handle HWPX tasks in natural language from Claude Desktop or Cursor.

**Build (one-time setup):**

```bash
cd mcp-server
npm install
npm run build
# → dist/index.js created
```

**Claude Desktop configuration:**

macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "hwpx": {
      "command": "node",
      "args": ["/absolute/path/to/hwpx-report-automation/mcp-server/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop after editing the config.

**Cursor configuration:**

`.cursor/mcp.json` (per-project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "hwpx": {
      "command": "node",
      "args": ["/absolute/path/to/hwpx-report-automation/mcp-server/dist/index.js"]
    }
  }
}
```

**Available tools:**

| Tool | Description | Inputs |
|------|-------------|--------|
| `fill_hwpx` | Fill `{{PLACEHOLDER}}` values in a template | `template_path`, `data` (JSON object), `output_path` |
| `extract_placeholders` | List all `{{PLACEHOLDER}}` keys in an HWPX file | `file_path` |
| `list_templates` | List available server-side templates | (none) |

**Usage example (in Claude):**

```
User: "What placeholders are in template.hwpx?"
Claude: Calling extract_placeholders...
        → ["TITLE", "AUTHOR", "DATE", "SUMMARY"]

User: "Fill TITLE with '2026 Strategy Report' and AUTHOR with 'John Smith'"
Claude: Calling fill_hwpx...
        → 2 placeholders replaced, output.hwpx saved
```

---

### Playground — Try it in the Browser (No Auth Required)

A demo page where you can experience HWPX features instantly without signing up. Perfect for first-time visitors, technical evaluators, and team demos.

**Access:**

```
http://localhost:3000/demo      # Local dev server
https://YOUR_DOMAIN/demo        # Deployed instance
```

**Usage flow:**

```
1. Select a template
   └─ Choose from built-in sample templates on the server

2. Auto-detect placeholders
   └─ {{PLACEHOLDER}} keys are read from the selected template
      and rendered as individual input fields

3. Fill in values
   └─ Complete the form and click "Generate"

4. Download
   └─ Completed output.hwpx is downloaded immediately
      → Opens directly in Hancom Office
```

**Features:**
- No authentication — use immediately without creating an account
- Generated files are not stored on the server (one-shot processing)
- Works in mobile browsers

---

### HWPX Studio — Web UI (Next.js)

A full-featured HWPX editor that runs in the browser. Deploy to Vercel or Fly.io to share with your entire team.

**Features:**

| Feature | Description |
|---------|-------------|
| Upload & edit HWPX | Upload files and browse/edit text nodes directly in the browser |
| Legacy `.hwp` support | Integration with external converter via `HWP_CONVERTER_COMMAND` |
| AI chat sidebar | Anthropic / OpenAI / Google Gemini BYOK, rendered markdown |
| PPTX → HWPX wizard | Upload PPT → analyze content → generate report structure → export HWPX |
| Placeholder substitution | Batch `{{PLACEHOLDER}}` replacement with preview |
| Batch document generation | Generate hundreds of documents from a CSV + single template |
| Document vault & dashboard | Notion-style document management with folder organization |
| Local draft cache | Auto-saves to localStorage every 30s, restore banner on reload |
| HWPX integrity checks | Validates `mimetype`, `version.xml`, XML parseability |
| User & quota management | Multi-user support, per-tenant document/template limits |

**Local run:**

```bash
cd web
cp .env.example .env.local   # Configure environment variables (see "Environment Variables" below)
npm install
npm run dev
# → http://localhost:3000
```

**Run tests:**

```bash
npm run lint          # ESLint
npm run test          # vitest (unit + integration tests)
npm run build         # Verify production build
```

---

## Deployment

### Fly.io (Recommended — persistent file storage)

Supports persistent volumes so uploaded HWPX files survive restarts.

```bash
cd web

# 1. Log in to Fly.io CLI
fly auth login

# 2. Initialize app (fly.toml is already included — no regeneration needed)
fly launch --no-deploy

# 3. Set secrets
fly secrets set \
  NEXTAUTH_SECRET="$(openssl rand -base64 32)" \
  ANTHROPIC_API_KEY="sk-ant-..." \
  OPENAI_API_KEY="sk-..." \
  BLOB_SIGNING_SECRET="$(openssl rand -base64 32)"

# 4. Create persistent volume (file storage)
fly volumes create hwpx_data --region nrt --size 1   # 1GB, Tokyo region

# 5. Deploy
fly deploy
```

Default configuration (`fly.toml`):
- Region: `nrt` (Tokyo) — closest to Korea
- File storage: `/data/blob-storage` (persistent volume mount)
- `auto_stop_machines = "off"` — always running, no cold starts

### Vercel (Serverless — no persistent file storage)

No persistent filesystem, so file storage must be configured with S3.

```bash
# 1. Push this repo to GitHub
# 2. Import web/ directory as root in Vercel Dashboard
# 3. Add Environment Variables:
#    NEXTAUTH_SECRET=...
#    ANTHROPIC_API_KEY=...
#    BLOB_STORAGE_DRIVER=s3
#    BLOB_STORAGE_S3_BUCKET=...
#    BLOB_STORAGE_S3_REGION=ap-northeast-2
#    BLOB_STORAGE_S3_ACCESS_KEY_ID=...
#    BLOB_STORAGE_S3_SECRET_ACCESS_KEY=...
```

> **Note:** Vercel serverless functions cannot write to the local filesystem. You must set `BLOB_STORAGE_DRIVER=s3`.

### Docker (Self-hosted)

```bash
cd web
docker build -t hwpx-studio .
docker run -p 3000:3000 \
  -e NEXTAUTH_SECRET="your-secret" \
  -e ANTHROPIC_API_KEY="sk-ant-..." \
  -v /host/data:/data/blob-storage \
  hwpx-studio
```

---

## Environment Variables

Copy `web/.env.example` to `web/.env.local` to get started.

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXTAUTH_SECRET` | Session signing key (32+ random characters) | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Public URL of the app (required in production) | `https://hwpx.example.com` |

At least one AI key is required:

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key (AI chat sidebar) |
| `OPENAI_API_KEY` | OpenAI API key |

### Optional — AI Model Override

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Claude model to use |
| `OPENAI_MODEL` | `gpt-4.1-mini` | OpenAI model to use |

### Optional — File Storage

| Variable | Default | Description |
|----------|---------|-------------|
| `BLOB_STORAGE_DRIVER` | `fs` | `fs` (local filesystem) or `s3` |
| `BLOB_STORAGE_FS_ROOT` | `.blob-storage` | Storage path for `fs` driver |
| `BLOB_STORAGE_S3_BUCKET` | — | S3 bucket name |
| `BLOB_STORAGE_S3_REGION` | `ap-northeast-2` | S3 region |
| `BLOB_STORAGE_S3_ACCESS_KEY_ID` | — | AWS access key |
| `BLOB_STORAGE_S3_SECRET_ACCESS_KEY` | — | AWS secret key |
| `BLOB_STORAGE_S3_ENDPOINT` | — | S3-compatible storage endpoint (MinIO, etc.) |
| `BLOB_SIGNING_SECRET` | — | Secret for signing file download URLs |

### Optional — Quota & Other

| Variable | Default | Description |
|----------|---------|-------------|
| `QUOTA_MAX_DOCUMENTS` | `100` | Max documents per user |
| `QUOTA_MAX_TEMPLATES` | `20` | Max templates per user |
| `QUOTA_MAX_BLOB_BYTES` | `5368709120` | Max storage per user (5 GB) |
| `HWP_CONVERTER_COMMAND` | — | Legacy `.hwp` converter command (e.g., `["node","converter.js","{input}","{output}"]`) |
| `PORT` | `3000` | HTTP port |

---

## When to Use What

| Task | Tool | Command / Method |
|------|------|-----------------|
| Fill a template once | Python script | `python scripts/fill_hwpx_template.py` |
| Inspect what's inside an HWPX | Python script | `python scripts/hwpx_editor.py --list` |
| Generate report content with AI | Python script | `python scripts/build_report.py` |
| Import into a Python pipeline | pyhwpx package | `pip install pyhwpx` |
| Use from Claude / Cursor | MCP server | `mcp-server/dist/index.js` |
| Try without signing up | Playground | `http://localhost:3000/demo` |
| Batch generation / team sharing | HWPX Studio | `npm run dev` → http://localhost:3000 |
| Verify HWPX file integrity | hancom-verify | `scripts/hancom-verify/` |
| Integrate via HTTP | Public REST API | `/api/public/*` (see below) |

---

## Public REST API

Open API endpoints — no authentication required.

**Common:**
- Rate limit: **2 req/min per IP per endpoint**
- Max file size: **10 MB**
- Response format: JSON (file downloads are `application/octet-stream`)
- CORS: All origins allowed (`Access-Control-Allow-Origin: *`)

**Common error responses:**

```json
// 429 Too Many Requests
{"error": "Rate limit exceeded. Try again in 60 seconds."}

// 400 Bad Request
{"error": "Missing required field: file"}

// 413 Payload Too Large
{"error": "File too large. Maximum size is 10 MB."}
```

---

### `GET /api/public/health`

Check server status. Use for post-deploy health checks and uptime monitoring.

```bash
curl https://YOUR_DOMAIN/api/public/health
```

Response `200 OK`:
```json
{
  "status": "ok",
  "ts": "2025-01-15T09:00:00.000Z"
}
```

---

### `POST /api/public/extract`

Extract all text nodes from an HWPX file as JSON. Use to discover placeholders or analyze content.

```bash
curl -X POST https://YOUR_DOMAIN/api/public/extract \
  -F "file=@document.hwpx"
```

Response `200 OK`:
```json
{
  "nodes": [
    {
      "file": "Contents/section0.xml",
      "index": 0,
      "text": "{{TITLE}}"
    },
    {
      "file": "Contents/section0.xml",
      "index": 1,
      "text": "Date: {{DATE}}"
    },
    {
      "file": "Contents/section0.xml",
      "index": 2,
      "text": "1. Business Overview"
    }
  ],
  "count": 3
}
```

Field descriptions:
- `file` — XML file path inside the HWPX
- `index` — Zero-based index of the text node within that XML file
- `text` — Text content (returned regardless of whether it contains placeholders)
- `count` — Total number of nodes

---

### `POST /api/public/fill`

Substitute `{{PLACEHOLDER}}` values in an HWPX template and return the completed file.

```bash
curl -X POST https://YOUR_DOMAIN/api/public/fill \
  -F "file=@template.hwpx" \
  -F 'data={"TITLE":"2026 Annual Report","AUTHOR":"Jane Doe","DATE":"2026.01.01"}' \
  --output output.hwpx
```

Response: `200 OK` — `Content-Type: application/octet-stream` (the completed `.hwpx` file)

Error response `400 Bad Request`:
```json
{"error": "No placeholders were replaced. Check that {{PLACEHOLDER}} keys exist in the template and match the data keys."}
```

---

### `GET /api/public/templates`

List built-in sample templates and their placeholder keys. Used by the Playground (`/demo`).

```bash
curl https://YOUR_DOMAIN/api/public/templates
```

Response `200 OK`:
```json
{
  "templates": [
    {
      "id": "annual-report",
      "name": "Annual Report",
      "description": "Standard corporate annual report template",
      "placeholders": ["TITLE", "AUTHOR", "DATE", "SUMMARY", "DEPARTMENT"]
    },
    {
      "id": "investment-memo",
      "name": "Investment Memo",
      "description": "Startup investment review memo template",
      "placeholders": ["COMPANY", "REVIEWER", "DATE", "AMOUNT", "STAGE"]
    }
  ]
}
```

---

### `GET /api/public/docs`

OpenAPI 3.0.3 spec JSON. Use with third-party tools (Postman, Insomnia, SDK generators).

```bash
curl https://YOUR_DOMAIN/api/public/docs
# → OpenAPI 3.0.3 JSON (Content-Type: application/json)
```

---

### `GET /api/public/docs/ui`

Swagger UI interface. Browse the API spec and make live calls from your browser.

```
https://YOUR_DOMAIN/api/public/docs/ui
```

---

## Design Philosophy

> "Don't re-serialize. Don't re-open. Just find the node and swap the text."

### Why Other Approaches Fail

HWPX stores every paragraph, run, and style definition as XML inside a ZIP archive. Most tools parse and re-serialize the entire document tree — and that's where things break:

```
[Typical approach]
  Original HWPX
      ↓ Parse (read entire XML tree)
  DOM tree in memory
      ↓ Modify
  Modified DOM tree
      ↓ Re-serialize (write entire XML back)  ← breaks here
  Output HWPX

  Problems:
  - Hancom-specific style attributes are omitted or transformed
  - Embedded font references break
  - XML namespace declaration order changes → Hancom can't recognize
  - Unnecessary whitespace added → layout shifts
```

### This Project's Approach

```
[This project's approach]
  Original HWPX (ZIP)
      ↓ Open ZIP — read file entry list only
  File entries
      ↓ Select only XML files (BinData/ binaries untouched)
  Parse XML — locate <hp:t> element positions
      ↓ Replace text only (change .text property of one element)
  Modified XML (everything else: original bytes)
      ↓ Repack ZIP — preserve original metadata for each entry
  Output HWPX

  Result:
  - Every byte identical except the replaced text
  - Formatting, fonts, images, layout: perfectly preserved
```

Concrete steps:

1. **Open ZIP** — read all file entries into memory
2. **Parse only XML** — select only `Contents/section*.xml` files; leave images, fonts, and other binaries untouched
3. **Find text nodes** — traverse `<hp:t>` elements, match `{{PLACEHOLDER}}` pattern or target index
4. **Replace `.text` only** — attributes, sibling nodes, parent structure: all unchanged
5. **Repack** — write each entry back with its original metadata (filename, compression method, modification time)

The output `.hwpx` is byte-for-byte identical to the template except for the characters you replaced. Open it in Hancom Office and it looks exactly like the original — because structurally, it is.

---

## Requirements

| Component | Requirement | Notes |
|-----------|-------------|-------|
| `fill_hwpx_template.py` | Python 3.8+ (stdlib only) | No external packages |
| `hwpx_editor.py` | Python 3.8+ (stdlib only) | No external packages |
| `build_report.py` | Python 3.8+, `requests` | OpenAI or Anthropic key required |
| `pyhwpx` package | Python 3.8+ (stdlib only) | `pip install pyhwpx` |
| MCP server | Node.js 18+ | `cd mcp-server && npm install && npm run build` |
| Web UI (dev) | Node.js 18+, npm | `cd web && npm install && npm run dev` |
| Web UI (deploy) | Docker or Node.js 18+ | Fly.io / Vercel / self-hosted |
| `hancom-verify` | macOS + Hancom Office installed | HWPX integrity verification only |

---

## Use Cases

- **Government & public institutions** — Automate standard report forms. Keep the Hancom format intact while filling in content automatically
- **Investment firms & VCs** — Generate investment memos from structured data. Portfolio company data → standard memo template
- **Consulting** — Mass-produce deliverables from master templates. Hundreds of client-specific documents in seconds
- **HR & admin teams** — Automate repetitive document work. Employment contracts, appointment letters, certificates in bulk
- **AI pipelines** — Connect LLM output directly to formatted HWPX. ChatGPT/Claude results → Korean document format automatically
- **System integration** — Connect to existing business systems via the public REST API

---

## Contributing

Issues and PRs welcome. For larger changes, please open an issue first.

**Development setup:**

```bash
# Clone the repository
git clone https://github.com/merryAI-dev/hwpx-report-automation.git
cd hwpx-report-automation

# Web app development
cd web
npm install
cp .env.example .env.local    # Configure environment variables
npm run dev

# MCP server development
cd ../mcp-server
npm install
npm run build
npm test

# Python script testing
python scripts/fill_hwpx_template.py --help
python scripts/hwpx_editor.py --help
```

**Ideas:**

| Idea | Difficulty | Files |
|------|------------|-------|
| Native HWP binary format support | Hard | `scripts/`, `pyhwpx/` |
| Multi-paragraph placeholder values | Medium | `scripts/fill_hwpx_template.py` |
| CLI wrapper (`hwpx fill template.hwpx data.json`) | Easy | New file |
| Type hints for pyhwpx | Easy | `pyhwpx/pyhwpx/` |
| Direct file upload in the Playground | Medium | `web/src/app/demo/` |

See `.github/workflows/examples/hwpx-ci-example.yml` for a CI-based document generation workflow example.

---

## FAQ

**Does this work with HWP (not HWPX)?**

The legacy `.hwp` binary format is not natively supported. HWPX is the ZIP+XML format introduced in Hancom Office 2014+. If you have a `.hwp` file, open it in Hancom Office and save as `.hwpx`. The web UI's `.hwp` upload feature handles conversion via an external converter (`HWP_CONVERTER_COMMAND`).

**Will the output open correctly in Hancom Office?**

Yes. The output is structurally identical to the input — only the replaced text has changed. Works in Hancom Office 2014 through the latest version. Formatting, fonts, and images display exactly as in the original.

**Can I use this on Linux / in CI?**

Yes, for the Python scripts (`fill_hwpx_template.py`, `hwpx_editor.py`, `build_report.py`), the `pyhwpx` package, and the web UI. No Hancom Office required. Only `hancom-verify` requires macOS + Hancom Office.

**Does this handle tables, headers, and footers?**

Yes. `hwpx_editor.py --list` returns all `<hp:t>` elements in `Contents/section*.xml`, including headers, footers, and table cells. `fill_hwpx_template.py` searches for `{{PLACEHOLDER}}` throughout the entire document.

**Can I process multiple files at once?**

The Python scripts process one file at a time. For batch processing, use a shell loop or the web UI's batch generation feature (CSV upload → bulk generation).

**How do I build the MCP server?**

```bash
cd mcp-server
npm install
npm run build
# → dist/index.js created
```

Requires Node.js 18+. After building, use the absolute path to `dist/index.js` in your Claude Desktop or Cursor configuration.

**What's the difference between `fill_hwpx_template.py` and `hwpx_editor.py`?**

Both work, different interfaces. `scripts/fill_hwpx_template.py` is the CLI script — run it directly from the terminal. `pyhwpx` is the Python package — import it into your code. For pipeline integration, `pyhwpx` is cleaner.

**What if a placeholder spans multiple text runs?**

When you type `{{TITLE}}` in Hancom Office, it's normally stored as a single text run. But if you position your cursor in the middle or change formatting mid-word, it may be split into multiple runs like `{{TI`, `TLE`, `}}` — which won't match. Fix: in Hancom Office, select and delete the entire cell/paragraph, then retype `{{KEY}}` from scratch.

---

## Background

Built at [MYSC](https://mysc.kr) to automate Korean-format reports — proposals, investment memos, impact assessments — that teams were filling out by hand.

The trigger: watching someone copy-paste ChatGPT output into a Hancom template for 45 minutes every week. There had to be a better way.

---

## License

[MIT](LICENSE) © 2025 MYSC
