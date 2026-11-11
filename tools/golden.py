#!/usr/bin/env python3
"""Generate tests/golden.json — the reference the JavaScript engine must reproduce exactly.

Every case is run through the PYTHON engine (gauss_gui.analyse — the snapshot in reference/,
verified by its own test_gauss.py), and its full JSON output is recorded. The JS port is then
tested by tests/test_engine.js: same input → identical steps, forms and solution, string for
string. For inputs the Python engine rejects, only the fact of rejection is recorded; the
wording of error messages is allowed to differ.

    python3 -I tools/golden.py                 uses the snapshot of the engine in reference/
    python3 -I tools/golden.py --engine DIR    uses gauss.py + gauss_gui.py from DIR instead
"""
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = sys.argv[sys.argv.index("--engine") + 1] if "--engine" in sys.argv else os.path.join(HERE, "..", "reference")
sys.path.insert(0, os.path.abspath(ENGINE))
import sympy as sp  # noqa: E402
import gauss_gui    # noqa: E402

I = sp.I
OUT = os.path.join(HERE, "..", "tests", "golden.json")

CASES = [
    # the lecture's examples and the GUI's example menu
    "1 2 3 | 13; 2 1 1 | 8; 5 0 2 | 16",
    "x1 + 2x2 + 3x3 = 13; 2x1 + x2 + x3 = 8; 5x1 + 2x3 = 16",
    "x + y + z + t = 1; 2x - y + 3z + t = 4; x - 2y - z + t = 0; 3x + 4z + 2t = 5; 3x + z + 3t = 2",
    "1 1 1 | 1; 1 1 1 | 2; 1 -1 0 | 0",
    "1+i, -1 | 2+i; i, 2-3i | 1",
    "(1+i)z1 - z2 = 2+i; i z1 + (2-3i)z2 = 1",
    "1 2 3 | 0; 2 4 6 | 0",
    "1/2, 1/3 | 1; 1/4, -1/5 | 2",
    "0 2 1 | 3; 1 1 1 | 2; 2 0 1 | 1",
    "1 2 3; 4 5 6; 7 8 10",
    # pivot choice: a 1 or −1 below is swapped up; otherwise the current row stays
    "2 4 | 6; 1 3 | 5", "2 4 | 6; -1 3 | 5", "2 4 | 6; 3 3 | 5", "0 3 | 6; 0 5 | 1; 2 1 | 0",
    "0 0 1 | 1; 0 1 0 | 2; 1 0 0 | 3",
    # degenerate shapes
    "0 0 | 0", "0 | 1", "0 | 0", "5", "0", "7 | 14", "1 2 3 4 5 6 7 8 9 10 | 1; 1 1 1 1 1 1 1 1 1 1 | 2",
    "1; 2; 3", "1 2 3", "1 | 2; 3 | 4; 5 | 6", "1 2 | 3",
    # number formats
    "0.25 -0.5 | 1.75; 1e2 2.5e-1 | 3", "−3 2 | 1; 2·2 1 | 0", "123456789012345678901234567890 1 | 2; 1 1 | 1",
    "1/3 1/6 | 1/2; 2/3 1/3 | 1", "2^12 1 | 2; 1 2^-2 | 3", "2(3) 4 | (1+2)(2) ; 1 1 | 1",
    "1 + i  2 | 3; 1 -2 | 0", "1 +i | 2; i -i | 0", "i/2, 3i/2 | 1/2i; -i, 1 | i",
    "(1+i)/2, (3-i)/4 | 1; 2, -i | (1-i)/2", "1+2i 3-4i | 5+6i; -1-2i 3 | i",
    # systems that end in each outcome, over ℂ
    "i 1 | 1; 1 i | i", "i 1 | 1; -1 i | 2", "1 i | 0; i -1 | 0",
    # the -s mode and plain matrices
    ("1 2 3 4; 5 6 7 8", True), ("1 2; 3 4", True), ("1 0 2; 0 1 3; 1 1 5", True), "1 0; 0 1", "0 0; 0 0",
    # equations in many spellings
    "x + y = 1", "x = 1; x = 2", "2x = 4", "e = 1", "x + y = i; x - y = 1",
    "3(x + y) = 1; x - y = 0", "x/2 + y = 1; x = 2", "-(x - y) = 1; x + y = 3", "x1 = 2; 2x1 - x_2 = 0",
    "a + b = 1; a - b = 0", "y + x = 1; x - y = 0", "2x + 3 = y + 1; x - y = 0", "x + y = 1; 2x + 2y = 2",
    "x + y + z = 1", "2.5x - 1/2y = 0.75; x + y = 1", "(2+i)x + (1-i)y = 3; x - y = i",
    # ─ rejected by the Python engine ─
    "mx + y = 1", "x^2 = 1", "x*y = 1", "xy = 1; x + y = 2", "abc = 1", "x = 1 = 2", "x + = 1", "= 1",
    "1 2 | 3 | 4", "1 2; 3", "1 'a' | 2", "9^9^9^9 1 | 2", "2^123 | 1", "", "   ", "1 + | 2", "+ 1 | 2",
    "2×3 | 1", "1 m | 2", "sqrt(2) 1 | 1", "x + y", "1 2 | 3; x + y = 1", "2^(1/2) | 1", "1/0 | 1",
    "; ".join(["1 2"] * 11), "1 " * 11 + "| 1", ("5", True),
]
CASES = [c if isinstance(c, tuple) else (c, False) for c in CASES]

# random systems, the same generator as reference/test_gauss.py
rng = random.Random(20261109)


def rand_entry(cplx):
    a = sp.Rational(rng.randint(-4, 4), rng.choice([1, 1, 1, 2, 3]))
    b = sp.Rational(rng.randint(-3, 3), rng.choice([1, 1, 2])) if cplx else 0
    return a + b * I


def as_text(x):
    return str(x).replace("I", "i").replace("*", "")


for trial in range(300):
    cplx = trial % 3 == 0
    n, m = rng.randint(1, 5), rng.randint(1, 5)
    M = [[rand_entry(cplx) for _ in range(m + 1)] for _ in range(n)]
    if trial % 4 == 1 and n >= 2:
        M[-1] = [sp.expand(2 * x - y) for x, y in zip(M[0], M[1 % n])]
    if trial % 7 == 2:
        for r in M:
            r[0] = 0
    text = "; ".join(", ".join(as_text(x) for x in r[:m]) + " | " + as_text(r[m]) for r in M)
    CASES.append((text, trial % 11 == 5))   # a few through the -s path (the '|' still wins there)

out = []
for text, system in CASES:
    try:
        r = gauss_gui.analyse(text, system)
        r.pop("text")
        out.append({"text": text, "system": system, "expect": r})
    except ValueError as e:
        out.append({"text": text, "system": system, "error": str(e)})

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=0)
ok = sum("expect" in c for c in out)
print(f"{len(out)} cases written to {os.path.normpath(OUT)}: {ok} solved, {len(out) - ok} rejected")
