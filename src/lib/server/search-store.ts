import type { WorkspaceActor, WorkspaceEnv } from "./workspace-store";
import { listWorkspaceDocuments, listWorkspaceTemplates } from "./workspace-store";
import type { WorkspaceDocumentSummary, WorkspaceTemplateSummary } from "@/lib/workspace-types";

export type SearchResultType = "document" | "template";

export type SearchResult = {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string;
  status: string;
  updatedAt: string;
  score: number;
  highlight: string;
};

export type SearchResponse = {
  query: string;
  total: number;
  results: SearchResult[];
  durationMs: number;
};

function computeScore(query: string, value: string): number {
  const q = query.toLowerCase();
  const v = value.toLowerCase();
  if (!v || !q) return 0;
  if (v === q) return 1.0;
  if (v.startsWith(q)) return 1.0;
  if (v.includes(q)) return 0.7;
  // fuzzy: each word of query matches value
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => v.includes(w))) return 0.4;
  if (words.length === 1 && words[0] && v.includes(words[0].slice(0, Math.max(2, Math.floor(words[0].length * 0.6))))) return 0.4;
  return 0;
}

function buildHighlight(query: string, field: string, value: string): string {
  if (!value) return "";
  const idx = value.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return `${field}: ${value.slice(0, 60)}`;
  const start = Math.max(0, idx - 20);
  const end = Math.min(value.length, idx + query.length + 20);
  const snippet = (start > 0 ? "…" : "") + value.slice(start, end) + (end < value.length ? "…" : "");
  return `${field}: ${snippet}`;
}

function scoreDocument(query: string, doc: WorkspaceDocumentSummary): { score: number; highlight: string } {
  const fields: Array<{ name: string; value: string; multiplier: number }> = [
    { name: "제목", value: doc.title, multiplier: 1.0 },
    { name: "형식", value: doc.sourceFormat, multiplier: 0.5 },
    { name: "상태", value: doc.status, multiplier: 0.5 },
  ];

  let bestScore = 0;
  let bestHighlight = "";

  for (const field of fields) {
    const raw = computeScore(query, field.value);
    const adjusted = raw * field.multiplier;
    if (adjusted > bestScore) {
      bestScore = adjusted;
      bestHighlight = buildHighlight(query, field.name, field.value);
    }
  }

  return { score: bestScore, highlight: bestHighlight };
}

function scoreTemplate(query: string, tmpl: WorkspaceTemplateSummary): { score: number; highlight: string } {
  const fields: Array<{ name: string; value: string; multiplier: number }> = [
    { name: "이름", value: tmpl.name, multiplier: 1.0 },
    { name: "문서 유형", value: tmpl.documentType, multiplier: 0.6 },
    { name: "카탈로그", value: tmpl.catalogVersion, multiplier: 0.4 },
    { name: "상태", value: tmpl.status, multiplier: 0.5 },
  ];

  let bestScore = 0;
  let bestHighlight = "";

  for (const field of fields) {
    const raw = computeScore(query, field.value);
    const adjusted = raw * field.multiplier;
    if (adjusted > bestScore) {
      bestScore = adjusted;
      bestHighlight = buildHighlight(query, field.name, field.value);
    }
  }

  return { score: bestScore, highlight: bestHighlight };
}

export async function searchWorkspace(params: {
  tenantId: string;
  actor: WorkspaceActor;
  query: string;
  types?: SearchResultType[];
  limit?: number;
  env?: WorkspaceEnv;
}): Promise<SearchResponse> {
  const start = Date.now();
  const query = params.query.trim();
  const limit = Math.min(params.limit ?? 20, 50);
  const types: SearchResultType[] = params.types && params.types.length > 0 ? params.types : ["document", "template"];

  if (!query) {
    return { query, total: 0, results: [], durationMs: Date.now() - start };
  }

  const results: SearchResult[] = [];

  if (types.includes("document")) {
    let docs: WorkspaceDocumentSummary[] = [];
    try {
      docs = await listWorkspaceDocuments({ tenantId: params.tenantId, actor: params.actor, env: params.env });
    } catch {
      docs = [];
    }

    for (const doc of docs) {
      const { score, highlight } = scoreDocument(query, doc);
      if (score > 0) {
        const versionLabel = `v${doc.currentVersionNumber}`;
        const subtitle = `${versionLabel} · ${doc.status}`;
        results.push({
          type: "document",
          id: doc.id,
          title: doc.title,
          subtitle,
          status: doc.status,
          updatedAt: doc.updatedAt,
          score,
          highlight,
        });
      }
    }
  }

  if (types.includes("template")) {
    let templates: WorkspaceTemplateSummary[] = [];
    try {
      templates = await listWorkspaceTemplates({ tenantId: params.tenantId, actor: params.actor, env: params.env });
    } catch {
      templates = [];
    }

    for (const tmpl of templates) {
      const { score, highlight } = scoreTemplate(query, tmpl);
      if (score > 0) {
        const subtitle = `${tmpl.documentType} · ${tmpl.fieldCount}필드`;
        results.push({
          type: "template",
          id: tmpl.id,
          title: tmpl.name,
          subtitle,
          status: tmpl.status,
          updatedAt: tmpl.updatedAt,
          score,
          highlight,
        });
      }
    }
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  const top = results.slice(0, limit);

  return {
    query,
    total: results.length,
    results: top,
    durationMs: Date.now() - start,
  };
}
