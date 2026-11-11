'use strict';
/* Gauss engine — a JavaScript port of linear_algebra/tools/gauss.py and gauss_gui.analyse().
 *
 * Exact arithmetic: rationals are pairs of BigInts, complex numbers pairs of rationals. The
 * result object is identical, string for string, to the Python engine's JSON — tests/test_engine.js
 * checks it against tests/golden.json, which the Python engine generated. Keep the two in step:
 * a behaviour change in gauss.py means regenerating the corpus and re-running the test.
 *
 * Usage:  GaussEngine.analyse(text, system) → result object, or throws GaussEngine.GaussError. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GaussEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  class GaussError extends Error {}
  const fail = msg => { throw new GaussError(msg); };

  const MAX_LEN = 4000, MAX_DIM = 10;
  const BAD_CHAR = /[^0-9A-Za-z_+\-*/^().,;|=\s−·×]/;
  const BIG_POWER = /(\^|\*\*)\s*\(?\s*-?\d{3,}|(\^|\*\*)[^,;|\s]*(\^|\*\*)/;
  const SUB = '₀₁₂₃₄₅₆₇₈₉';
  const sub = s => String(s).replace(/\d/g, d => SUB[d]);
  const PARAMS = 'αβγδεζηθκμνξπρστφχψω';
  const NOT_EXACT = 'not an exact rational or complex-rational number';

  /* ───────────────────────── rationals (BigInt) ───────────────────────── */
  const babs = a => (a < 0n ? -a : a);
  function bgcd(a, b) { a = babs(a); b = babs(b); while (b) { const t = a % b; a = b; b = t; } return a; }
  function Q(n, d = 1n) {
    if (d === 0n) fail(NOT_EXACT + ': division by zero');
    if (d < 0n) { n = -n; d = -d; }
    const g = bgcd(n, d) || 1n;
    return { n: n / g, d: d / g };
  }
  const Q0 = Q(0n), Q1 = Q(1n);
  const qadd = (a, b) => Q(a.n * b.d + b.n * a.d, a.d * b.d);
  const qsub = (a, b) => Q(a.n * b.d - b.n * a.d, a.d * b.d);
  const qmul = (a, b) => Q(a.n * b.n, a.d * b.d);
  const qdiv = (a, b) => Q(a.n * b.d, a.d * b.n);
  const qneg = a => ({ n: -a.n, d: a.d });
  const qzero = a => a.n === 0n;
  const qeq = (a, b) => a.n === b.n && a.d === b.d;

  /* ───────────────────────── complex rationals ───────────────────────── */
  const C = (re, im = Q0) => ({ re, im });
  const C0 = C(Q0), C1 = C(Q1), CI = C(Q0, Q1);
  const cadd = (a, b) => C(qadd(a.re, b.re), qadd(a.im, b.im));
  const csub = (a, b) => C(qsub(a.re, b.re), qsub(a.im, b.im));
  const cmul = (a, b) => C(qsub(qmul(a.re, b.re), qmul(a.im, b.im)), qadd(qmul(a.re, b.im), qmul(a.im, b.re)));
  const cneg = a => C(qneg(a.re), qneg(a.im));
  const czero = a => qzero(a.re) && qzero(a.im);
  const ceq = (a, b) => qeq(a.re, b.re) && qeq(a.im, b.im);
  const cisint = (a, k) => qzero(a.im) && a.re.d === 1n && a.re.n === k;
  // the sign test gauss.py uses for λ: re(λ) < 0, or re(λ) = 0 and im(λ) < 0
  const cnegative = a => a.re.n < 0n || (qzero(a.re) && a.im.n < 0n);
  function cdiv(a, b) {
    if (czero(b)) fail(NOT_EXACT + ': division by zero');
    const den = qadd(qmul(b.re, b.re), qmul(b.im, b.im));
    const num = cmul(a, C(b.re, qneg(b.im)));
    return C(qdiv(num.re, den), qdiv(num.im, den));
  }
  function cpow(a, k) {
    if (k < 0n) return cdiv(C1, cpow(a, -k));
    let result = C1, base = a;
    while (k > 0n) { if (k & 1n) result = cmul(result, base); base = cmul(base, base); k >>= 1n; }
    return result;
  }

  /* ───────────────────────── formatting (gauss.py: fmt, fmt_coef, L, lin) ───────────────────────── */
  const minus = s => s.replace(/-/g, '−');
  const ratStr = q => (q.d === 1n ? `${q.n}` : `${q.n}/${q.d}`);
  function gaussInt(a, b) {
    const im = b === 1n ? 'i' : b === -1n ? '-i' : `${b}i`;
    if (b === 0n) return `${a}`;
    if (a === 0n) return im;
    return im.startsWith('-') ? `${a}${im}` : `${a}+${im}`;
  }
  function fmt(v) {
    const a = v.re, b = v.im;
    if (qzero(b)) return minus(ratStr(a));
    const d = a.d * b.d / bgcd(a.d, b.d);
    const A = a.n * (d / a.d), B = b.n * (d / b.d);
    if (d === 1n) return minus(gaussInt(A, B));
    if (A === 0n) return minus(`${gaussInt(0n, B)}/${d}`);
    return minus(`(${gaussInt(A, B)})/${d}`);
  }
  function fmtCoef(v) {
    if (cisint(v, 1n)) return '';
    if (cisint(v, -1n)) return '−';
    const s = fmt(v);
    return (/^−?\d+$/.test(s) ? s : `(${s})`) + '·';
  }
  const L = k => 'L' + sub(k + 1);
  function lin(konst, terms) {
    const parts = (czero(konst) && terms.length) ? [] : [fmt(konst)];
    for (const [p, c] of terms) {
      if (czero(c)) continue;
      const neg = cnegative(c);
      const mag = neg ? cneg(c) : c;
      const s = fmt(mag);
      const body = cisint(mag, 1n) ? p : (/^\d+$/.test(s) ? `${s}${p}` : `(${s})${p}`);
      if (!parts.length) parts.push((neg ? '−' : '') + body);
      else parts.push((neg ? '− ' : '+ ') + body);
    }
    return parts.length ? parts.join(' ') : '0';
  }

  /* ───────────────────────── expression parser ─────────────────────────
     Replaces sympy's parse_expr for the two uses in gauss.py: a numeric entry, and a linear
     expression in the unknowns of an equation. Values are linear forms {c, terms}: a constant
     plus a Map name → coefficient. An entry must come out constant. */
  const LF = (c, terms = new Map()) => ({ c, terms });
  function lfconst(a) { for (const v of a.terms.values()) if (!czero(v)) return false; return true; }
  function lfadd(a, b) {
    const t = new Map(a.terms);
    for (const [k, v] of b.terms) t.set(k, t.has(k) ? cadd(t.get(k), v) : v);
    return LF(cadd(a.c, b.c), t);
  }
  function lfscale(a, s) {
    const t = new Map();
    for (const [k, v] of a.terms) t.set(k, cmul(v, s));
    return LF(cmul(a.c, s), t);
  }
  const lfneg = a => lfscale(a, cneg(C1));
  const lfsub = (a, b) => lfadd(a, lfneg(b));

  function parseDecimal(str) {
    const m = /^(\d*)\.?(\d*)(?:[eE]([+-]?\d+))?$/.exec(str);
    const int = m[1] || '', frac = m[2] || '';
    let n = BigInt((int + frac) || '0'), d = 10n ** BigInt(frac.length);
    const e = m[3] ? parseInt(m[3], 10) : 0;
    if (Math.abs(e) > 40) fail('that number is too large for an exact calculator');
    if (e > 0) n *= 10n ** BigInt(e); else if (e < 0) d *= 10n ** BigInt(-e);
    return C(Q(n, d));
  }

  function tokenize(src, what) {
    const toks = [];
    let i = 0;
    while (i < src.length) {
      const rest = src.slice(i);
      let m;
      if (/^\s/.test(rest)) { i++; continue; }
      if ((m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(rest))) { toks.push({ t: 'num', v: m[0] }); i += m[0].length; continue; }
      if ((m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(rest))) { toks.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
      if (rest.startsWith('**')) { toks.push({ t: 'op', v: '^' }); i += 2; continue; }
      if ('+-*/^()'.includes(rest[0])) { toks.push({ t: 'op', v: rest[0] }); i++; continue; }
      fail(`cannot read the ${what} ${JSON.stringify(src)}: unexpected ${JSON.stringify(rest[0])}`);
    }
    return toks;
  }

  const nonlinear = line => fail(`not linear: '${line}' contains a product of unknowns. If a letter there is a ` +
    'parameter (m, k, …), the system needs a case split by hand — substitute a value of the parameter to check one case.');

  function parseExpression(src, mode, line) {
    const what = mode === 'entry' ? 'entry' : 'equation';
    const toks = tokenize(src.trim(), what);
    let p = 0;
    const peek = () => toks[p];
    const isOp = (t, v) => t && t.t === 'op' && t.v === v;
    const atomStart = t => t && (t.t === 'num' || t.t === 'id' || isOp(t, '('));
    const syntax = () => fail(`cannot read the ${what} ${JSON.stringify(src)}: invalid syntax`);

    function expr() {
      let v = term();
      while (isOp(peek(), '+') || isOp(peek(), '-')) {
        const op = toks[p++].v;
        const r = term();
        v = op === '+' ? lfadd(v, r) : lfsub(v, r);
      }
      return v;
    }
    function term() {
      let v = unary();
      for (;;) {
        const t = peek();
        if (isOp(t, '*') || isOp(t, '/')) {
          p++;
          const r = unary();
          if (t.v === '*') v = mul(v, r);
          else { if (!lfconst(r)) nonlinear(line); v = lfscale(v, cdiv(C1, r.c)); }
        } else if (atomStart(t)) {                       // implicit multiplication: 2i, 2(3), (1+i)z, i z1
          if (t.t === 'num' && toks[p - 1].t === 'num') syntax();
          v = mul(v, unary());
        } else return v;
      }
    }
    function mul(a, b) {
      if (lfconst(b)) return lfscale(a, b.c);
      if (lfconst(a)) return lfscale(b, a.c);
      return nonlinear(line);
    }
    function unary() {
      if (isOp(peek(), '-')) { p++; return lfneg(unary()); }
      if (isOp(peek(), '+')) { p++; return unary(); }
      return power();
    }
    function power() {
      const base = atom();
      if (!isOp(peek(), '^')) return base;
      p++;
      const e = unary();
      if (!lfconst(e)) nonlinear(line);
      if (!qzero(e.c.im) || e.c.re.d !== 1n) {
        if (lfconst(base)) fail(`${NOT_EXACT}: ${src.trim()}`);
        nonlinear(line);
      }
      const k = e.c.re.n;
      if (!lfconst(base)) {
        if (k === 1n) return base;
        if (k === 0n) return LF(C1);
        nonlinear(line);
      }
      return LF(cpow(base.c, k));
    }
    function atom() {
      const t = toks[p++];
      if (!t) syntax();
      if (t.t === 'num') return LF(parseDecimal(t.v));
      if (t.t === 'id') {
        if (t.v === 'i' || t.v === 'I') return LF(CI);
        if (mode === 'entry') fail(`the entry ${JSON.stringify(src.trim())} contains a letter other than i. Systems with a ` +
          'parameter (m, k, …) need a case split by hand — substitute a value of the parameter to check one case.');
        return LF(C0, new Map([[t.v, C1]]));
      }
      if (isOp(t, '(')) {
        const v = expr();
        if (!isOp(peek(), ')')) syntax();
        p++;
        return v;
      }
      return syntax();
    }

    if (!toks.length) syntax();
    const v = expr();
    if (p < toks.length) syntax();
    return v;
  }

  const parseNumber = text => parseExpression(text, 'entry').c;

  /* ───────────────────────── input (gauss.py: _entries, parse_matrix, parse_equations) ───────────────────────── */
  function entries(chunk) {
    if (chunk.includes(',')) return chunk.split(',').filter(x => x.trim());
    const out = [];
    let glue = false;
    for (const tok of chunk.trim().split(/\s+/).filter(Boolean)) {
      if (tok === '+' || tok === '-') {
        if (!out.length) fail(`a row starts with a lone '${tok}': '${chunk.trim()}'`);
        out[out.length - 1] += tok;
        glue = true;
      } else if (glue || (out.length && '+-*/('.includes(out[out.length - 1].slice(-1)))) {
        out[out.length - 1] += tok;
        glue = false;
      } else out.push(tok);
    }
    if (glue) fail(`an entry ends with an operator: '${chunk.trim()}'`);
    return out;
  }

  function parseMatrix(text, system) {
    text = text.replace(/−/g, '-').replace(/·/g, '*');
    const lines = text.split(/[;\n]/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) fail('empty input');
    if (lines.some(l => l.includes('='))) return parseEquations(lines);
    const rows = [];
    let bar = null;
    for (const r of lines) {
      const parts = r.split('|');
      if (parts.length > 2) fail(`more than one '|' in row: '${r}'`);
      const cells = parts.map(chunk => entries(chunk).map(parseNumber));
      const thisBar = parts.length === 2 ? cells[0].length : null;
      if (rows.length && thisBar !== bar) fail("every row needs the '|' in the same place (or none at all)");
      bar = thisBar;
      rows.push(cells.flat());
    }
    const width = rows[0].length;
    rows.forEach((r, k) => { if (r.length !== width) fail(`row ${k + 1} has ${r.length} entries, row 1 has ${width}`); });
    if (system && bar === null) {
      if (width < 2) fail('-s needs at least two columns: coefficients, then the right-hand side');
      bar = width - 1;
    }
    const names = [];
    for (let k = 1; k <= (bar || 0); k++) names.push('x' + sub(k));
    return { rows, bar, names };
  }

  const VAR = /^[A-Za-z](_?\d+)?$/;
  // 'mx' → 'm*x', 'xy' → 'x*y': a run of letters is a product, as in handwriting.
  const splitLetters = line => line.replace(/[A-Za-z_][A-Za-z_0-9]*/g,
    tok => (VAR.test(tok) || !/^[A-Za-z]+$/.test(tok)) ? tok : tok.split('').join('*'));

  function parseEquations(lines) {
    lines = lines.map(splitLetters);
    const names = [];
    for (const line of lines) {
      for (const tok of line.match(/[A-Za-z_][A-Za-z_0-9]*/g) || []) {
        if (tok !== 'i' && tok !== 'I' && !names.includes(tok)) names.push(tok);
      }
    }
    if (!names.length) fail('no variables found in the equations');
    const rows = [];
    for (const line of lines) {
      if ((line.match(/=/g) || []).length !== 1) fail(`not a single equation: '${line}'`);
      const [lhs, rhs] = line.split('=');
      const e = lfsub(parseExpression(lhs, 'equation', line), parseExpression(rhs, 'equation', line));
      const row = names.map(n => e.terms.get(n) || C0);
      row.push(cneg(e.c));
      rows.push(row);
    }
    return { rows, bar: names.length, names };
  }

  /* ───────────────────────── elimination (gauss.py: Reducer) ───────────────────────── */
  class Reducer {
    constructor(rows, bar) {
      this.A = rows.map(r => r.slice());
      this.bar = bar;
      this.n = rows.length;
      this.ncols = rows[0].length;       // the right-hand side may carry a pivot: that is the inconsistent case
      this.pivots = [];
      this.echelon = null;
      this.trace = [];
      this._ops = [];
    }
    emit(ops, pivot, phase) {
      if (ops.length) this.trace.push({ phase, pivot, ops: this._ops, matrix: this.A.map(r => r.slice()) });
      this._ops = [];
    }
    swap(i, j) {
      [this.A[i], this.A[j]] = [this.A[j], this.A[i]];
      const label = `${L(i)} ↔ ${L(j)}`;
      this._ops.push({ kind: 'swap', rows: [i, j], label });
      return label;
    }
    scale(i, lam) {
      this.A[i] = this.A[i].map(x => cmul(lam, x));
      const label = `${L(i)} → ${fmtCoef(lam)}${L(i)}`;
      this._ops.push({ kind: 'scale', target: i, factor: fmt(lam), label });
      return label;
    }
    add(i, lam, j) {
      this.A[i] = this.A[i].map((x, k) => cadd(x, cmul(lam, this.A[j][k])));
      const neg = cnegative(lam);
      const label = `${L(i)} → ${L(i)} ${neg ? '−' : '+'} ${fmtCoef(neg ? cneg(lam) : lam)}${L(j)}`;
      this._ops.push({ kind: 'add', target: i, source: j, factor: fmt(lam), label });
      return label;
    }
    forward() {
      let r = 0;
      for (let c = 0; c < this.ncols; c++) {
        if (r === this.n) break;
        const cand = [];
        for (let k = r; k < this.n; k++) if (!czero(this.A[k][c])) cand.push(k);
        if (!cand.length) continue;
        let pick = cand.find(k => cisint(this.A[k][c], 1n));
        if (pick === undefined) pick = cand.find(k => cisint(this.A[k][c], -1n));
        if (pick === undefined) pick = czero(this.A[r][c]) ? cand[0] : r;
        if (pick !== r) this.emit([this.swap(r, pick)], [r, c], 1);   // the swap is a step of its own
        const ops = [];
        const p = this.A[r][c];
        for (let k = r + 1; k < this.n; k++) {
          if (!czero(this.A[k][c])) ops.push(this.add(k, cneg(cdiv(this.A[k][c], p)), r));
        }
        this.emit(ops, [r, c], 1);
        this.pivots.push([r, c]);
        r++;
      }
      this.echelon = this.A.map(row => row.slice());
    }
    backward() {
      const ops = [];
      for (const [r, c] of this.pivots) if (!cisint(this.A[r][c], 1n)) ops.push(this.scale(r, cdiv(C1, this.A[r][c])));
      this.emit(ops, null, 2);
      for (let q = this.pivots.length - 1; q >= 0; q--) {
        const [r, c] = this.pivots[q];
        const ops2 = [];
        for (let k = 0; k < r; k++) if (!czero(this.A[k][c])) ops2.push(this.add(k, cneg(this.A[k][c]), r));
        this.emit(ops2, [r, c], 2);
      }
    }
  }

  /* ───────────────────────── the solution set (gauss.py: solution) ───────────────────────── */
  function solution(red, original) {
    const A = red.A, bar = red.bar;
    for (const [r, c] of red.pivots) if (c === bar) return { status: 'none', row: red.echelon[r] };
    const pivCols = red.pivots.map(p => p[1]);
    const free = [];
    for (let c = 0; c < bar; c++) if (!pivCols.includes(c)) free.push(c);
    const params = new Map(free.map((c, k) => [c, k < PARAMS.length ? PARAMS[k] : `t${k + 1}`]));
    const sol = new Map();
    for (const [r, c] of red.pivots) sol.set(c, [A[r][bar], free.map(f => [params.get(f), cneg(A[r][f])])]);
    for (const f of free) sol.set(f, [C0, [[params.get(f), C1]]]);
    // Self-check against the ORIGINAL system: the particular solution must satisfy A·x = b and every
    // parameter direction must satisfy A·v = 0 — the same identity gauss.py checks symbolically.
    const x0 = [], dirs = free.map(() => []);
    for (let c = 0; c < bar; c++) {
      const [k, terms] = sol.get(c);
      x0.push(k);
      free.forEach((f, q) => { const t = terms.find(e => e[0] === params.get(f)); dirs[q].push(t ? t[1] : C0); });
    }
    const dot = (row, v) => v.reduce((acc, x, j) => cadd(acc, cmul(row[j], x)), C0);
    let ok = original.every(row => ceq(dot(row, x0), row[bar]));
    ok = ok && dirs.every(v => original.every(row => czero(dot(row, v))));
    return { status: free.length ? 'infinite' : 'unique', sol, free, params, ok };
  }

  /* ───────────────────────── plain-text rendering (the CLI's output, for "copy as text") ───────────────────────── */
  function show(rows, bar) {
    const cells = rows.map(r => r.map(fmt));
    const w = cells[0].map((_, j) => Math.max(...cells.map(r => r[j].length)));
    const pad = (s, n) => ' '.repeat(Math.max(0, n - s.length)) + s;
    return cells.map(r => {
      const left = (bar !== null ? r.slice(0, bar) : r).map((c, j) => pad(c, w[j])).join('  ');
      if (bar === null) return `    [ ${left} ]`;
      const right = r.slice(bar).map((c, j) => pad(c, w[bar + j])).join('  ');
      return `    [ ${left} | ${right} ]`;
    }).join('\n');
  }

  function renderText(out, rows, red, res, names, field) {
    const bar = red.bar, lines = [];
    lines.push(`Input (${out.rows}×${out.cols}, over ${field}${bar !== null ? `; unknowns: ${names.join(', ')}` : ''}):`, show(rows, bar), '');
    const phase = (title, which) => {
      const steps = red.trace.filter(s => s.phase === which);
      if (!steps.length) return;
      lines.push(`── ${title} ──`, '');
      for (const s of steps) lines.push('  ' + s.ops.map(o => o.label).join(',   '), show(s.matrix, bar), '');
    };
    phase('Phase 1: zeros below the pivots', 1);
    lines.push('Echelon form (מטריצה מדורגת):', show(red.echelon, bar), '');
    phase('Phase 2: leading 1s, then zeros above the pivots', 2);
    lines.push('Canonical echelon form (מטריצה מדורגת קנונית):', show(red.A, bar), `  non-zero rows: ${red.pivots.length}`, '');
    if (bar === null) {
      lines.push('(No right-hand side, so this is a matrix, not a system — nothing to solve for x₁, x₂, ….)');
      return lines.join('\n') + '\n';
    }
    const RULE = '═'.repeat(56);
    lines.push(RULE, '  RESULT  (תוצאה)', RULE);
    const s = out.solution;
    if (s.status === 'none') {
      lines.push('No solution  (אין פתרון)', '', '  The echelon form has the row', show([res.row], bar),
        `  which says  0 = ${s.rhs}  — impossible: no values of ${names.join(', ')} satisfy every equation.`, '', '  S = ∅', RULE);
      return lines.join('\n') + '\n';
    }
    const w = Math.max(...names.map(n => n.length));
    if (s.status === 'unique') {
      lines.push('Exactly one solution  (פתרון יחיד)', '');
      names.forEach((n, c) => lines.push(`  ${n.padEnd(w)} = ${s.values[c]}`));
    } else {
      const k = s.free.length;
      lines.push(`Infinitely many solutions  (אינסוף פתרונות) — ${k} free variable${k > 1 ? 's' : ''}`, '',
        `  free: ${s.free.map((f, i) => `${f} = ${s.params[i]}`).join(', ')}   (${s.params.join(', ')} any number in ${field})`,
        `  every other unknown is expressed through ${k > 1 ? 'them' : 'it'}:`, '');
      names.forEach((n, c) => lines.push(`  ${n.padEnd(w)} = ${s.values[c]}${s.free.includes(n) ? '   ← free' : ''}`));
    }
    lines.push('', `  ${s.set}`);
    if (s.example) lines.push(`  for example, ${s.params.join(' = ')} = 0 gives the solution (${s.example.join(', ')})`);
    lines.push('', '  ' + (s.ok ? '✓ checked: substituted into the original equations — every one holds'
                                 : '✗ CHECK FAILED: the solution does not satisfy the original system'), RULE);
    return lines.join('\n') + '\n';
  }

  /* ───────────────────────── analyse (gauss_gui.py) ───────────────────────── */
  function analyse(text, system = false) {
    text = String(text == null ? '' : text);
    if (text.length > MAX_LEN) fail(`input too long (${text.length} characters; the limit is ${MAX_LEN})`);
    const bad = BAD_CHAR.exec(text);
    if (bad) fail(`the character ${JSON.stringify(bad[0])} is not allowed. Entries are numbers like 3, -1/2, 0.25, 2-3i, (1+i)/2; equations use letters for unknowns.`);
    if (BIG_POWER.test(text)) fail('powers may have at most a two-digit exponent and cannot be chained');
    const { rows, bar, names } = parseMatrix(text, !!system);
    if (rows.length > MAX_DIM || rows[0].length - (bar !== null ? 1 : 0) > MAX_DIM) {
      fail(`at most ${MAX_DIM} rows and ${MAX_DIM} columns (plus the right-hand side)`);
    }
    const field = rows.some(r => r.some(x => !qzero(x.im))) ? 'ℂ' : 'ℝ';
    const red = new Reducer(rows, bar);
    red.forward();
    red.backward();
    const F = M => M.map(r => r.map(fmt));
    const out = {
      input: F(rows), bar, names, field, rows: rows.length, cols: rows[0].length,
      steps: red.trace.map(s => ({ phase: s.phase, pivot: s.pivot, ops: s.ops, matrix: F(s.matrix) })),
      echelon: F(red.echelon), canonical: F(red.A), pivots: red.pivots, rank: red.pivots.length,
    };
    let res = null;
    if (bar !== null) {
      res = solution(red, rows);
      if (res.status === 'none') {
        out.solution = { status: 'none', row: F([res.row])[0], rhs: fmt(res.row[bar]) };
      } else {
        const values = [];
        for (let c = 0; c < bar; c++) values.push(lin(...res.sol.get(c)));
        const ps = res.free.map(f => res.params.get(f));
        out.solution = {
          status: res.status, values,
          free: res.free.map(f => names[f]), params: ps,
          set: `S = {(${values.join(', ')})${res.free.length ? ` | ${ps.join(', ')} ∈ ${field}` : ''}}`,
          example: res.free.length ? Array.from({ length: bar }, (_, c) => fmt(res.sol.get(c)[0])) : null,
          ok: res.ok,
        };
      }
    }
    out.text = renderText(out, rows, red, res, names, field);
    return out;
  }

  return { analyse, GaussError, MAX_DIM, _internals: { fmt, lin, parseNumber, parseMatrix, Q, C } };
}));
