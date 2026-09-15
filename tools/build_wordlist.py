#!/usr/bin/env python3
from pathlib import Path
import argparse
import json

VARIABLES = {
    "easy": "DAKTILO_EASY",
    "hard": "DAKTILO_HARD",
    "names": "DAKTILO_NAMES",
    "sentences": "DAKTILO_SENTENCES",
}

parser = argparse.ArgumentParser(description="TXT-Liste in eine Daktilo-Datendatei umwandeln")
parser.add_argument("category", choices=VARIABLES)
parser.add_argument("input", type=Path, help="Textdatei, ein Eintrag pro Zeile")
parser.add_argument("output", type=Path, nargs="?", help="Ausgabedatei; Standard: data/<category>.js")
args = parser.parse_args()

lines = [line.strip() for line in args.input.read_text(encoding="utf-8").splitlines()]
values = []
seen = set()
for line in lines:
    if not line or line.startswith("#"):
        continue
    item = line.upper()
    if item not in seen:
        seen.add(item)
        values.append(item)

root = Path(__file__).resolve().parents[1]
out = args.output or (root / "data" / f"{args.category}.js")
out.write_text(
    f"window.{VARIABLES[args.category]} = " + json.dumps(values, ensure_ascii=False, indent=2) + ";\n",
    encoding="utf-8"
)
print(f"{len(values)} eindeutige Einträge -> {out}")
