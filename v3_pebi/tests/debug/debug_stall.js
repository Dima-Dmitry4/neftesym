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
  if (!r.ok) { console.log('стоп на шаге', k, ':', r.error); break; }
}
console.log('t=', st.t, 'lastDt=', st.lastDt, 'dtCurrent=', st.dtCurrent);

// воспроизвести отказ: тот же dt, verbose
const dt = st.dtCurrent;
console.log('--- повтор отказа с dt=' + dt + ' ---');
sim.wells.forEach((w, i) => { w.mode = sim.controls[i].mode; w.value = sim.controls[i].value; Pebi.resolveFlowing(w, st.p[w.cell], sim.fluid, st.S[w.cell]); });
const pr = sim.pressure;
pr.assemble(st, sim.wells, dt, {});
const res = pr.solve(st.p, params.control.pcgTol);
console.log('pressure:', res.ok, 'iters:', res.iters);
pr.wellRates(st, sim.wells);
const v = pr.fluxes(st);
const tr = sim.transport;
tr.prepare(st, pr.p, v, sim.wells);
const ts = tr.solve(st.S, dt, { tol: params.control.newtonTol, verbose: true });
console.log('converged:', ts.converged, 'reason:', ts.reason || '');

// состояние вокруг проблемной зоны
let nHi = 0, maxS = 0, maxSi = -1;
for (let i = 0; i < mesh.N; i++) {
  if (st.S[i] > 0.8 - 1e-6) nHi++;
  if (st.S[i] > maxS) { maxS = st.S[i]; maxSi = i; }
}
console.log('ячеек с S≈0.8:', nHi, 'maxS=', maxS.toFixed(6), 'cell=', maxSi,
  'p=', st.p[maxSi].toFixed(2), 'это ячейка скважины?', maxSi === sim.wells[0].cell || maxSi === sim.wells[1].cell);
// найдем ячейки-соседи зоны front
const S1 = ts.S;
let nHi1 = 0;
for (let i = 0; i < mesh.N; i++) if (S1[i] > 0.8 - 1e-6) nHi1++;
console.log('после шага: ячеек с S≈0.8:', nHi1);
