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
  if (!r.ok) break;
}
const dt = st.dtCurrent;
const CI = 2773;
sim.wells.forEach((w, i) => { w.mode = sim.controls[i].mode; w.value = sim.controls[i].value; Pebi.resolveFlowing(w, st.p[w.cell], sim.fluid, st.S[w.cell]); });
const pr = sim.pressure;
pr.assemble(st, sim.wells, dt, {});
pr.solve(st.p, params.control.pcgTol);
pr.wellRates(st, sim.wells);
const v = pr.fluxes(st);
const tr = sim.transport;
tr.prepare(st, pr.p, v, sim.wells);
const fluid = sim.fluid;

console.log('dt=', dt);
console.log('cell', CI, ': S0=', st.S[CI].toFixed(12), 'p0=', st.p[CI].toFixed(4), 'p1=', pr.p[CI].toFixed(4));
console.log('  VpRef=', tr.VpRef[CI].toFixed(4), 'VpNew=', tr.VpNew[CI].toFixed(4), 'VpOld=', tr.VpOld[CI].toFixed(4));
console.log('  BwNew=', tr.BwNew[CI].toFixed(8), 'Bw(p0)=', fluid.Bw(st.p[CI]).toFixed(8));
console.log('  accum0=', tr.accum0[CI].toFixed(6), ' VpNew*S0/BwNew=', (tr.VpNew[CI] * st.S[CI] / tr.BwNew[CI]).toFixed(6));
console.log('  accum-член R=', ((tr.VpNew[CI] * st.S[CI] / tr.BwNew[CI] - tr.accum0[CI]) / dt).toExponential(4));
// грани
let sumFace = 0;
for (let f = 0; f < mesh.F; f++) {
  const ia = mesh.faceA[f], ib = mesh.faceB[f];
  let other = -1, sign = 0;
  if (ia === CI) { other = ib; sign = 1; } else if (ib === CI) { other = ia; sign = -1; } else continue;
  const vv = v[f] * sign;
  const up = tr.fUp[f] === 0 ? mesh.faceA[f] : mesh.faceB[f];
  const Fo = vv * fluid.fw(st.S[up]) / fluid.Bw(pr.p[up]); // >0: отток из CI
  console.log('  face->', other, 'v=', vv.toFixed(5), 'S_up=', st.S[up].toFixed(6), 'fw_up=', fluid.fw(st.S[up]).toFixed(6), 'F=', Fo.toExponential(4), 'p_oth=', pr.p[other].toFixed(2));
  sumFace += Fo;
}
console.log('  sumFace (отток-приток)=', sumFace.toExponential(4));
// скважины в этой ячейке?
for (const src of tr.wellSrc) if (src.cell === CI) console.log('  wellSrc!', src);
console.log('  wellSrc cells:', tr.wellSrc.map(s => s.cell).join(','));
console.log('  соседи:', Array.from(mesh.delaunay.neighbors(CI)).join(','));
