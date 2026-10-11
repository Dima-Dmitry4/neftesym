'use strict';
// T6: Бакли-Леверетт (1D-цепочка гексов vs Вельге; 2D-полоса — качественно)
// T7: монотонность насыщенности
// T8: регрессия (детерминизм + снапшот)
const fs = require('fs');
const path = require('path');
const { loadCore, assert, approx, runSuite } = require('./helpers.js');
const Pebi = loadCore();

// ОФП и дробный поток сценария по умолчанию (несжимаемый предел для T6)
function makeIncompressibleFluid(over) {
  const f = Pebi.createFluid(Object.assign({ cw: 0, co: 0, cr: 0 }, over || {}));
  return f;
}

// Построение 1D-цепочки из двух рядов сгенерированных вручную точек (Вороной = цепочка гексов)
function buildChain(Lx, Ly, spacing) {
  const pts = [];
  const isWell = [], isBoundary = [];
  pts.push([0.5 * spacing, Ly / 2]); isWell.push(true); isBoundary.push(false); // инжектор
  pts.push([Lx - 0.5 * spacing, Ly / 2]); isWell.push(true); isBoundary.push(false); // добыча
  const y1 = Ly * 0.25, y2 = Ly * 0.75;
  for (let x = spacing; x < Lx; x += spacing) { pts.push([x, y1]); isWell.push(false); isBoundary.push(false); }
  for (let x = 2 * spacing; x < Lx; x += spacing) { pts.push([x, y2]); isWell.push(false); isBoundary.push(false); }
  return Pebi.buildTopology({ Lx, Ly, wells: [pts[0], pts[1]], sMin: spacing, sMax: spacing, RGrad: 1, seed: 1 },
    pts, isWell, isBoundary, Pebi.DelaunayClass);
}

function welgeShock(f) {
  // f'(S_f) = f(S_f)/(S_f - swc): бисекция по [swc+eps, 1-sor-eps]
  const swc = f.swc, sor = f.sor;
  const g = (S) => f.dfw(S) - f.fw(S) / (S - swc);
  let lo = swc + 1e-6, hi = 1 - sor - 1e-6;
  for (let it = 0; it < 80; it++) {
    const mid = 0.5 * (lo + hi);
    if (g(mid) > 0) lo = mid; else hi = mid;
  }
  const Sf = 0.5 * (lo + hi);
  return { Sf, fw: f.fw(Sf), slope: f.dfw(Sf) };
}

runSuite('T6a: Бакли-Леверетт на 1D-цепочке (Вельге)', function () {
  const Lx = 400, Ly = 3.2, spacing = 2, h = 10, qRate = 10;
  const mesh = buildChain(Lx, Ly, spacing);
  assert('цепочка построена', mesh.N > 350, 'N=' + mesh.N);
  const fluid = makeIncompressibleFluid();
  const params = Pebi.defaultParams();
  params.domain = { Lx, Ly, h };
  params.wells = [
    { type: 'injector', x: 0.5 * spacing, y: Ly / 2, rw: 0.1, mode: 'rate', value: qRate },
    { type: 'producer', x: Lx - 0.5 * spacing, y: Ly / 2, rw: 0.1, mode: 'rate', value: qRate }
  ];
  params.control.newtonTol = 1e-9;
  params.control.dt0 = 1;
  params.control.dtMax = 1;   // фиксируем шаг: точное сравнение времени
  params.control.dtMin = 0.25;
  params.control.dSMax = 1.0; // ячейки цепочки крошечные (Vp ~ 6 м3) — допустим крупный dS (схема неявная)
  const sim = new Pebi.Simulator(params, mesh);
  const st = sim.state;
  const A = h * Ly, porePerM = 0.2 * A;
  const { Sf, slope } = welgeShock(fluid);
  console.log('  S_f=' + Sf.toFixed(4), "f'(S_f)=" + slope.toFixed(4), 'ячеек=' + mesh.N);

  const Lpath = Lx - spacing;
  const tBreak = Lpath * porePerM / (qRate * slope);
  console.log('  аналитический t прорыва=' + tBreak.toFixed(1) + ' сут');

  function frontX() {
    // середина размазанного скачка: S >= 0.5*S_f
    let xf = 0;
    for (let i = 0; i < mesh.N; i++) {
      if (st.S[i] > 0.5 * Sf) xf = Math.max(xf, mesh.sites[2 * i]);
    }
    return xf;
  }
  function simWaterCut() {
    const prod = sim.wells[1];
    const liq = prod.qws + prod.qos;
    return liq > 0 ? prod.qws / liq : 0;
  }
  function runTo(tTarget) {
    while (st.t < tTarget - 1e-9) {
      const r = sim.stepOnce();
      if (!r.ok) throw new Error('шаг не сошелся: ' + r.error);
    }
  }
  function checkBounds(tag) {
    for (let i = 0; i < mesh.N; i++) {
      // низ допускает кламп-запас (line search), верх — 1
      if (!(st.S[i] >= fluid.swc - 5.1e-3 && st.S[i] <= 1 + 1e-9)) {
        assert(tag + ': S в границах', false, 'S[' + i + ']=' + st.S[i]);
        return;
      }
    }
    assert(tag + ': S в границах', true);
  }

  // фронт до прорыва
  runTo(60); checkBounds('t=60');
  {
    const xInj = 0.5 * spacing;
    const xfA = xInj + (qRate * 60 / porePerM) * slope;
    const xfS = frontX();
    console.log('  t=60: фронт сим=' + xfS.toFixed(1) + ' аналит=' + xfA.toFixed(1));
    approx('фронт t=60', xfS, xfA, 0.05, 6);
  }
  runTo(tBreak * 0.9); checkBounds('t=0.9bt');
  {
    const simWC = simWaterCut();
    assert('до прорыва обводненность = 0', simWC < 0.02, 'wcut=' + simWC);
  }
  // обводненность после прорыва (Вельге): f'(S_prod) = L*A*phi/W_i
  for (const tm of [tBreak * 1.3, tBreak * 2]) {
    runTo(tm); checkBounds('t=' + tm.toFixed(0));
    const Wi = qRate * st.t;
    const dS = Lpath * porePerM / Wi;
    // инвертируем f'(S) = dS (монотонно убывает при S > S_f)
    let lo = Sf, hi = 1 - fluid.sor;
    for (let it = 0; it < 80; it++) {
      const mid = 0.5 * (lo + hi);
      if (fluid.dfw(mid) > dS) lo = mid; else hi = mid;
    }
    const Sprod = 0.5 * (lo + hi);
    const fwA = fluid.fw(Sprod);
    const simWC = simWaterCut();
    console.log('  t=' + tm.toFixed(0) + ': обводн. сим=' + simWC.toFixed(4), 'Вельге=' + fwA.toFixed(4));
    assert('обводненность t=' + tm.toFixed(0) + ' (Вельге, L1<0.05)', Math.abs(simWC - fwA) < 0.05,
      'sim=' + simWC.toFixed(4) + ' ref=' + fwA.toFixed(4));
  }
});

runSuite('T6b/T7: 2D-полоса — охват и монотонность', function () {
  const params = Pebi.defaultParams();
  params.domain = { Lx: 600, Ly: 150, h: 10 };
  params.wells = [
    { type: 'injector', x: 60, y: 75, rw: 0.1, mode: 'rate', value: 30 },
    { type: 'producer', x: 540, y: 75, rw: 0.1, mode: 'rate', value: 30 }
  ];
  params.control.dtMax = 30;
  const mesh = Pebi.generate({
    Lx: 600, Ly: 150, wells: params.wells, sMin: 3,
    targetCells: 900, RGrad: 60, seed: 9
  }, Pebi.DelaunayClass);
  const fluid = makeIncompressibleFluid();
  const sim = new Pebi.Simulator(params, mesh);
  const f = fluid;
  const { slope } = welgeShock(f);
  const pvTotal = sim.transport.VpRef.reduce((s, v) => s + v, 0);
  const pv1d = 1 / slope; // 1D-прорыв в долях порового объема
  let pvBt2d = -1, maxImb = 0, okBounds = true;
  for (let k = 0; k < 600; k++) {
    const r = sim.stepOnce();
    if (!r.ok) { console.log('  стоп:', r.error); break; }
    maxImb = Math.max(maxImb, Math.abs(sim.diag.imbW));
    const prod = sim.wells[1];
    const liq = prod.qws + prod.qos;
    for (let i = 0; i < mesh.N; i++) {
      if (sim.state.S[i] < f.swc - 5.1e-3 || sim.state.S[i] > 1 + 1e-9) { okBounds = false; break; }
    }
    if (pvBt2d < 0 && liq > 0 && prod.qws / liq > 0.02) {
      pvBt2d = sim.cums.Wi / pvTotal;
      break;
    }
  }
  console.log('  PV прорыва: 1D=' + pv1d.toFixed(3), '2D=' + pvBt2d.toFixed(3));
  assert('T7: S в границах на всех шагах', okBounds);
  assert('T7: материальный баланс', maxImb <= 1e-5 * 30, 'imb=' + maxImb.toExponential(2));
  // В ограниченном 2D центральная стримлиния быстрее средней — прорыв РАНЬШЕ 1D;
  // проверяем разумный диапазон и монотонный рост обводненности.
  assert('T6b: PV прорыва в разумном диапазоне', pvBt2d > 0.15 && pvBt2d < pv1d, 'pv2d=' + pvBt2d);
  const H = sim.history;
  let mono = true;
  for (let i = 2; i < H.wcut.length; i++) {
    if (H.wcut[i] < H.wcut[i - 1] - 1e-4) { mono = false; break; }
  }
  assert('T6b: обводненность растет монотонно', mono);
});

runSuite('T8: регрессия (детерминизм + снапшот)', function () {
  function runOnce() {
    const params = Pebi.defaultParams();
    params.mesh.targetCells = 1200;
    const mesh = Pebi.generate({
      Lx: params.domain.Lx, Ly: params.domain.Ly, wells: params.wells,
      sMin: Math.max(3, 27 * params.wells[0].rw),
      targetCells: params.mesh.targetCells, RGrad: params.mesh.RGrad, seed: params.mesh.seed
    }, Pebi.DelaunayClass);
    const sim = new Pebi.Simulator(params, mesh);
    // смена режима скважины на лету (проверка управления)
    for (let k = 0; k < 40; k++) {
      if (k === 20) sim.setWellControl(0, 'rate', 150); // нагнетательная -> приемистость
      const r = sim.stepOnce();
      if (!r.ok) throw new Error('стоп: ' + r.error);
    }
    const H = sim.history;
    return {
      t: H.t.slice(), qo: H.qo.slice(), qw: H.qw.slice(), qinj: H.qinj.slice(),
      pavg: H.pavg.slice(), pwfIn: H.pwfIn.slice()
    };
  }
  const a = runOnce(), b = runOnce();
  let identical = true;
  for (const key of Object.keys(a)) {
    if (a[key].length !== b[key].length) { identical = false; break; }
    for (let i = 0; i < a[key].length; i++) {
      if (Math.abs(a[key][i] - b[key][i]) > 1e-9 * Math.max(1, Math.abs(a[key][i]))) { identical = false; }
    }
  }
  assert('два прогона идентичны (вкл. смену режима на лету)', identical);

  // снапшот
  const snapPath = path.join(__dirname, 'snapshot.json');
  const snap = { t: a.t[a.t.length - 1], qo: a.qo[a.qo.length - 1], qw: a.qw[a.qw.length - 1], qinj: a.qinj[a.qinj.length - 1], pavg: a.pavg[a.pavg.length - 1] };
  if (process.env.UPDATE_SNAPSHOT) {
    fs.writeFileSync(snapPath, JSON.stringify(snap, null, 2));
    console.log('  снапшот обновлен:', JSON.stringify(snap));
    assert('снапшот записан', true);
  } else if (fs.existsSync(snapPath)) {
    const ref = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    let ok = true;
    for (const key of Object.keys(snap)) {
      if (Math.abs(snap[key] - ref[key]) > 1e-9 * Math.max(1, Math.abs(ref[key]))) ok = false;
    }
    assert('снапшот совпадает', ok, JSON.stringify(snap) + ' vs ' + JSON.stringify(ref));
  } else {
    fs.writeFileSync(snapPath, JSON.stringify(snap, null, 2));
    console.log('  снапшот создан:', JSON.stringify(snap));
    assert('снапшот создан при первом запуске', true);
  }
});
