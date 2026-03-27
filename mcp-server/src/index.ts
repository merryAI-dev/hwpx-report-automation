#!/usr/bin/env node

/**
 * hwpx-mcp — MCP server for HWPX report automation
 *
 * Wraps the hwpx-report public API as MCP tools.
 * Set HWPX_API_URL to override the default server URL.
 *
 * Tools:
 *   - health_check       GET  /api/public/health
 *   - list_templates     GET  /api/public/templates
 *   - extract_text       POST /api/public/extract   (file path → text nodes)
 *   - fill_template      POST /api/public/fill      (file path + data → filled .hwpx)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";

const API_URL = process.env.HWPX_API_URL ?? "https://hwpx-report.fly.dev";

// ── Simple fetch helper (no external deps beyond Node built-ins) ──────────────

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    lib.get(url, (res) => {
      let body = "";
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve({ raw: body });
        }
      });
    }).on("error", reject);
  });
}

function postMultipart(
  url: string,
  fields: Record<string, string>,
  fileField: string,
  filePath: string
): Promise<{ buffer: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    const boundary = "----hwpxmcp" + Date.now().toString(16);
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    const parts: Buffer[] = [];

    // text fields
    for (const [key, value] of Object.entries(fields)) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`
        )
      );
    }

    // file field
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`
      )
    );
    parts.push(fileBuffer);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const body = Buffer.concat(parts);
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname,
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            buffer: Buffer.concat(chunks),
            contentType: res.headers["content-type"] ?? "",
          });
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── MCP Server setup ──────────────────────────────────────────────────────────

const server = new Server(
  { name: "hwpx-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "health_check",
      description: "hwpx-report 서버 상태를 확인합니다.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "list_templates",
      description:
        "사용 가능한 HWPX 템플릿 목록을 반환합니다. 각 템플릿에는 name, description, 다운로드 URL이 포함됩니다.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "extract_text",
      description:
        ".hwpx 파일에서 텍스트 노드를 추출합니다. 로컬 파일 경로를 받아 모든 텍스트와 위치(file, index)를 반환합니다.",
      inputSchema: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "추출할 .hwpx 파일의 로컬 절대 경로",
          },
        },
        required: ["file_path"],
      },
    },
    {
      name: "fill_template",
      description:
        ".hwpx 템플릿의 플레이스홀더({{KEY}})를 데이터로 채워서 결과 파일을 저장합니다.",
      inputSchema: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "템플릿 .hwpx 파일의 로컬 절대 경로",
          },
          data: {
            type: "object",
            description:
              '플레이스홀더 → 치환값 맵. 예: {"TITLE": "2026 보고서", "AUTHOR": "홍길동"}',
            additionalProperties: { type: "string" },
          },
          output_path: {
            type: "string",
            description:
              "결과 파일을 저장할 경로 (생략 시 원본 파일명에 _filled 접미사 추가)",
          },
        },
        required: ["file_path", "data"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // ── health_check ──────────────────────────────────────────────────────────
    if (name === "health_check") {
      const result = await fetchJson(`${API_URL}/api/public/health`);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── list_templates ────────────────────────────────────────────────────────
    if (name === "list_templates") {
      const result = await fetchJson(`${API_URL}/api/public/templates`);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── extract_text ──────────────────────────────────────────────────────────
    if (name === "extract_text") {
      const filePath = (args as { file_path: string }).file_path;

      if (!fs.existsSync(filePath)) {
        return {
          content: [{ type: "text", text: `오류: 파일을 찾을 수 없습니다 — ${filePath}` }],
          isError: true,
        };
      }

      const { buffer, contentType } = await postMultipart(
        `${API_URL}/api/public/extract`,
        {},
        "file",
        filePath
      );

      if (contentType.includes("application/json")) {
        const json = JSON.parse(buffer.toString("utf-8"));
        return {
          content: [{ type: "text", text: JSON.stringify(json, null, 2) }],
        };
      }

      return {
        content: [{ type: "text", text: buffer.toString("utf-8") }],
      };
    }

    // ── fill_template ─────────────────────────────────────────────────────────
    if (name === "fill_template") {
      const { file_path, data, output_path } = args as {
        file_path: string;
        data: Record<string, string>;
        output_path?: string;
      };

      if (!fs.existsSync(file_path)) {
        return {
          content: [{ type: "text", text: `오류: 파일을 찾을 수 없습니다 — ${file_path}` }],
          isError: true,
        };
      }

      const { buffer, contentType } = await postMultipart(
        `${API_URL}/api/public/fill`,
        { data: JSON.stringify(data) },
        "file",
        file_path
      );

      // API가 JSON 에러를 반환한 경우
      if (contentType.includes("application/json")) {
        const json = JSON.parse(buffer.toString("utf-8"));
        return {
          content: [{ type: "text", text: JSON.stringify(json, null, 2) }],
          isError: true,
        };
      }

      // 성공 — .hwpx 바이너리 저장
      const ext = path.extname(file_path);
      const base = path.basename(file_path, ext);
      const dir = path.dirname(file_path);
      const savePath =
        output_path ?? path.join(dir, `${base}_filled${ext}`);

      fs.writeFileSync(savePath, buffer);

      return {
        content: [
          {
            type: "text",
            text: `완료! 채워진 파일이 저장되었습니다:\n${savePath}\n\n적용된 플레이스홀더:\n${Object.entries(data)
              .map(([k, v]) => `  {{${k}}} → ${v}`)
              .join("\n")}`,
          },
        ],
      };
    }

    return {
      content: [{ type: "text", text: `알 수 없는 도구: ${name}` }],
      isError: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `오류가 발생했습니다: ${message}` }],
      isError: true,
    };
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // MCP 서버는 stderr로만 로그 출력 (stdout은 프로토콜 통신용)
  process.stderr.write("hwpx-mcp server started\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
