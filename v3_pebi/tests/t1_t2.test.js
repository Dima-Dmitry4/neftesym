'use strict';
// T1: сетка (площади, связность, K-ортогональность, градация, детерминизм)
// T2: решатели PCG+IC(0), BiCGStab+ILU(0)
const { loadCore, assert, approx, runSuite } = require('./helpers.js');
const Pebi = loadCore();

function checkMesh(tag, m, opts) {
  opts = opts || {};
  let area = 0, minA = Infinity, maxA = 0;
  for (let i = 0; i < m.N; i++) {
    area += m.cellArea[i];
    minA = Math.min(minA, m.cellArea[i]);
    maxA = Math.max(maxA, m.cellArea[i]);
  }
  approx(tag + ': сумма площадей = Lx*Ly', area, m.Lx * m.Ly, 1e-9);
  assert(tag + ': нет вырожденных ячеек', minA > 1e-6 * maxA, 'minA=' + minA);

  // K-ортогональность внутренних граней: концы сегмента равнодальны от обоих сайтов
  let maxErr = 0;
  for (let f = 0; f < m.F; f++) {
    const i = m.faceA[f], j = m.faceB[f];
    const xi = m.sites[2 * i], yi = m.sites[2 * i + 1], xj = m.sites[2 * j], yj = m.sites[2 * j + 1];
    const dij = Math.hypot(xj - xi, yj - yi);
    for (let e = 0; e < 2; e++) {
      const ex = m.faceNodes[4 * f + 2 * e], ey = m.faceNodes[4 * f + 2 * e + 1];
      const d1 = Math.hypot(ex - xi, ey - yi), d2 = Math.hypot(ex - xj, ey - yj);
      maxErr = Math.max(maxErr, Math.abs(d1 - d2) / dij);
    }
  }
  assert(tag + ': K-ортогональность (серединный перпендикуляр)', maxErr < 1e-9, 'err=' + maxErr.toExponential(2));

  // связность
  const adj = Array.from({ length: m.N }, () => []);
  for (let f = 0; f < m.F; f++) { adj[m.faceA[f]].push(m.faceB[f]); adj[m.faceB[f]].push(m.faceA[f]); }
  const seen = new Uint8Array(m.N);
  const st = [0]; seen[0] = 1; let cnt = 1;
  while (st.length) {
    const c = st.pop();
    for (const nb of adj[c]) if (!seen[nb]) { seen[nb] = 1; cnt++; st.push(nb); }
  }
  assert(tag + ': связность графа соседей', cnt === m.N, cnt + '/' + m.N);

  // симметрия граней
  let sym = true;
  for (let f = 0; f < m.F; f++) {
    const i = m.faceA[f], j = m.faceB[f];
    if (!(m.faceDij[f] > 0) || i === j) sym = false;
  }
  assert(tag + ': грани корректны', sym && m.F > 0);

  if (opts.checkGrading) {
    const w0 = opts.wells[0], w1 = opts.wells[1];
    const d = (i) => Math.min(
      Math.hypot(m.sites[2 * i] - w0.x, m.sites[2 * i + 1] - w0.y),
      Math.hypot(m.sites[2 * i] - w1.x, m.sites[2 * i + 1] - w1.y));
    let nearMin = Infinity, farMax = 0;
    for (let i = 0; i < m.N; i++) {
      const eq = Math.sqrt(m.cellArea[i] / 0.866); // эквивалентный шаг гекс-сетки
      if (d(i) < opts.RGrad * 0.4) nearMin = Math.min(nearMin, eq);
      if (d(i) > 2.2 * opts.RGrad) farMax = Math.max(farMax, eq);
    }
    assert(tag + ': градация (у скважин мельче)', nearMin < farMax * 0.35,
      'near=' + nearMin.toFixed(1) + ' far=' + farMax.toFixed(1));
  }
}

runSuite('T1: сетка', function () {
  const base = { Lx: 1000, Ly: 500, wells: [{ x: 250, y: 250 }, { x: 750, y: 250 }], RGrad: 130 };
  const m1 = Pebi.generate(Object.assign({ sMin: 3, sMax: 30, seed: 42, lloydIters: 2 }, base), Pebi.DelaunayClass);
  checkMesh('default', m1, { checkGrading: true, wells: base.wells, RGrad: 130 });

  const m2 = Pebi.generate({ Lx: 400, Ly: 300, wells: [{ x: 200, y: 150 }], sMin: 3, sMax: 25, RGrad: 90, seed: 7, lloydIters: 2 }, Pebi.DelaunayClass);
  checkMesh('small', m2);

  // бисекция sMax по целевому числу ячеек
  const m3 = Pebi.generate({ Lx: 1000, Ly: 500, wells: base.wells, sMin: 3, targetCells: 2000, RGrad: 130, seed: 42 }, Pebi.DelaunayClass);
  checkMesh('target', m3);
  assert('бисекция: число ячеек ~целевому (±25%)', m3.N > 1500 && m3.N < 2500, 'N=' + m3.N);

  // детерминизм
  const m4 = Pebi.generate(Object.assign({ sMin: 3, sMax: 30, seed: 42, lloydIters: 2 }, base), Pebi.DelaunayClass);
  let same = m4.N === m1.N;
  if (same) for (let i = 0; i < m1.N && same; i++) same = m1.cellArea[i] === m4.cellArea[i];
  assert('детерминизм (одинаковый seed)', same);
});

runSuite('T2: решатели', function () {
  const n = 300, rng = Pebi.mulberry32(3);
  // SPD: симметричная матрица с диагональным преобладанием
  const A0 = [];
  for (let i = 0; i < n; i++) { A0[i] = new Float64Array(n); A0[i][i] = 8 + rng(); }
  for (let i = 0; i < n; i++) {
    for (const off of [-1, -2, 5, 17]) {
      const j = i + off;
      if (j >= 0 && j < n) { const v = rng(); A0[i][j] += v; A0[j][i] += v; }
    }
  }
  const rows = [], cols = [], vals = [];
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) if (A0[i][j] !== 0) {
    rows.push(i); cols.push(j); vals.push(A0[i][j]);
    if (i !== j) { rows.push(j); cols.push(i); vals.push(A0[i][j]); }
  }
  const A = Pebi.CSR.buildPattern(n, rows, cols);
  for (let k = 0; k < rows.length; k++) A.add(rows[k], cols[k], vals[k]);
  const xe = new Float64Array(n);
  for (let i = 0; i < n; i++) xe[i] = rng();
  const b = new Float64Array(n); A.spmv(xe, b);
  const r1 = Pebi.pcg(A, b, { M: Pebi.ic0(A), tol: 1e-12, maxit: 500 });
  let err = 0; for (let i = 0; i < n; i++) err = Math.max(err, Math.abs(r1.x[i] - xe[i]));
  assert('PCG+IC(0): сходится', r1.converged, 'iters=' + r1.iters);
  assert('PCG+IC(0): точность', err < 1e-8, 'err=' + err.toExponential(2));

  // несимметричная с диагональным преобладанием
  const rows2 = [], cols2 = [], vals2 = [];
  for (let i = 0; i < n; i++) {
    rows2.push(i); cols2.push(i); vals2.push(6 + rng() * 2);
    for (const off of [-1, -3, 2, 11]) {
      const j = i + off;
      if (j >= 0 && j < n) { rows2.push(i); cols2.push(j); vals2.push(0.6 * rng()); }
    }
  }
  const B = Pebi.CSR.buildPattern(n, rows2, cols2);
  for (let k = 0; k < rows2.length; k++) B.add(rows2[k], cols2[k], vals2[k]);
  const be = new Float64Array(n); B.spmv(xe, be);
  const r2 = Pebi.bicgstab(B, be, { M: Pebi.ilu0(B), tol: 1e-11, maxit: 300 });
  err = 0; for (let i = 0; i < n; i++) err = Math.max(err, Math.abs(r2.x[i] - xe[i]));
  assert('BiCGStab+ILU(0): сходится', r2.converged, 'iters=' + r2.iters);
  assert('BiCGStab+ILU(0): точность', err < 1e-7, 'err=' + err.toExponential(2));
});

module.exports = { checkMesh };
