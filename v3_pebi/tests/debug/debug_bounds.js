'use strict';
const { loadCore } = require('./helpers.js');
const Pebi = loadCore();

const params = Pebi.defaultParams();
const mesh = Pebi.generate({
  Lx: params.domain.Lx, Ly: params.domain.Ly, wells: params.wells,
  sMin: Math.max(3, 27 * params.wells[0].rw),
  targetCells: params.mesh.targetCells, RGrad: params.mesh.RGrad, seed: params.mesh.seed
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

console.log('J: NaN in data?', (() => { let c = 0; for (let k = 0; k < J.data.length; k++) if (!isFinite(J.data[k])) c++; return c; })());
const M = Pebi.ilu0(J);
const negR = new Float64Array(n);
for (let i = 0; i < n; i++) negR[i] = -R[i];
const lin = Pebi.bicgstab(J, negR, { M, tol: 1e-9, maxit: 300 });
const dS = lin.x;
let nanC = 0, negC = 0, minD = 0, maxD = 0;
for (let i = 0; i < n; i++) {
  if (!isFinite(dS[i])) nanC++;
  else { if (dS[i] < minD) minD = dS[i]; if (dS[i] > maxD) maxD = dS[i]; if (dS[i] < -1e-9) negC++; }
}
console.log('bicgstab: converged=', lin.converged, 'iters=', lin.iters, 'relres=', lin.relres.toExponential(2));
console.log('NaN dS:', nanC, 'отрицательных (<-1e-9):', negC, 'min dS:', minD.toExponential(3), 'max dS:', maxD.toFixed(4));
// кто нарушает границы при lam=1
const lo = fluid.swc - 1e-9, hi = 1 - fluid.sor + 1e-9;
let viol = [];
for (let i = 0; i < n; i++) {
  const s = S0[i] + dS[i];
  if (!(s >= lo && s <= hi)) viol.push({ i, S0: S0[i], dS: dS[i], s });
}
console.log('нарушений границ при lam=1:', viol.length);
viol.slice(0, 8).forEach(x => console.log('  cell', x.i, 'S0=', x.S0, 'dS=', x.dS.toExponential(3), 'S=', x.s));
