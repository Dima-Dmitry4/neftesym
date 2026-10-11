'use strict';
// Загрузка численного ядра для Node-тестов.
const path = require('path');
const CORE_DIR = path.join(__dirname, '..', 'js', 'core');

function loadCore() {
  const Pebi = {};
  const files = ['sparse.js', 'fluid.js', 'mesh.js', 'wells.js', 'pressure.js', 'transport.js', 'timestepper.js', 'engine.js'];
  for (const f of files) {
    const mod = require(path.join(CORE_DIR, f));
    Object.assign(Pebi, mod);
  }
  const Del = require(path.join(__dirname, '..', 'vendor', 'd3-delaunay.min.js'));
  Pebi.DelaunayClass = Del.Delaunay;
  return Pebi;
}

let passed = 0, failed = 0;
const failures = [];

function assert(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

function approx(name, actual, expected, relTol, absTol) {
  const diff = Math.abs(actual - expected);
  const tol = Math.max(absTol || 0, relTol * Math.abs(expected));
  assert(name, diff <= tol, 'actual=' + actual + ' expected=' + expected + ' diff=' + diff.toExponential(2));
}

function runSuite(title, fn) {
  console.log('\n== ' + title + ' ==');
  try { fn(); }
  catch (e) { failed++; failures.push(title + ': исключение — ' + e.message); console.log('  EXCEPTION: ' + e.stack); }
}

function summary() {
  console.log('\n========================================');
  console.log('Пройдено: ' + passed + ', провалено: ' + failed);
  if (failures.length) { console.log('Провалы:'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(failed ? 1 : 0);
}

module.exports = { loadCore, assert, approx, runSuite, summary };
