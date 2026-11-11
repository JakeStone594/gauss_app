#!/usr/bin/env python3
# Snapshot of linear_algebra/tools/gauss.py (the Python reference engine), taken 2026-11-11.
# The JavaScript engine in web/engine.js is verified against THIS code via tools/golden.py.
"""Gaussian elimination calculator — step by step, exact, in the lecture's notation.

Reduces a matrix (or an augmented matrix / a system of equations) using ONLY the three
elementary row operations of שיעור 3, עמ' 88–129, written the way the lecture writes them:

    L₁ ↔ L₂              swap two rows
    L₂ → (1/3)·L₂        multiply a row by a non-zero number
    L₂ → L₂ − 2·L₁       add a multiple of another row

It prints every step, the echelon form (מטריצה מדורגת), the canonical echelon form
(מטריצה מדורגת קנונית), and — for a system — the solution set: unique, none (with the
contradicting row), or infinitely many, written with parameters α, β, … as on p. 203.
Every general solution is substituted back into the ORIGINAL system before it is printed.

Arithmetic is exact: integers, fractions and complex numbers (ℂ systems, p. 219–232).
Decimals are read as exact fractions (0.5 → 1/2). No floating point anywhere.

USAGE
    python3 tools/gauss.py "1 2 3 | 13; 2 1 1 | 8; 5 0 2 | 16"
    python3 tools/gauss.py "x + 2y + 3z = 13; 2x + y + z = 8; 5x + 2z = 16"
    python3 tools/gauss.py "1+i, -1 | 2+i; i, 2-3i | 1"
    python3 tools/gauss.py "1 2; 3 4"                 a plain matrix, no system
    python3 tools/gauss.py -f system.txt              one row / equation per line
    python3 tools/gauss.py                            type rows interactively, blank line ends
    python3 tools/gauss.py -q "..."                   no steps: forms and result only
    python3 tools/gauss.py -a "..."                   only the result: x₁ = …, x₂ = …
    python3 tools/gauss.py -s "1 2 5; 3 4 6"          no '|': last column is the right-hand side

INPUT RULES
    rows are separated by ';' or newlines; '|' separates the right-hand side.
    Entries are separated by spaces, or by commas. A free-standing + or − joins its
    neighbours into one entry, so "1 + i  2 | 3" is two entries, 1+i and 2; "1 -2" is
    also two, 1 and −2. When in doubt, use commas: "1 + i, -1 | 2 + i". Write the imaginary unit as i: 2i, -i, 1/2+3i, (1-i)/2.
    Equations: unknowns are single letters, optionally indexed (x, y, z, t, x1, x_2);
    `i` is always the imaginary unit. Every other letter is an unknown — a parameter m
    written as `mx` or `m x` is rejected (a product is not linear); substitute a value.

⚠ What the syllabus says about tools like this: allowed for CHECKING your own computation,
not as the way you solve the homework. Solve by hand first, then compare step by step.
"""
import argparse
import re
import sys

import sympy as sp
from sympy.parsing.sympy_parser import (convert_xor, implicit_multiplication,
                                        parse_expr, standard_transformations)

TRANSFORMS = standard_transformations + (implicit_multiplication, convert_xor)
SUB = str.maketrans("0123456789", "₀₁₂₃₄₅₆₇₈₉")
PARAMS = "αβγδεζηθκμνξπρστφχψω"


# ─────────────────────────────── parsing ───────────────────────────────

def num(v):
    """Canonical exact form a + b·i, a and b rational. Every stored entry goes through this,
    so that 'is it zero?' is never fooled by an unsimplified form like i/(1+i)."""
    # No nsimplify here: it "simplifies" 3324/17225 into a product of fractional powers.
    a, b = (x if x.is_Rational else sp.simplify(x) for x in sp.expand(sp.sympify(v)).as_real_imag())
    if not (a.is_Rational and b.is_Rational):
        raise ValueError(f"not an exact rational or complex-rational number: {v}")
    return a + b * sp.I


def _exact(expr):
    """Replace every float by the exact fraction it was typed as."""
    return expr.xreplace({f: sp.Rational(str(f)) for f in expr.atoms(sp.Float)})


def parse_number(text):
    try:
        v = parse_expr(text.strip(), local_dict={"i": sp.I, "I": sp.I}, transformations=TRANSFORMS)
    except Exception as e:  # noqa: BLE001 — report any parse failure the same way
        raise ValueError(f"cannot read the entry {text!r}: {e}") from None
    v = sp.expand(_exact(sp.sympify(v)))
    if not v.free_symbols:
        return num(v)
    if v.free_symbols:
        raise ValueError(f"the entry {text!r} contains a letter other than i. Systems with a "
                         "parameter (m, k, …) need a case split by hand — substitute a value "
                         "of the parameter to check one case.")
    return v


def _entries(chunk):
    """Split one side of a row into entries. Commas, if present, are the separators.
    Otherwise whitespace is — except around a free-standing + or −, which glues its
    neighbours into one entry: '1 + i  2' → ['1+i', '2'], while '1 -2' → ['1', '-2']."""
    if "," in chunk:
        return [x for x in chunk.split(",") if x.strip()]
    out = []
    glue = False
    for tok in chunk.split():
        if tok in ("+", "-"):
            if not out:
                raise ValueError(f"a row starts with a lone {tok!r}: {chunk.strip()!r}")
            out[-1] += tok
            glue = True
        elif glue or (out and out[-1][-1] in "+-*/(" ):
            out[-1] += tok
            glue = False
        else:
            out.append(tok)
    if glue:
        raise ValueError(f"an entry ends with an operator: {chunk.strip()!r}")
    return out


def parse_matrix(text, system=False):
    """Return (rows, n_coeff_cols, var_names). n_coeff_cols is None for a plain matrix.
    system=True reads a matrix without '|' as augmented: the last column is the right-hand side."""
    text = text.replace("−", "-").replace("·", "*")
    lines = [r.strip() for r in re.split(r"[;\n]", text) if r.strip()]
    if not lines:
        raise ValueError("empty input")
    if any("=" in r for r in lines):
        return parse_equations(lines)
    rows, bar = [], None
    for r in lines:
        parts = r.split("|")
        if len(parts) > 2:
            raise ValueError(f"more than one '|' in row: {r!r}")
        cells = []
        for chunk in parts:
            cells.append([parse_number(x) for x in _entries(chunk)])
        this_bar = len(cells[0]) if len(parts) == 2 else None
        if rows and this_bar != bar:
            raise ValueError("every row needs the '|' in the same place (or none at all)")
        bar = this_bar
        rows.append([x for c in cells for x in c])
    width = len(rows[0])
    for k, r in enumerate(rows, 1):
        if len(r) != width:
            raise ValueError(f"row {k} has {len(r)} entries, row 1 has {width}")
    if system and bar is None:
        if width < 2:
            raise ValueError("-s needs at least two columns: coefficients, then the right-hand side")
        bar = width - 1
    names = [f"x{k}".translate(SUB) for k in range(1, (bar or 0) + 1)]
    return rows, bar, names


VAR = re.compile(r"[A-Za-z](_?\d+)?")   # one letter, optional index: x, t, x1, x_2


def _split_letters(line):
    """'mx' → 'm*x', '2xy' → '2x*y': a run of letters is a product, as in handwriting.
    Without this, 'mx + y = 1' would silently become an unknown called mx."""
    def f(m):
        tok = m.group(0)
        return tok if VAR.fullmatch(tok) or not tok.isalpha() else "*".join(tok)
    return re.sub(r"[A-Za-z_][A-Za-z_0-9]*", f, line)


def parse_equations(lines):
    lines = [_split_letters(x) for x in lines]
    names = []
    for line in lines:   # variable order = order of first appearance in the input
        for tok in re.findall(r"[A-Za-z_][A-Za-z_0-9]*", line):
            if tok not in ("i", "I") and tok not in names:
                names.append(tok)
    if not names:
        raise ValueError("no variables found in the equations")
    syms = [sp.Symbol(n) for n in names]
    local = {"i": sp.I, "I": sp.I, **{n: s for n, s in zip(names, syms)}}
    rows = []
    for line in lines:
        if line.count("=") != 1:
            raise ValueError(f"not a single equation: {line!r}")
        lhs, rhs = line.split("=")
        try:
            e = sp.expand(_exact(parse_expr(lhs, local_dict=local, transformations=TRANSFORMS)
                                 - parse_expr(rhs, local_dict=local, transformations=TRANSFORMS)))
        except Exception as ex:  # noqa: BLE001
            raise ValueError(f"cannot read the equation {line!r}: {ex}") from None
        poly = sp.Poly(e, *syms)
        if poly.total_degree() > 1:
            prods = [t for t in sp.Add.make_args(e) if sum(sp.degree(t, x) for x in syms) > 1]
            raise ValueError(f"not linear: {line!r} contains {prods[0]}. If a letter there is a "
                             "parameter (m, k, …), the system needs a case split by hand — "
                             "substitute a value of the parameter to check one case.")
        row = [num(e.coeff(s)) for s in syms]
        const = num(e.subs({s: 0 for s in syms}))
        rows.append(row + [num(-const)])
    return rows, len(syms), names


# ─────────────────────────────── formatting ───────────────────────────────

def _rat(q):
    return str(q.p) if q.q == 1 else f"{q.p}/{q.q}"


def _gauss_int(a, b):
    """a + b·i with integer a, b, as text: 3, -2, i, -i, 2-3i."""
    im = {1: "i", -1: "-i"}.get(b, f"{b}i")
    if b == 0:
        return str(a)
    if a == 0:
        return im
    return f"{a}{im}" if im.startswith("-") else f"{a}+{im}"


def fmt(v):
    """Exact number as text, the way the lecture writes it: 3, −1/2, 2i, −i, (8−4i)/5."""
    v = num(v)
    a, b = (sp.Rational(x) for x in v.as_real_imag())
    if b == 0:
        return _rat(a).replace("-", "−")
    d = sp.ilcm(a.q, b.q)
    A, B = int(a * d), int(b * d)
    if d == 1:
        return _gauss_int(A, B).replace("-", "−")
    if A == 0:   # purely imaginary: i/2, −3i/4
        return f"{_gauss_int(0, B)}/{d}".replace("-", "−")
    return f"({_gauss_int(A, B)})/{d}".replace("-", "−")


def fmt_coef(v):
    """A multiplier written before ·L: 2, (1/3), (1-i), −. Returns '' for 1."""
    if v == 1:
        return ""
    if v == -1:
        return "−"
    s = fmt(v)
    simple = re.fullmatch(r"−?\d+", s)
    return (s if simple else f"({s})") + "·"


def show(rows, bar):
    cells = [[fmt(x) for x in r] for r in rows]
    w = [max(len(r[j]) for r in cells) for j in range(len(cells[0]))]
    out = []
    for r in cells:
        left = "  ".join(c.rjust(w[j]) for j, c in enumerate(r[:bar] if bar else r))
        if bar is not None:
            right = "  ".join(c.rjust(w[bar + j]) for j, c in enumerate(r[bar:]))
            out.append(f"    [ {left} | {right} ]")
        else:
            out.append(f"    [ {left} ]")
    return "\n".join(out)


def L(k):
    return f"L{k + 1}".translate(SUB)


# ─────────────────────────────── elimination ───────────────────────────────

class Reducer:
    def __init__(self, rows, bar, quiet=False):
        self.A = [[num(x) for x in r] for r in rows]
        self.bar = bar
        self.quiet = quiet
        self.n = len(rows)
        # Every column may carry a pivot — the right-hand side too. A pivot there happens only
        # when the system is inconsistent, and it is what makes the result THE canonical form
        # of the augmented matrix (unique, שיעור 3 עמ' 155) rather than a near miss.
        self.ncols = len(rows[0])
        self.pivots = []
        self.echelon = None
        # Structured record of every step, for programs that drive the reducer (the GUI):
        # [{"phase": 1|2, "pivot": (r, c) | None, "ops": [op records], "matrix": snapshot}, …]
        self.trace = []
        self._ops = []

    def emit(self, ops, pivot=None, phase=None):
        if ops:
            self.trace.append({"phase": phase, "pivot": pivot, "ops": self._ops,
                               "matrix": [row[:] for row in self.A]})
            if not self.quiet:
                print("  " + ",   ".join(ops))
                print(show(self.A, self.bar))
                print()
        self._ops = []

    def swap(self, i, j):
        self.A[i], self.A[j] = self.A[j], self.A[i]
        label = f"{L(i)} ↔ {L(j)}"
        self._ops.append({"kind": "swap", "rows": [i, j], "label": label})
        return label

    def scale(self, i, lam):
        self.A[i] = [num(lam * x) for x in self.A[i]]
        label = f"{L(i)} → {fmt_coef(lam)}{L(i)}"
        self._ops.append({"kind": "scale", "target": i, "factor": fmt(lam), "label": label})
        return label

    def add(self, i, lam, j):
        self.A[i] = [num(x + lam * y) for x, y in zip(self.A[i], self.A[j])]
        sign, mag = ("−", -lam) if (sp.re(lam) < 0 or (sp.re(lam) == 0 and sp.im(lam) < 0)) else ("+", lam)
        label = f"{L(i)} → {L(i)} {sign} {fmt_coef(mag)}{L(j)}"
        self._ops.append({"kind": "add", "target": i, "source": j, "factor": fmt(lam), "label": label})
        return label

    def forward(self):
        """Phase 1: zeros below each pivot → echelon form (מטריצה מדורגת)."""
        r = 0
        for c in range(self.ncols):
            if r == self.n:
                break
            cand = [k for k in range(r, self.n) if self.A[k][c] != 0]
            if not cand:
                continue
            # As by hand: a pivot of 1 (or −1) below is worth a swap — it avoids fractions.
            pick = next((k for k in cand if self.A[k][c] == 1), None)
            if pick is None:
                pick = next((k for k in cand if self.A[k][c] == -1), None)
            if pick is None:
                pick = r if self.A[r][c] != 0 else cand[0]
            if pick != r:
                # The swap is a step of its own, so the row names in the eliminations that
                # follow refer unambiguously to the rows AFTER the swap.
                self.emit([self.swap(r, pick)], pivot=(r, c), phase=1)
            ops = []
            p = self.A[r][c]
            for k in range(r + 1, self.n):
                if self.A[k][c] != 0:
                    ops.append(self.add(k, num(-self.A[k][c] / p), r))
            self.emit(ops, pivot=(r, c), phase=1)
            self.pivots.append((r, c))
            r += 1
        self.echelon = [row[:] for row in self.A]

    def backward(self):
        """Phase 2: leading 1s, then zeros above each pivot → canonical echelon form."""
        ops = [self.scale(r, num(1 / self.A[r][c])) for r, c in self.pivots if self.A[r][c] != 1]
        self.emit(ops, phase=2)
        for r, c in reversed(self.pivots):
            ops = [self.add(k, num(-self.A[k][c]), r) for k in range(r) if self.A[k][c] != 0]
            self.emit(ops, pivot=(r, c), phase=2)


# ─────────────────────────────── the solution set ───────────────────────────────

def lin(const, terms):
    """const + Σ coef·param, as text."""
    parts = [] if const == 0 and terms else [fmt(const)]
    for p, c in terms:
        if c == 0:
            continue
        neg = sp.re(c) < 0 or (sp.re(c) == 0 and sp.im(c) < 0)
        mag = -c if neg else c
        s = fmt(mag)
        body = p if mag == 1 else (f"{s}{p}" if re.fullmatch(r"\d+", s) else f"({s}){p}")
        if not parts:
            parts.append(("−" if neg else "") + body)
        else:
            parts.append(("− " if neg else "+ ") + body)
    return " ".join(parts) if parts else "0"


def solution(red, original):
    """Return a dict: status 'none' | 'unique' | 'infinite', the general solution, and
    whether substituting it into the ORIGINAL system succeeded."""
    A, bar = red.A, red.bar
    for r, c in red.pivots:
        if c == bar:   # a leading entry in the right-hand side: the row reads 0 = c ≠ 0
            return {"status": "none", "row": red.echelon[r]}
    piv_cols = [c for _, c in red.pivots]
    free = [c for c in range(bar) if c not in piv_cols]
    params = {c: PARAMS[k] if k < len(PARAMS) else f"t{k + 1}" for k, c in enumerate(free)}
    sol = {}
    for r, c in red.pivots:
        sol[c] = (A[r][bar], [(params[f], -A[r][f]) for f in free])
    for f in free:
        sol[f] = (sp.Integer(0), [(params[f], sp.Integer(1))])

    # Self-check: substitute the general solution into the ORIGINAL system.
    psyms = {params[f]: sp.Symbol(params[f]) for f in free}
    xs = [sp.expand(sol[c][0] + sum(k * psyms[p] for p, k in sol[c][1])) for c in range(bar)]
    ok = all(sp.expand(sum(a * x for a, x in zip(row[:bar], xs)) - row[bar]) == 0 for row in original)
    return {"status": "unique" if not free else "infinite", "sol": sol, "free": free,
            "params": params, "xs": xs, "ok": ok}


RULE = "═" * 56


def solve(red, original, names, field):
    """Print the RESULT block: every unknown's value, or why there is none."""
    res = solution(red, original)
    bar = red.bar
    print(RULE)
    print("  RESULT  (תוצאה)")
    print(RULE)
    if res["status"] == "none":
        row = res["row"]
        print("No solution  (אין פתרון)\n")
        print("  The echelon form has the row")
        print(show([row], bar))
        print(f"  which says  0 = {fmt(row[bar])}  — impossible: no values of {', '.join(names)}"
              " satisfy every equation.")
        print("\n  S = ∅")
        print(RULE)
        return res
    sol, free, params, ok = res["sol"], res["free"], res["params"], res["ok"]
    w = max(len(n) for n in names)
    if not free:
        print("Exactly one solution  (פתרון יחיד)\n")
        for c in range(bar):
            print(f"  {names[c].ljust(w)} = {fmt(sol[c][0])}")
        print("\n  S = {(" + ", ".join(fmt(sol[c][0]) for c in range(bar)) + ")}")
    else:
        k = len(free)
        print(f"Infinitely many solutions  (אינסוף פתרונות) — {k} free variable{'s' if k > 1 else ''}\n")
        print("  free: " + ", ".join(f"{names[f]} = {params[f]}" for f in free)
              + f"   ({', '.join(params[f] for f in free)} any number in {field})")
        print("  every other unknown is expressed through "
              + ("it" if k == 1 else "them") + ":\n")
        for c in range(bar):
            tag = "   ← free" if c in free else ""
            print(f"  {names[c].ljust(w)} = {lin(*sol[c])}{tag}")
        ps = ", ".join(params[f] for f in free)
        print("\n  S = {(" + ", ".join(lin(*sol[c]) for c in range(bar)) + f") | {ps} ∈ {field}}}")
        zero = ", ".join(fmt(sol[c][0]) for c in range(bar))
        print(f"  for example, {' = '.join(params[f] for f in free)} = 0 gives the solution ({zero})")
    print("\n  " + ("✓ checked: substituted into the original equations — every one holds"
                    if ok else "✗ CHECK FAILED: the solution does not satisfy the original system"))
    print(RULE)
    if not ok:
        sys.exit(2)
    return res


# ─────────────────────────────── main ───────────────────────────────

def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Step-by-step Gaussian elimination, exact arithmetic, lecture notation.",
        formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__.split("USAGE")[1])
    ap.add_argument("matrix", nargs="?", help='e.g. "1 2 3 | 13; 2 1 1 | 8" or "x + y = 2; x - y = 0"')
    ap.add_argument("-f", "--file", help="read rows / equations from a file")
    ap.add_argument("-q", "--quiet", action="store_true", help="no steps: forms and result only")
    ap.add_argument("-a", "--answer", action="store_true",
                    help="only the RESULT block (x₁ = …, or no / infinitely many solutions)")
    ap.add_argument("-s", "--system", action="store_true",
                    help="no '|' in the input: treat the LAST column as the right-hand side")
    a = ap.parse_args(argv)

    if a.file:
        text = open(a.file, encoding="utf-8").read()
    elif a.matrix:
        text = a.matrix
    else:
        print("Enter one row per line (e.g.  1 2 3 | 13  or  x + 2y = 5). Blank line to finish.")
        lines = []
        for line in sys.stdin:
            if not line.strip():
                break
            lines.append(line)
        text = "\n".join(lines)

    try:
        rows, bar, names = parse_matrix(text, system=a.system)
    except ValueError as e:
        sys.exit(f"error: {e}")

    complex_in = any(sp.im(x) != 0 for r in rows for x in r)
    field = "ℂ" if complex_in else "ℝ"
    out = (lambda *x, **k: None) if a.answer else print
    quiet = a.quiet or a.answer

    out(f"Input ({len(rows)}×{len(rows[0])}, over {field}"
        + (f"; unknowns: {', '.join(names)})" if bar is not None else ")") + ":")
    out(show(rows, bar))
    out()

    red = Reducer(rows, bar, quiet)
    if not quiet:
        print("── Phase 1: zeros below the pivots ──\n")
    red.forward()
    out("Echelon form (מטריצה מדורגת):")
    out(show(red.A, bar))
    out()
    if not quiet:
        print("── Phase 2: leading 1s, then zeros above the pivots ──\n")
    red.backward()
    out("Canonical echelon form (מטריצה מדורגת קנונית):")
    out(show(red.A, bar))
    out(f"  non-zero rows: {len(red.pivots)}")
    out()
    if bar is not None:
        solve(red, rows, names, field)
    else:
        if a.answer:
            print(show(red.A, bar))
        print("(No right-hand side, so this is a matrix, not a system — nothing to solve for x₁, x₂, ….\n"
              " To solve a system, put '|' before the right-hand side:  \"1 2 | 5; 3 4 | 6\"\n"
              " or add -s to read the last column as the right-hand side.)")


if __name__ == "__main__":
    main()
