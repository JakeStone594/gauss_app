#!/usr/bin/env node
'use strict';
/* Check web/engine.js against tests/golden.json — the Python engine's own output for 388
   inputs. A solved case must match string for string (every step label, every matrix entry,
   the solution set); a rejected case must be rejected. The CLI-style `text` field is not
   compared (its layout is allowed to differ).

       node tests/test_engine.js                       */
const fs = require('fs');
const path = require('path');
const engine = require(path.join(__dirname, '..', 'web', 'engine.js'));
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden.json'), 'utf8'));

function diff(a, b, where = '$') {
  if (a === b) return null;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return `${where}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${where}: array/object mismatch`;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${where}: length ${a.length}, expected ${b.length}`;
    for (let i = 0; i < a.length; i++) { const d = diff(a[i], b[i], `${where}[${i}]`); if (d) return d; }
    return null;
  }
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join() !== kb.join()) return `${where}: keys ${ka.join(',')} vs expected ${kb.join(',')}`;
  for (const k of ka) { const d = diff(a[k], b[k], `${where}.${k}`); if (d) return d; }
  return null;
}

let pass = 0;
const fails = [];
for (const c of golden) {
  let got = null, err = null;
  try { got = engine.analyse(c.text, c.system); } catch (e) { if (!(e instanceof engine.GaussError)) throw e; err = e; }
  if (c.error !== undefined) {
    if (err) pass++;
    else fails.push(`${JSON.stringify(c.text)}: expected a rejection (${c.error}) but got a result`);
    continue;
  }
  if (err) { fails.push(`${JSON.stringify(c.text)}: threw "${err.message}"`); continue; }
  const { text, ...rest } = got;
  if (typeof text !== 'string' || !text.length) fails.push(`${JSON.stringify(c.text)}: no text rendering`);
  const d = diff(JSON.parse(JSON.stringify(rest)), c.expect);
  if (d) fails.push(`${JSON.stringify(c.text)}: ${d}`); else pass++;
}

console.log(`${pass} of ${golden.length} golden cases match the Python engine`);
if (fails.length) {
  console.log(`FAILURES: ${fails.length}`);
  for (const f of fails.slice(0, 25)) console.log('  ' + f);
  process.exit(1);
}
console.log('engine.js reproduces the Python engine on every case');
