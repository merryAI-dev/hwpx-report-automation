#!/usr/bin/env python3
"""Generate report JSON with AI and render it into an HWPX template."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
from typing import Any

import requests

from fill_hwpx_template import apply_placeholders, normalize_replacements

DEFAULT_MODEL = "gpt-4.1-mini"


def load_prompt(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def call_openai_chat(
    api_key: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    api_base: str = "https://api.openai.com/v1",
) -> dict[str, Any]:
    url = f"{api_base.rstrip('/')}/chat/completions"
    payload = {
        "model": model,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    response = requests.post(url, headers=headers, json=payload, timeout=120)
    response.raise_for_status()
    data = response.json()
    content = data["choices"][0]["message"]["content"]
    if isinstance(content, list):
        content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
    return json.loads(str(content))


def render_body(report: dict[str, Any]) -> str:
    lines: list[str] = []
    summary = str(report.get("summary", "")).strip()
    if summary:
        lines.append("요약")
        lines.append(summary)
        lines.append("")

    sections = report.get("sections", [])
    if isinstance(sections, list):
        for idx, section in enumerate(sections, start=1):
            if not isinstance(section, dict):
                continue
            heading = str(section.get("heading", f"섹션 {idx}")).strip()
            lines.append(f"{idx}. {heading}")
            for paragraph in section.get("paragraphs", []) or []:
                lines.append(str(paragraph).strip())
            for bullet in section.get("bullets", []) or []:
                lines.append(f"- {str(bullet).strip()}")
            lines.append("")

    conclusion = str(report.get("conclusion", "")).strip()
    if conclusion:
        lines.append("결론")
        lines.append(conclusion)
        lines.append("")

    references = report.get("references", [])
    if isinstance(references, list) and references:
        lines.append("참고자료")
        for item in references:
            lines.append(f"- {str(item).strip()}")

    return "\n".join(line for line in lines if line is not None).strip()


def build_placeholders(report: dict[str, Any], fallback_author: str | None, fallback_title: str | None) -> dict[str, str]:
    today = dt.date.today().isoformat()
    refs = report.get("references", [])
    if isinstance(refs, list):
        ref_text = "\n".join(f"- {str(item)}" for item in refs)
    else:
        ref_text = str(refs)

    base = {
        "TITLE": report.get("title") or fallback_title or "AI 생성 보고서",
        "SUBTITLE": report.get("subtitle") or "",
        "AUTHOR": report.get("author") or fallback_author or "",
        "DATE": report.get("date") or today,
        "SUMMARY": report.get("summary") or "",
        "BODY": render_body(report),
        "CONCLUSION": report.get("conclusion") or "",
        "REFERENCES": ref_text,
    }

    custom = report.get("placeholders", {})
    if isinstance(custom, dict):
        for key, value in custom.items():
            base[str(key)] = str(value)

    return normalize_replacements(base)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", required=True, type=Path, help="Input template .hwpx")
    parser.add_argument("--output", required=True, type=Path, help="Output .hwpx")
    parser.add_argument("--topic", help="Report topic for AI generation")
    parser.add_argument("--instructions", default="", help="Extra writing instructions")
    parser.add_argument("--source-file", type=Path, help="Optional source text file")
    parser.add_argument("--json-input", type=Path, help="Use existing JSON report instead of AI")
    parser.add_argument("--dump-json", type=Path, help="Save generated report JSON")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="OpenAI model name")
    parser.add_argument("--api-base", default="https://api.openai.com/v1", help="OpenAI API base URL")
    parser.add_argument("--api-key-env", default="OPENAI_API_KEY", help="Environment variable for API key")
    parser.add_argument("--author", help="Fallback author")
    parser.add_argument("--title", help="Fallback title")
    parser.add_argument(
        "--prompt-file",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "prompts" / "report_system_prompt.txt",
        help="System prompt file",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.json_input:
        report = json.loads(args.json_input.read_text(encoding="utf-8"))
    else:
        if not args.topic:
            raise ValueError("Provide --topic when --json-input is not used.")
        api_key = os.getenv(args.api_key_env)
        if not api_key:
            raise ValueError(f"Set {args.api_key_env} to call OpenAI API.")
        source_text = ""
        if args.source_file:
            source_text = args.source_file.read_text(encoding="utf-8")
        user_prompt = (
            f"주제:\n{args.topic}\n\n"
            f"추가 지시:\n{args.instructions}\n\n"
            f"원문/참고자료:\n{source_text}\n"
        )
        system_prompt = load_prompt(args.prompt_file)
        report = call_openai_chat(
            api_key=api_key,
            model=args.model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            api_base=args.api_base,
        )

    if args.dump_json:
        args.dump_json.parent.mkdir(parents=True, exist_ok=True)
        args.dump_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    placeholders = build_placeholders(report, fallback_author=args.author, fallback_title=args.title)
    apply_placeholders(args.template, args.output, placeholders)
    print(f"Created: {args.output}")


if __name__ == "__main__":
    main()
