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
for (; k < 400; k++) {
  const r = sim.stepOnce();
  if (!r.ok) break;
}
console.log('стоп k=', k, 't=', st.t.toFixed(1), 'dtCurrent=', st.dtCurrent);

// повторить попытку с dt=dtCurrent и verbose
const dt = st.dtCurrent;
sim.wells.forEach((w, i) => { w.mode = sim.controls[i].mode; w.value = sim.controls[i].value; Pebi.resolveFlowing(w, st.p[w.cell], sim.fluid, st.S[w.cell]); });
const pr = sim.pressure;
pr.assemble(st, sim.wells, dt, {});
pr.solve(st.p, params.control.pcgTol);
pr.wellRates(st, sim.wells);
const v = pr.fluxes(st);
const tr = sim.transport;
tr.prepare(st, pr.p, v, sim.wells);
const ts = tr.solve(st.S, dt, { tol: params.control.newtonTol, verbose: true });
console.log('converged:', ts.converged, ts.reason || '', 'iters:', ts.iters);

// состояние: распределение S
let bins = new Array(10).fill(0);
for (let i = 0; i < mesh.N; i++) bins[Math.min(9, Math.floor(st.S[i] * 10))]++;
console.log('гистограмма S (децили):', bins.join(','));
// ячейки у границ
let atHi = 0, atLo = 0;
for (let i = 0; i < mesh.N; i++) {
  if (Math.abs(st.S[i] - (1 - 1e-9)) < 1e-6) atHi++;
  if (Math.abs(st.S[i] - (0.2 - 5e-3)) < 1e-6) atLo++;
}
console.log('у hi:', atHi, 'у lo:', atLo);
