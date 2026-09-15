#!/usr/bin/env python3
from pathlib import Path
import json, re, sys
ROOT=Path(__file__).resolve().parents[1]
FILES={
    "easy":(ROOT/'data/easy.js','DAKTILO_EASY'),
    "hard":(ROOT/'data/hard.js','DAKTILO_HARD'),
    "technical":(ROOT/'data/technical.js','DAKTILO_TECHNICAL'),
    "english":(ROOT/'data/english.js','DAKTILO_ENGLISH'),
    "names":(ROOT/'data/names.js','DAKTILO_NAMES'),
    "sentences":(ROOT/'data/sentences.js','DAKTILO_SENTENCES')
}
MIN_TOTAL=10000
WORD=re.compile(r'^[A-ZÄÖÜß ]+$'); SENT=re.compile(r'^[A-ZÄÖÜß0-9 ,.?!:;()\-]+$')
def load(path,var):
    t=path.read_text(encoding='utf-8').strip(); p=f'window.{var} = '
    return json.loads(t[len(p):].rstrip().rstrip(';'))
def main():
    fail=False
    for cat,(path,var) in FILES.items():
        obj=load(path,var); vals=[]; print(f'\n{cat.upper()} — {obj.get("label",cat)}')
        for key,sec in obj.get('subcategories',{}).items():
            items=sec.get('items',[]); pat=SENT if cat=='sentences' else WORD
            bad=[v for v in items if not pat.fullmatch(str(v))]; dup=len(items)-len(set(items)); vals += items
            print(f'  {key:24s}: {len(items):6d} | Duplikate {dup:4d} | ungültig {len(bad):4d}')
            fail |= bool(bad or dup)
        print(f'  {"GESAMT":24s}: {len(vals):6d}')
        if len(vals)<MIN_TOTAL: fail=True
    return int(fail)
if __name__=='__main__': sys.exit(main())
