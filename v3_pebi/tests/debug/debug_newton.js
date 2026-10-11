'use strict';
const { loadCore } = require('./helpers.js');
const Pebi = loadCore();

const params = Pebi.defaultParams();
params.mesh.targetCells = 400;
params.control.dt0 = 0.01;
params.control.dtMin = 0.001;
const mesh = Pebi.generate({
  Lx: params.domain.Lx, Ly: params.domain.Ly, wells: params.wells,
  sMin: Math.max(3, 27 * params.wells[0].rw),
  targetCells: params.mesh.targetCells, RGrad: params.mesh.RGrad, seed: params.mesh.seed
}, Pebi.DelaunayClass);
console.log('cells:', mesh.N);
const sim = new Pebi.Simulator(params, mesh);
const st = sim.state;

// ручной шаг: давление
sim.wells.forEach((w, i) => { w.mode = sim.controls[i].mode; w.value = sim.controls[i].value; Pebi.resolveFlowing(w, st.p[w.cell], sim.fluid, st.S[w.cell]); });
const pr = sim.pressure;
pr.assemble(st, sim.wells, 0.01, {});
const res = pr.solve(st.p, 1e-10);
console.log('pressure ok:', res.ok, 'iters:', res.iters, 'relres:', res.relres.toExponential(2));
pr.wellRates(st, sim.wells);
const v = pr.fluxes(st);
console.log('well qRes:', sim.wells.map(w => w.qRes.toFixed(1)).join(', '));
console.log('max |v|:', Math.max(...v).toFixed(1), 'min |v|:', Math.min(...v).toFixed(1));

const tr = sim.transport;
tr.prepare(st, pr.p, v, sim.wells);

// проверка якобиана: J*d vs конечная разность R(S+eps*d)
const n = mesh.N;
const S0 = Float64Array.from(st.S);
const d = new Float64Array(n);
const rng = Pebi.mulberry32(7);
for (let i = 0; i < n; i++) d[i] = (rng() - 0.5) * 0.01;

// R(S0)
function residual(Sarr) {
  const R = new Float64Array(n);
  const fluid = sim.fluid;
  for (let i = 0; i < n; i++) R[i] = (tr.VpNew[i] * Sarr[i] / tr.BwNew[i] - tr.accum0[i]) / 0.01;
  for (let f = 0; f < mesh.F; f++) {
    const vv = tr.vFace[f];
    if (vv === 0) continue;
    const ia = mesh.faceA[f], ib = mesh.faceB[f];
    const up = tr.fUp[f] === 0 ? ia : ib;
    const Fo = vv * fluid.fw(Sarr[up]) / tr.BwNew[up];
    R[ia] += Fo; R[ib] -= Fo;
  }
  for (const src of tr.wellSrc) {
    if (src.type === 'injector') R[src.cell] -= src.qRes / tr.BwNew[src.cell];
    else R[src.cell] += fluid.fw(Sarr[src.cell]) * src.qRes / tr.BwNew[src.cell];
  }
  return R;
}
const R0 = residual(S0);
console.log('|R(S0)|inf*n', Math.max(...Array.from(R0, (r, i) => Math.abs(r) * 0.01 / tr.VpNew[i])).toExponential(2));

// J*d
const J = Pebi.CSR.buildPattern(n + 2 * mesh.F, new Int32Array(0), new Int32Array(0)); // заглушка не нужна — соберем вручную
{
  // собрать якобиан как в solve()
  const Jm = tr.J; Jm.zero();
  for (let i = 0; i < n; i++) Jm.add(i, i, tr.VpNew[i] / (0.01 * tr.BwNew[i]));
  const fluid = sim.fluid;
  for (let f = 0; f < mesh.F; f++) {
    const vv = tr.vFace[f];
    if (vv === 0) continue;
    const ia = mesh.faceA[f], ib = mesh.faceB[f];
    const up = tr.fUp[f] === 0 ? ia : ib;
    const dF = vv * fluid.dfw(S0[up]) / tr.BwNew[up];
    Jm.add(ia, up, dF); Jm.add(ib, up, -dF);
  }
  for (const src of tr.wellSrc) {
    if (src.type === 'producer') Jm.add(src.cell, src.cell, src.qRes * fluid.dfw(S0[src.cell]) / tr.BwNew[src.cell]);
  }
  const Jd = new Float64Array(n);
  Jm.spmv(d, Jd);
  const eps = 1e-7;
  const S1 = Float64Array.from(S0);
  for (let i = 0; i < n; i++) S1[i] += eps * d[i];
  const R1 = residual(S1);
  let maxErr = 0, maxRel = 0;
  for (let i = 0; i < n; i++) {
    const fd = (R1[i] - R0[i]) / eps;
    const err = Math.abs(fd - Jd[i]);
    const scale = Math.abs(fd) + Math.abs(Jd[i]) + 1e-9;
    if (err / scale > maxRel) { maxRel = err / scale; }
    maxErr = Math.max(maxErr, err);
  }
  console.log('Jacoban check: maxAbsErr=', maxErr.toExponential(2), 'maxRelErr=', maxRel.toExponential(2));
}

// трассировка Ньютона
console.log('\n-- Newton trace (dt=0.01) --');
const ts = tr.solve(S0, 0.01, { tol: 1e-6 });
console.log('converged:', ts.converged, 'iters:', ts.iters, 'reason:', ts.reason || '-');
