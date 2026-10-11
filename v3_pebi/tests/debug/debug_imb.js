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

// перехват commit для контроля
const origCommit = sim.commit.bind(sim);
let lastStepInfo = null;
sim.commit = function (pNew, SNew, dt, info) {
  origCommit(pNew, SNew, dt, info);
  lastStepInfo = { dt, imbW: sim.diag.imbW, imbO: sim.diag.imbO, t: sim.state.t };
  if (Math.abs(sim.diag.imbW) > 1) {
    const st = sim.state, fluid = sim.fluid;
    // воспроизвести невязку последнего шага
    const n = mesh.N;
    let worst = [];
    // пересчет WIP-компонент
    const ipNow = sim._inPlace();
    console.log('  imbW=' + sim.diag.imbW.toFixed(2), 'dt=' + dt, 't=' + sim.state.t.toFixed(1),
      'inj=' + sim.wells.filter(w => w.type === 'injector')[0].qws.toFixed(2),
      'prodW=' + sim.wells.filter(w => w.type === 'producer')[0].qws.toFixed(4),
      'WIP=' + ipNow.wip.toFixed(1));
    // где S у границы
    let nHi = 0, nLo = 0;
    for (let i = 0; i < n; i++) {
      if (st.S[i] > 0.8 - 1e-6) nHi++;
      if (st.S[i] < 0.2 + 1e-6) nLo++;
    }
    console.log('  ячеек у hi:', nHi, 'у lo:', nLo);
    // топ-вклад в дисбаланс: сравнить R-уровни
    const tr = sim.transport;
    const R = new Float64Array(n);
    const fluid2 = fluid;
    for (let i = 0; i < n; i++) R[i] = (tr.VpNew[i] * st.S[i] / fluid2.Bw(st.p[i]) - tr.accum0[i]) / dt;
    for (let f = 0; f < mesh.F; f++) {
      const vv = tr.vFace[f]; if (vv === 0) continue;
      const ia = mesh.faceA[f], ib = mesh.faceB[f];
      const up = tr.fUp[f] === 0 ? ia : ib;
      const Fo = vv * fluid2.fw(st.S[up]) / fluid2.Bw(st.p[up]);
      R[ia] += Fo; R[ib] -= Fo;
    }
    for (const src of tr.wellSrc) {
      if (src.type === 'injector') R[src.cell] -= src.qRes / fluid2.Bw(st.p[src.cell]);
      else R[src.cell] += fluid2.fw(st.S[src.cell]) * src.qRes / fluid2.Bw(st.p[src.cell]);
    }
    let sum = 0, maxR = 0, maxI = -1;
    for (let i = 0; i < n; i++) { sum += R[i]; if (Math.abs(R[i]) > maxR) { maxR = Math.abs(R[i]); maxI = i; } }
    console.log('  пересчет: sum(R)=' + sum.toFixed(4), 'max|R|=' + maxR.toExponential(2), 'cell=' + maxI,
      'S=' + st.S[maxI].toFixed(6), 'p=' + st.p[maxI].toFixed(2));
  }
};

let steps = 0;
for (let k = 0; k < 35; k++) {
  const r = sim.stepOnce();
  if (!r.ok) { console.log('стоп:', r.error); break; }
  steps++;
}
console.log('steps:', steps, 't:', sim.state.t.toFixed(1), 'lastDt:', sim.state.lastDt);
const H = sim.history, last = H.t.length - 1;
console.log('q_inj:', H.qinj[last].toFixed(2), 'p_avg:', H.pavg[last].toFixed(2));
console.log('imbW history (последние 10):');
for (let k = Math.max(0, H.t.length - 10); k < H.t.length; k++) {
  console.log('  t=' + H.t[k].toFixed(1), 'dt=' + H.dt[k], 'imbW=' + H.imbW[k].toFixed(3), 'qinj=' + H.qinj[k].toFixed(2));
}
