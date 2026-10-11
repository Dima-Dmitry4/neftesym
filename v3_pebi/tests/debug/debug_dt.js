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
for (let k = 0; k < 300; k++) {
  const r = sim.stepOnce();
  if (!r.ok) { console.log('стоп:', r.error); break; }
  if (k % 20 === 0 || sim.diag.lastRetry) {
    console.log('k=' + k, 't=' + sim.state.t.toFixed(1), 'dt=' + sim.state.lastDt.toPrecision(3),
      'maxDS=' + sim.diag.maxDS.toPrecision(3), 'retry=' + (sim.diag.lastRetry || '-'),
      'newton=' + sim.diag.newtonIters, 'outer=' + (sim.diag.outerIters || 1), 'ms=' + sim.diag.ms.toFixed(0));
    sim.diag.lastRetry = null;
  }
}
console.log('конец: t=' + sim.state.t.toFixed(1), 'dt=' + sim.state.dtCurrent.toPrecision(3));
