/* Уравнение давления: RT0/ТПФА на вороной-сетке (SPD), PCG+IC(0).
   T_f — только порода: T_f = C·L_f·k/|x_i−x_j| (d_i = d_j = |x_i−x_j|/2 на вороной-грани);
   подвижность входит один раз: v_f = T_f·λ_t,f·(p_i − p_j). */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.Pebi = root.Pebi || {}; Object.assign(root.Pebi, api); }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  var Pebi = (root && root.Pebi) || {};
  var sparseMod = Pebi.CSR ? Pebi : require('./sparse.js');
  var CSR = sparseMod.CSR, pcg = sparseMod.pcg, ic0 = sparseMod.ic0;

  function PressureSolver(mesh, fluid, rock) {
    var n = mesh.N, F = mesh.F;
    this.n = n;
    this.mesh = mesh;
    this.fluid = fluid;

    // Шаблон матрицы: диагональ + соседи по граням.
    var rows = new Int32Array(n + 2 * F), cols = new Int32Array(n + 2 * F);
    var w = 0;
    for (var i = 0; i < n; i++) { rows[w] = i; cols[w] = i; w++; }
    for (var f = 0; f < F; f++) {
      rows[w] = mesh.faceA[f]; cols[w] = mesh.faceB[f]; w++;
      rows[w] = mesh.faceB[f]; cols[w] = mesh.faceA[f]; w++;
    }
    this.A = CSR.buildPattern(n, rows, cols);
    this.b = new Float64Array(n);
    this.p = new Float64Array(n);
    this.vcof = new Float64Array(F); // T_f * λ_t,f
    this.Trock = new Float64Array(F);
    for (f = 0; f < F; f++) {
      // T = C * k * (L_f * h) / d_ij  — площадь грани L_f*h, путь d (d_i = d_j = d/2)
      this.Trock[f] = fluid.C * mesh.faceLen[f] * rock.h * rock.k / mesh.faceDij[f];
    }
    this.Vp = new Float64Array(n);
    for (i = 0; i < n; i++) this.Vp[i] = rock.phi * mesh.cellArea[i] * rock.h;
    this.rockH = rock.h;
    this.lastIters = 0;
    this.lastRelres = 0;
  }

  // state: {p, S}; wells: [{cell, mode, value, flowing, type}]; opts: {steady, dirichlet}
  PressureSolver.prototype.assemble = function (state, wells, dt, opts) {
    opts = opts || {};
    var A = this.A, b = this.b, mesh = this.mesh, fluid = this.fluid;
    var n = this.n, F = mesh.F;
    A.zero(); b.fill(0);
    var p0 = state.p, S0 = state.S;

    for (var f = 0; f < F; f++) {
      var ia = mesh.faceA[f], ib = mesh.faceB[f];
      var lamF = 0.5 * (fluid.lamT(S0[ia]) + fluid.lamT(S0[ib]));
      var vc = this.Trock[f] * lamF;
      this.vcof[f] = vc;
      A.add(ia, ia, vc); A.add(ib, ib, vc);
      A.add(ia, ib, -vc); A.add(ib, ia, -vc);
    }

    var steady = !!opts.steady;
    if (!steady) {
      for (var i = 0; i < n; i++) {
        var Mi = this.Vp[i] * fluid.ct(S0[i]) / dt;
        A.add(i, i, Mi);
        b[i] += Mi * p0[i];
      }
    }

    // Скважины
    for (var wI = 0; wI < wells.length; wI++) {
      var wl = wells[wI];
      if (!wl.flowing) continue;
      var c = wl.cell, lam = fluid.lamT(S0[c]);
      if (wl.mode === 'bhp') {
        var wcoef = wl.WI * lam;
        A.add(c, c, wcoef);
        b[c] += wcoef * wl.value;
      } else if (wl.type === 'injector') {
        // задана референсная приемистость q_ws -> пластовый объем
        b[c] += wl.value * fluid.Bw(p0[c]);
      } else {
        // задан референсный дебит жидкости -> пластовый объем
        var fw0 = fluid.fw(S0[c]);
        var mix = fw0 / fluid.Bw(p0[c]) + (1 - fw0) / fluid.Bo(p0[c]);
        b[c] -= wl.value / mix;
      }
    }

    // Тестовое ГУ Дирихле на внешней границе
    if (opts.dirichlet !== undefined && opts.dirichlet !== null) {
      var pB = opts.dirichlet, Fb = mesh.Fb;
      for (f = 0; f < Fb; f++) {
        if (mesh.bFaceDist[f] < 1e-6) continue; // угловые сайты лежат на линии грани — связь через соседей
        var ci = mesh.bFaceCell[f];
        var Tb = fluid.C * mesh.bFaceLen[f] * this.rockH * this.rockK / mesh.bFaceDist[f];
        var TbL = Tb * this.dirichletMobility;
        A.add(ci, ci, TbL);
        b[ci] += TbL * pB;
      }
    }
  };

  // Для тестов: однофазный режим с заданной подвижностью (1/сП) на границе.
  PressureSolver.prototype.setTestMode = function (rockK, mobility) {
    this.rockK = rockK;
    this.dirichletMobility = mobility;
  };

  PressureSolver.prototype.solve = function (p0, tol) {
    var res = pcg(this.A, this.b, { x0: p0, tol: tol || 1e-10, maxit: 1000, M: ic0(this.A) });
    this.p = res.x;
    this.lastIters = res.iters;
    this.lastRelres = res.relres;
    if (!res.converged) return { ok: false, iters: res.iters, relres: res.relres };
    return { ok: true, iters: res.iters, relres: res.relres };
  };

  // Потоки по граням [пласт. м3/сут] и дебиты скважин.
  PressureSolver.prototype.fluxes = function (state, out) {
    var F = this.mesh.F, v = out || this._v || (this._v = new Float64Array(F));
    var p = this.p;
    for (var f = 0; f < F; f++) {
      v[f] = this.vcof[f] * (p[this.mesh.faceA[f]] - p[this.mesh.faceB[f]]);
    }
    return v;
  };

  // Дебиты скважин [пласт. м3/сут] из решения; state.S — подвижности с n.
  PressureSolver.prototype.wellRates = function (state, wells) {
    var p = this.p, S = state.S, fluid = this.fluid;
    for (var wI = 0; wI < wells.length; wI++) {
      var wl = wells[wI];
      if (!wl.flowing) { wl.qRes = 0; continue; }
      var lam = fluid.lamT(S[wl.cell]);
      var dp = wl.mode === 'bhp'
        ? (wl.type === 'injector' ? (wl.value - p[wl.cell]) : (p[wl.cell] - wl.value))
        : 0;
      if (wl.mode === 'bhp') {
        var q = wl.WI * lam * dp;
        if (q < 0) q = 0; // страховка (решение о течении принято раньше)
        wl.qRes = q;
      } else if (wl.type === 'injector') {
        wl.qRes = wl.value * fluid.Bw(p[wl.cell]);
      } else {
        var fw0 = fluid.fw(S[wl.cell]);
        var mix = fw0 / fluid.Bw(p[wl.cell]) + (1 - fw0) / fluid.Bo(p[wl.cell]);
        wl.qRes = wl.value / mix;
      }
    }
  };

  return { PressureSolver: PressureSolver };
});
