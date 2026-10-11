/* Адаптивный шаг по времени: последовательная схема (давление -> насыщенность),
   контроль |dS|, |dp|, откат шага при не-сходимости. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.Pebi = root.Pebi || {}; Object.assign(root.Pebi, api); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Одна попытка шага с заданным dt. Возвращает {ok}|{retry, reason}.
  function attemptStep(sim, dt) {
    var t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    var st = sim.state, fluid = sim.fluid, wells = sim.wells;
    var ctrl = sim.controls;

    // 1. Управление скважинами + решение о течении (фиксируется на шаг).
    for (var wI = 0; wI < wells.length; wI++) {
      var wl = wells[wI], c = ctrl[wI];
      wl.mode = c.mode;
      wl.value = c.value;
      sim.wellsModule.resolveFlowing(wl, st.p[wl.cell], fluid, st.S[wl.cell]);
      // Дебитные скважины: проверка достижимости по pwf (без бесконечных перепадов):
      // добывающая останавливается, если расчетный pwf уходит ниже 0.5 бар,
      // нагнетательная — выше 500 бар (решение фиксируется до сборки матрицы).
      if (wl.flowing && wl.mode === 'rate') {
        var pwfEst = sim.wellsModule.estimatePwf(wl, st, fluid);
        if (wl.type === 'producer' && pwfEst < 0.5) { wl.flowing = false; wl.clamped = true; }
        else if (wl.type === 'injector' && pwfEst > 500) { wl.flowing = false; wl.clamped = true; }
        else wl.clamped = false;
      } else wl.clamped = false;
    }

    // 2. Внешний последовательный цикл: давление -> транспорт до согласования подвижностей.
    var pr = sim.pressure, tr = sim.transport;
    var maxOuter = sim.params.control.outerIters || 4;
    var Siter = null, pOut = null, tsOut = null, res = null;
    var outer;
    for (outer = 0; outer < maxOuter; outer++) {
      var SforP = outer === 0 ? st.S : Siter;
      pr.assemble({ p: st.p, S: SforP }, wells, dt, {});
      res = pr.solve(st.p, sim.params.control.pcgTol);
      if (!res.ok) return { retry: true, reason: 'pressure' };
      pr.wellRates({ p: pr.p, S: SforP }, wells);
      var v = pr.fluxes({ S: SforP });
      tr.prepare(st, pr.p, v, wells);
      var ts = tr.solve(st.S, dt, { tol: sim.params.control.newtonTol });
      if (!ts.converged) return { retry: true, reason: 'newton:' + (ts.reason || '') };
      // мера согласованности: насколько S^{n+1} отличается от S, использованного в давлении
      var dSout = 0;
      for (var i2 = 0; i2 < sim.mesh.N; i2++) {
        var dd = Math.abs(ts.S[i2] - SforP[i2]);
        if (dd > dSout) dSout = dd;
      }
      Siter = ts.S; pOut = pr.p; tsOut = ts;
      if (dSout < 1e-3) break;
    }

    // 3. Лимиты шага.
    var n = sim.mesh.N, maxDS = 0, maxDP = 0;
    for (var i = 0; i < n; i++) {
      var dS = Math.abs(tsOut.S[i] - st.S[i]);
      if (dS > maxDS) maxDS = dS;
      var dP = Math.abs(pOut[i] - st.p[i]);
      if (dP > maxDP) maxDP = dP;
    }
    if (maxDS > sim.params.control.dSMax || maxDP > sim.params.control.dpMax) {
      return { retry: true, reason: 'limits', maxDS: maxDS, maxDP: maxDP };
    }

    // 4. Коммит.
    var t1 = (typeof performance !== 'undefined' ? performance : Date).now();
    sim.commit(pOut, tsOut.S, dt, {
      ms: t1 - t0, newtonIters: tsOut.iters, pcgIters: res.iters, maxDS: maxDS, maxDP: maxDP,
      floored: !!tsOut.floor
    });
    sim.diag.outerIters = Math.min(outer + 1, maxOuter);
    return { ok: true, dt: dt, ms: t1 - t0 };
  }

  // Адаптивный шаг: сжатие при неудачах, рост при успехе.
  function adaptiveStep(sim) {
    var ctrl = sim.params.control;
    var dt = sim.state.dtCurrent;
    for (var attempt = 0; attempt < 30; attempt++) {
      var r = attemptStep(sim, dt);
      if (r.ok) {
        // шаг, принятый через «пол» невязки, не ускоряет время (точность фронта)
        var grow = sim.diag.floored ? 1.0 : 1.3;
        sim.state.dtCurrent = Math.min(dt * grow, ctrl.dtMax);
        sim.state.lastDt = dt;
        return r;
      }
      dt *= 0.5;
      sim.diag.lastRetry = r.reason;
      if (dt < ctrl.dtMin) {
        return { ok: false, error: 'dt < dtMin, шаг не сошелся (' + r.reason + ')' };
      }
    }
    return { ok: false, error: 'превышено число попыток шага' };
  }

  return { attemptStep: attemptStep, adaptiveStep: adaptiveStep };
});
