#!/usr/bin/env python3
# Snapshot of linear_algebra/tools/gauss.py (the Python reference engine), taken 2026-11-16.
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
    python3 tools/gauss.py "m 1 1 | 1; 1 m 1 | m"     a parameter: generic reduction, special values, each case
    python3 tools/gauss.py -p m "mx + y = 1; x + my = m"   in equations the parameter must be named
    python3 tools/gauss.py --case 1 "m 1 | 1; 1 m | m"     the full steps at one value of it

INPUT RULES
    rows are separated by ';' or newlines; '|' separates the right-hand side.
    Entries are separated by spaces, or by commas. A free-standing + or − joins its
    neighbours into one entry, so "1 + i  2 | 3" is two entries, 1+i and 2; "1 -2" is
    also two, 1 and −2. When in doubt, use commas: "1 + i, -1 | 2 + i". Write the imaginary unit as i: 2i, -i, 1/2+3i, (1-i)/2.
    Equations: unknowns are single letters, optionally indexed (x, y, z, t, x1, x_2);
    `i` is always the imaginary unit. Every other letter is an unknown — a parameter m
    written as `mx` or `m x` is rejected (a product is not linear); substitute a value.

A SYSTEM WITH A PARAMETER (שיעור 3, עמ' 233–277)
    The matrix is reduced with the parameter kept symbolic — the generic case — never dividing
    by an expression in it while a number will do, and preferring the simplest expression when
    one must be used (the lecture's choice). The special values are the zeros of every leading
    entry of the echelon form, of every expression divided by, and of the right-hand side of a
    row whose left side vanished. Each special value is substituted into the ORIGINAL system
    and solved on its own, so the three cases come out as the lecture states them. A factor
    whose roots are real but irrational (m² − 2) is named in the generic case's condition and
    left for work by hand. Without a right-hand side the answer is the rank: generic, and at
    each special value.

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


def symnorm(v):
    """Canonical form for an entry that may contain the parameter: a cancelled rational
    function. Without free symbols it is num(), or a simplified algebraic number (√2 …)."""
    v = sp.cancel(sp.together(sp.sympify(v)))
    if not v.free_symbols:
        try:
            return num(v)
        except ValueError:
            return sp.radsimp(sp.simplify(v))
    return v


def is_exact_number(v):
    v = sp.sympify(v)
    if v.free_symbols:
        return False
    a, b = v.as_real_imag()
    return bool(a.is_Rational and b.is_Rational)


def is_negative(c):
    """The sign used to write λ as '− |λ|': for a number, re < 0 (or re = 0 and im < 0); for
    an expression in the parameter, the sign of the leading coefficient of its numerator."""
    c = sp.sympify(c)
    if not c.free_symbols:
        re_, im_ = sp.re(c), sp.im(c)
        try:
            return bool(re_ < 0) or (re_ == 0 and bool(im_ < 0))
        except TypeError:
            return bool(sp.N(re_) < 0)
    numer, _ = sp.fraction(sp.cancel(c))
    return bool(sp.Poly(numer, *sorted(c.free_symbols, key=str)).LC() < 0)


def _exact(expr):
    """Replace every float by the exact fraction it was typed as."""
    return expr.xreplace({f: sp.Rational(str(f)) for f in expr.atoms(sp.Float)})


def parse_number(text, params=None):
    """params: None → numbers only; "auto" → a letter is a parameter; a set of names → those are."""
    local = {"i": sp.I, "I": sp.I}
    if params is not None:   # every other name is a symbol — never sympy's sqrt, E, pi, …
        for tok in re.findall(r"[A-Za-z_][A-Za-z_0-9]*", text):
            if tok not in ("i", "I"):
                local[tok] = sp.Symbol(tok)
    try:
        v = parse_expr(text.strip(), local_dict=local, transformations=TRANSFORMS)
    except Exception as e:  # noqa: BLE001 — report any parse failure the same way
        raise ValueError(f"cannot read the entry {text!r}: {e}") from None
    v = sp.expand(_exact(sp.sympify(v)))
    if not v.free_symbols:
        return num(v)
    letters = {str(x) for x in v.free_symbols}
    if params == "auto" or (params and letters <= set(params)):
        for name in sorted(letters):
            if len(name) != 1:
                raise ValueError(f"a parameter is a single letter — found {name!r} in the entry {text!r}")
        return symnorm(v)
    raise ValueError(f"the entry {text!r} contains a letter other than i. For a system with a "
                     "parameter, name it with -p (e.g. -p m) and the cases are worked out for you.")


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


def parse_input(text, system=False, param=None):
    """Return (rows, n_coeff_cols, var_names, parameter). n_coeff_cols is None for a plain
    matrix; parameter is the sympy Symbol of the parameter, or None.
    system=True reads a matrix without '|' as augmented: the last column is the right-hand side.
    param: None → numbers only; "auto" → in matrix form, a letter in an entry is the parameter;
    a name → that letter is the parameter (in equations it is then not an unknown)."""
    text = text.replace("−", "-").replace("·", "*")
    lines = [r.strip() for r in re.split(r"[;\n]", text) if r.strip()]
    if not lines:
        raise ValueError("empty input")
    if any("=" in r for r in lines):
        return parse_equations(lines, None if param in (None, "auto") else param)
    allowed = "auto" if param == "auto" else ({param} if param else None)
    rows, bar = [], None
    for r in lines:
        parts = r.split("|")
        if len(parts) > 2:
            raise ValueError(f"more than one '|' in row: {r!r}")
        cells = []
        for chunk in parts:
            cells.append([parse_number(x, allowed) for x in _entries(chunk)])
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
    symbols = set().union(*(x.free_symbols for row in rows for x in row))
    if len(symbols) > 1:
        raise ValueError("one parameter at a time — found " + ", ".join(sorted(map(str, symbols))))
    if symbols and any(x.has(sp.I) for row in rows for x in row):
        raise ValueError("a parameter together with complex numbers is not supported")
    return rows, bar, names, (next(iter(symbols)) if symbols else None)


def parse_matrix(text, system=False):
    """The numeric-only reader: (rows, n_coeff_cols, var_names). A letter in an entry is an error."""
    rows, bar, names, _ = parse_input(text, system)
    return rows, bar, names


VAR = re.compile(r"[A-Za-z](_?\d+)?")   # one letter, optional index: x, t, x1, x_2


def _split_letters(line):
    """'mx' → 'm*x', '2xy' → '2x*y': a run of letters is a product, as in handwriting.
    Without this, 'mx + y = 1' would silently become an unknown called mx."""
    def f(m):
        tok = m.group(0)
        return tok if VAR.fullmatch(tok) or not tok.isalpha() else "*".join(tok)
    return re.sub(r"[A-Za-z_][A-Za-z_0-9]*", f, line)


def parse_equations(lines, param=None):
    lines = [_split_letters(x) for x in lines]
    names = []
    for line in lines:   # variable order = order of first appearance in the input
        for tok in re.findall(r"[A-Za-z_][A-Za-z_0-9]*", line):
            if tok not in ("i", "I") and tok != param and tok not in names:
                names.append(tok)
    if not names:
        raise ValueError("no variables found in the equations")
    syms = [sp.Symbol(n) for n in names]
    psym = sp.Symbol(param) if param else None
    norm = symnorm if psym is not None else num
    local = {"i": sp.I, "I": sp.I, **{n: s for n, s in zip(names, syms)}}
    if psym is not None:
        local[param] = psym
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
        try:
            poly = sp.Poly(e, *syms)
        except sp.PolynomialError as ex:
            raise ValueError(f"not linear: {line!r} ({ex})") from None
        if poly.total_degree() > 1:
            prods = [t for t in sp.Add.make_args(e) if sum(sp.degree(t, x) for x in syms) > 1]
            raise ValueError(f"not linear: {line!r} contains {prods[0]}. If a letter there is a "
                             "parameter (m, k, …), name it with -p m and the cases are worked out for you.")
        row = [norm(e.coeff(s)) for s in syms]
        const = norm(e.subs({s: 0 for s in syms}))
        rows.append(row + [norm(-const)])
    if psym is not None and any(x.has(sp.I) for row in rows for x in row):
        raise ValueError("a parameter together with complex numbers is not supported")
    return rows, len(syms), names, psym


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


SUP = str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹")


def _tidy(text):
    """sympy's str → the notation used everywhere else: 2*m**2 - 3*m + 1 → 2m² − 3m + 1."""
    text = re.sub(r"\*\*(\d+)", lambda m: m.group(1).translate(SUP), text)
    text = re.sub(r"(\d)\*([A-Za-z(])", r"\1\2", text)
    text = text.replace(")*(", ")(").replace("*", "·").replace("sqrt(", "√(")
    text = re.sub(r"√\((\d+)\)", r"√\1", text)
    return re.sub(r"(^|[\s(])-", r"\1−", text)


def _poly_text(poly, sym):
    """A polynomial written out: terms in descending degree — except the two-term case
    'positive number minus something', written number first (1 − m, 2 − m²) — as 2m² − 3m + 1."""
    terms = [(k, c) for (k,), c in sp.Poly(sp.expand(poly), sym).terms()]   # descending degree
    if len(terms) == 2 and terms[1][0] == 0 and terms[1][1] > 0 and terms[0][1] < 0:
        terms = [terms[1], terms[0]]
    out = ""
    for idx, (k, c) in enumerate(terms):
        neg = c < 0
        mag = -c if neg else c
        mono = "" if k == 0 else str(sym) + ("" if k == 1 else str(k).translate(SUP))
        if k == 0:
            body = fmt(mag)
        elif mag == 1:
            body = mono
        else:
            body = (fmt(mag) if mag.is_Integer else f"({fmt(mag)})") + mono
        out += (("−" if neg else "") if idx == 0 else (" − " if neg else " + ")) + body
    return out


def _poly_str(poly, sym):
    """A polynomial in the parameter, written as the lecture writes it: 1 − m, m + 2, 2m + 3,
    m² + 1 — and factored when that is shorter: 6(m − 1), (1 − m)(m + 2), (m + 1)²."""
    poly = sp.expand(poly)
    if not poly.free_symbols:
        return fmt(poly)
    coeff, factors = sp.factor_list(poly, sym)
    if factors and coeff < 0 and factors[0][1] == 1 and sp.degree(factors[0][0], sym) == 1 \
            and factors[0][0].coeff(sym, 0) < 0:
        coeff, factors = -coeff, [(sp.expand(-factors[0][0]), 1)] + factors[1:]   # −(m − 1) → 1 − m
    if coeff == 1 and len(factors) == 1 and factors[0][1] == 1:
        return _poly_text(factors[0][0], sym)
    if coeff == -1 and len(factors) == 1 and factors[0][1] == 1:
        t = sp.expand(-factors[0][0])                       # −(m² − 2) → 2 − m², but −(m + 1) stays
        if any(c > 0 for c in sp.Poly(t, sym).coeffs()):
            return _poly_text(t, sym)
    parts = []
    if coeff == -1:
        parts.append("−")
    elif coeff != 1:
        parts.append(fmt(coeff) if coeff.is_Integer else f"({fmt(coeff)})")
    factors = sorted(factors, key=lambda fk: 0 if fk[0].is_Symbol else 1)
    for f, k in factors:
        body = _poly_text(f, sym)
        if not f.is_Symbol:
            body = f"({body})"
        parts.append(body + (str(k).translate(SUP) if k > 1 else ""))
    return "".join(parts)


def _depth0_space(text):
    depth = 0
    for ch in text:
        depth += (ch == "(") - (ch == ")")
        if ch == " " and depth == 0:
            return True
    return False


def fmt_sym(e):
    """An entry in the parameter, as text: (m + 1)/(m + 2), −2(2m + 3)/3, 1 − m."""
    e = sp.together(sp.cancel(sp.together(sp.sympify(e))))
    syms = sorted(e.free_symbols, key=str)
    if not syms:
        return _tidy(str(sp.radsimp(sp.simplify(e))))
    sym = syms[0]
    numer, denom = (sp.expand(x) for x in e.as_numer_denom())
    if (denom.free_symbols and sp.Poly(denom, sym).LC() < 0) or (not denom.free_symbols and denom < 0):
        numer, denom = -numer, -denom
    if denom != 1 and not numer.free_symbols and numer < 0:
        flipped = _poly_str(sp.expand(-denom), sym)
        if not flipped.startswith("−"):
            numer, denom = -numer, sp.expand(-denom)
    ns = _poly_str(numer, sym)
    if denom == 1:
        return ns
    ds = _poly_str(denom, sym)
    if _depth0_space(ns):
        ns = f"({ns})"
    if not re.fullmatch(r"\d+|[A-Za-z]|\([^()]*\)", ds):
        ds = f"({ds})"
    return f"{ns}/{ds}"


def fmt(v):
    """Exact number as text, the way the lecture writes it: 3, −1/2, 2i, −i, (8−4i)/5 — or,
    for an entry in the parameter, (m + 1)/(m + 2), 6(m − 1), 1 − m."""
    v = sp.sympify(v)
    if v.free_symbols or not is_exact_number(v):
        return fmt_sym(v)
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
    """A multiplier written before ·L: 2, (1/3), (1−i), m, (1 − m), −. Returns '' for 1."""
    v = sp.sympify(v)
    if v == 1:
        return ""
    if v == -1:
        return "−"
    s = fmt(v)
    simple = re.fullmatch(r"−?\d+|−?(?!i$)[A-Za-z]", s)
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
    def __init__(self, rows, bar, quiet=False, norm=num):
        self.norm = norm                 # num for numbers; symnorm when a parameter is present
        self.A = [[norm(x) for x in r] for r in rows]
        self.bar = bar
        self.quiet = quiet
        self.divisors = []               # expressions in the parameter that were divided by
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
        self.A[i] = [self.norm(lam * x) for x in self.A[i]]
        label = f"{L(i)} → {fmt_coef(lam)}{L(i)}"
        self._ops.append({"kind": "scale", "target": i, "factor": fmt(lam), "label": label})
        return label

    def add(self, i, lam, j):
        self.A[i] = [self.norm(x + lam * y) for x, y in zip(self.A[i], self.A[j])]
        sign, mag = ("−", -lam) if is_negative(lam) else ("+", lam)
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
            # With a parameter: never divide by an expression in it while a number will do,
            # and among expressions take the simplest (lowest degree) — the lecture's choice.
            pick = next((k for k in cand if self.A[k][c] == 1), None)
            if pick is None:
                pick = next((k for k in cand if self.A[k][c] == -1), None)
            if pick is None:
                pick = next((k for k in cand if not self.A[k][c].free_symbols), None)
            if pick is None:
                pick = min(cand, key=lambda k: sp.degree(sp.fraction(self.A[k][c])[0], *self.A[k][c].free_symbols))
            if pick != r:
                # The swap is a step of its own, so the row names in the eliminations that
                # follow refer unambiguously to the rows AFTER the swap.
                self.emit([self.swap(r, pick)], pivot=(r, c), phase=1)
            ops = []
            p = self.A[r][c]
            for k in range(r + 1, self.n):
                if self.A[k][c] != 0:
                    ops.append(self.add(k, self.norm(-self.A[k][c] / p), r))
            if ops and p.free_symbols:
                self.divisors.append(p)
            self.emit(ops, pivot=(r, c), phase=1)
            self.pivots.append((r, c))
            r += 1
        self.echelon = [row[:] for row in self.A]

    def backward(self):
        """Phase 2: leading 1s, then zeros above each pivot → canonical echelon form."""
        self.divisors += [self.A[r][c] for r, c in self.pivots if self.A[r][c].free_symbols]
        ops = [self.scale(r, self.norm(1 / self.A[r][c])) for r, c in self.pivots if self.A[r][c] != 1]
        self.emit(ops, phase=2)
        for r, c in reversed(self.pivots):
            ops = [self.add(k, self.norm(-self.A[k][c]), r) for k in range(r) if self.A[k][c] != 0]
            self.emit(ops, pivot=(r, c), phase=2)


# ─────────────────────────────── the solution set ───────────────────────────────

def lin(const, terms):
    """const + Σ coef·param, as text."""
    parts = [] if const == 0 and terms else [fmt(const)]
    for p, c in terms:
        if c == 0:
            continue
        neg = is_negative(c)
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
    ok = all(symnorm(sum(a * x for a, x in zip(row[:bar], xs)) - row[bar]) == 0 for row in original)
    return {"status": "unique" if not free else "infinite", "sol": sol, "free": free,
            "params": params, "xs": xs, "ok": ok}


RULE = "═" * 56


def describe(res, names, field, bar, indent=""):
    """The body of a RESULT block for one solution dict — what solve() prints inside its rules."""
    def p(line=""):
        print(indent + line if line else "")
    if res["status"] == "none":
        row = res["row"]
        p("No solution  (אין פתרון)")
        p()
        p("  The echelon form has the row")
        for line in show([row], bar).split("\n"):
            p(line)
        p(f"  which says  0 = {fmt(row[bar])}  — impossible: no values of {', '.join(names)} satisfy every equation.")
        p()
        p("  S = ∅")
        return
    sol, free, params, ok = res["sol"], res["free"], res["params"], res["ok"]
    w = max(len(n) for n in names)
    if not free:
        p("Exactly one solution  (פתרון יחיד)")
        p()
        for c in range(bar):
            p(f"  {names[c].ljust(w)} = {fmt(sol[c][0])}")
        p()
        p("  S = {(" + ", ".join(fmt(sol[c][0]) for c in range(bar)) + ")}")
    else:
        k = len(free)
        p(f"Infinitely many solutions  (אינסוף פתרונות) — {k} free variable{'s' if k > 1 else ''}")
        p()
        p("  free: " + ", ".join(f"{names[f]} = {params[f]}" for f in free)
          + f"   ({', '.join(params[f] for f in free)} any number in {field})")
        p("  every other unknown is expressed through " + ("them" if k > 1 else "it") + ":")
        p()
        for c in range(bar):
            tag = "   ← free" if c in free else ""
            p(f"  {names[c].ljust(w)} = {lin(*sol[c])}{tag}")
        ps = ", ".join(params[f] for f in free)
        p()
        p("  S = {(" + ", ".join(lin(*sol[c]) for c in range(bar)) + f") | {ps} ∈ {field}}}")
        zero = ", ".join(fmt(sol[c][0]) for c in range(bar))
        p(f"  for example, {' = '.join(params[f] for f in free)} = 0 gives the solution ({zero})")
    p()
    p("  " + ("✓ checked: substituted into the original equations — every one holds"
              if ok else "✗ CHECK FAILED: the solution does not satisfy the original system"))


def solve(red, original, names, field):
    """Print the RESULT block: every unknown's value, or why there is none."""
    res = solution(red, original)
    print(RULE)
    print("  RESULT  (תוצאה)")
    print(RULE)
    describe(res, names, field, red.bar)
    print(RULE)
    if res["status"] != "none" and not res["ok"]:
        sys.exit(2)
    return res


# ─────────────────────────────── systems with a parameter ───────────────────────────────

def special_values(exprs, sym):
    """The RATIONAL values of the parameter at which any of the expressions vanishes — the
    lecture's cases — plus the irreducible factors of degree ≥ 2 that do vanish for some real
    value: their roots are irrational and are left for work by hand. A factor with no real root
    (m² + 1) never vanishes — the parameter is real — so it is no case at all."""
    values, unsolved = [], []
    for e in exprs:
        numer, _ = sp.fraction(sp.cancel(e))
        poly = sp.Poly(numer, sym)
        if poly.degree() < 1:
            continue
        for v in sp.roots(poly, filter="Q"):
            if v not in values:
                values.append(v)
        for f, _k in sp.factor_list(numer, sym)[1]:
            if sp.degree(f, sym) >= 2 and sp.Poly(f, sym).count_roots() > 0:
                txt = _poly_str(f, sym)
                if txt not in unsolved:
                    unsolved.append(txt)
    values.sort()
    return values, unsolved


def run_case(rows, bar, sym, value):
    """The system at one value of the parameter: its rows, the reducer and the solution."""
    rows_v = [[symnorm(x.subs(sym, value)) for x in row] for row in rows]
    numeric = all(is_exact_number(x) for row in rows_v for x in row)
    red = Reducer(rows_v, bar, quiet=True, norm=num if numeric else symnorm)
    red.forward()
    red.backward()
    return rows_v, red, (solution(red, rows_v) if bar is not None else None)


def parametric(rows, bar, sym):
    """Reduce with the parameter kept symbolic — the GENERIC case — then find the special
    values: the zeros of every leading entry of the echelon form, of every expression that was
    divided by, and of the right-hand side of a row whose left side vanished. Each special value
    is substituted into the ORIGINAL system and solved on its own."""
    red = Reducer(rows, bar, quiet=True, norm=symnorm)
    red.forward()
    red.backward()
    origins = []                                   # (expression, where it comes from)
    for r, c in red.pivots:
        e = red.echelon[r][c]
        if e.free_symbols:
            origins.append((e, f"leading entry of {L(r)} in the echelon form"))
    if bar is not None:
        for r, row in enumerate(red.echelon):
            if all(x == 0 for x in row[:bar]) and row[bar] != 0 and row[bar].free_symbols:
                origins.append((row[bar], f"right-hand side of {L(r)}, whose left side vanished"))
    for e in red.divisors:
        if not any(sp.cancel(e - o) == 0 for o, _ in origins):
            origins.append((e, "divided by during the reduction"))
    exprs = []
    for e, _ in origins:
        if not any(sp.cancel(e - x) == 0 for x in exprs):
            exprs.append(e)
    values, unsolved = special_values(exprs, sym)
    undefined = []                                 # where the INPUT itself is undefined
    for row in rows:
        for x in row:
            d = sp.fraction(sp.cancel(x))[1]
            if d.free_symbols:
                for v in sp.roots(sp.Poly(d, sym), filter="Q"):
                    if v not in undefined:
                        undefined.append(v)
    generic = solution(red, rows) if bar is not None else None
    cases = []
    for v in values:
        if v in undefined:
            continue
        rows_v, red_v, res_v = run_case(rows, bar, sym, v)
        same = False
        if res_v is not None and generic is not None and res_v["status"] == "unique" \
                and generic["status"] == "unique":
            try:
                same = all(symnorm(g.subs(sym, v) - x) == 0 for g, x in zip(generic["xs"], res_v["xs"]))
            except (ValueError, ZeroDivisionError):
                same = False
        cases.append({"value": v, "rows": rows_v, "red": red_v, "res": res_v, "same_as_generic": same})
    return {"sym": sym, "red": red, "origins": origins, "values": values, "unsolved": unsolved,
            "undefined": undefined, "generic": generic, "cases": cases}


def generic_condition(P):
    """Where the generic case holds: every value of the parameter but the special ones — the
    rational ones by value, the irrational ones by the factor that vanishes there."""
    sym = P["sym"]
    parts = [f"{sym} ∉ {{{', '.join(fmt(v) for v in P['values'])}}}"] if P["values"] else []
    parts += [f"{f} ≠ 0" for f in P["unsolved"]]
    return " and ".join(parts) if parts else f"every {sym}"


def print_parametric(P, rows, names, field, quiet=False, answer_only=False):
    sym, red, bar = P["sym"], P["red"], P["red"].bar
    out = (lambda *x, **k: None) if answer_only else print
    out(f"Parameter {sym}. The reduction below is the GENERIC case: it divides by expressions in "
        f"{sym}, and the values where those vanish are treated separately after it.")
    out()
    for phase, title in ((1, "Phase 1: zeros below the pivots"), (2, "Phase 2: leading 1s, then zeros above the pivots")):
        steps = [st for st in red.trace if st["phase"] == phase]
        if steps and not quiet:
            out(f"── {title} ──")
            out()
            for st in steps:
                out("  " + ",   ".join(o["label"] for o in st["ops"]))
                out(show(st["matrix"], bar))
                out()
        if phase == 1:
            out("Echelon form (מטריצה מדורגת), generic:")
            out(show(red.echelon, bar))
            out()
    out("Canonical echelon form (מטריצה מדורגת קנונית), generic:")
    out(show(red.A, bar))
    out(f"  non-zero rows: {len(red.pivots)}")
    out()
    print(RULE)
    print(f"  SPECIAL VALUES OF {sym}  (ערכים מיוחדים)")
    print(RULE)
    if P["origins"]:
        for e, where in P["origins"]:
            print(f"  {fmt(e)} = 0   ← {where}")
        if P["values"]:
            print(f"  ⟹ {sym} ∈ {{{', '.join(fmt(v) for v in P['values'])}}}")
        elif P["unsolved"]:
            print(f"  ⟹ no rational special value")
        else:
            print(f"  ⟹ none of these vanishes for any {sym}: the generic case is the only case")
    else:
        print(f"  no leading entry or divisor depends on {sym} — the generic case holds for every {sym}")
    for f in P["unsolved"]:
        print(f"  ⚠ {f} = 0 has no rational root — treat that case by hand")
    if P["undefined"]:
        print(f"  ⚠ the matrix itself is undefined at {sym} ∈ {{{', '.join(fmt(v) for v in P['undefined'])}}} (a denominator vanishes)")
    print(RULE)
    cond = generic_condition(P)
    if bar is None:                                # a matrix, not a system: its rank, generic and at each value
        print("  RANK  (דרגה)")
        print(RULE)
        print(f"▸ For {cond}  — the generic case: rank {len(red.pivots)}")
        for case in P["cases"]:
            print(f"▸ For {sym} = {fmt(case['value'])}: rank {len(case['red'].pivots)}")
        print(RULE)
        if P["cases"]:
            print(f"  the full steps for one case:  --case {fmt(P['cases'][0]['value'])}")
        return
    print("  RESULT  (תוצאה)")
    print(RULE)
    print(f"▸ For {cond}  — the generic case:")
    describe(P["generic"], names, field, bar, indent="  ")
    for case in P["cases"]:
        v = case["value"]
        print()
        print(f"▸ For {sym} = {fmt(v)}:")
        if case["same_as_generic"]:
            print(f"  (the generic formula is valid here too — this value only interrupted the reduction above)")
        describe(case["res"], names, field, bar, indent="  ")
    print(RULE)
    if P["cases"]:
        print(f"  the full steps for one case:  --case {fmt(P['values'][0])}")


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
    ap.add_argument("-p", "--param", metavar="NAME", default="auto",
                    help="the parameter, e.g. m. In matrix form a letter in an entry is one by itself; "
                         "equations need it named (so that 'mx' is m·x with x the unknown)")
    ap.add_argument("--case", metavar="VALUE",
                    help="with a parameter: show the full steps for this one value of it")
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
        rows, bar, names, psym = parse_input(text, system=a.system, param=a.param)
        if psym is not None and a.case is not None:
            value = parse_number(a.case.replace("−", "-"))
            rows, _, _ = run_case(rows, bar, psym, value)
            print(f"Case {psym} = {fmt(value)} — the system at that value:")
            psym = None
    except ValueError as e:
        sys.exit(f"error: {e}")

    complex_in = any((x.has(sp.I) if x.free_symbols else sp.im(x) != 0) for r in rows for x in r)
    field = "ℂ" if complex_in else "ℝ"
    out = (lambda *x, **k: None) if a.answer else print
    quiet = a.quiet or a.answer

    out(f"Input ({len(rows)}×{len(rows[0])}, over {field}"
        + (f"; unknowns: {', '.join(names)}" if bar is not None else "")
        + (f"; parameter {psym}" if psym is not None else "") + "):")
    out(show(rows, bar))
    out()

    if psym is not None:
        print_parametric(parametric(rows, bar, psym), rows, names, field, quiet, a.answer)
        return

    exact = all(is_exact_number(x) for r in rows for x in r)
    red = Reducer(rows, bar, quiet, norm=num if exact else symnorm)
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
