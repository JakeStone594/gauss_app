#!/usr/bin/env python3
# Snapshot of linear_algebra/tools/test_gauss.py (the Python reference engine), taken 2026-11-11.
# The JavaScript engine in web/engine.js is verified against THIS code via tools/golden.py.
"""Test tools/gauss.py against an independent route.

    python3 -I tools/test_gauss.py

1. The lecture's own worked examples (שיעור 3), with the answers printed on the slides.
2. Random matrices, real and complex, full rank and rank-deficient: the canonical echelon
   form is UNIQUE (שיעור 3, עמ' 155), so gauss.py's reducer — which picks pivots its own way —
   must land on exactly the matrix sympy's Matrix.rref() produces. The solution status
   (none / unique / infinite) must agree with sympy's linsolve, and every general solution
   must pass gauss.py's own substitution check.
"""
import os
import random
import sys
import time

import sympy as sp

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gauss  # noqa: E402
import gauss_gui  # noqa: E402

I = sp.I
fails = []


def run(text):
    rows, bar, names = gauss.parse_matrix(text)
    red = gauss.Reducer(rows, bar, quiet=True)
    red.forward()
    red.backward()
    return rows, red, gauss.solution(red, rows) if bar is not None else None


def expect(cond, what):
    if not cond:
        fails.append(what)


def main():
    # ── 1. the lecture's examples ──
    _, _, s = run("x1 + 2x2 + 3x3 = 13; 2x1 + x2 + x3 = 8; 5x1 + 2x3 = 16")           # p. 147–149
    expect(s["status"] == "unique" and s["xs"] == [2, 1, 3], "p149 (2,1,3)")

    _, _, s = run("x + y + z + t = 1; 2x - y + 3z + t = 4; x - 2y - z + t = 0;"
                  "3x + 4z + 2t = 5; 3x + z + 3t = 2")                                  # p. 199–203
    a = sp.Symbol("α")
    want = [sp.Rational(1, 3) - sp.Rational(10, 9) * a, -sp.Rational(1, 3) - sp.Rational(2, 9) * a,
            1 + a / 3, a]
    expect(s["status"] == "infinite" and all(sp.expand(x - w) == 0 for x, w in zip(s["xs"], want)),
           "p203 parametric family")

    _, _, s = run("(1+i)z1 - z2 = 2+i; i z1 + (2-3i)z2 = 1")                            # p. 220–232
    expect(s["status"] == "unique" and s["xs"] == [(8 - 4 * I) / 5, (2 - I) / 5], "p232 complex")

    _, _, s = run("x + y + z = 1; x + y + z = 2")
    expect(s["status"] == "none", "inconsistent pair")

    for bad in ("mx + y = 1", "1 2 | 3; 4 5", "1 m | 2"):
        try:
            gauss.parse_matrix(bad)
            fails.append(f"accepted bad input {bad!r}")
        except ValueError:
            pass

    # ── 1b. the printed RESULT block and the -a / -s flags ──
    import contextlib, io  # noqa: E402


    def output(argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            try:
                gauss.main(argv)
            except SystemExit as e:
                buf.write(f"<exit {e.code}>")
        return buf.getvalue()


    o = output(["-a", "-s", "1 2 3 13; 2 1 1 8; 5 0 2 16"])
    expect(all(x in o for x in ("Exactly one solution", "x₁ = 2", "x₂ = 1", "x₃ = 3", "✓ checked"))
           and "Echelon" not in o, "-a -s unique: values printed, steps hidden")
    o = output(["-a", "x + y + z = 1; x + y + z = 2"])
    expect("No solution" in o and "0 = 1" in o and "x, y, z" in o and "S = ∅" in o, "-a none")
    o = output(["-a", "1 2 3 | 0; 2 4 6 | 0"])
    expect(all(x in o for x in ("Infinitely many", "2 free variables", "x₁ = −2α − 3β",
                                "x₂ = α   ← free", "x₃ = β   ← free", "✓ checked")), "-a infinite")
    o = output(["1 2; 3 4"])
    expect("L₂ → L₂ − 3·L₁" in o and "RESULT" not in o and "add -s" in o, "plain matrix: steps + hint")
    o = output(["-s", "5"])
    expect("error" in o or "<exit" in o, "-s on one column is refused")

    # ── 1c. the GUI's JSON view of the engine (tools/gauss_gui.py) ──
    g = gauss_gui.analyse("1 2 3 | 13; 2 1 1 | 8; 5 0 2 | 16")
    expect(g["solution"]["status"] == "unique" and g["solution"]["values"] == ["2", "1", "3"]
           and len(g["steps"]) == 5 and g["steps"][0]["ops"][0]["label"] == "L₂ → L₂ − 2·L₁"
           and g["steps"][0]["pivot"] == (0, 0) and g["rank"] == 3 and "RESULT" in g["text"], "gui: unique")
    g = gauss_gui.analyse("x + y + z = 1; x + y + z = 2")
    expect(g["solution"]["status"] == "none" and g["solution"]["rhs"] == "1" and g["names"] == ["x", "y", "z"], "gui: none")
    g = gauss_gui.analyse("1 2 3 | 0; 2 4 6 | 0")
    expect(g["solution"]["status"] == "infinite" and g["solution"]["params"] == ["α", "β"]
           and g["solution"]["values"] == ["−2α − 3β", "α", "β"] and g["solution"]["ok"], "gui: infinite")
    g = gauss_gui.analyse("1+i, -1 | 2+i; i, 2-3i | 1")
    expect(g["field"] == "ℂ" and g["solution"]["values"] == ["(8−4i)/5", "(2−i)/5"], "gui: complex")
    g = gauss_gui.analyse("1 2 3 4; 5 6 7 8", system=True)
    expect(g["bar"] == 3 and g["solution"]["status"] == "infinite", "gui: -s")
    g = gauss_gui.analyse("0 2 1 | 3; 1 1 1 | 2; 2 0 1 | 1")
    expect([o["label"] for o in g["steps"][0]["ops"]] == ["L₁ ↔ L₂"]
           and [o["label"] for o in g["steps"][1]["ops"]] == ["L₃ → L₃ − 2·L₁"], "gui: a swap is a step of its own")
    g = gauss_gui.analyse("1 2; 3 4")
    expect(g["bar"] is None and "solution" not in g and g["canonical"] == [["1", "0"], ["0", "1"]], "gui: plain matrix")
    for bad in ("9^9^9^9 1 | 2", "2^123 | 1", "1 2 | 3'", "1 2 | 3; import os", "; ".join(["1 2"] * 11)):
        try:
            gauss_gui.analyse(bad)
            fails.append(f"gui accepted {bad!r}")
        except ValueError:
            pass
    # the worker process: a normal call goes through, a stuck worker is replaced
    expect(gauss_gui.analyse_safely("1 2 | 3; 4 5 | 6")["solution"]["values"] == ["−1", "2"], "gui: worker answers")
    try:
        gauss_gui._pool_get().apply_async(time.sleep, (5,)).get(timeout=0.3)
        fails.append("gui: worker timeout did not fire")
    except gauss_gui.multiprocessing.TimeoutError:
        gauss_gui._pool_reset()
    expect(gauss_gui.analyse_safely("1 2 | 3; 4 5 | 6")["solution"]["status"] == "unique", "gui: worker replaced after a hang")
    gauss_gui._pool_reset()

    # ── 2. random matrices vs sympy ──
    rng = random.Random(20261109)


    def rand_entry(cplx):
        a = sp.Rational(rng.randint(-4, 4), rng.choice([1, 1, 1, 2, 3]))
        b = sp.Rational(rng.randint(-3, 3), rng.choice([1, 1, 2])) if cplx else 0
        return a + b * I


    n_cases = 0
    for trial in range(300):
        cplx = trial % 3 == 0
        n, m = rng.randint(1, 5), rng.randint(1, 5)
        M = [[rand_entry(cplx) for _ in range(m + 1)] for _ in range(n)]
        if trial % 4 == 1 and n >= 2:          # force a dependent row → rank-deficient
            M[-1] = [sp.expand(2 * x - y) for x, y in zip(M[0], M[1 % n])]
        if trial % 7 == 2:                      # a zero column
            for r in M:
                r[0] = 0
        text = "; ".join(", ".join(str(x).replace("I", "i").replace("*", "") for x in r[:m])
                         + " | " + str(r[m]).replace("I", "i").replace("*", "") for r in M)
        rows, red, s = run(text)
        expect(rows == [[sp.expand(x) for x in r] for r in M], f"#{trial} parse round-trip")

        ref = sp.Matrix(M).rref(simplify=True)[0]
        ours = sp.Matrix(red.A)
        expect((ref - ours).applyfunc(sp.simplify) == sp.zeros(n, m + 1), f"#{trial} RREF differs")

        xs = sp.symbols(f"v0:{m}")
        ls = sp.linsolve((sp.Matrix(M)[:, :m], sp.Matrix(M)[:, m]), *xs)
        if ls == sp.EmptySet:
            expect(s["status"] == "none", f"#{trial} sympy: no solution, ours {s['status']}")
        else:
            sol = next(iter(ls))
            free = set().union(*(sp.sympify(c).free_symbols for c in sol))
            status = "infinite" if free else "unique"
            expect(s["status"] == status, f"#{trial} sympy {status}, ours {s['status']}")
            expect(s["ok"], f"#{trial} self-check failed")
            if status == "unique":
                expect(all(sp.simplify(a - b) == 0 for a, b in zip(s["xs"], sol)), f"#{trial} values")
        n_cases += 1

    print(f"lecture examples: 4 + 3 bad-input rejections + 5 output/flag checks + 14 GUI checks;  random systems vs sympy: {n_cases}")
    if fails:
        print(f"FAILURES: {len(fails)}")
        for f in fails[:20]:
            print("  " + f)
        sys.exit(1)
    print("all gauss.py tests passed")


if __name__ == "__main__":
    main()
