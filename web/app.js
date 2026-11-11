'use strict';
/* Gauss app — the page logic. The mathematics is engine.js (GaussEngine), a port of gauss.py
   that runs right here; nothing leaves the device. Inside the Android app, window.Android
   provides the clipboard (the Clipboard API needs https). */

const $ = s => document.querySelector(s);
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const sub = n => String(n).replace(/\d/g, d => SUB[d]);
const L = i => 'L' + sub(i + 1);
const MAX_DIM = 10;

const EXAMPLES = [
  { name: 'Unique solution — lecture p. 149', text: '1 2 3 | 13; 2 1 1 | 8; 5 0 2 | 16' },
  { name: 'Infinitely many (free t) — lecture p. 203',
    text: 'x + y + z + t = 1; 2x - y + 3z + t = 4; x - 2y - z + t = 0; 3x + 4z + 2t = 5; 3x + z + 3t = 2' },
  { name: 'No solution', text: '1 1 1 | 1; 1 1 1 | 2; 1 -1 0 | 0' },
  { name: 'Complex coefficients — lecture p. 232', text: '1+i, -1 | 2+i; i, 2-3i | 1' },
  { name: 'Two free variables (homogeneous)', text: '1 2 3 | 0; 2 4 6 | 0' },
  { name: 'Fractions', text: '1/2, 1/3 | 1; 1/4, -1/5 | 2' },
  { name: 'A row swap is needed', text: '0 2 1 | 3; 1 1 1 | 2; 2 0 1 | 1' },
  { name: 'Plain matrix (no system)', text: '1 2 3; 4 5 6; 7 8 10' },
];

const state = { rows: 3, cols: 3, aug: true, mode: 'grid', data: null, revealed: 0, items: [] };

/* ───────────────────────── input grid ───────────────────────── */

function readGrid() {
  const out = [];
  document.querySelectorAll('#grid input').forEach(inp => {
    const r = +inp.dataset.r, c = +inp.dataset.c;
    (out[r] = out[r] || [])[c] = inp.value;
  });
  return out;
}

function buildGrid(keep = true) {
  const old = keep ? readGrid() : [];
  const total = state.cols + (state.aug ? 1 : 0);
  const t = document.createElement('table');
  t.className = 'grid';
  const head = t.createTHead().insertRow();
  head.appendChild(document.createElement('th'));
  for (let j = 0; j < total; j++) {
    const th = document.createElement('th');
    const isB = state.aug && j === state.cols;
    th.textContent = state.aug ? (isB ? 'b' : 'x' + sub(j + 1)) : String(j + 1);
    if (isB) th.className = 'bar';
    head.appendChild(th);
  }
  const body = t.createTBody();
  for (let i = 0; i < state.rows; i++) {
    const tr = body.insertRow();
    const th = document.createElement('th');
    th.className = 'rowlbl'; th.textContent = L(i);
    tr.appendChild(th);
    for (let j = 0; j < total; j++) {
      const td = tr.insertCell();
      if (state.aug && j === state.cols) td.className = 'bar';
      const inp = document.createElement('input');
      inp.type = 'text'; inp.autocomplete = 'off'; inp.spellcheck = false;
      inp.dataset.r = i; inp.dataset.c = j;
      inp.setAttribute('aria-label', `row ${i + 1}, column ${j + 1}`);
      inp.value = (old[i] && old[i][j]) || '';
      inp.addEventListener('keydown', onCellKey);
      inp.addEventListener('input', () => validateCell(inp));
      inp.addEventListener('paste', onCellPaste);
      td.appendChild(inp);
    }
  }
  $('#grid').replaceChildren(t);
  $('#rows-n').textContent = state.rows;
  $('#cols-n').textContent = state.cols;
  fitGrid(total);
}

/* Narrower cells as columns are added, and a wider input column to hold them (capped in CSS). */
function fitGrid(total) {
  const cellW = total <= 5 ? 64 : total <= 8 ? 52 : 44;
  const font = total <= 5 ? 15 : total <= 8 ? 14 : 13;
  const needed = 60 + (total + 1) * (cellW + 4) - cellW + (state.aug ? 10 : 0) + 2 * 18 + 2;   // row label + cells + spacing + bar + card padding
  const root = document.documentElement.style;
  root.setProperty('--cell-w', cellW + 'px');
  root.setProperty('--cell-font', font + 'px');
  root.setProperty('--input-w', Math.max(460, needed) + 'px');
}

function validateCell(inp) {
  inp.classList.toggle('bad', !/^[0-9+\-*/().iI^\s−·]*$/.test(inp.value));
}

function focusCell(r, c) {
  const inp = document.querySelector(`#grid input[data-r="${r}"][data-c="${c}"]`);
  if (inp) { inp.focus(); inp.select(); }
}

function onCellKey(e) {
  const inp = e.target, r = +inp.dataset.r, c = +inp.dataset.c;
  const total = state.cols + (state.aug ? 1 : 0);
  let nr = r, nc = c;
  if (e.key === 'ArrowRight' && inp.selectionStart === inp.value.length) nc = c + 1;
  else if (e.key === 'ArrowLeft' && inp.selectionStart === 0) nc = c - 1;
  else if (e.key === 'ArrowDown') nr = r + 1;
  else if (e.key === 'ArrowUp') nr = r - 1;
  else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    if (r === state.rows - 1) solve(); else focusCell(r + 1, c);
    return;
  } else return;
  if (nr < 0 || nr >= state.rows || nc < 0 || nc >= total) return;
  e.preventDefault();
  focusCell(nr, nc);
}

/* Pasting a whole matrix into a cell fills the grid (rows by newline or ';', entries by
   commas or spaces, '|' marks the right-hand side). A single value pastes normally. */
function onCellPaste(e) {
  const txt = (e.clipboardData || window.clipboardData).getData('text');
  const multi = /[\n;|]/.test(txt) || txt.trim().split(/[\s,]+/).length > 1;
  if (!multi) return;
  e.preventDefault();
  if (fillGridFromText(txt)) hideError();
}

function splitEntries(chunk) {
  if (chunk.includes(',')) return chunk.split(',').map(s => s.trim()).filter(Boolean);
  const out = []; let glue = false;                 // same gluing rule as the CLI: "1 + i  2" → 1+i, 2
  for (const tok of chunk.trim().split(/\s+/).filter(Boolean)) {
    if (tok === '+' || tok === '-' || tok === '−') { if (out.length) { out[out.length - 1] += tok; glue = true; } }
    else if (glue || (out.length && /[+\-−*/(]$/.test(out[out.length - 1]))) { out[out.length - 1] += tok; glue = false; }
    else out.push(tok);
  }
  return out;
}

function fillGridFromText(txt) {
  const lines = txt.split(/[\n;]/).map(s => s.trim()).filter(Boolean);
  if (!lines.length || lines.some(l => l.includes('='))) return false;   // equations live in the text tab
  const rows = [], bars = new Set();
  for (const line of lines) {
    const parts = line.split('|');
    if (parts.length > 2) return false;
    const left = splitEntries(parts[0]), right = parts.length === 2 ? splitEntries(parts[1]) : [];
    if (parts.length === 2) bars.add(left.length);
    rows.push(left.concat(right));
  }
  const width = Math.max(...rows.map(r => r.length));
  if (bars.size > 1 || (bars.size === 1 && [...bars][0] !== width - 1)) return false;
  state.aug = bars.size === 1;
  state.rows = Math.min(rows.length, MAX_DIM);
  state.cols = Math.min(width - (state.aug ? 1 : 0), MAX_DIM);
  $('#aug').checked = state.aug;
  buildGrid(false);
  rows.slice(0, state.rows).forEach((row, i) => row.forEach((v, j) => {
    const inp = document.querySelector(`#grid input[data-r="${i}"][data-c="${j}"]`);
    if (inp) { inp.value = v; validateCell(inp); }
  }));
  return true;
}

function gridToText() {
  const g = readGrid();
  return g.map(row => {
    const vals = row.map(v => v.trim() || '0');
    return state.aug ? vals.slice(0, state.cols).join(', ') + ' | ' + vals[state.cols] : vals.join(', ');
  }).join('; ');
}

/* ───────────────────────── solving ───────────────────────── */

function showError(msg) { const e = $('#error'); e.textContent = msg; e.hidden = false; markBadEntry(msg); }
function hideError() { $('#error').hidden = true; }
function markBadEntry(msg) {
  const m = /entry '([^']*)'/.exec(msg);
  if (!m) return;
  document.querySelectorAll('#grid input').forEach(inp => { if (inp.value.trim() === m[1].trim()) inp.classList.add('bad'); });
}

function solve() {
  let text, system = false;
  if (state.mode === 'grid') { text = gridToText(); $('#text').value = text; }
  else { text = $('#text').value; system = $('#text-s').checked; }
  if (!text.trim()) return showError('Nothing to solve — enter a matrix or some equations.');
  let data;
  try {
    data = GaussEngine.analyse(text, system);
  } catch (err) {
    showError(err instanceof GaussEngine.GaussError ? err.message : 'Unexpected error: ' + err.message);
    return;
  }
  hideError();
  state.data = data; state.text = text; state.system = system; state.revealed = 1;
  setHash();
  pushHistory(text, system);
  render();
}

function setHash() {
  const h = '#q=' + encodeURIComponent(state.text) + (state.system ? '&s=1' : '') + ($('#practice').checked ? '&p=1' : '');
  try { history.replaceState(null, '', h); } catch (e) { /* file:// in some WebViews */ }
}

function copyText(s, btn) {
  if (window.Android && Android.copy) { Android.copy(s); return; }
  navigator.clipboard.writeText(s).then(() => flash(btn, 'Copied'), () => flash(btn, 'Cannot copy here'));
}

/* ───────────────────────── rendering ───────────────────────── */

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/* "−3/4", "(8−4i)/5", "i/2" → stacked fraction; anything else as text. */
function numEl(s) {
  const span = el('span', 'num');
  const m = /^(−?)(?:\((.+)\)|([^/]+))\/(\d+)$/.exec(s);
  if (!m) { span.textContent = s; return span; }
  if (m[1]) span.append(m[1]);
  const f = el('span', 'frac');
  f.append(el('span', 'n', m[2] || m[3]), el('span', 'd', m[4]));
  span.append(f);
  return span;
}

function matrixEl(M, bar, o = {}) {
  const wrap = el('div', 'matwrap');
  const t = el('table', 'mat');
  const width = M[0].length;
  if (o.names) {
    const tr = t.createTHead().insertRow();
    tr.appendChild(el('th'));
    for (let j = 0; j < width; j++) {
      const th = el('th', '', bar !== null && j === bar ? 'b' : (o.names[j] || String(j + 1)));
      tr.appendChild(th);
    }
  }
  const body = t.createTBody();
  M.forEach((row, i) => {
    const tr = body.insertRow();
    if (i === 0) tr.classList.add('top');
    if (i === M.length - 1) tr.classList.add('bottom');
    if (o.changed && o.changed.has(i)) tr.classList.add('changed');
    if (o.source && o.source.has(i)) tr.classList.add('source');
    tr.appendChild(el('th', 'rowlbl', L(i)));
    row.forEach((v, j) => {
      const td = tr.insertCell();
      td.className = 'num-cell';
      if (j === 0) td.classList.add('first');
      if (j === width - 1) td.classList.add('last');
      if (bar !== null && j === bar) td.classList.add('bar');
      const isPivot = (o.pivot && o.pivot[0] === i && o.pivot[1] === j) ||
                      (o.pivots && o.pivots.some(p => p[0] === i && p[1] === j));
      if (isPivot) td.classList.add('pivot');
      td.appendChild(numEl(v));
    });
  });
  wrap.appendChild(t);
  return wrap;
}

/* English text with the Hebrew term isolated in a <bdi>, so bidi never reorders the line. */
function bi(tag, cls, en, he) {
  const e = el(tag, cls, en);
  if (he) { e.append(' · '); e.appendChild(el('bdi', 'he', he)); }
  return e;
}

function heading(en, he, cap) {
  const h = bi('h2', '', en, he);
  if (cap) h.appendChild(el('span', 'cap', cap));
  return h;
}

function stepEl(step, n, d) {
  const div = el('div', 'step');
  const ops = el('div', 'ops');
  ops.appendChild(el('span', 'no', 'step ' + n));
  const changed = new Set(), source = new Set();
  for (const op of step.ops) {
    ops.appendChild(el('code', 'op', op.label));
    if (op.kind === 'swap') op.rows.forEach(r => changed.add(r));
    else { changed.add(op.target); if (op.source !== undefined) source.add(op.source); }
  }
  div.append(ops, matrixEl(step.matrix, d.bar, { changed, source, pivot: step.pivot }));
  return div;
}

function resultEl(sol, d) {
  const box = el('div', 'result ' + sol.status);
  const body = el('div', 'body');
  if (sol.status === 'none') {
    box.appendChild(bi('div', 'banner', 'No solution', 'אין פתרון'));
    body.append(el('p', 'note', 'The echelon form has the row'),
                matrixEl([sol.row], d.bar),
                el('p', '', `which says  0 = ${sol.rhs}  — impossible: no values of ${d.names.join(', ')} satisfy every equation.`),
                el('p', 'setline', 'S = ∅'));
  } else {
    const k = sol.free.length;
    box.appendChild(sol.status === 'unique'
      ? bi('div', 'banner', 'Exactly one solution', 'פתרון יחיד')
      : bi('div', 'banner', `Infinitely many solutions — ${k} free variable${k > 1 ? 's' : ''}`, 'אינסוף פתרונות'));
    if (k) body.appendChild(el('p', 'note',
      `Free: ${sol.free.map((f, i) => f + ' = ' + sol.params[i]).join(', ')}  (${sol.params.join(', ')} — any number in ${d.field}). ` +
      `Every other unknown is expressed through ${k > 1 ? 'them' : 'it'}:`));
    const grid = el('div', 'values');
    d.names.forEach((name, i) => {
      grid.append(el('span', 'name', name + ' ='));
      const v = el('span');
      v.appendChild(numEl(sol.values[i]));
      if (sol.free.includes(name)) v.appendChild(el('span', 'free', '  ← free'));
      grid.appendChild(v);
    });
    body.appendChild(grid);
    body.appendChild(el('p', 'setline', sol.set));
    if (sol.example) body.appendChild(el('p', 'note',
      `For example, ${sol.params.join(' = ')} = 0 gives the solution (${sol.example.join(', ')}).`));
    body.appendChild(el('span', 'check ' + (sol.ok ? 'ok' : 'fail'),
      sol.ok ? '✓ checked — substituted into the original equations, every one holds'
             : '✗ check failed — the solution does not satisfy the original system'));
  }
  box.appendChild(body);
  return box;
}

function render() {
  const d = state.data, out = $('#output');
  out.hidden = false; out.replaceChildren();
  const showSteps = $('#show-steps').checked;
  const practice = showSteps && $('#practice').checked;
  state.items = [];

  const bar = el('div', 'outbar');
  bar.append(el('span', 'note', `${d.rows}×${d.cols} over ${d.field}` + (d.bar === null ? ' — a matrix, not a system' : '')),
             el('span', 'spacer'));
  const copyT = el('button', '', 'Copy as text'), copyL = el('button', '', 'Copy link');
  copyT.onclick = () => copyText(d.text, copyT);
  copyL.onclick = () => copyText(location.href, copyL);
  bar.append(copyT);
  if (!window.Android) bar.append(copyL);     // inside the app there is no URL to share
  out.appendChild(bar);

  $('#welcome').hidden = true;
  out.append(heading('Input', 'קלט'), matrixEl(d.input, d.bar, { names: d.names }));

  if (showSteps) {
    const legend = el('div', 'legend');
    for (const [cls, label] of [['sw-changed', 'row changed in this step'],
                                ['sw-source', 'row used (the Lⱼ in Lᵢ → Lᵢ + λ·Lⱼ)'],
                                ['sw-pivot', 'pivot']]) {
      const item = el('span');
      item.append(el('i', cls), label);
      legend.appendChild(item);
    }
    out.appendChild(legend);
  }
  let n = 0;
  const phase = (title, which) => {
    const steps = d.steps.filter(s => s.phase === which);
    if (!showSteps || !steps.length) return;
    const box = el('div', 'phase');
    box.appendChild(el('h3', '', title));
    steps.forEach(s => { const e = stepEl(s, ++n, d); box.appendChild(e); state.items.push(e); });
    out.appendChild(box);
  };
  const form = (en, he, M, cap) => {
    const e = el('div');
    e.append(heading(en, he, cap), matrixEl(M, d.bar, { names: d.names, pivots: d.pivots }));
    out.appendChild(e); state.items.push(e);
  };
  phase('Phase 1 — zeros below the pivots', 1);
  form('Echelon form', 'מטריצה מדורגת', d.echelon, 'after phase 1');
  phase('Phase 2 — leading 1s, then zeros above the pivots', 2);
  form('Canonical echelon form', 'מטריצה מדורגת קנונית', d.canonical,
       `rank ${d.rank} — ${d.rank} non-zero row${d.rank === 1 ? '' : 's'}`);
  if (d.solution) { const e = resultEl(d.solution, d); out.appendChild(e); state.items.push(e); }
  else out.appendChild(el('p', 'note', 'No right-hand side, so there is nothing to solve for. ' +
    'Tick "Augmented" (or put | before the last column) to solve a system.'));

  if (practice) {
    const pb = el('div', 'practice-bar');
    const status = el('span'), next = el('button', '', 'Reveal next  →'), all = el('button', '', 'Reveal all');
    next.onclick = () => reveal(1); all.onclick = () => reveal(Infinity);
    pb.append(status, next, all);
    out.appendChild(pb);
    state.practiceStatus = status;
    applyReveal();
  }
}

function applyReveal() {
  state.items.forEach((e, i) => { e.hidden = i >= state.revealed; });
  document.querySelectorAll('.phase').forEach(p => {
    p.hidden = [...p.querySelectorAll('.step')].every(s => s.hidden);
  });
  if (state.practiceStatus) {
    const shown = Math.min(state.revealed, state.items.length);
    state.practiceStatus.textContent = `Practice: work out the next step on paper, then reveal it — ${shown} of ${state.items.length} shown`;
  }
}
function reveal(k) { state.revealed = Math.min(state.items.length, state.revealed + k); applyReveal(); }

function flash(btn, msg) { const t = btn.textContent; btn.textContent = msg; setTimeout(() => btn.textContent = t, 1200); }

/* ───────────────────────── history, examples, hash ───────────────────────── */

function loadHistory() { try { return JSON.parse(localStorage.getItem('gauss.history') || '[]'); } catch { return []; } }
function pushHistory(text, system) {
  const h = loadHistory().filter(x => x.text !== text);
  h.unshift({ text, system });
  localStorage.setItem('gauss.history', JSON.stringify(h.slice(0, 5)));
  renderHistory();
}
function renderHistory() {
  const h = loadHistory(), box = $('#history');
  $('#history-wrap').hidden = !h.length;
  box.replaceChildren(...h.map(item => {
    const b = el('button', '', item.text.length > 48 ? item.text.slice(0, 46) + '…' : item.text);
    b.title = item.text;
    b.onclick = () => loadInput(item.text, item.system);
    return b;
  }));
}

function loadInput(text, system = false) {
  if (!text.includes('=') && fillGridFromText(text)) setMode('grid');
  else { setMode('text'); $('#text').value = text; $('#text-s').checked = !!system; }
  solve();
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === mode));
  $('#tab-grid').hidden = mode !== 'grid';
  $('#tab-text').hidden = mode !== 'text';
  if (mode === 'text' && !$('#text').value.trim()) $('#text').value = readGrid().flat().some(v => v.trim()) ? gridToText() : '';
}

function randomFill() {
  document.querySelectorAll('#grid input').forEach(inp => {
    let v = Math.floor(Math.random() * 11) - 5;
    if (v === 0 && Math.random() < 0.7) v = Math.random() < 0.5 ? 1 : -1;
    inp.value = String(v); inp.classList.remove('bad');
  });
}

/* ───────────────────────── wiring ───────────────────────── */

document.querySelectorAll('.tab').forEach(t => t.onclick = () => setMode(t.dataset.tab));
$('#rows-plus').onclick = () => { if (state.rows < MAX_DIM) { state.rows++; buildGrid(); } };
$('#rows-minus').onclick = () => { if (state.rows > 1) { state.rows--; buildGrid(); } };
$('#cols-plus').onclick = () => { if (state.cols < MAX_DIM) { state.cols++; buildGrid(); } };
$('#cols-minus').onclick = () => { if (state.cols > 1) { state.cols--; buildGrid(); } };
$('#aug').onchange = e => { state.aug = e.target.checked; buildGrid(); };
$('#solve').onclick = solve;
$('#random').onclick = () => { if (state.mode !== 'grid') setMode('grid'); randomFill(); hideError(); };
$('#clear').onclick = () => {
  document.querySelectorAll('#grid input').forEach(inp => { inp.value = ''; inp.classList.remove('bad'); });
  $('#text').value = ''; $('#output').hidden = true; $('#welcome').hidden = false; hideError();
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
  if (state.mode === 'grid') focusCell(0, 0);
};
$('#show-steps').onchange = $('#practice').onchange = () => {
  if (!state.data) return;
  state.revealed = 1; render();
  setHash();
};
const sel = $('#examples');
EXAMPLES.forEach((ex, i) => { const o = document.createElement('option'); o.value = i; o.textContent = ex.name; sel.appendChild(o); });
sel.onchange = () => { if (sel.value !== '') { loadInput(EXAMPLES[+sel.value].text); sel.value = ''; } };
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); solve(); }
  else if (state.practiceStatus && !$('#output').hidden && ['ArrowRight', ' '].includes(e.key) &&
           !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); reveal(1); }
});

buildGrid(false);
renderHistory();
if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {   // installable, offline-capable PWA
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
{
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('p') === '1') $('#practice').checked = true;
  if (h.get('q')) loadInput(h.get('q'), h.get('s') === '1');
  else focusCell(0, 0);
}
