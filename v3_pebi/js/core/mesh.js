/* Неструктурированная вороной-сетка с градацией к скважинам (d3-delaunay).
   Точки: seeded dart-throwing + Ллойд; грани — из cellPolygon с классификацией
   по циркумцентрам; вороной-грани лежат на серединных перпендикулярах (K-ортогональность). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.Pebi = root.Pebi || {}; Object.assign(root.Pebi, api); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Локальный шаг сетки: мелко у скважин, крупно вдали.
  function makeSpacing(p) {
    var wells = p.wells, sMin = p.sMin, sMax = p.sMax, R = p.RGrad;
    return function (x, y) {
      var d = Infinity;
      for (var w = 0; w < wells.length; w++) {
        var dx = x - wells[w].x, dy = y - wells[w].y;
        var dd = Math.sqrt(dx * dx + dy * dy);
        if (dd < d) d = dd;
      }
      var t = d / R;
      if (t > 1) t = 1;
      var g = t * t * (3 - 2 * t);
      return sMin + (sMax - sMin) * g;
    };
  }

  // Генерация точек (скважины + граница + внутренние дарты). countOnly — без Ллойда и топологии.
  function generatePoints(p, Delaunay, countOnly) {
    var Lx = p.Lx, Ly = p.Ly;
    var rng = mulberry32(p.seed >>> 0);
    var s = makeSpacing(p);
    var pts = [];
    var isWell = [], isBoundary = [];
    var i, w;

    for (w = 0; w < p.wells.length; w++) {
      pts.push([p.wells[w].x, p.wells[w].y]);
      isWell.push(true); isBoundary.push(false);
    }

    // Точки вдоль границы: марш по периметру с локальным шагом, микросдвиг внутрь
    // (защита от вырожденных треугольников на collinear-наборах).
    var epsN = 1e-4 * p.sMin;
    var sides = [
      [[0, 0], [Lx, 0], [0, 1]],
      [[Lx, 0], [Lx, Ly], [-1, 0]],
      [[Lx, Ly], [0, Ly], [0, -1]],
      [[0, Ly], [0, 0], [1, 0]]
    ];
    for (var sd = 0; sd < 4; sd++) {
      var A = sides[sd][0], B = sides[sd][1], N = sides[sd][2];
      var len = Math.hypot(B[0] - A[0], B[1] - A[1]);
      var pos = 0;
      pts.push([A[0], A[1]]); isWell.push(false); isBoundary.push(true);
      var guard = 0;
      while (guard++ < 100000) {
        var cur = [A[0] + (B[0] - A[0]) * (pos / len), A[1] + (B[1] - A[1]) * (pos / len)];
        var step = 0.9 * s(cur[0], cur[1]);
        if (pos + step >= len - 0.35 * step) break;
        pos += step;
        var t2 = pos / len;
        var jx = (rng() - 0.5) * 0.2 * step;
        var jn = (0.3 + 0.7 * rng()) * epsN;
        pts.push([
          A[0] + (B[0] - A[0]) * t2 + N[0] * jn + (B[0] - A[0]) / len * jx,
          A[1] + (B[1] - A[1]) * t2 + N[1] * jn + (B[1] - A[1]) / len * jx
        ]);
        isWell.push(false); isBoundary.push(true);
      }
    }

    // Внутренние точки: переменный dart throwing с пространственным хэшем.
    // rhoFactor < 1 компенсирует низкую плотность случайной упаковки относительно гекс-решетки.
    var rf = p.rhoFactor || 0.45;
    var cellSz = Math.max(0.5 * p.sMax, 1e-6);
    var nx = Math.max(1, Math.ceil(Lx / cellSz)), ny = Math.max(1, Math.ceil(Ly / cellSz));
    var grid = new Array(nx * ny);
    function gridInsert(pt, idx) {
      var gx = Math.min(nx - 1, Math.max(0, Math.floor(pt[0] / cellSz)));
      var gy = Math.min(ny - 1, Math.max(0, Math.floor(pt[1] / cellSz)));
      var c = gy * nx + gx;
      (grid[c] || (grid[c] = [])).push(idx);
    }
    for (i = 0; i < pts.length; i++) gridInsert(pts[i], i);

    function rho(x, y) { return rf * s(x, y); }

    var maxAttempts = 400000;
    var rejects = 0;
    for (var att = 0; att < maxAttempts && rejects < 30000; att++) {
      var x = rng() * Lx, y = rng() * Ly;
      var rc = rho(x, y);
      var rad = 0.5 * (rc + 0.92 * p.sMax) + 1e-9;
      var gx0 = Math.max(0, Math.floor((x - rad) / cellSz)), gx1 = Math.min(nx - 1, Math.floor((x + rad) / cellSz));
      var gy0 = Math.max(0, Math.floor((y - rad) / cellSz)), gy1 = Math.min(ny - 1, Math.floor((y + rad) / cellSz));
      var ok = true;
      outer:
      for (var gy = gy0; gy <= gy1; gy++) {
        for (var gx = gx0; gx <= gx1; gx++) {
          var bucket = grid[gy * nx + gx];
          if (!bucket) continue;
          for (var b = 0; b < bucket.length; b++) {
            var q = pts[bucket[b]];
            var dx = x - q[0], dy = y - q[1];
            if (dx * dx + dy * dy < 1e-18) { ok = false; break outer; }
            var rq = rho(q[0], q[1]);
            var need = 0.5 * (rc + rq);
            // минимальная дистанция до скважины — валидность модели Писмана (r_e/r_w)
            if (isWell[bucket[b]] && need < 0.9 * p.sMin) need = 0.9 * p.sMin;
            if (dx * dx + dy * dy < need * need) { ok = false; break outer; }
          }
        }
      }
      if (ok) {
        pts.push([x, y]); isWell.push(false); isBoundary.push(false);
        gridInsert(pts[pts.length - 1], pts.length - 1);
        rejects = 0;
      } else {
        rejects++;
      }
    }

    if (countOnly) return { pts: pts, isWell: isWell, isBoundary: isBoundary };

    // Ллойд: внутренние точки -> центроиды своих ячеек; скважины и граница закреплены.
    var iters = (p.lloydIters === undefined) ? 2 : p.lloydIters;
    for (var it = 0; it < iters; it++) {
      var del = Delaunay.from(pts);
      var vor = del.voronoi([0, 0, Lx, Ly]);
      for (i = p.wells.length; i < pts.length; i++) {
        if (isBoundary[i]) continue;
        var poly = vor.cellPolygon(i);
        if (!poly) continue;
        var a2 = 0, cx = 0, cy = 0;
        for (var k = 0; k < poly.length - 1; k++) {
          var x0 = poly[k][0], y0 = poly[k][1], x1 = poly[k + 1][0], y1 = poly[k + 1][1];
          var cr = x0 * y1 - x1 * y0;
          a2 += cr; cx += (x0 + x1) * cr; cy += (y0 + y1) * cr;
        }
        a2 *= 0.5;
        if (Math.abs(a2) > 1e-12) {
          var npx = cx / (6 * a2), npy = cy / (6 * a2);
          // не подпускать точки ближе 0.85*sMin к скважинам при релаксации
          var tooClose = false;
          for (var wI = 0; wI < p.wells.length; wI++) {
            var wdx = npx - p.wells[wI].x, wdy = npy - p.wells[wI].y;
            if (wdx * wdx + wdy * wdy < 0.7225 * p.sMin * p.sMin) { tooClose = true; break; }
          }
          if (!tooClose) pts[i] = [npx, npy];
        }
      }
    }

    return { pts: pts, isWell: isWell, isBoundary: isBoundary };
  }

  // Оценка числа ячеек (для бисекции sMax по целевому количеству).
  function estimateCount(p, Delaunay) {
    var pc = Object.assign({}, p, { seed: p.seed });
    return generatePoints(pc, Delaunay, true).pts.length;
  }

  // Подбор sMax под целевое число ячеек (бисекция).
  function sMaxForTarget(p, Delaunay) {
    var lo = Math.max(p.sMin * 1.2, 3), hi = 80;
    var target = p.targetCells;
    for (var it = 0; it < 14; it++) {
      var mid = 0.5 * (lo + hi);
      var cnt = estimateCount(Object.assign({}, p, { sMax: mid }), Delaunay);
      if (cnt < target) hi = mid; else lo = mid;
    }
    return 0.5 * (lo + hi);
  }

  function commonVerts(tri, ta, tb) {
    var a = [tri[3 * ta], tri[3 * ta + 1], tri[3 * ta + 2]];
    var b = [tri[3 * tb], tri[3 * tb + 1], tri[3 * tb + 2]];
    var out = [];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) if (a[i] === b[j]) { out.push(a[i]); break; }
    return out;
  }

  // Построение топологии из финальных точек.
  function buildTopology(p, pts, isWell, isBoundary, Delaunay) {
    var Lx = p.Lx, Ly = p.Ly, N = pts.length;
    var del = Delaunay.from(pts);
    var vor = del.voronoi([0, 0, Lx, Ly]);
    var tri = del.triangles;

    // Соседи сайта в графе Делоне (для геометрической классификации граней).
    var neighborCache = new Array(N);
    function neighborsOf(i) {
      var nb = neighborCache[i];
      if (!nb) {
        nb = [];
        for (var it of del.neighbors(i)) nb.push(it);
        neighborCache[i] = nb;
      }
      return nb;
    }

    // Является ли отрезок (a,b) частью серединного перпендикуляра между i и j:
    // оба конца равнодальны от сайтов i и j.
    function onBisector(i, j, ax, ay, bx, by) {
      var xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      var d = Math.hypot(xj - xi, yj - yi);
      var da1 = Math.hypot(ax - xi, ay - yi), da2 = Math.hypot(ax - xj, ay - yj);
      var db1 = Math.hypot(bx - xi, by - yi), db2 = Math.hypot(bx - xj, by - yj);
      var tol = 1e-6 * d + 1e-9;
      return Math.abs(da1 - da2) < tol && Math.abs(db1 - db2) < tol;
    }

    var sites = new Float64Array(2 * N);
    for (var i = 0; i < N; i++) { sites[2 * i] = pts[i][0]; sites[2 * i + 1] = pts[i][1]; }

    var cellArea = new Float64Array(N);
    var polyStart = new Int32Array(N + 1);
    var polyCoords = [];
    var fA = [], fB = [], fN = [], fLen = [], fDij = [];
    var bCell = [], bN = [], bLen = [], bDist = [];
    var faceSeen = new Set();
    var skippedEdges = 0;

    for (i = 0; i < N; i++) {
      var poly = vor.cellPolygon(i);
      if (!poly) throw new Error('mesh: пустая ячейка ' + i);
      var m = poly.length - 1;
      polyStart[i] = polyCoords.length / 2;
      var area2 = 0;
      for (var k2 = 0; k2 < m; k2++) {
        polyCoords.push(poly[k2][0], poly[k2][1]);
        var x0 = poly[k2][0], y0 = poly[k2][1], x1 = poly[k2 + 1][0], y1 = poly[k2 + 1][1];
        area2 += x0 * y1 - x1 * y0;
      }
      polyStart[i + 1] = polyCoords.length / 2;
      cellArea[i] = 0.5 * area2;

      var si = [pts[i][0], pts[i][1]];
      var nbs = neighborsOf(i);
      for (var k = 0; k < m; k++) {
        var ax = poly[k][0], ay = poly[k][1], bx = poly[k + 1][0], by = poly[k + 1][1];
        var ex = bx - ax, ey = by - ay;
        var len = Math.hypot(ex, ey);
        if (len < 1e-9 * Math.max(Lx, Ly)) { skippedEdges++; continue; }
        var neighbor = -1;
        for (var q = 0; q < nbs.length; q++) {
          if (onBisector(i, nbs[q], ax, ay, bx, by)) { neighbor = nbs[q]; break; }
        }
        if (neighbor >= 0) {
          var key = i < neighbor ? i * N + neighbor : neighbor * N + i;
          if (!faceSeen.has(key)) {
            faceSeen.add(key);
            fA.push(i); fB.push(neighbor);
            fN.push(ax, ay, bx, by);
            fLen.push(len);
            var sj = [pts[neighbor][0], pts[neighbor][1]];
            fDij.push(Math.hypot(sj[0] - si[0], sj[1] - si[1]));
          }
        } else {
          // граничная грань на прямоугольнике
          bCell.push(i);
          bN.push(ax, ay, bx, by);
          bLen.push(len);
          // перпендикулярное расстояние от сайта до прямой грани
          var d = Math.abs(ex * (si[1] - ay) - ey * (si[0] - ax)) / len;
          bDist.push(d);
        }
      }
    }

    var F = fA.length, Fb = bCell.length;
    return {
      N: N, Lx: Lx, Ly: Ly,
      sites: sites,
      cellArea: cellArea,
      isBoundarySite: Uint8Array.from(isBoundary),
      wellCells: p.wells.map(function (w2, idx) { return idx; }),
      polyStart: polyStart,
      polyCoords: Float64Array.from(polyCoords),
      F: F,
      faceA: Int32Array.from(fA), faceB: Int32Array.from(fB),
      faceNodes: Float64Array.from(fN), faceLen: Float64Array.from(fLen), faceDij: Float64Array.from(fDij),
      Fb: Fb,
      bFaceCell: Int32Array.from(bCell),
      bFaceNodes: Float64Array.from(bN), bFaceLen: Float64Array.from(bLen), bFaceDist: Float64Array.from(bDist),
      delaunay: del,
      bounds: [0, 0, Lx, Ly],
      skippedEdges: skippedEdges,
      params: { sMin: p.sMin, sMax: p.sMax, RGrad: p.RGrad, seed: p.seed }
    };
  }

  // Полная генерация сетки.
  function generate(p, Delaunay) {
    if (!p.sMax && p.targetCells) p = Object.assign({}, p, { sMax: sMaxForTarget(p, Delaunay) });
    var pc = generatePoints(p, Delaunay, false);
    return buildTopology(p, pc.pts, pc.isWell, pc.isBoundary, Delaunay);
  }

  return {
    mulberry32: mulberry32,
    generate: generate,
    generatePoints: generatePoints,
    buildTopology: buildTopology,
    estimateCount: estimateCount,
    sMaxForTarget: sMaxForTarget,
    makeSpacing: makeSpacing
  };
});
