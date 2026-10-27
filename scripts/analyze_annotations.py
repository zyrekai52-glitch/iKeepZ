#!/usr/bin/env python3
"""Turn `flutter analyze` output into GitHub annotations and a readable step summary.

Usage: analyze_annotations.py analyze.log

Parses lines such as
    error • Undefined name 'foo' • lib/main.dart:12:5 • undefined_identifier
and prints `::error file=...,line=...,col=...::message` workflow commands (max 50) plus a markdown table in
$GITHUB_STEP_SUMMARY so problems are readable without opening the raw log.
"""
import os
import re
import sys

LINE = re.compile(r"^\s*(error|warning|info)\s+•\s+(.*?)\s+•\s+([^•]+?):(\d+):(\d+)\s+•\s+(\S+)\s*$")


def main() -> int:
    if len(sys.argv) < 2 or not os.path.exists(sys.argv[1]):
        print("analyze log not found")
        return 0
    items = []
    with open(sys.argv[1], encoding="utf-8", errors="replace") as handle:
        for raw in handle:
            match = LINE.match(raw.rstrip("\n"))
            if match:
                severity, message, path, line, col, rule = match.groups()
                items.append((severity, message.strip(), path.strip().replace("\\", "/"), int(line), int(col), rule))
    errors = [i for i in items if i[0] == "error"]
    warnings = [i for i in items if i[0] == "warning"]
    infos = [i for i in items if i[0] == "info"]
    shown = 0
    for severity, message, path, line, col, rule in errors + warnings:
        if shown >= 50:
            break
        level = "error" if severity == "error" else "warning"
        text = f"{message} ({rule})".replace("%", "%25").replace("\r", "").replace("\n", " ")
        print(f"::{level} file={path},line={line},col={col}::{text}")
        shown += 1
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as out:
            out.write(f"### flutter analyze: {len(errors)} errors, {len(warnings)} warnings, {len(infos)} infos\n\n")
            if errors or warnings:
                out.write("| severity | location | message | rule |\n|---|---|---|---|\n")
                for severity, message, path, line, col, rule in (errors + warnings)[:100]:
                    safe = message.replace("|", "\\|")
                    out.write(f"| {severity} | `{path}:{line}:{col}` | {safe} | `{rule}` |\n")
                if len(errors) + len(warnings) > 100:
                    out.write(f"\n…and {len(errors) + len(warnings) - 100} more.\n")
            else:
                out.write("No errors or warnings.\n")
    print(f"analyze: {len(errors)} errors, {len(warnings)} warnings, {len(infos)} infos")
    return 0


if __name__ == "__main__":
    sys.exit(main())
