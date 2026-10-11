'use strict';
const Del = require('../vendor/d3-delaunay.min.js');
const Pebi = { Mesh: require('../js/core/mesh.js') };

for (const rf of [0.92, 0.6, 0.5, 0.45, 0.4]) {
  const m = Pebi.Mesh.generate({
    Lx: 1000, Ly: 500,
    wells: [{ x: 250, y: 250 }, { x: 750, y: 250 }],
    sMin: 3, sMax: 40, RGrad: 130, seed: 42, lloydIters: 2, rhoFactor: rf
  }, Del.Delaunay);
  let area = 0;
  for (let i = 0; i < m.N; i++) area += m.cellArea[i];
  const adj = Array.from({ length: m.N }, () => []);
  for (let f = 0; f < m.F; f++) { adj[m.faceA[f]].push(m.faceB[f]); adj[m.faceB[f]].push(m.faceA[f]); }
  const seen = new Uint8Array(m.N); const st = [0]; seen[0] = 1; let cnt = 1;
  while (st.length) { const c = st.pop(); for (const nb of adj[c]) if (!seen[nb]) { seen[nb] = 1; cnt++; st.push(nb); } }
  const d = (i) => Math.min(Math.hypot(m.sites[2 * i] - 250, m.sites[2 * i + 1] - 250), Math.hypot(m.sites[2 * i] - 750, m.sites[2 * i + 1] - 250));
  let nearA = 0, nearN = 0, farA = 0, farN = 0, minA = 1e9;
  for (let i = 0; i < m.N; i++) {
    if (m.cellArea[i] < minA) minA = m.cellArea[i];
    if (d(i) < 50) { nearA += m.cellArea[i]; nearN++; }
    else if (d(i) > 250) { farA += m.cellArea[i]; farN++; }
  }
  console.log(
    'rf=' + rf,
    'cells=' + m.N,
    'faces=' + m.F,
    'conn=' + cnt + '/' + m.N,
    'areaErr=' + (Math.abs(area - 500000) / 500000).toExponential(1),
    'nearA=' + (nearA / nearN).toFixed(1),
    'farA=' + (farA / farN).toFixed(1),
    'minA=' + minA.toFixed(1)
  );
}
