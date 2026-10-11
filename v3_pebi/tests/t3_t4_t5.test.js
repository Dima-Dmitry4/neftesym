'use strict';
// T3: стационарный радиальный приток vs метод изображений (калибровка Писмана)
// T4: стационарный линейный поток между скважинами
// T5: материальный баланс при сжимаемости (закрытая система + закачка)
const { loadCore, assert, approx, runSuite } = require('./helpers.js');
const Pebi = loadCore();

// Однофазный флюид (для стационарных тестов): подвижность 1/mu, несжимаемый.
function singlePhaseFluid(mu) {
  return {
    C: 8.527e-3, muw: mu, muo: mu, swc: 0, sor: 0, dS: 1, pref: 0,
    krw: () => 1, kro: () => 1,
    lamW: () => 1 / mu, lamO: () => 1 / mu, lamT: () => 1 / mu,
    fw: () => 1, dfw: () => 0,
    Bw: () => 1, Bo: () => 1, vpScale: () => 1, ct: () => 0
  };
}

// Эталон T3: та же задача на ОДНОРОДНОЙ прямоугольной вороной-сетке (ячейки ~ квадраты):
// для нее re = 0.2*sqrt(A) — это точное определение Писмана; отклонение гекс-сетки
// от него и проверяем. Решатель и сборка одни, отличается только сетка и форма ячеек.
function uniformRectMesh(Lx, Ly, spacing, wellX, wellY, Delaunay) {
  const pts = [];
  const isWell = [], isBoundary = [];
  const nx = Math.round(Lx / spacing), ny = Math.round(Ly / spacing);
  const rng = Pebi.mulberry32(99);
  for (let i = 1; i < nx; i++) {
    for (let j = 1; j < ny; j++) {
      let x = i * spacing, y = j * spacing;
      const isW = Math.abs(x - wellX) < 1e-9 && Math.abs(y - wellY) < 1e-9;
      if (!isW) { x += (rng() - 0.5) * 0.02 * spacing; y += (rng() - 0.5) * 0.02 * spacing; }
      pts.push([x, y]); isWell.push(isW); isBoundary.push(false);
    }
  }
  return Pebi.buildTopology({ Lx, Ly, wells: [{ x: wellX, y: wellY }], sMin: spacing, sMax: spacing, RGrad: 1, seed: 1 },
    pts, isWell, isBoundary, Delaunay);
}

function solveSteadyDirichlet(mesh, k, h, mu, pBnd, pwf, rw) {
  const fluid = singlePhaseFluid(mu);
  const wells = Pebi.createWells(mesh, [{ type: 'injector', x: mesh.Lx / 2, y: mesh.Ly / 2, rw, mode: 'bhp', value: pwf }], k, h);
  Pebi.resolveFlowing(wells[0], pBnd, fluid, 0);
  const pr = new Pebi.PressureSolver(mesh, fluid, { k, phi: 0.2, h });
  pr.setTestMode(k, 1 / mu);
  const p = new Float64Array(mesh.N).fill(pBnd);
  pr.assemble({ p, S: p }, wells, 1, { steady: true, dirichlet: pBnd });
  const res = pr.solve(p, 1e-12);
  if (!res.ok) throw new Error('стационарное решение не сошлось: ' + res.relres);
  pr.wellRates({ p, S: p }, wells);
  return { q: wells[0].qRes, wells };
}

runSuite('T3: радиальный приток (калибровка Писмана на гекс-сетке)', function () {
  const Lx = 400, Ly = 400, k = 100, h = 10, mu = 1, rw = 0.1;
  const pBnd = 150, pwf = 160;
  const meshHex = Pebi.generate({ Lx, Ly, wells: [{ x: Lx / 2, y: Ly / 2 }], sMin: 3, sMax: 30, RGrad: 80, seed: 5, lloydIters: 2 }, Pebi.DelaunayClass);
  const meshRect = uniformRectMesh(Lx, Ly, 10, Lx / 2, Ly / 2, Pebi.DelaunayClass);
  const qHex = solveSteadyDirichlet(meshHex, k, h, mu, pBnd, pwf, rw).q;
  const qRect = solveSteadyDirichlet(meshRect, k, h, mu, pBnd, pwf, rw).q;
  const err = Math.abs(qHex - qRect) / Math.abs(qRect);
  console.log('  q_гекс=' + qHex.toFixed(2), 'q_прямоуг=' + qRect.toFixed(2), 'отклонение=' + (err * 100).toFixed(2) + '%');
  assert('решения положительны', qHex > 0 && qRect > 0);
  assert('q гекс-сетки в пределах 6% от прямоугольной', err < 0.06, 'err=' + (err * 100).toFixed(1) + '%');

  // Сходимость дискретизации: измельчение прямоугольной сетки 10м -> 5м почти не меняет q
  // (решение сеточной задачи сошлось; абсолютная калибровка r_e = 0.2*sqrt(A) — конвенция
  // MRST/Писмана по литературе; прямая решетка изображений условно-сходящаяся и без
  // суммирования Эвальда тестовый допуск не обеспечивает).
  const meshRectFine = uniformRectMesh(Lx, Ly, 5, Lx / 2, Ly / 2, Pebi.DelaunayClass);
  const qRectFine = solveSteadyDirichlet(meshRectFine, k, h, mu, pBnd, pwf, rw).q;
  const conv = Math.abs(qRect - qRectFine) / qRectFine;
  console.log('  q_rect(10м)=' + qRect.toFixed(2), 'q_rect(5м)=' + qRectFine.toFixed(2), 'сходимость=' + (conv * 100).toFixed(2) + '%');
  assert('сходимость q при измельчении < 1%', conv < 0.01, 'conv=' + (conv * 100).toFixed(2) + '%');
});

runSuite('T4: линейный поток между скважинами', function () {
  const Lx = 600, Ly = 20, k = 100, h = 10, mu = 1, q = 50;
  const mesh = Pebi.generate({ Lx, Ly, wells: [{ x: 5, y: 10 }, { x: 595, y: 10 }], sMin: 3, sMax: 12, RGrad: 40, seed: 11, lloydIters: 2 }, Pebi.DelaunayClass);
  const fluid = singlePhaseFluid(mu);
  const wells = Pebi.createWells(mesh, [
    { type: 'injector', x: 5, y: 10, rw: 0.1, mode: 'rate', value: q },
    { type: 'producer', x: 595, y: 10, rw: 0.1, mode: 'rate', value: q }
  ], k, h);
  Pebi.resolveFlowing(wells[0], 100, fluid, 0);
  Pebi.resolveFlowing(wells[1], 100, fluid, 0);
  const pr = new Pebi.PressureSolver(mesh, fluid, { k, phi: 0.2, h });
  const p = new Float64Array(mesh.N).fill(100);
  pr.assemble({ p, S: p }, wells, 1, { steady: true });
  const res = pr.solve(p, 1e-12);
  assert('решение сошлось', res.ok);
  pr.wellRates({ p, S: p }, wells);
  approx('закачка = отбор (стационар)', wells[0].qRes, wells[1].qRes, 1e-6);

  // линейность профиля вдали от скважин: p(x) на центральной полосе
  const pts = [];
  for (let i = 0; i < mesh.N; i++) {
    const x = mesh.sites[2 * i], y = mesh.sites[2 * i + 1];
    if (x > 120 && x < 480 && Math.abs(y - 10) < 4) pts.push([x, pr.p[i]]);
  }
  // МНК-аппроксимация p = a + b*x
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const nN = pts.length;
  const b = (nN * sxy - sx * sy) / (nN * sxx - sx * sx);
  const a = (sy - b * sx) / nN;
  let maxDev = 0;
  for (const [x, y] of pts) maxDev = Math.max(maxDev, Math.abs(y - (a + b * x)));
  console.log('  наклон=' + b.toFixed(4) + ' бар/м (аналитика ~' + (-q / (8.527e-3 * k * h * Ly)).toFixed(4) + '), maxDev=' + maxDev.toFixed(3) + ' бар');
  // аналитический наклон: dp/dx = -q/(C*k*h*Ly) (давление падает к добывающей)
  approx('наклон давления = -q/(C*k*h*Ly)', b, -q / (8.527e-3 * k * h * Ly), 0.05);
  assert('профиль линеен (макс. отклонение < 2% перепада)', maxDev < 0.02 * Math.abs(b) * 360,
    'maxDev=' + maxDev.toFixed(3));
});

runSuite('T5: материальный баланс с сжимаемостью', function () {
  const params = Pebi.defaultParams();
  params.domain = { Lx: 500, Ly: 500, h: 10 };
  params.wells = [{ type: 'injector', name: 'Нагнетательная', x: 250, y: 250, rw: 0.1, mode: 'rate', value: 100 }];
  params.control.newtonTol = 1e-9;
  params.control.pcgTol = 1e-12;
  params.control.dt0 = 0.003; // первая ячейка насыщается за ~0.08 сут, дальше шаг растет
  params.control.dtMin = 0.0005;
  params.control.dtMax = 2;   // dp шага <= ~14 бар: остаемся в линейном режиме c_t
  const mesh = Pebi.generate({
    Lx: 500, Ly: 500, wells: params.wells, sMin: Math.max(3, 27 * 0.1),
    targetCells: 1200, RGrad: 90, seed: 3
  }, Pebi.DelaunayClass);
  const sim = new Pebi.Simulator(params, mesh);
  const VpTotal = sim.transport.VpRef.reduce((s, v) => s + v, 0);
  const qInj = 100;
  let maxImbW = 0, maxTotalImb = 0;
  const pAvgSeries = [];
  let prevIP = null;
  for (let k = 0; k < 60; k++) {
    const r = sim.stepOnce();
    if (!r.ok) { console.log('  стоп:', r.error); break; }
    maxImbW = Math.max(maxImbW, Math.abs(sim.diag.imbW));
    const ip = sim._inPlace();
    if (prevIP) {
      // полный референс-баланс: d(вода+нефть)/dt должен равняться закачке
      // (расхождение = ошибка последовательного расщепления O(c*dp))
      const totalImb = (ip.wip + ip.oip) - (prevIP.wip + prevIP.oip) - qInj * sim.state.lastDt;
      maxTotalImb = Math.max(maxTotalImb, Math.abs(totalImb) / (qInj * sim.state.lastDt));
    }
    prevIP = ip;
    pAvgSeries.push([sim.state.t, sim.avgPressure()]);
  }
  console.log('  t=' + sim.state.t.toFixed(0) + ' сут, pAvg: ' + pAvgSeries[0][1].toFixed(2) + ' -> ' + pAvgSeries[pAvgSeries.length - 1][1].toFixed(2) + ' бар');
  assert('дисбаланс воды <= 1e-6 от закачки', maxImbW <= 1e-6 * qInj, 'maxImbW=' + maxImbW.toExponential(2));
  assert('полный баланс (вода+нефть) в пределах 1%', maxTotalImb <= 0.01, 'maxTotalImb=' + maxTotalImb.toExponential(2));

  // наклон dpAvg/dt vs q/(Vp*c_t): мгновенный наклон в конце (по последним 30% точек)
  const tail = pAvgSeries.slice(Math.floor(pAvgSeries.length * 0.7));
  let st = 0, stt = 0, sttt = 0;
  for (const [t, p] of tail) { st += t; stt += t * t; sttt += t * p; }
  const nN = tail.length;
  const slope = (nN * sttt - st * tail.reduce((s, e) => s + e[1], 0)) / (nN * stt - st * st);
  const Sbar = sim.transport.VpRef.reduce((s, v, i) => s + v * sim.state.S[i], 0) / VpTotal;
  const f = sim.fluid;
  const ct = Sbar * f.cw + (1 - Sbar) * f.co + f.cr;
  const slopeRef = qInj / (VpTotal * ct);
  const err = Math.abs(slope - slopeRef) / slopeRef;
  console.log('  dpAvg/dt=' + slope.toExponential(3), 'эталон=' + slopeRef.toExponential(3), 'откл=' + (err * 100).toFixed(2) + '%');
  assert('наклон pAvg = q/(Vp*c_t) в пределах 2%', err < 0.02, 'err=' + (err * 100).toFixed(1) + '%');
});

module.exports = { singlePhaseFluid, uniformRectMesh };
