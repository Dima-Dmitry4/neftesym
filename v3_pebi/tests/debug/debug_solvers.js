'use strict';
const { loadCore, assert, approx, runSuite, summary } = require('./helpers.js');
const Pebi = loadCore();

runSuite('PCG+IC0 на случайной SPD', function () {
  const n = 300, rng = Pebi.mulberry32(3);
  const rows = [], cols = [], vals = [];
  const M = [];
  for (let i = 0; i < n; i++) { M[i] = []; for (let j = 0; j < n; j++) M[i][j] = 0; }
  for (let i = 0; i < n; i++) {
    M[i][i] = 4 + rng();
    for (const off of [-1, -2, 5, 17]) {
      const j = i + off;
      if (j >= 0 && j < n) { const v = 0.5 * rng(); M[i][j] = v; M[j][i] = v; }
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) if (M[i][j] !== 0) { rows.push(i); cols.push(j); vals.push(M[i][j]); rows.push(j); cols.push(i); vals.push(M[i][j]); }
  const A = Pebi.CSR.buildPattern(n, rows, cols);
  for (let k = 0; k < rows.length; k++) A.add(rows[k], cols[k], vals[k]);
  const xe = new Float64Array(n); for (let i = 0; i < n; i++) xe[i] = rng();
  const b = new Float64Array(n); A.spmv(xe, b);
  const r = Pebi.pcg(A, b, { M: Pebi.ic0(A), tol: 1e-12, maxit: 500 });
  let err = 0; for (let i = 0; i < n; i++) err = Math.max(err, Math.abs(r.x[i] - xe[i]));
  console.log('  iters:', r.iters, 'relres:', r.relres.toExponential(2), 'err:', err.toExponential(2));
  assert('PCG сходится', r.converged);
  assert('PCG точность', err < 1e-8, 'err=' + err);
});

runSuite('BiCGStab+ILU0 на случайной несимметричной', function () {
  const n = 300, rng = Pebi.mulberry32(5);
  const rows = [], cols = [], vals = [];
  for (let i = 0; i < n; i++) {
    rows.push(i); cols.push(i); vals.push(6 + rng() * 2);
    for (const off of [-1, -3, 2, 11]) {
      const j = i + off;
      if (j >= 0 && j < n) { rows.push(i); cols.push(j); vals.push(0.6 * rng()); }
    }
  }
  const A = Pebi.CSR.buildPattern(n, rows, cols);
  for (let k = 0; k < rows.length; k++) A.add(rows[k], cols[k], vals[k]);
  const xe = new Float64Array(n); for (let i = 0; i < n; i++) xe[i] = rng();
  const b = new Float64Array(n); A.spmv(xe, b);
  const r = Pebi.bicgstab(A, b, { M: Pebi.ilu0(A), tol: 1e-11, maxit: 300 });
  let err = 0; for (let i = 0; i < n; i++) err = Math.max(err, Math.abs(r.x[i] - xe[i]));
  console.log('  iters:', r.iters, 'relres:', r.relres.toExponential(2), 'err:', err.toExponential(2));
  assert('BiCGStab сходится', r.converged);
  assert('BiCGStab точность', err < 1e-7, 'err=' + err);
});

runSuite('Первый шаг Ньютона: трассировка', function () {
  const params = Pebi.defaultParams();
  params.mesh.targetCells = 400;
  const mesh = Pebi.generate({
    Lx: params.domain.Lx, Ly: params.domain.Ly, wells: params.wells,
    sMin: 3, targetCells: params.mesh.targetCells, RGrad: params.mesh.RGrad, seed: params.mesh.seed
  }, Pebi.DelaunayClass);
  const sim = new Pebi.Simulator(params, mesh);
  const st = sim.state, dt = 0.01;
  sim.wells.forEach((w, i) => { w.mode = sim.controls[i].mode; w.value = sim.controls[i].value; Pebi.resolveFlowing(w, st.p[w.cell], sim.fluid, st.S[w.cell]); });
  const pr = sim.pressure;
  pr.assemble(st, sim.wells, dt, {});
  pr.solve(st.p, 1e-10);
  pr.wellRates(st, sim.wells);
  const v = pr.fluxes(st);
  const tr = sim.transport;
  tr.prepare(st, pr.p, v, sim.wells);
  const n = mesh.N, fluid = sim.fluid;

  // R(S0)
  const S0 = Float64Array.from(st.S);
  const R = new Float64Array(n);
  for (let i = 0; i < n; i++) R[i] = (tr.VpNew[i] * S0[i] / tr.BwNew[i] - tr.accum0[i]) / dt;
  for (let f = 0; f < mesh.F; f++) {
    const vv = tr.vFace[f]; if (vv === 0) continue;
    const ia = mesh.faceA[f], ib = mesh.faceB[f];
    const up = tr.fUp[f] === 0 ? ia : ib;
    const Fo = vv * fluid.fw(S0[up]) / tr.BwNew[up];
    R[ia] += Fo; R[ib] -= Fo;
  }
  for (const src of tr.wellSrc) {
    if (src.type === 'injector') R[src.cell] -= src.qRes / tr.BwNew[src.cell];
    else R[src.cell] += fluid.fw(S0[src.cell]) * src.qRes / tr.BwNew[src.cell];
  }
  // Якобиан
  const J = tr.J; J.zero();
  for (let i = 0; i < n; i++) J.add(i, i, tr.VpNew[i] / (dt * tr.BwNew[i]));
  for (let f = 0; f < mesh.F; f++) {
    const vv = tr.vFace[f]; if (vv === 0) continue;
    const ia = mesh.faceA[f], ib = mesh.faceB[f];
    const up = tr.fUp[f] === 0 ? ia : ib;
    const dF = vv * fluid.dfw(S0[up]) / tr.BwNew[up];
    J.add(ia, up, dF); J.add(ib, up, -dF);
  }
  for (const src of tr.wellSrc) if (src.type === 'producer') J.add(src.cell, src.cell, src.qRes * fluid.dfw(S0[src.cell]) / tr.BwNew[src.cell]);

  const negR = new Float64Array(n);
  for (let i = 0; i < n; i++) negR[i] = -R[i];
  const M = Pebi.ilu0(J);
  const lin = Pebi.bicgstab(J, negR, { M, tol: 1e-9, maxit: 300 });
  console.log('  linear: converged=', lin.converged, 'iters=', lin.iters, 'relres=', lin.relres.toExponential(2));
  const dS = lin.x;
  let nanCount = 0, maxD = 0;
  for (let i = 0; i < n; i++) { if (!isFinite(dS[i])) nanCount++; if (Math.abs(dS[i]) > maxD) maxD = Math.abs(dS[i]); }
  console.log('  NaN в dS:', nanCount, 'max|dS|:', maxD.toFixed(4));

  // невязка в пробных точках
  function normAt(lam) {
    const Rt = new Float64Array(n);
    for (let i = 0; i < n; i++) Rt[i] = (tr.VpNew[i] * (S0[i] + lam * dS[i]) / tr.BwNew[i] - tr.accum0[i]) / dt;
    for (let f = 0; f < mesh.F; f++) {
      const vv = tr.vFace[f]; if (vv === 0) continue;
      const ia = mesh.faceA[f], ib = mesh.faceB[f];
      const up = tr.fUp[f] === 0 ? ia : ib;
      const Fo = vv * fluid.fw(S0[up] + lam * dS[up]) / tr.BwNew[up];
      Rt[ia] += Fo; Rt[ib] -= Fo;
    }
    for (const src of tr.wellSrc) {
      if (src.type === 'injector') Rt[src.cell] -= src.qRes / tr.BwNew[src.cell];
      else Rt[src.cell] += fluid.fw(S0[src.cell] + lam * dS[src.cell]) * src.qRes / tr.BwNew[src.cell];
    }
    let nm = 0;
    for (let i = 0; i < n; i++) { const ri = Math.abs(Rt[i]) * dt / tr.VpNew[i]; if (ri > nm) nm = ri; }
    return nm;
  }
  let nm0 = 0;
  for (let i = 0; i < n; i++) { const ri = Math.abs(R[i]) * dt / tr.VpNew[i]; if (ri > nm0) nm0 = ri; }
  console.log('  norm(S0) =', nm0.toExponential(3));
  for (const lam of [1, 0.5, 0.25, 0.125, 0.0625, 0.01, 0.002, 0.001]) {
    console.log('    lam=' + lam, 'norm=' + normAt(lam).toExponential(3));
  }
});

summary();
