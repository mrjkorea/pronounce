#!/usr/bin/env python3
"""Day 4 content, dictionary, and HuBERT model checks."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONTENT = ROOT / "content"
WORD = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")
FILES = [
    "basic_a.json", "basic_b.json", "basic_c.json",
    "int2a.json", "int2b.json", "int2c.json",
    "int3a.json", "int3b.json", "int3c.json",
]
HUBERT_MANIFEST = ROOT / "models" / "hubert" / "manifest.json"


def main():
    manifest = json.loads((CONTENT / "manifest.json").read_text())
    assert len(manifest["books"]) == 9, len(manifest["books"])
    books = []
    units = 0
    items = 0
    words = set()
    for name in FILES:
        data = json.loads((CONTENT / name).read_text())
        books.append(data["id"])
        assert len(data["units"]) == 8, (data["id"], len(data["units"]))
        for unit in data["units"]:
            units += 1
            for item in unit["items"]:
                items += 1
                assert item.get("korean"), item.get("id")
                assert item.get("english"), item.get("id")
                assert item.get("audio"), item.get("id")
                for token in WORD.findall(item["english"]):
                    words.add(token.lower())
                if data["id"] == "basic_a" and unit["id"] == "unit03":
                    assert len(unit["items"]) == 9
                if data["id"] == "basic_a" and unit["id"] == "unit04":
                    assert len(unit["items"]) == 7
    assert len(books) == 9
    assert units == 72, units
    assert items == 716, items
    print(f"content ok: books={len(books)} units={units} items={items}")

    full = json.loads((ROOT / "models" / "cmudict.full.json").read_text())["entries"]
    missing = sorted(w for w in words if w not in full)
    print(f"dictionary ok: words={len(words)} in_full_cmudict={len(words)-len(missing)} (others use letter-to-sound)")

    man = json.loads(HUBERT_MANIFEST.read_text())
    total = 0
    for part in man["parts"]:
        size = (ROOT / part["file"]).stat().st_size
        assert size == part["bytes"], (part["file"], size)
        total += size
    assert total == man["totalBytes"], total
    print(f"model ok: hubert_bytes={total} parts={len(man['parts'])}")

if __name__ == "__main__":
    main()
