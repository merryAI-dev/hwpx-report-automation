#!/usr/bin/env python3
"""Utilities for reading and editing text nodes in HWPX XML files."""

from __future__ import annotations

import json
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import xml.etree.ElementTree as ET

STYLE_ATTR_KEYWORDS = ("style", "pridref", "idref", "font", "face", "align")


@dataclass
class TextNode:
    file_name: str
    text_index: int
    text: str
    tag: str
    style_attrs: dict[str, str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "file_name": self.file_name,
            "text_index": self.text_index,
            "text": self.text,
            "tag": self.tag,
            "style_attrs": self.style_attrs,
        }


def _is_xml(file_name: str) -> bool:
    return file_name.lower().endswith(".xml")


def _style_attrs(attrs: dict[str, str]) -> dict[str, str]:
    picked: dict[str, str] = {}
    for key, value in attrs.items():
        key_lower = key.lower()
        if any(token in key_lower for token in STYLE_ATTR_KEYWORDS):
            picked[key] = value
    return picked


def _read_zip_payload(path: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(path, "r") as zf:
        return {info.filename: zf.read(info.filename) for info in zf.infolist()}


def list_text_nodes(path: Path) -> list[TextNode]:
    payload = _read_zip_payload(path)
    nodes: list[TextNode] = []
    for file_name, blob in payload.items():
        if not _is_xml(file_name):
            continue
        try:
            root = ET.fromstring(blob)
        except ET.ParseError:
            continue
        text_index = 0
        for elem in root.iter():
            if elem.text is not None:
                text = elem.text.strip()
                if text:
                    nodes.append(
                        TextNode(
                            file_name=file_name,
                            text_index=text_index,
                            text=text,
                            tag=elem.tag,
                            style_attrs=_style_attrs(elem.attrib),
                        )
                    )
                text_index += 1
    return nodes


def extract_style_catalog(path: Path) -> dict[str, dict[str, int]]:
    payload = _read_zip_payload(path)
    counts: defaultdict[str, Counter[str]] = defaultdict(Counter)
    for file_name, blob in payload.items():
        if not _is_xml(file_name):
            continue
        try:
            root = ET.fromstring(blob)
        except ET.ParseError:
            continue
        for elem in root.iter():
            for key, value in elem.attrib.items():
                key_lower = key.lower()
                if any(token in key_lower for token in STYLE_ATTR_KEYWORDS):
                    counts[key][value] += 1
    return {key: dict(counter) for key, counter in counts.items()}


def apply_text_edits(template_path: Path, output_path: Path, edits: list[dict[str, Any]]) -> None:
    if not template_path.exists():
        raise FileNotFoundError(f"Template not found: {template_path}")
    grouped: dict[str, dict[int, str]] = defaultdict(dict)
    for edit in edits:
        file_name = str(edit["file_name"])
        text_index = int(edit["text_index"])
        new_text = str(edit["new_text"])
        grouped[file_name][text_index] = new_text

    with zipfile.ZipFile(template_path, "r") as src, zipfile.ZipFile(output_path, "w") as dst:
        for info in src.infolist():
            payload = src.read(info.filename)
            if info.filename in grouped and _is_xml(info.filename):
                try:
                    root = ET.fromstring(payload)
                except ET.ParseError as exc:
                    raise ValueError(f"Invalid XML in {info.filename}") from exc
                text_index = 0
                for elem in root.iter():
                    if elem.text is not None:
                        if text_index in grouped[info.filename]:
                            elem.text = grouped[info.filename][text_index]
                        text_index += 1
                payload = ET.tostring(root, encoding="utf-8", xml_declaration=True)
            dst.writestr(info, payload)


def _main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Inspect or edit HWPX text nodes")
    parser.add_argument("--input", required=True, type=Path, help="Input .hwpx path")
    parser.add_argument("--list", action="store_true", help="List text nodes as JSON")
    parser.add_argument("--styles", action="store_true", help="Show style catalog as JSON")
    parser.add_argument("--edits-json", type=Path, help="JSON edits file")
    parser.add_argument("--output", type=Path, help="Output .hwpx path for edits")
    args = parser.parse_args()

    if args.list:
        nodes = [node.to_dict() for node in list_text_nodes(args.input)]
        print(json.dumps(nodes, ensure_ascii=False, indent=2))
        return

    if args.styles:
        print(json.dumps(extract_style_catalog(args.input), ensure_ascii=False, indent=2))
        return

    if args.edits_json and args.output:
        edits = json.loads(args.edits_json.read_text(encoding="utf-8"))
        if not isinstance(edits, list):
            raise ValueError("--edits-json must be a list")
        apply_text_edits(args.input, args.output, edits)
        print(f"Created: {args.output}")
        return

    parser.error("Use --list or --styles or (--edits-json and --output)")


if __name__ == "__main__":
    _main()
