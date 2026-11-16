'use strict';
/* Gauss engine — a JavaScript port of linear_algebra/tools/gauss.py and gauss_gui.analyse().
 *
 * Exact arithmetic: rationals are pairs of BigInts, complex numbers pairs of rationals, and —
 * for a system with a parameter — entries are rational functions of the parameter with
 * rational coefficients. The result object is identical, string for string, to the Python
 * engine's JSON: tests/test_engine.js checks it against tests/golden.json, which the Python
 * engine generated. Keep the two in step: a behaviour change in gauss.py means regenerating
 * the corpus and re-running the test.
 *
 * Usage:  GaussEngine.analyse(text, system, param) → result object, or throws GaussEngine.GaussError.
 *   param: the parameter's name for equations ('m'); omitted, a letter in a matrix entry is one. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GaussEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  class GaussError extends Error {}
  const fail = msg => { throw new GaussError(msg); };

  const MAX_LEN = 4000, MAX_DIM = 10;
  const BAD_CHAR = /[^0-9A-Za-z_+\-*/^().,;|=\s−·×]/;
  const BIG_POWER = /(\^|\*\*)\s*\(?\s*-?\d{3,}|(\^|\*\*)[^,;|\s]*(\^|\*\*)/;
  const SUB = '₀₁₂₃₄₅₆₇₈₉', SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const sub = s => String(s).replace(/\d/g, d => SUB[d]);
  const sup = s => String(s).replace(/\d/g, d => SUP[d]);
  const PARAMS = 'αβγδεζηθκμνξπρστφχψω';
  const NOT_EXACT = 'not an exact rational or complex-rational number';
  const L = k => 'L' + sub(k + 1);

  /* ───────────────────────── rationals (BigInt) ───────────────────────── */
  const babs = a => (a < 0n ? -a : a);
  function bgcd(a, b) { a = babs(a); b = babs(b); while (b) { const t = a % b; a = b; b = t; } return a; }
  const blcm = (a, b) => (a === 0n || b === 0n ? 0n : babs(a * b) / bgcd(a, b));
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
  const qcmp = (a, b) => { const x = a.n * b.d, y = b.n * a.d; return x < y ? -1 : x > y ? 1 : 0; };

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

  /* ───────────────────────── polynomials in the parameter ─────────────────────────
     Arrays of complex-rational coefficients, lowest degree first, no trailing zeros. */
  const ptrim = p => { let n = p.length; while (n > 0 && czero(p[n - 1])) n--; return p.slice(0, n); };
  const pconst = c => (czero(c) ? [] : [c]);
  const P1 = [C1], PM = [C0, C1];
  function padd(a, b) {
    const r = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) r.push(cadd(a[i] || C0, b[i] || C0));
    return ptrim(r);
  }
  const pneg = a => a.map(cneg);
  const psub = (a, b) => padd(a, pneg(b));
  function pmul(a, b) {
    if (!a.length || !b.length) return [];
    const r = Array(a.length + b.length - 1).fill(C0);
    for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) r[i + j] = cadd(r[i + j], cmul(a[i], b[j]));
    return ptrim(r);
  }
  const pscale = (a, c) => ptrim(a.map(x => cmul(x, c)));
  function pdivmod(a, b) {
    if (!b.length) fail(NOT_EXACT + ': division by zero');
    let r = ptrim(a);
    const q = Array(Math.max(0, r.length - b.length + 1)).fill(C0);
    const lb = b[b.length - 1];
    while (r.length >= b.length) {
      const k = r.length - b.length, c = cdiv(r[r.length - 1], lb);
      q[k] = c;
      for (let i = 0; i < b.length; i++) r[k + i] = csub(r[k + i], cmul(c, b[i]));
      r = ptrim(r);
    }
    return [ptrim(q), r];
  }
  const pmonic = a => (a.length ? pscale(a, cdiv(C1, a[a.length - 1])) : a);
  function pgcd(a, b) {
    a = ptrim(a); b = ptrim(b);
    while (b.length) { const [, r] = pdivmod(a, b); a = b; b = r; }
    return pmonic(a);
  }
  const peval = (p, x) => p.reduceRight((acc, c) => cadd(cmul(acc, x), c), C0);
  const peq = (a, b) => a.length === b.length && a.every((c, i) => ceq(c, b[i]));

  /* ───────────────────────── rational functions n/d ─────────────────────────
     d monic and gcd(n, d) = 1: a unique form, so equality is structural. A plain number is
     the case n = [c], d = [1]. */
  function RF(n, d = P1) {
    n = ptrim(n); d = ptrim(d);
    if (!d.length) fail(NOT_EXACT + ': division by zero');
    if (!n.length) return { n: [], d: P1 };
    const g = pgcd(n, d);
    if (g.length > 1) { n = pdivmod(n, g)[0]; d = pdivmod(d, g)[0]; }
    const lc = d[d.length - 1];
    if (!cisint(lc, 1n)) { n = pscale(n, cdiv(C1, lc)); d = pscale(d, cdiv(C1, lc)); }
    return { n, d };
  }
  const rfC = c => RF(pconst(c));
  const R0 = rfC(C0), R1 = rfC(C1), RM = RF(PM);
  const rfadd = (a, b) => RF(padd(pmul(a.n, b.d), pmul(b.n, a.d)), pmul(a.d, b.d));
  const rfsub = (a, b) => RF(psub(pmul(a.n, b.d), pmul(b.n, a.d)), pmul(a.d, b.d));
  const rfmul = (a, b) => RF(pmul(a.n, b.n), pmul(a.d, b.d));
  function rfdiv(a, b) { if (!b.n.length) fail(NOT_EXACT + ': division by zero'); return RF(pmul(a.n, b.d), pmul(a.d, b.n)); }
  const rfneg = a => ({ n: pneg(a.n), d: a.d });
  const rfzero = a => !a.n.length;
  const rfeq = (a, b) => peq(a.n, b.n) && peq(a.d, b.d);
  const rfIsNumber = a => a.n.length <= 1 && a.d.length === 1;
  const rfValue = a => (a.n.length ? a.n[0] : C0);
  const rfHasParam = a => !rfIsNumber(a);
  const rfIsInt = (a, k) => rfIsNumber(a) && cisint(rfValue(a), k);
  function rfpow(a, k) {
    if (k < 0n) return rfdiv(R1, rfpow(a, -k));
    let r = R1, b = a;
    while (k > 0n) { if (k & 1n) r = rfmul(r, b); b = rfmul(b, b); k >>= 1n; }
    return r;
  }
  const rfsubs = (a, v) => cdiv(peval(a.n, v), peval(a.d, v));     // the value at the number v
  const rfHasI = a => [...a.n, ...a.d].some(c => !qzero(c.im));
  // the sign used to write λ as '− |λ|': for an expression, the sign of the numerator's leading coefficient
  const rfnegative = a => (rfIsNumber(a) ? cnegative(rfValue(a)) : a.n[a.n.length - 1].re.n < 0n);

  /* Integer form of a rational function (sympy's together(cancel(…)).as_numer_denom()):
     numerator and denominator with integer coefficients, no common content, denominator
     with a positive leading coefficient. BigInt arrays, lowest degree first. */
  function rfInteger(a) {
    const qs = [...a.n, ...a.d].map(c => c.re);
    let lcm = 1n;
    for (const q of qs) lcm = blcm(lcm, q.d);
    let N = a.n.map(c => c.re.n * (lcm / c.re.d)), D = a.d.map(c => c.re.n * (lcm / c.re.d));
    let g = 0n;
    for (const x of [...N, ...D]) g = bgcd(g, x);
    if (g > 1n) { N = N.map(x => x / g); D = D.map(x => x / g); }
    if (D[D.length - 1] < 0n) { N = N.map(x => -x); D = D.map(x => -x); }
    return [N, D];
  }
  const itoC = N => N.map(x => C(Q(x)));
  const ifromC = p => p.map(c => { if (c.re.d !== 1n || !qzero(c.im)) throw new Error('not integer'); return c.re.n; });
  const itrim = N => { let n = N.length; while (n > 0 && N[n - 1] === 0n) n--; return N.slice(0, n); };

  /* ───────────────────────── factoring over ℚ (gauss.py: sympy's factor_list) ───────────────────────── */
  function divisorsOf(x) {
    x = babs(x);
    const out = [];
    for (let i = 1n; i * i <= x; i++) if (x % i === 0n) { out.push(i); if (i * i !== x) out.push(x / i); }
    return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
  function ievalQ(N, r) {   // N at the rational r, exactly
    let acc = Q0;
    for (let i = N.length - 1; i >= 0; i--) acc = qadd(qmul(acc, r), Q(N[i]));
    return acc;
  }
  function iexactDiv(N, F) {  // N / F over ℚ, which must be exact and integer here (Gauss's lemma)
    const [q, r] = pdivmod(itoC(N), itoC(F));
    if (r.length) throw new Error('inexact');
    return ifromC(q);
  }
  // sympy's order: by degree, then the coefficient list (highest degree first), then multiplicity
  function factorCmp(a, b) {
    if (a.poly.length !== b.poly.length) return a.poly.length - b.poly.length;
    for (let i = a.poly.length - 1; i >= 0; i--) if (a.poly[i] !== b.poly[i]) return a.poly[i] < b.poly[i] ? -1 : 1;
    return a.k - b.k;
  }
  function addFactor(factors, poly) {
    const hit = factors.find(f => f.poly.length === poly.length && f.poly.every((x, i) => x === poly[i]));
    if (hit) hit.k++; else factors.push({ poly, k: 1 });
  }
  /* {coeff: Q, factors: [{poly: BigInt[] (primitive, positive leading coefficient), k}]} such that
     N = coeff · Π poly^k. Rational roots are found exactly; a remaining factor of degree ≥ 4 is
     also tried against quadratic factors with small coefficients. */
  function factorList(N) {
    N = itrim(N);
    let content = 0n;
    for (const x of N) content = bgcd(content, x);
    const sign = N[N.length - 1] < 0n ? -1n : 1n;
    const coeff = Q(sign * content);
    let P = N.map(x => x / (sign * content));
    const factors = [];
    let k0 = 0;
    while (P.length > 1 && P[0] === 0n) { P = P.slice(1); k0++; }
    for (let i = 0; i < k0; i++) addFactor(factors, [0n, 1n]);
    let found = true;
    while (P.length > 2 && found) {
      found = false;
      const ps = divisorsOf(P[0]), qs = divisorsOf(P[P.length - 1]);
      outer: for (const q of qs) for (const p of ps) for (const s of [1n, -1n]) {
        const root = Q(s * p, q);
        if (!qzero(ievalQ(P, root))) continue;
        const lin = [-s * p, q];                       // q·m − s·p, primitive, positive leading coefficient
        P = iexactDiv(P, lin);
        addFactor(factors, lin);
        found = true;
        break outer;
      }
    }
    if (P.length === 2) { addFactor(factors, P); P = [1n]; }
    // quadratic factors a·m² + b·m + c of a remaining polynomial of degree ≥ 4
    found = true;
    while (P.length >= 5 && found) {
      found = false;
      const bound = P.reduce((m, x) => (babs(x) > m ? babs(x) : m), 0n);
      const as = divisorsOf(P[P.length - 1]), cs = divisorsOf(P[0]);
      if (bound > 400n || as.length * cs.length > 400) break;
      outer2: for (const a of as) for (const c0 of cs) for (const sc of [1n, -1n]) for (let b = -bound; b <= bound; b++) {
        const f = [sc * c0, b, a];
        if (bgcd(bgcd(f[0], f[1]), f[2]) !== 1n) continue;
        const [q, r] = pdivmod(itoC(P), itoC(f));
        if (r.length) continue;
        P = ifromC(q);
        addFactor(factors, f);
        found = true;
        break outer2;
      }
    }
    if (P.length > 1) addFactor(factors, P);
    factors.sort(factorCmp);
    return { coeff, factors };
  }

  /* ───────────────────────── formatting (gauss.py: fmt, fmt_sym, _poly_text, _poly_str, fmt_coef, lin) ───────────────────────── */
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
  /* A polynomial written out: terms in descending degree — except the two-term case 'positive
     number minus something', written number first (1 − m, 2 − m²). Integer coefficients. */
  function polyText(N, sym) {
    const terms = [];
    for (let k = N.length - 1; k >= 0; k--) if (N[k] !== 0n) terms.push([k, N[k]]);
    if (terms.length === 2 && terms[1][0] === 0 && terms[1][1] > 0n && terms[0][1] < 0n) terms.reverse();
    let out = '';
    terms.forEach(([k, c], idx) => {
      const neg = c < 0n, mag = neg ? -c : c;
      const mono = k === 0 ? '' : sym + (k === 1 ? '' : sup(k));
      const body = k === 0 ? `${mag}` : mag === 1n ? mono : `${mag}${mono}`;
      out += (idx === 0 ? (neg ? '−' : '') : (neg ? ' − ' : ' + ')) + body;
    });
    return out;
  }
  const isSym = poly => poly.length === 2 && poly[0] === 0n && poly[1] === 1n;
  /* A polynomial as the lecture writes it: 1 − m, m + 2, 2m + 3, m² + 1 — and factored when that
     is shorter: 6(m − 1), (1 − m)(m + 2), (m + 1)². */
  function polyStr(N, sym) {
    N = itrim(N);
    if (N.length <= 1) return fmt(C(Q(N[0] === undefined ? 0n : N[0])));
    let { coeff, factors } = factorList(N);
    if (factors.length && coeff.n < 0n && factors[0].k === 1 && factors[0].poly.length === 2 && factors[0].poly[0] < 0n) {
      coeff = qneg(coeff);                                            // −(m − 1) → 1 − m
      factors = [{ poly: factors[0].poly.map(x => -x), k: 1 }, ...factors.slice(1)];
    }
    if (qeq(coeff, Q1) && factors.length === 1 && factors[0].k === 1) return polyText(factors[0].poly, sym);
    if (qeq(coeff, Q(-1n)) && factors.length === 1 && factors[0].k === 1) {
      const t = factors[0].poly.map(x => -x);                         // −(m² − 2) → 2 − m², but −(m + 1) stays
      if (t.some(x => x > 0n)) return polyText(t, sym);
    }
    const parts = [];
    if (qeq(coeff, Q(-1n))) parts.push('−');
    else if (!qeq(coeff, Q1)) parts.push(coeff.d === 1n ? fmt(C(coeff)) : `(${fmt(C(coeff))})`);
    const ordered = [...factors].sort((a, b) => (isSym(a.poly) ? 0 : 1) - (isSym(b.poly) ? 0 : 1));
    for (const { poly, k } of ordered) {
      let body = polyText(poly, sym);
      if (!isSym(poly)) body = `(${body})`;
      parts.push(body + (k > 1 ? sup(k) : ''));
    }
    return parts.join('');
  }
  function depth0Space(text) {
    let depth = 0;
    for (const ch of text) { depth += (ch === '(') - (ch === ')'); if (ch === ' ' && depth === 0) return true; }
    return false;
  }
  /* An entry in the parameter, as text: (m + 1)/(m + 2), −2(2m + 3)/3, 1 − m. */
  function fmtSym(a, sym) {
    let [N, D] = rfInteger(a);
    if (D.length > 1 && N.length === 1 && N[0] < 0n) {
      const flipped = polyStr(D.map(x => -x), sym);                  // −1/(m − 1) → 1/(1 − m)
      if (!flipped.startsWith('−')) { N = N.map(x => -x); D = D.map(x => -x); }
    }
    let ns = polyStr(N, sym);
    if (D.length === 1 && D[0] === 1n) return ns;
    let ds = polyStr(D, sym);
    if (depth0Space(ns)) ns = `(${ns})`;
    if (!/^(\d+|[A-Za-z]|\([^()]*\))$/.test(ds)) ds = `(${ds})`;
    return `${ns}/${ds}`;
  }
  function fmtCoefText(s, isOne, isMinusOne) {
    if (isOne) return '';
    if (isMinusOne) return '−';
    return (/^(−?\d+|−?(?!i$)[A-Za-z])$/.test(s) ? s : `(${s})`) + '·';
  }

  /* The two number types the reducer runs on. */
  const KC = {
    zero: C0, one: C1, add: cadd, sub: csub, mul: cmul, div: cdiv, neg: cneg, isZero: czero, eq: ceq,
    isOne: v => cisint(v, 1n), isMinusOne: v => cisint(v, -1n), isNumber: () => true, degree: () => 0,
    negative: cnegative, fmt, fmtCoef: v => fmtCoefText(fmt(v), cisint(v, 1n), cisint(v, -1n)),
  };
  const KR = sym => ({
    zero: R0, one: R1, add: rfadd, sub: rfsub, mul: rfmul, div: rfdiv, neg: rfneg, isZero: rfzero, eq: rfeq,
    isOne: v => rfIsInt(v, 1n), isMinusOne: v => rfIsInt(v, -1n), isNumber: rfIsNumber, degree: v => v.n.length - 1,
    negative: rfnegative, fmt: v => (rfIsNumber(v) ? fmt(rfValue(v)) : fmtSym(v, sym)),
    fmtCoef: v => fmtCoefText(rfIsNumber(v) ? fmt(rfValue(v)) : fmtSym(v, sym), rfIsInt(v, 1n), rfIsInt(v, -1n)),
  });

  function lin(konst, terms, K) {
    const parts = (K.isZero(konst) && terms.length) ? [] : [K.fmt(konst)];
    for (const [p, c] of terms) {
      if (K.isZero(c)) continue;
      const neg = K.negative(c);
      const mag = neg ? K.neg(c) : c;
      const s = K.fmt(mag);
      const body = K.isOne(mag) ? p : (/^\d+$/.test(s) ? `${s}${p}` : `(${s})${p}`);
      if (!parts.length) parts.push((neg ? '−' : '') + body);
      else parts.push((neg ? '− ' : '+ ') + body);
    }
    return parts.length ? parts.join(' ') : '0';
  }

  /* ───────────────────────── expression parser ─────────────────────────
     Replaces sympy's parse_expr for the two uses in gauss.py: a numeric entry, and a linear
     expression in the unknowns of an equation. Values are linear forms {c, terms}: a constant
     plus a Map name → coefficient, all rational functions of the parameter (a plain number is
     the degree-0 case). An entry must come out constant. pctx says which letter the parameter
     is: {mode: 'none' | 'auto' | 'named', name}. */
  const LF = (c, terms = new Map()) => ({ c, terms });
  function lfconst(a) { for (const v of a.terms.values()) if (!rfzero(v)) return false; return true; }
  function lfadd(a, b) {
    const t = new Map(a.terms);
    for (const [k, v] of b.terms) t.set(k, t.has(k) ? rfadd(t.get(k), v) : v);
    return LF(rfadd(a.c, b.c), t);
  }
  function lfscale(a, s) {
    const t = new Map();
    for (const [k, v] of a.terms) t.set(k, rfmul(v, s));
    return LF(rfmul(a.c, s), t);
  }
  const lfneg = a => lfscale(a, rfneg(R1));
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
    'parameter (m, k, …), name it with -p m and the cases are worked out for you.');

  function parseExpression(src, mode, line, pctx) {
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
          else { if (!lfconst(r)) nonlinear(line); v = lfscale(v, rfdiv(R1, r.c)); }
        } else if (atomStart(t)) {                       // implicit multiplication: 2i, 2(3), (1+i)z, i z1, mx
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
      const ev = e.c;
      if (!rfIsNumber(ev) || !qzero(rfValue(ev).im) || rfValue(ev).re.d !== 1n) {
        if (lfconst(base)) fail(`${NOT_EXACT}: ${src.trim()}`);
        nonlinear(line);
      }
      const k = rfValue(ev).re.n;
      if (!lfconst(base)) {
        if (k === 1n) return base;
        if (k === 0n) return LF(R1);
        nonlinear(line);
      }
      return LF(rfpow(base.c, k));
    }
    function atom() {
      const t = toks[p++];
      if (!t) syntax();
      if (t.t === 'num') return LF(rfC(parseDecimal(t.v)));
      if (t.t === 'id') {
        if (t.v === 'i' || t.v === 'I') return LF(rfC(CI));
        if (pctx.mode === 'auto' && mode === 'entry') {
          if (t.v.length !== 1) fail(`a parameter is a single letter — found '${t.v}' in the entry ${JSON.stringify(src.trim())}`);
          if (pctx.name === null) pctx.name = t.v;
          if (t.v === pctx.name) return LF(RM);
          fail('one parameter at a time — found ' + [pctx.name, t.v].sort().join(', '));
        }
        if (pctx.mode === 'named' && t.v === pctx.name) return LF(RM);
        if (mode === 'entry') fail(`the entry ${JSON.stringify(src.trim())} contains a letter other than i. For a system with a ` +
          'parameter, name it with -p (e.g. -p m) and the cases are worked out for you.');
        return LF(R0, new Map([[t.v, R1]]));
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

  const parseNumber = (text, pctx) => parseExpression(text, 'entry', undefined, pctx).c;

  /* ───────────────────────── input (gauss.py: _entries, parse_input, parse_equations) ───────────────────────── */
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

  /* → {rows (rational functions), bar, names, param: the parameter's name or null}.
     param: a name → that letter is the parameter (in equations it is then not an unknown);
     empty → in matrix form a letter in an entry is the parameter by itself. */
  function parseMatrix(text, system, param) {
    text = text.replace(/−/g, '-').replace(/·/g, '*');
    const lines = text.split(/[;\n]/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) fail('empty input');
    if (lines.some(l => l.includes('='))) return parseEquations(lines, param || null);
    const pctx = param ? { mode: 'named', name: param } : { mode: 'auto', name: null };
    const rows = [];
    let bar = null;
    for (const r of lines) {
      const parts = r.split('|');
      if (parts.length > 2) fail(`more than one '|' in row: '${r}'`);
      const cells = parts.map(chunk => entries(chunk).map(x => parseNumber(x, pctx)));
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
    const hasParam = rows.some(r => r.some(rfHasParam));
    if (hasParam && rows.some(r => r.some(rfHasI))) fail('a parameter together with complex numbers is not supported');
    return { rows, bar, names, param: hasParam ? pctx.name : null };
  }

  const VAR = /^[A-Za-z](_?\d+)?$/;
  // 'mx' → 'm*x', 'xy' → 'x*y': a run of letters is a product, as in handwriting.
  const splitLetters = line => line.replace(/[A-Za-z_][A-Za-z_0-9]*/g,
    tok => (VAR.test(tok) || !/^[A-Za-z]+$/.test(tok)) ? tok : tok.split('').join('*'));

  function parseEquations(lines, param) {
    lines = lines.map(splitLetters);
    const names = [];
    for (const line of lines) {
      for (const tok of line.match(/[A-Za-z_][A-Za-z_0-9]*/g) || []) {
        if (tok !== 'i' && tok !== 'I' && tok !== param && !names.includes(tok)) names.push(tok);
      }
    }
    if (!names.length) fail('no variables found in the equations');
    const pctx = param ? { mode: 'named', name: param } : { mode: 'none', name: null };
    const rows = [];
    for (const line of lines) {
      if ((line.match(/=/g) || []).length !== 1) fail(`not a single equation: '${line}'`);
      const [lhs, rhs] = line.split('=');
      const e = lfsub(parseExpression(lhs, 'equation', line, pctx), parseExpression(rhs, 'equation', line, pctx));
      const row = names.map(n => e.terms.get(n) || R0);
      row.push(rfneg(e.c));
      rows.push(row);
    }
    if (param && rows.some(r => r.some(rfHasI))) fail('a parameter together with complex numbers is not supported');
    return { rows, bar: names.length, names, param: param || null };
  }

  /* ───────────────────────── elimination (gauss.py: Reducer), generic over the number type K ───────────────────────── */
  class Reducer {
    constructor(rows, bar, K) {
      this.K = K;
      this.A = rows.map(r => r.slice());
      this.bar = bar;
      this.n = rows.length;
      this.ncols = rows[0].length;       // the right-hand side may carry a pivot: that is the inconsistent case
      this.pivots = [];
      this.echelon = null;
      this.trace = [];
      this.divisors = [];                // expressions in the parameter that were divided by
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
      const K = this.K;
      this.A[i] = this.A[i].map(x => K.mul(lam, x));
      const label = `${L(i)} → ${K.fmtCoef(lam)}${L(i)}`;
      this._ops.push({ kind: 'scale', target: i, factor: K.fmt(lam), label });
      return label;
    }
    add(i, lam, j) {
      const K = this.K;
      this.A[i] = this.A[i].map((x, k) => K.add(x, K.mul(lam, this.A[j][k])));
      const neg = K.negative(lam);
      const label = `${L(i)} → ${L(i)} ${neg ? '−' : '+'} ${K.fmtCoef(neg ? K.neg(lam) : lam)}${L(j)}`;
      this._ops.push({ kind: 'add', target: i, source: j, factor: K.fmt(lam), label });
      return label;
    }
    forward() {
      const K = this.K;
      let r = 0;
      for (let c = 0; c < this.ncols; c++) {
        if (r === this.n) break;
        const cand = [];
        for (let k = r; k < this.n; k++) if (!K.isZero(this.A[k][c])) cand.push(k);
        if (!cand.length) continue;
        // As by hand: a pivot of 1 (or −1) below is worth a swap — it avoids fractions. With a
        // parameter: never divide by an expression in it while a number will do, and among
        // expressions take the simplest (lowest degree) — the lecture's choice.
        let pick = cand.find(k => K.isOne(this.A[k][c]));
        if (pick === undefined) pick = cand.find(k => K.isMinusOne(this.A[k][c]));
        if (pick === undefined) pick = cand.find(k => K.isNumber(this.A[k][c]));
        if (pick === undefined) {
          pick = cand[0];
          for (const k of cand) if (K.degree(this.A[k][c]) < K.degree(this.A[pick][c])) pick = k;
        }
        if (pick !== r) this.emit([this.swap(r, pick)], [r, c], 1);   // the swap is a step of its own
        const ops = [];
        const p = this.A[r][c];
        for (let k = r + 1; k < this.n; k++) {
          if (!K.isZero(this.A[k][c])) ops.push(this.add(k, K.neg(K.div(this.A[k][c], p)), r));
        }
        if (ops.length && !K.isNumber(p)) this.divisors.push(p);
        this.emit(ops, [r, c], 1);
        this.pivots.push([r, c]);
        r++;
      }
      this.echelon = this.A.map(row => row.slice());
    }
    backward() {
      const K = this.K;
      for (const [r, c] of this.pivots) if (!K.isNumber(this.A[r][c])) this.divisors.push(this.A[r][c]);
      const ops = [];
      for (const [r, c] of this.pivots) if (!K.isOne(this.A[r][c])) ops.push(this.scale(r, K.div(K.one, this.A[r][c])));
      this.emit(ops, null, 2);
      for (let q = this.pivots.length - 1; q >= 0; q--) {
        const [r, c] = this.pivots[q];
        const ops2 = [];
        for (let k = 0; k < r; k++) if (!K.isZero(this.A[k][c])) ops2.push(this.add(k, K.neg(this.A[k][c]), r));
        this.emit(ops2, [r, c], 2);
      }
    }
  }

  /* ───────────────────────── the solution set (gauss.py: solution) ───────────────────────── */
  function solution(red, original) {
    const K = red.K, A = red.A, bar = red.bar;
    for (const [r, c] of red.pivots) if (c === bar) return { status: 'none', row: red.echelon[r] };
    const pivCols = red.pivots.map(p => p[1]);
    const free = [];
    for (let c = 0; c < bar; c++) if (!pivCols.includes(c)) free.push(c);
    const params = new Map(free.map((c, k) => [c, k < PARAMS.length ? PARAMS[k] : `t${k + 1}`]));
    const sol = new Map();
    for (const [r, c] of red.pivots) sol.set(c, [A[r][bar], free.map(f => [params.get(f), K.neg(A[r][f])])]);
    for (const f of free) sol.set(f, [K.zero, [[params.get(f), K.one]]]);
    // Self-check against the ORIGINAL system: the particular solution must satisfy A·x = b and
    // every parameter direction must satisfy A·v = 0 — the identity gauss.py checks symbolically.
    const x0 = [], dirs = free.map(() => []);
    for (let c = 0; c < bar; c++) {
      const [k, terms] = sol.get(c);
      x0.push(k);
      free.forEach((f, q) => { const t = terms.find(e => e[0] === params.get(f)); dirs[q].push(t ? t[1] : K.zero); });
    }
    const dot = (row, v) => v.reduce((acc, x, j) => K.add(acc, K.mul(row[j], x)), K.zero);
    let ok = original.every(row => K.eq(dot(row, x0), row[bar]));
    ok = ok && dirs.every(v => original.every(row => K.isZero(dot(row, v))));
    return { status: free.length ? 'infinite' : 'unique', sol, free, params, ok, xs: x0 };
  }

  function solutionJson(res, names, bar, field, K) {
    if (res.status === 'none') return { status: 'none', row: res.row.map(K.fmt), rhs: K.fmt(res.row[bar]) };
    const values = [];
    for (let c = 0; c < bar; c++) values.push(lin(...res.sol.get(c), K));
    const ps = res.free.map(f => res.params.get(f));
    return {
      status: res.status, values,
      free: res.free.map(f => names[f]), params: ps,
      set: `S = {(${values.join(', ')})${res.free.length ? ` | ${ps.join(', ')} ∈ ${field}` : ''}}`,
      example: res.free.length ? Array.from({ length: bar }, (_, c) => K.fmt(res.sol.get(c)[0])) : null,
      ok: res.ok,
    };
  }
  const reductionJson = (red, K) => ({
    steps: red.trace.map(s => ({ phase: s.phase, pivot: s.pivot, ops: s.ops, matrix: s.matrix.map(r => r.map(K.fmt)) })),
    echelon: red.echelon.map(r => r.map(K.fmt)), canonical: red.A.map(r => r.map(K.fmt)),
    pivots: red.pivots, rank: red.pivots.length,
  });

  /* ───────────────────────── systems with a parameter (gauss.py: special_values, parametric) ───────────────────────── */
  /* The RATIONAL values of the parameter at which any expression vanishes — the lecture's cases —
     plus the irreducible factors of degree ≥ 2, whose roots are not rational and are left for
     work by hand. */
  function specialValues(exprs, sym) {
    const values = [], unsolved = [];
    for (const e of exprs) {
      const N = itrim(rfInteger(e)[0]);
      if (N.length < 2) continue;
      for (const { poly } of factorList(N).factors) {
        if (poly.length === 2) {
          const v = Q(-poly[0], poly[1]);
          if (!values.some(x => qeq(x, v))) values.push(v);
        } else {
          const txt = polyStr(poly, sym);
          if (!unsolved.includes(txt)) unsolved.push(txt);
        }
      }
    }
    values.sort(qcmp);
    return { values, unsolved };
  }

  function parametric(rows, bar, sym) {
    const K = KR(sym);
    const red = new Reducer(rows, bar, K);
    red.forward();
    red.backward();
    const origins = [];
    for (const [r, c] of red.pivots) {
      const e = red.echelon[r][c];
      if (rfHasParam(e)) origins.push([e, `leading entry of ${L(r)} in the echelon form`]);
    }
    if (bar !== null) {
      red.echelon.forEach((row, r) => {
        if (row.slice(0, bar).every(rfzero) && !rfzero(row[bar]) && rfHasParam(row[bar])) {
          origins.push([row[bar], `right-hand side of ${L(r)}, whose left side vanished`]);
        }
      });
    }
    for (const e of red.divisors) if (!origins.some(([o]) => rfeq(e, o))) origins.push([e, 'divided by during the reduction']);
    const exprs = [];
    for (const [e] of origins) if (!exprs.some(x => rfeq(x, e))) exprs.push(e);
    const { values, unsolved } = specialValues(exprs, sym);
    const undefinedAt = [];
    for (const row of rows) for (const x of row) {
      const D = itrim(rfInteger(x)[1]);
      if (D.length < 2) continue;
      for (const { poly } of factorList(D).factors) {
        if (poly.length !== 2) continue;
        const v = Q(-poly[0], poly[1]);
        if (!undefinedAt.some(u => qeq(u, v))) undefinedAt.push(v);
      }
    }
    const generic = bar !== null ? solution(red, rows) : null;
    const cases = [];
    for (const v of values) {
      if (undefinedAt.some(u => qeq(u, v))) continue;
      const cv = C(v);
      const rowsV = rows.map(r => r.map(x => rfsubs(x, cv)));
      const redV = new Reducer(rowsV, bar, KC);
      redV.forward();
      redV.backward();
      const resV = bar !== null ? solution(redV, rowsV) : null;
      let same = false;
      if (resV && generic && resV.status === 'unique' && generic.status === 'unique') {
        try { same = generic.xs.every((g, i) => ceq(rfsubs(g, cv), resV.xs[i])); } catch (e) { same = false; }
      }
      cases.push({ value: v, rows: rowsV, red: redV, res: resV, same });
    }
    return { sym, K, red, origins, values, unsolved, undefinedAt, generic, cases };
  }

  /* ───────────────────────── plain-text rendering (the CLI's output, for "copy as text") ───────────────────────── */
  function show(rows, bar, K) {
    const cells = rows.map(r => r.map(K.fmt));
    const w = cells[0].map((_, j) => Math.max(...cells.map(r => r[j].length)));
    const pad = (s, n) => ' '.repeat(Math.max(0, n - s.length)) + s;
    return cells.map(r => {
      const left = (bar !== null ? r.slice(0, bar) : r).map((c, j) => pad(c, w[j])).join('  ');
      if (bar === null) return `    [ ${left} ]`;
      const right = r.slice(bar).map((c, j) => pad(c, w[bar + j])).join('  ');
      return `    [ ${left} | ${right} ]`;
    }).join('\n');
  }
  const RULE = '═'.repeat(56);

  function describe(sol, names, field, bar, indent, row) {
    const lines = [];
    const p = line => lines.push(line ? indent + line : '');
    if (sol.status === 'none') {
      p('No solution  (אין פתרון)'); p();
      p('  The echelon form has the row');
      p(`      [ ${row.slice(0, bar).join('  ')} | ${row.slice(bar).join('  ')} ]`);
      p(`  which says  0 = ${sol.rhs}  — impossible: no values of ${names.join(', ')} satisfy every equation.`);
      p(); p('  S = ∅');
      return lines;
    }
    const w = Math.max(...names.map(n => n.length));
    if (sol.status === 'unique') {
      p('Exactly one solution  (פתרון יחיד)'); p();
      names.forEach((n, c) => p(`  ${n.padEnd(w)} = ${sol.values[c]}`));
    } else {
      const k = sol.free.length;
      p(`Infinitely many solutions  (אינסוף פתרונות) — ${k} free variable${k > 1 ? 's' : ''}`); p();
      p(`  free: ${sol.free.map((f, i) => `${f} = ${sol.params[i]}`).join(', ')}   (${sol.params.join(', ')} any number in ${field})`);
      p(`  every other unknown is expressed through ${k > 1 ? 'them' : 'it'}:`); p();
      names.forEach((n, c) => p(`  ${n.padEnd(w)} = ${sol.values[c]}${sol.free.includes(n) ? '   ← free' : ''}`));
    }
    p(); p(`  ${sol.set}`);
    if (sol.example) p(`  for example, ${sol.params.join(' = ')} = 0 gives the solution (${sol.example.join(', ')})`);
    p(); p('  ' + (sol.ok ? '✓ checked: substituted into the original equations — every one holds'
                        : '✗ CHECK FAILED: the solution does not satisfy the original system'));
    return lines;
  }

  function renderSteps(lines, red, K, bar) {
    for (const [which, title] of [[1, 'Phase 1: zeros below the pivots'], [2, 'Phase 2: leading 1s, then zeros above the pivots']]) {
      const steps = red.trace.filter(s => s.phase === which);
      if (steps.length) {
        lines.push(`── ${title} ──`, '');
        for (const s of steps) lines.push('  ' + s.ops.map(o => o.label).join(',   '), show(s.matrix, bar, K), '');
      }
      if (which === 1) lines.push('Echelon form (מטריצה מדורגת):', show(red.echelon, bar, K), '');
    }
    lines.push('Canonical echelon form (מטריצה מדורגת קנונית):', show(red.A, bar, K), `  non-zero rows: ${red.pivots.length}`, '');
  }

  function renderText(out, rows, red, K, names, field) {
    const bar = red.bar, lines = [];
    lines.push(`Input (${out.rows}×${out.cols}, over ${field}${bar !== null ? `; unknowns: ${names.join(', ')}` : ''}):`, show(rows, bar, K), '');
    renderSteps(lines, red, K, bar);
    if (bar === null) {
      lines.push('(No right-hand side, so this is a matrix, not a system — nothing to solve for x₁, x₂, ….)');
      return lines.join('\n') + '\n';
    }
    lines.push(RULE, '  RESULT  (תוצאה)', RULE);
    lines.push(...describe(out.solution, names, field, bar, '', out.solution.row), RULE);
    return lines.join('\n') + '\n';
  }

  function renderTextParametric(out, rows, P, names, field) {
    const bar = P.red.bar, K = P.K, sym = P.sym, lines = [];
    lines.push(`Input (${out.rows}×${out.cols}, over ${field}${bar !== null ? `; unknowns: ${names.join(', ')}` : ''}; parameter ${sym}):`, show(rows, bar, K), '');
    lines.push(`Parameter ${sym}. The reduction below is the GENERIC case: it divides by expressions in ${sym}, and the values where those vanish are treated separately after it.`, '');
    renderSteps(lines, P.red, K, bar);
    lines.push(RULE, `  SPECIAL VALUES OF ${sym}  (ערכים מיוחדים)`, RULE);
    const sp = out.special;
    if (sp.origins.length) {
      for (const [e, where] of sp.origins) lines.push(`  ${e} = 0   ← ${where}`);
      if (sp.values.length) lines.push(`  ⟹ ${sym} ∈ {${sp.values.join(', ')}}`);
      else if (sp.unsolved.length) lines.push('  ⟹ no rational special value');
      else lines.push(`  ⟹ none of these vanishes for any ${sym}: the generic case is the only case`);
    } else lines.push(`  no leading entry or divisor depends on ${sym} — the generic case holds for every ${sym}`);
    for (const f of sp.unsolved) lines.push(`  ⚠ ${f} = 0 has no rational root — treat that case by hand`);
    if (sp.undefined.length) lines.push(`  ⚠ the matrix itself is undefined at ${sym} ∈ {${sp.undefined.join(', ')}} (a denominator vanishes)`);
    lines.push(RULE);
    if (bar === null) {
      lines.push(`  (a matrix, not a system: the rank is ${P.red.pivots.length} for every ${sym} outside the special values)`);
      return lines.join('\n') + '\n';
    }
    lines.push('  RESULT  (תוצאה)', RULE, `▸ For ${out.generic.condition}  — the generic case:`);
    lines.push(...describe(out.generic.solution, names, field, bar, '  ', P.generic.status === 'none' ? P.generic.row.map(K.fmt) : null));
    out.cases.forEach(c => {
      lines.push('', `▸ For ${sym} = ${c.value}:`);
      if (c.same_as_generic) lines.push('  (the generic formula is valid here too — this value only interrupted the reduction above)');
      lines.push(...describe(c.solution, names, field, bar, '  ', c.solution.status === 'none' ? c.solution.row : null));
    });
    lines.push(RULE);
    return lines.join('\n') + '\n';
  }

  /* ───────────────────────── analyse (gauss_gui.py) ───────────────────────── */
  function analyse(text, system = false, param = null) {
    text = String(text == null ? '' : text);
    param = (param == null ? '' : String(param)).trim() || null;
    if (text.length > MAX_LEN) fail(`input too long (${text.length} characters; the limit is ${MAX_LEN})`);
    const bad = BAD_CHAR.exec(text);
    if (bad) fail(`the character ${JSON.stringify(bad[0])} is not allowed. Entries are numbers like 3, -1/2, 0.25, 2-3i, (1+i)/2; equations use letters for unknowns.`);
    if (BIG_POWER.test(text)) fail('powers may have at most a two-digit exponent and cannot be chained');
    const parsed = parseMatrix(text, !!system, param);
    const { bar, names } = parsed;
    const rfRows = parsed.rows;
    if (rfRows.length > MAX_DIM || rfRows[0].length - (bar !== null ? 1 : 0) > MAX_DIM) {
      fail(`at most ${MAX_DIM} rows and ${MAX_DIM} columns (plus the right-hand side)`);
    }
    const out = { bar, names, rows: rfRows.length, cols: rfRows[0].length };

    if (!parsed.param) {
      const rows = rfRows.map(r => r.map(rfValue));
      const field = rows.some(r => r.some(x => !qzero(x.im))) ? 'ℂ' : 'ℝ';
      const red = new Reducer(rows, bar, KC);
      red.forward();
      red.backward();
      Object.assign(out, { input: rows.map(r => r.map(fmt)), field }, reductionJson(red, KC));
      if (bar !== null) out.solution = solutionJson(solution(red, rows), names, bar, field, KC);
      out.text = renderText(out, rows, red, KC, names, field);
      return out;
    }

    // a parameter: the generic reduction, the special values, and every case solved on its own
    const sym = parsed.param, field = 'ℝ';
    const P = parametric(rfRows, bar, sym);
    const K = P.K;
    const values = P.values.map(v => fmt(C(v)));
    out.input = rfRows.map(r => r.map(K.fmt));
    out.field = field;
    out.parameter = sym;
    Object.assign(out, reductionJson(P.red, K));
    out.special = {
      origins: P.origins.map(([e, where]) => [K.fmt(e), where]),
      values, unsolved: P.unsolved, undefined: P.undefinedAt.map(v => fmt(C(v))),
    };
    out.generic = {
      condition: values.length ? `${sym} ∉ {${values.join(', ')}}` : `every ${sym}`,
      solution: bar !== null ? solutionJson(P.generic, names, bar, field, K) : null,
    };
    out.cases = P.cases.map(c => ({
      value: fmt(C(c.value)), same_as_generic: c.same,
      input: c.rows.map(r => r.map(fmt)), ...reductionJson(c.red, KC),
      solution: bar !== null ? solutionJson(c.res, names, bar, field, KC) : null,
    }));
    out.text = renderTextParametric(out, rfRows, P, names, field);
    return out;
  }

  return { analyse, GaussError, MAX_DIM, _internals: { fmt, fmtSym, polyStr, polyText, factorList, parseMatrix, Q, C, RF } };
}));
