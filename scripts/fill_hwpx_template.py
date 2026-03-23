#!/usr/bin/env python3
"""Replace {{PLACEHOLDER}} tokens inside XML files of an HWPX package."""

from __future__ import annotations

import argparse
import json
import re
import zipfile
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

PLACEHOLDER_RE = re.compile(r"\{\{([A-Z0-9_]+)\}\}")


def stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(str(item) for item in value)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False, indent=2)
    return str(value)


def normalize_replacements(raw: dict[str, Any]) -> dict[str, str]:
    normalized: dict[str, str] = {}
    for key, value in raw.items():
        normalized[str(key).strip().upper()] = stringify(value)
    return normalized


def replace_tokens(xml_text: str, replacements: dict[str, str]) -> str:
    def repl(match: re.Match[str]) -> str:
        token = match.group(1)
        if token not in replacements:
            return match.group(0)
        return escape(replacements[token], entities={"'": "&apos;", '"': "&quot;"})

    return PLACEHOLDER_RE.sub(repl, xml_text)


def apply_placeholders(template_path: Path, output_path: Path, replacements: dict[str, str]) -> None:
    if not template_path.exists():
        raise FileNotFoundError(f"Template not found: {template_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(template_path, "r") as src, zipfile.ZipFile(output_path, "w") as dst:
        for info in src.infolist():
            payload = src.read(info.filename)
            if info.filename.lower().endswith(".xml"):
                text = payload.decode("utf-8")
                payload = replace_tokens(text, replacements).encode("utf-8")
            dst.writestr(info, payload)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", required=True, type=Path, help="Input .hwpx template path")
    parser.add_argument("--data-json", required=True, type=Path, help="JSON file with placeholder values")
    parser.add_argument("--output", required=True, type=Path, help="Output .hwpx path")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    payload = json.loads(args.data_json.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Placeholder JSON must be an object")
    replacements = normalize_replacements(payload)
    apply_placeholders(args.template, args.output, replacements)
    print(f"Created: {args.output}")


if __name__ == "__main__":
    main()
