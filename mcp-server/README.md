# hwpx-mcp

Claude Desktop과 Cursor에서 HWPX 보고서 자동화를 사용하는 MCP 서버.

## 제공 도구

| 도구 | 설명 |
|------|------|
| `health_check` | 서버 상태 확인 |
| `list_templates` | 사용 가능한 템플릿 목록 조회 |
| `extract_text` | .hwpx 파일에서 텍스트 노드 추출 |
| `fill_template` | 템플릿 플레이스홀더(`{{KEY}}`)를 데이터로 채워 저장 |

## 설치

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`에 추가:

```json
{
  "mcpServers": {
    "hwpx": {
      "command": "npx",
      "args": ["-y", "hwpx-mcp"],
      "env": {
        "HWPX_API_URL": "https://hwpx-report.fly.dev"
      }
    }
  }
}
```

### Cursor

`.cursor/mcp.json`에 추가:

```json
{
  "mcpServers": {
    "hwpx": {
      "command": "npx",
      "args": ["-y", "hwpx-mcp"]
    }
  }
}
```

## 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `HWPX_API_URL` | `https://hwpx-report.fly.dev` | hwpx-report 서버 URL |

## 로컬 개발

```bash
cd mcp-server
npm install
npm run build
node dist/index.js
```

## 사용 예시

Claude에게 이렇게 말하면 돼:

- "hwpx 서버 상태 확인해줘"
- "사용 가능한 HWPX 템플릿 목록 알려줘"
- "~/documents/report.hwpx 파일에서 텍스트 추출해줘"
- "~/documents/template.hwpx의 TITLE을 '2026 투자 보고서', AUTHOR를 '홍길동'으로 채워줘"
