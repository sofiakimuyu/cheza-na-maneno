#!/usr/bin/env python3
"""
Safari ya Matatu — build step.

Converts `swahili_wordscapes_levels_1-30.csv` into an embedded `puzzles.js`
(`const PUZZLES = [...]`) that the game loads directly. We embed rather than
fetch() at runtime so the game works offline and from file://.

Run:  python3 build.py

What it does:
  * reads the CSV, maps its columns to the game's level schema
  * normalizes: uppercase + trim all letters/answers, split answers on "|"
  * treats each tile as the given character(s); supports a digraph like NG'
  * auto-names each checkpoint (kituo) from a Nairobi -> Mombasa matatu route,
    since the CSV has no checkpoint column
  * derives BONUS words per level: any word that is a *vetted* answer somewhere
    else in the CSV and is buildable from this level's letters but is NOT one of
    this level's own grid answers. Nothing is invented — every bonus word is
    real Swahili taken from the dataset itself.
  * confirms every answer is buildable from its letter set and warns otherwise
"""

import csv
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(HERE, "swahili_wordscapes_levels_1-30.csv")
OUT_PATH = os.path.join(HERE, "puzzles.js")

# Auto-generated route of vituo (matatu stops): Nairobi CBD -> Mombasa on the
# A109. Fallback names because the CSV has no `checkpoint` column. Order matches
# play order; index i is used for levelId i+1. Extend/rename freely.
ROUTE = [
    "Kituo cha Kati", "Nyayo", "Cabanas", "Athi River", "Mlolongo",
    "Kitengela", "Konza", "Malili", "Machakos Junction", "Salama",
    "Sultan Hamud", "Kima", "Emali", "Makindu", "Kibwezi",
    "Mtito Andei", "Tsavo", "Manyani", "Voi", "Maungu",
    "Mackinnon Road", "Samburu", "Mariakani", "Mazeras", "Miritini",
    "Changamwe", "Nyali", "Bamburi", "Likoni", "Mombasa",
]


def tokenize(s):
    """Split a letter string into tiles. A trailing apostrophe binds to its
    preceding letter to form a digraph tile (e.g. NG' -> ["NG'"]). Otherwise
    each character is its own single-letter tile."""
    s = s.strip().upper()
    tiles = []
    for ch in s:
        if ch == "'" and tiles:
            tiles[-1] += "'"
        else:
            tiles.append(ch)
    return tiles


def buildable(word_tiles, bag):
    """Is `word_tiles` (list of tiles) buildable from the multiset `bag`?"""
    need = Counter(word_tiles)
    have = Counter(bag)
    return all(have[t] >= n for t, n in need.items())


def split_word_into_tiles(word, tileset):
    """Greedy-longest tokenization of an answer using known tiles (handles
    digraphs). Falls back to single chars."""
    word = word.strip().upper()
    known = sorted(set(tileset), key=len, reverse=True)
    out = []
    i = 0
    while i < len(word):
        for t in known:
            if word.startswith(t, i):
                out.append(t)
                i += len(t)
                break
        else:
            out.append(word[i])
            i += 1
    return out


def main():
    if not os.path.exists(CSV_PATH):
        print("ERROR: CSV not found at", CSV_PATH, file=sys.stderr)
        sys.exit(1)

    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    print("Columns:", list(rows[0].keys()))
    print("Rows:", len(rows))

    # First pass: parse letters + answers per row.
    parsed = []
    vetted_corpus = set()  # every answer word anywhere -> vetted Swahili
    for r in rows:
        level_id = int(r["level"])
        tiles = tokenize(r["letters"])
        answers = [w.strip().upper() for w in r["words"].split("|") if w.strip()]
        # de-dupe answers, preserve order
        seen = set()
        answers = [a for a in answers if not (a in seen or seen.add(a))]
        base = r.get("base_word", "").strip().upper() or (answers[0] if answers else "")
        difficulty = r.get("difficulty", "").strip().lower()
        for a in answers:
            vetted_corpus.add(a)
        parsed.append({
            "levelId": level_id,
            "tiles": tiles,
            "answers": answers,
            "base": base,
            "difficulty": difficulty,
        })

    # Second pass: validate buildability + derive bonus words.
    warnings = 0
    puzzles = []
    total_bonus = 0
    for p in parsed:
        tiles = p["tiles"]
        # Validate every answer is buildable from the tiles.
        for a in p["answers"]:
            at = split_word_into_tiles(a, tiles)
            if not buildable(at, tiles):
                print(f"  WARN L{p['levelId']}: answer '{a}' NOT buildable from {tiles}")
                warnings += 1

        # Derive bonus words: vetted words buildable here, not in this grid.
        own = set(p["answers"])
        bonus = []
        for w in sorted(vetted_corpus):
            if w in own:
                continue
            if len(w) < 2:
                continue
            wt = split_word_into_tiles(w, tiles)
            if buildable(wt, tiles):
                bonus.append(w)
        total_bonus += len(bonus)

        idx = p["levelId"] - 1
        checkpoint = ROUTE[idx] if idx < len(ROUTE) else f"Kituo {p['levelId']}"

        puzzles.append({
            "levelId": p["levelId"],
            "checkpoint": checkpoint,
            "difficulty": p["difficulty"],
            "letters": tiles,
            "base": p["base"],
            "answers": p["answers"],
            "bonusWords": bonus,
        })

    # Emit puzzles.js
    body = ",\n".join("  " + json.dumps(pz, ensure_ascii=False) for pz in puzzles)
    js = (
        "// GENERATED by build.py from swahili_wordscapes_levels_1-30.csv — do not edit by hand.\n"
        "// Re-run `python3 build.py` to regenerate. Embedded (not fetched) so the game\n"
        "// works offline and from file://.\n"
        f"const PUZZLES = [\n{body}\n];\n"
        "if (typeof module !== 'undefined') { module.exports = PUZZLES; }\n"
    )
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write(js)

    print(f"\nWrote {OUT_PATH}")
    print(f"Levels: {len(puzzles)}  |  total bonus words: {total_bonus}  |  buildability warnings: {warnings}")
    print("Route:", " -> ".join(pz["checkpoint"] for pz in puzzles[:6]), "-> ... ->", puzzles[-1]["checkpoint"])


if __name__ == "__main__":
    main()
