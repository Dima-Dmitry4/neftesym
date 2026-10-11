'use strict';
const { loadCore } = require('./helpers.js');
const Pebi = loadCore();

const params = Pebi.defaultParams();
const mesh = Pebi.generate({
  Lx: params.domain.Lx, Ly: params.domain.Ly, wells: params.wells,
  sMin: Math.max(3, 27 * params.wells[0].rw),
  targetCells: params.mesh.targetCells, RGrad: params.mesh.RGrad, seed: params.mesh.seed
}, Pebi.DelaunayClass);
console.log('cells:', mesh.N);
const sim = new Pebi.Simulator(params, mesh);
const st = sim.state;

for (const dt of [1, 0.25, 0.05, 0.01]) {
  console.log('--- dt=' + dt + ' ---');
  // восстановить состояние
  st.p.fill(params.init.p0); st.S.fill(params.init.sw0); st.t = 0; st.step = 0;
  sim.wells.forEach((w, i) => { w.mode = sim.controls[i].mode; w.value = sim.controls[i].value; Pebi.resolveFlowing(w, st.p[w.cell], sim.fluid, st.S[w.cell]); });
  const pr = sim.pressure;
  pr.assemble(st, sim.wells, dt, {});
  const res = pr.solve(st.p, 1e-10);
  console.log('pressure:', res.ok, 'iters:', res.iters);
  pr.wellRates(st, sim.wells);
  const v = pr.fluxes(st);
  const tr = sim.transport;
  tr.prepare(st, pr.p, v, sim.wells);
  const ts = tr.solve(st.S, dt, { tol: 1e-6, verbose: true });
  console.log('=> converged:', ts.converged, 'iters:', ts.iters, ts.reason || '');
}
