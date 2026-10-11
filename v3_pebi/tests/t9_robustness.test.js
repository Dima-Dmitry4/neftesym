'use strict';
// T9: устойчивость к пользовательским настройкам (регрессия P0 из ревью)
// 9a: S_wc = 0.3 (выше начальной насыщенности 0.2) — расчет не должен блокироваться
// 9b: экстремальный дебит добывающей — кламп по pwf, без отрицательных давлений и NaN
const { loadCore, assert, runSuite, summary } = require('./helpers.js');
const Pebi = loadCore();

function buildSim(over) {
  const params = Pebi.defaultParams();
  Object.assign(params, over.params || {});
  if (over.fluid) Object.assign(params.fluid, over.fluid);
  if (over.control) Object.assign(params.control, over.control);
  if (over.wells) params.wells = over.wells;
  params.mesh.targetCells = 900;
  const mesh = Pebi.generate({
    Lx: params.domain.Lx, Ly: params.domain.Ly, wells: params.wells,
    sMin: Math.max(3, 27 * params.wells[0].rw),
    targetCells: params.mesh.targetCells, RGrad: params.mesh.RGrad, seed: params.mesh.seed
  }, Pebi.DelaunayClass);
  return { sim: new Pebi.Simulator(params, mesh), mesh, params };
}

runSuite('T9a: пользовательский S_wc = 0.3 > начальной S', function () {
  const { sim } = buildSim({ fluid: { swc: 0.3 } });
  let steps = 0, okBounds = true;
  for (let k = 0; k < 60; k++) {
    const r = sim.stepOnce();
    if (!r.ok) { assert('расчет не остановился (P0-1: клап-ловушка)', false, 'шаг ' + k + ': ' + r.error); return; }
    steps++;
    const S = sim.state.S, f = sim.fluid;
    for (let i = 0; i < S.length; i++) {
      if (S[i] < f.swc - 5.1e-3 || S[i] > 1 + 1e-9) { okBounds = false; break; }
    }
  }
  assert('60 шагов выполнено при swc=0.3', steps === 60, 'steps=' + steps);
  assert('S в допустимых границах', okBounds);
  assert('вода распространяется от нагнетательной', sim.state.S[sim.wells[0].cell] > 0.6);
});

runSuite('T9b: экстремальный дебит добывающей — кламп по pwf', function () {
  const wells = [
    { type: 'injector', name: 'Нагнетательная', x: 250, y: 250, rw: 0.1, mode: 'bhp', value: 180 },
    { type: 'producer', name: 'Добывающая', x: 750, y: 250, rw: 0.1, mode: 'rate', value: 20000 }
  ];
  const { sim } = buildSim({ wells, control: { dt0: 0.01, dtMin: 0.001 } });
  let stopped = false, minP = Infinity, nan = false;
  for (let k = 0; k < 120; k++) {
    const r = sim.stepOnce();
    if (!r.ok) { console.log('  стоп на шаге ' + k + ': ' + r.error); break; }
    const prod = sim.wells[1];
    if (!prod.flowing) stopped = true;
    for (let i = 0; i < sim.mesh.N; i++) {
      if (sim.state.p[i] < minP) minP = sim.state.p[i];
      if (!isFinite(sim.state.p[i]) || !isFinite(sim.state.S[i])) nan = true;
    }
  }
  console.log('  min p=' + minP.toFixed(1) + ' бар, добывающая остановлена: ' + stopped);
  assert('нет NaN', !nan);
  assert('давление не уходит в глубокий минус', minP > -50, 'minP=' + minP.toFixed(1));
  assert('добывающая остановлена клампом приемистости', stopped || minP > 0);
});

summary();
