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
let retries = 0;
for (let k = 0; k < 600; k++) {
  const r0 = sim.stepOnce();
  if (!r0.ok) { console.log('стоп:', r0.error); break; }
  // stepOnce делает все ретраи внутри; оценим нагрузку по времени шага
  if (k % 40 === 0) {
    const H = sim.history, last = H.t.length - 1;
    console.log('k=' + k, 't=' + sim.state.t.toFixed(0), 'dt=' + sim.state.dtCurrent.toPrecision(3),
      'ms=' + sim.diag.ms.toFixed(0), 'newton=' + sim.diag.newtonIters,
      'qinj=' + H.qinj[last].toFixed(0), 'qw=' + H.qw[last].toFixed(1), 'wcut=' + (H.qo[last] + H.qw[last] > 0 ? (H.qw[last] / (H.qo[last] + H.qw[last])).toFixed(3) : '0'));
  }
}
console.log('финал: t=' + sim.state.t.toFixed(0), 'dt=' + sim.state.dtCurrent.toPrecision(3));
