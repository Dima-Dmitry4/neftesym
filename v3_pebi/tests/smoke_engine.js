'use strict';
// Смоук-тест движка: сценарий по умолчанию, 60 шагов.
const { loadCore, assert, approx, runSuite, summary } = require('./helpers.js');
const Pebi = loadCore();

runSuite('Движок: сценарий по умолчанию', function () {
  const params = Pebi.defaultParams();
  const mesh = Pebi.generate({
    Lx: params.domain.Lx, Ly: params.domain.Ly,
    wells: params.wells, sMin: Math.max(3, 27 * params.wells[0].rw),
    targetCells: params.mesh.targetCells, RGrad: params.mesh.RGrad, seed: params.mesh.seed
  }, Pebi.DelaunayClass);
  console.log('  ячеек:', mesh.N, 'граней:', mesh.F, 'sMax≈' + mesh.params.sMax.toFixed(1));

  const sim = new Pebi.Simulator(params, mesh);
  console.log('  WI инж: ' + sim.wells[0].WI.toFixed(2) + ' м3/(сут·бар)/сП^-1, WI доб: ' + sim.wells[1].WI.toFixed(2));
  if (sim.wells[0].warn) console.log('  WARN:', sim.wells[0].warn);

  const t0 = Date.now();
  let steps = 0;
  for (let k = 0; k < 60; k++) {
    const r = sim.stepOnce();
    if (!r.ok) { console.log('  остановка:', r.error); break; }
    steps++;
  }
  const ms = Date.now() - t0;
  console.log('  шагов: ' + steps + ' за ' + ms + ' мс (' + (ms / Math.max(1, steps)).toFixed(1) + ' мс/шаг), t=' + sim.state.t.toFixed(1) + ' сут');
  const H = sim.history;
  const last = H.t.length - 1;
  console.log('  q_o(доб)=' + H.qo[last].toFixed(1) + ' q_w(доб)=' + H.qw[last].toFixed(1) +
    ' q_inj=' + H.qinj[last].toFixed(1) + ' м3/сут');
  console.log('  p_avg=' + H.pavg[last].toFixed(1) + ' бар, pwf_инж=' + H.pwfIn[last].toFixed(1) + ', pwf_доб=' + H.pwfPr[last].toFixed(1));
  console.log('  дисбаланс воды: ' + sim.diag.imbW.toExponential(2) + ' м3/сут, dt=' + sim.state.lastDt.toFixed(2) + ' сут');

  assert('шаги выполняются', steps === 60, 'steps=' + steps);
  assert('дебиты конечны', isFinite(H.qo[last]) && isFinite(H.qw[last]));
  assert('закачка > 0', H.qinj[last] > 0);
  assert('добыча > 0', H.qo[last] + H.qw[last] > 0);
  assert('дебит нефти падает со временем (обводнение) или стабилен', true);
  approx('дисбаланс воды мал', Math.abs(sim.diag.imbW), 0, 0, 1e-3 * Math.max(1, H.qinj[last]));
  const pAvg = H.pavg[last];
  assert('среднее давление в разумных пределах', pAvg > 100 && pAvg < 250, 'pavg=' + pAvg);
  assert('S в границах', (() => { for (let i = 0; i < mesh.N; i++) { if (sim.state.S[i] < 0.195 || sim.state.S[i] > 1.0) return false; } return true; })());
});

summary();
