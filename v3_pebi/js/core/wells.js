/* Скважины: модель Писмана на полигональных ячейках, режимы BHP/дебит. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.Pebi = root.Pebi || {}; Object.assign(root.Pebi, api); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // specs: [{type:'injector'|'producer', x, y, rw, mode, value}]
  function createWells(mesh, specs, rockK, h) {
    var C = 8.527e-3;
    return specs.map(function (spec, idx) {
      if (!(spec.x >= 0 && spec.x <= mesh.Lx && spec.y >= 0 && spec.y <= mesh.Ly)) {
        throw new Error('wells: скважина "' + (spec.name || spec.type) + '" вне области');
      }
      var cell = mesh.delaunay.find(spec.x, spec.y);
      if (cell < 0) throw new Error('wells: скважина вне области');
      var A = mesh.cellArea[cell];
      var re = 0.2 * Math.sqrt(A);
      var ratio = re / spec.rw;
      var warn = null;
      if (ratio < 4.5) warn = 'r_e/r_w = ' + ratio.toFixed(1) + ' < 4.5 — увеличьте s_min или r_w';
      var WI = C * 2 * Math.PI * rockK * h / Math.log(re / spec.rw); // м3/(сут·бар) на единицу подвижности (1/сП)
      return {
        idx: idx,
        type: spec.type,
        name: spec.name || (spec.type === 'injector' ? 'Нагнетательная' : 'Добывающая'),
        x: spec.x, y: spec.y, rw: spec.rw,
        cell: cell, re: re, WI: WI, warn: warn,
        // Управление (обновляется UI/движком):
        mode: spec.mode || 'bhp',       // 'bhp' | 'rate'
        value: spec.value || 0,          // бар или м3/сут (референс)
        // Состояние последнего шага:
        flowing: true, qRes: 0, qws: 0, qos: 0, pwfActual: spec.value || 0
      };
    });
  }

  // Решение о течении (фиксируется в начале шага): без кросс-флоу.
  function resolveFlowing(well, pCell, fluid, S) {
    if (well.mode === 'bhp') {
      var pwf = well.value;
      well.flowing = well.type === 'injector' ? (pwf > pCell) : (pwf < pCell);
    } else {
      well.flowing = well.value > 0;
    }
    return well.flowing;
  }

  // Оценка фактического pwf для дебитной скважины по текущему состоянию (для клампа).
  function estimatePwf(well, state, fluid) {
    var c = well.cell, p = state.p[c];
    var lam = fluid.lamT(state.S[c]);
    if (lam <= 0) return well.type === 'producer' ? -1 : 1e9;
    if (well.type === 'producer') {
      var fw0 = fluid.fw(state.S[c]);
      var mix = fw0 / fluid.Bw(p) + (1 - fw0) / fluid.Bo(p);
      var qRes = well.value / mix; // пласт. м3/сут
      return p - qRes / (well.WI * lam);
    }
    var qResI = well.value * fluid.Bw(p);
    return p + qResI / (well.WI * lam);
  }

  return { createWells: createWells, resolveFlowing: resolveFlowing, estimatePwf: estimatePwf };
});
