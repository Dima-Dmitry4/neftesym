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
const st = sim.state;
let k = 0;
for (; k < 200; k++) {
  const r = sim.stepOnce();
  if (!r.ok) break;
}
const dt = st.dtCurrent;
console.log('стоп на шаге', k, 't=', st.t.toFixed(1), 'dt=', dt);

// воспроизвести и дампнуть ячейку 653
sim.wells.forEach((w, i) => { w.mode = sim.controls[i].mode; w.value = sim.controls[i].value; Pebi.resolveFlowing(w, st.p[w.cell], sim.fluid, st.S[w.cell]); });
const pr = sim.pressure;
pr.assemble(st, sim.wells, dt, {});
pr.solve(st.p, params.control.pcgTol);
pr.wellRates(st, sim.wells);
const v = pr.fluxes(st);
const tr = sim.transport;
tr.prepare(st, pr.p, v, sim.wells);
const fluid = sim.fluid;

// невязка на текущем состоянии
function residualAt(Sarr, Parr) {
  const R = new Float64Array(mesh.N);
  for (let i = 0; i < mesh.N; i++) R[i] = (tr.VpNew[i] * Sarr[i] / fluid.Bw(Parr[i]) - tr.accum0[i]) / dt;
  for (let f = 0; f < mesh.F; f++) {
    const vv = tr.vFace[f]; if (vv === 0) continue;
    const ia = mesh.faceA[f], ib = mesh.faceB[f];
    const up = tr.fUp[f] === 0 ? ia : ib;
    const Fo = vv * fluid.fw(Sarr[up]) / fluid.Bw(Parr[up]);
    R[ia] += Fo; R[ib] -= Fo;
  }
  for (const src of tr.wellSrc) {
    if (src.type === 'injector') R[src.cell] -= src.qRes / fluid.Bw(Parr[src.cell]);
    else R[src.cell] += fluid.fw(Sarr[src.cell]) * src.qRes / fluid.Bw(Parr[src.cell]);
  }
  return R;
}
const R0 = residualAt(st.S, pr.p);
// топ-5 ячеек по |R|
const idx = Array.from({ length: mesh.N }, (_, i) => i).sort((a, b) => Math.abs(R0[b]) - Math.abs(R0[a]));
for (const ci of idx.slice(0, 5)) {
  // потоки ячейки
  let vin = 0, vout = 0, win = 0, wout = 0;
  for (let f = 0; f < mesh.F; f++) {
    const ia = mesh.faceA[f], ib = mesh.faceB[f];
    let other = -1, sign = 0;
    if (ia === ci) { other = ib; sign = 1; } else if (ib === ci) { other = ia; sign = -1; } else continue;
    const vv = v[f] * sign; // >0: отток из ci
    if (vv > 0) { vout += vv; wout += vv * fluid.fw(st.S[ci]) / fluid.Bw(pr.p[ci]); }
    else { vin += -vv; win += -vv * fluid.fw(st.S[other]) / fluid.Bw(pr.p[other]); }
  }
  console.log('cell', ci, 'S=', st.S[ci].toFixed(6), 'p=', pr.p[ci].toFixed(2), 'p0=', st.p[ci].toFixed(2),
    'R=', R0[ci].toExponential(3), 'normR=', (Math.abs(R0[ci]) * dt / tr.VpNew[ci]).toExponential(3),
    'v_in=', vin.toFixed(3), 'v_out=', vout.toFixed(3), 'w_in=', win.toFixed(4), 'w_out=', wout.toFixed(4),
    'x=', mesh.sites[2 * ci].toFixed(0), 'y=', mesh.sites[2 * ci + 1].toFixed(0));
}
// сколько ячеек с S>0.85, их суммарный R
let c85 = 0, sumR85 = 0;
for (let i = 0; i < mesh.N; i++) if (st.S[i] > 0.85) { c85++; sumR85 += R0[i]; }
console.log('ячеек S>0.85:', c85, 'sumR по ним:', sumR85.toExponential(3));
let cLo = 0, sumRlo = 0;
for (let i = 0; i < mesh.N; i++) if (st.S[i] < 0.2) { cLo++; sumRlo += R0[i]; }
console.log('ячеек S<0.2:', cLo, 'sumR по ним:', sumRlo.toExponential(3));
console.log('sumR все:', idx.reduce((s, i) => s + R0[i], 0).toExponential(3));
