#!/usr/bin/env python3
"""Day 4 content, dictionary, and model-part checks."""
import hashlib
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
EXPECT = 317712780


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

    subset = json.loads((ROOT / "models" / "cmudict.day4.json").read_text())
    missing_path = ROOT / "MISSING_WORDS.txt"
    listed = [ln.strip() for ln in missing_path.read_text().splitlines() if ln.strip()]
    missing = sorted(w for w in words if w not in subset)
    assert missing == listed, (missing, listed)
    print(f"dictionary ok: words={len(words)} in_dict={len(words)-len(missing)} missing={len(missing)}")

    man = json.loads((ROOT / "models" / "wav2vec2" / "manifest.json").read_text())
    total = 0
    hasher = hashlib.sha256()
    for part in man["parts"]:
        path = ROOT / "models" / "wav2vec2" / part["name"]
        size = path.stat().st_size
        assert size == part["bytes"], (part["name"], size, part["bytes"])
        assert size < 45000000, (part["name"], size)
        total += size
        hasher.update(path.read_bytes())
    assert total == EXPECT, total
    assert man["total"] == EXPECT
    src = Path("/Users/andreclouthier/.hermes/projects/mrj-pronounce/packages/pronounce-web/models/wav2vec2/model_int8.onnx")
    src_hash = hashlib.sha256(src.read_bytes()).hexdigest()
    assert hasher.hexdigest() == src_hash
    print(f"model ok: parts={len(man['parts'])} bytes={total} sha256={src_hash}")


if __name__ == "__main__":
    main()
