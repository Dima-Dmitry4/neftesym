'use strict';
const Del = require('../vendor/d3-delaunay.min.js');
const Pebi = { Mesh: require('../js/core/mesh.js') };

console.time('mesh');
const m = Pebi.Mesh.generate({
  Lx: 1000, Ly: 500,
  wells: [{ x: 250, y: 250 }, { x: 750, y: 250 }],
  sMin: 3, sMax: 40, RGrad: 130, seed: 42, lloydIters: 2
}, Del.Delaunay);
console.timeEnd('mesh');

let area = 0, minA = 1e9, maxA = 0;
for (let i = 0; i < m.N; i++) {
  area += m.cellArea[i];
  if (m.cellArea[i] < minA) minA = m.cellArea[i];
  if (m.cellArea[i] > maxA) maxA = m.cellArea[i];
}
console.log('cells:', m.N, 'faces:', m.F, 'bfaces:', m.Fb, 'skippedEdges:', m.skippedEdges);
console.log('area sum rel.err:', Math.abs(area - 500000) / 500000);
console.log('min/max cell area:', minA.toFixed(2), maxA.toFixed(2));

let maxErr = 0;
function len(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }
for (let f = 0; f < m.F; f++) {
  const i = m.faceA[f], j = m.faceB[f];
  const xi = m.sites[2 * i], yi = m.sites[2 * i + 1], xj = m.sites[2 * j], yj = m.sites[2 * j + 1];
  const ax = m.faceNodes[4 * f], ay = m.faceNodes[4 * f + 1], bx = m.faceNodes[4 * f + 2], by = m.faceNodes[4 * f + 3];
  const dij = Math.hypot(xj - xi, yj - yi);
  const d1 = Math.hypot(ax - xi, ay - yi), d2 = Math.hypot(ax - xj, ay - yj);
  const d3 = Math.hypot(bx - xi, by - yi), d4 = Math.hypot(bx - xj, by - yj);
  maxErr = Math.max(maxErr, Math.abs(d1 - d2) / dij, Math.abs(d3 - d4) / dij);
}
console.log('max bisector err (rel):', maxErr.toExponential(2));

const adj = Array.from({ length: m.N }, () => []);
for (let f = 0; f < m.F; f++) { adj[m.faceA[f]].push(m.faceB[f]); adj[m.faceB[f]].push(m.faceA[f]); }
const seen = new Uint8Array(m.N); const st = [0]; seen[0] = 1; let cnt = 1;
while (st.length) { const c = st.pop(); for (const nb of adj[c]) if (!seen[nb]) { seen[nb] = 1; cnt++; st.push(nb); } }
console.log('connectivity:', cnt, '/', m.N);

const d = (i) => Math.min(Math.hypot(m.sites[2 * i] - 250, m.sites[2 * i + 1] - 250), Math.hypot(m.sites[2 * i] - 750, m.sites[2 * i + 1] - 250));
let nearA = 0, nearN = 0, farA = 0, farN = 0;
for (let i = 0; i < m.N; i++) {
  if (d(i) < 60) { nearA += m.cellArea[i]; nearN++; }
  else if (d(i) > 250) { farA += m.cellArea[i]; farN++; }
}
console.log('near-well avg area:', (nearA / nearN).toFixed(2), 'far avg area:', (farA / farN).toFixed(2));

// детерминизм
const m2 = Pebi.Mesh.generate({ Lx: 1000, Ly: 500, wells: [{ x: 250, y: 250 }, { x: 750, y: 250 }], sMin: 3, sMax: 40, RGrad: 130, seed: 42, lloydIters: 2 }, Del.Delaunay);
let same = m2.N === m.N;
if (same) for (let i = 0; i < m.N && same; i++) same = m.cellArea[i] === m2.cellArea[i];
console.log('determinism (same seed):', same);
