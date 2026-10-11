'use strict';
const { loadCore } = require('./helpers.js');
const Pebi = loadCore();

const params = Pebi.defaultParams();
params.mesh.targetCells = 400;
const mesh = Pebi.generate({
  Lx: params.domain.Lx, Ly: params.domain.Ly, wells: params.wells,
  sMin: 3, targetCells: params.mesh.targetCells, RGrad: params.mesh.RGrad, seed: params.mesh.seed
}, Pebi.DelaunayClass);
const sim = new Pebi.Simulator(params, mesh);
const origCommit = sim.commit.bind(sim);
let n = 0;
sim.commit = function (pNew, SNew, dt, info) {
  const tr = sim.transport;
  let accumSum = 0;
  for (let i = 0; i < mesh.N; i++) accumSum += tr.accum0[i];
  const refBefore = sim._inPlaceRef.wip;
  const wipPre = sim._inPlace().wip; // состояние до commit = S0/p0
  origCommit(pNew, SNew, dt, info);
  const ip = sim._inPlace();
  const inj = sim.wells.filter(w => w.type === 'injector')[0];
  const prod = sim.wells.filter(w => w.type === 'producer')[0];
  console.log(
    '#' + (++n),
    'dt=' + dt,
    't=' + sim.state.t.toFixed(3),
    'W0ref=' + refBefore.toFixed(3),
    'W0accum=' + accumSum.toFixed(3),
    'diff=' + (refBefore - accumSum).toExponential(2),
    'WIP=' + ip.wip.toFixed(3),
    'dWIP/dt=' + ((ip.wip - refBefore) / dt).toFixed(3),
    'inj=' + (inj.flowing ? inj.qws : 0).toFixed(3),
    'prodW=' + (prod.flowing ? prod.qws : 0).toFixed(4),
    'imbW=' + sim.diag.imbW.toExponential(2)
  );
};
for (let k = 0; k < 8; k++) {
  const r = sim.stepOnce();
  if (!r.ok) { console.log('стоп:', r.error); break; }
}
