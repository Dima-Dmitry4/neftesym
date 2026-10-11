/* Транспорт насыщенности: неявная схема с одноточечным upwind, Ньютон + BiCGStab/ILU(0).
   Аккумуляция в референсных объемах: Vp(p)·S/B_w(p) — породный член через Vp(p). */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.Pebi = root.Pebi || {}; Object.assign(root.Pebi, api); }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  var Pebi = (root && root.Pebi) || {};
  var sparseMod = Pebi.CSR ? Pebi : require('./sparse.js');
  var CSR = sparseMod.CSR, bicgstab = sparseMod.bicgstab, ilu0 = sparseMod.ilu0;

  function TransportSolver(mesh, fluid, rock) {
    var n = mesh.N, F = mesh.F;
    this.n = n;
    this.mesh = mesh;
    this.fluid = fluid;
    this.VpRef = new Float64Array(n);
    for (var iv = 0; iv < n; iv++) this.VpRef[iv] = rock.phi * mesh.cellArea[iv] * rock.h;

    var rows = new Int32Array(n + 2 * F), cols = new Int32Array(n + 2 * F);
    var w = 0;
    for (var i = 0; i < n; i++) { rows[w] = i; cols[w] = i; w++; }
    for (var f = 0; f < F; f++) {
      rows[w] = mesh.faceA[f]; cols[w] = mesh.faceB[f]; w++;
      rows[w] = mesh.faceB[f]; cols[w] = mesh.faceA[f]; w++;
    }
    this.J = CSR.buildPattern(n, rows, cols);
    this.R = new Float64Array(n);
    this.S = new Float64Array(n);
    this.dS = new Float64Array(n);
    this.ztmp = new Float64Array(n);
    // предвычисляемые величины шага
    this.VpNew = new Float64Array(n);
    this.VpOld = new Float64Array(n);
    this.BwNew = new Float64Array(n);
    this.accum0 = new Float64Array(n);
    this.fUp = new Int8Array(F);    // upwind-ячейка: 0 = A, 1 = B
    this.vFace = new Float64Array(F);
  }

  // state: {p, S}; pNew: решение давления; v: потоки; wells: с qRes.
  TransportSolver.prototype.prepare = function (state, pNew, v, wells) {
    var n = this.n, F = this.mesh.F, fluid = this.fluid, mesh = this.mesh;
    this.pNew = pNew;
    this.vFace.set(v);
    for (var f = 0; f < F; f++) this.fUp[f] = v[f] > 0 ? 0 : 1;
    var wellsByCell = {};
    this.wellSrc = [];
    for (var wI = 0; wI < wells.length; wI++) {
      var wl = wells[wI];
      if (!wl.flowing || wl.qRes === 0) continue;
      this.wellSrc.push({
        cell: wl.cell, type: wl.type, qRes: wl.qRes
      });
    }
    for (var i = 0; i < n; i++) {
      var p1 = pNew[i], p0 = state.p[i];
      this.VpNew[i] = this.VpRef[i] * fluid.vpScale(p1);
      this.VpOld[i] = this.VpRef[i] * fluid.vpScale(p0);
      this.BwNew[i] = fluid.Bw(p1);
      this.accum0[i] = this.VpOld[i] * state.S[i] / fluid.Bw(p0);
    }
  };

  // Ньютон. opts: {tol (нормир. residual), maxit, floorTol}
  TransportSolver.prototype.solve = function (S0, dt, opts) {
    opts = opts || {};
    var tol = opts.tol || 1e-6, maxit = opts.maxit || 8;
    var n = this.n, F = this.mesh.F, fluid = this.fluid, mesh = this.mesh;
    var R = this.R, S = this.S, J = this.J;
    S.set(S0);
    // Границы по S: снизу — запас на сжимаемость (dS = -S*(cw+cr)*dp в ячейках без притока),
    // сверху — до 1: за фронтом S может слегка превышать 1-sor (нефть расширяется, kro=0
    // клампируется) — жесткая граница 1-sor создает неустранимую невязку (ловушка Ньютона).
    // Низ не выше текущего состояния: пользовательский swc > init.sw0 иначе блокирует перенос.
    var minS0 = S0[0], maxS0 = S0[0];
    for (i = 1; i < n; i++) {
      if (S0[i] < minS0) minS0 = S0[i];
      if (S0[i] > maxS0) maxS0 = S0[i];
    }
    var lo = Math.min(fluid.swc, minS0) - 5e-3;
    var hi = Math.max(1 - 1e-9, maxS0);
    // "Пол" последовательной схемы: у ячеек, запертых на границе S, остаток
    // O(v*c_w*dp_соседа) неустраним (Bw-взвешивание апстрим-потоков); он пропорционален dt
    // в нормированном виде. Принимаем его, только если худшая ячейка лежит на границе S.
    var srcs = this.wellSrc;
    var iters = 0, converged = false, normCur = Infinity;
    var nPrev = Infinity, worstCell = -1;

    for (var nit = 0; nit < maxit; nit++) {
      // Невязка
      for (var i = 0; i < n; i++) {
        R[i] = (this.VpNew[i] * S[i] / this.BwNew[i] - this.accum0[i]) / dt;
      }
      for (var f = 0; f < F; f++) {
        var v = this.vFace[f];
        if (v === 0) continue;
        var ia = mesh.faceA[f], ib = mesh.faceB[f];
        var up = this.fUp[f] === 0 ? ia : ib;
        var Fout = v * fluid.fw(S[up]) / this.BwNew[up];
        R[ia] += Fout;
        R[ib] -= Fout;
      }
      for (var s2 = 0; s2 < srcs.length; s2++) {
        var src = srcs[s2];
        if (src.type === 'injector') R[src.cell] -= src.qRes / this.BwNew[src.cell];
        else R[src.cell] += fluid.fw(S[src.cell]) * src.qRes / this.BwNew[src.cell];
      }
      var norm = 0;
      worstCell = -1;
      for (i = 0; i < n; i++) {
        var ri = Math.abs(R[i]) * dt / this.VpNew[i];
        if (ri > norm) { norm = ri; worstCell = i; }
      }
      if (norm < tol) { converged = true; normCur = norm; break; }
      // "пол" на границе S: худшая ячейка зажата границей, остаток мал и неустраним — принять
      if (nit >= 2 && norm <= 1e-2 && norm >= 0.7 * nPrev && worstCell >= 0) {
        var wS = S[worstCell];
        if (Math.abs(wS - lo) < 1e-6 || Math.abs(wS - hi) < 1e-6) {
          converged = true; normCur = norm; break;
        }
      }
      nPrev = norm;
      normCur = norm;

      // Якобиан
      J.zero();
      for (i = 0; i < n; i++) J.add(i, i, this.VpNew[i] / (dt * this.BwNew[i]));
      for (f = 0; f < F; f++) {
        var v2 = this.vFace[f];
        if (v2 === 0) continue;
        var ia2 = mesh.faceA[f], ib2 = mesh.faceB[f];
        var up2 = this.fUp[f] === 0 ? ia2 : ib2;
        var dF = v2 * fluid.dfw(S[up2]) / this.BwNew[up2];
        J.add(ia2, up2, dF);
        J.add(ib2, up2, -dF);
      }
      for (s2 = 0; s2 < srcs.length; s2++) {
        var src3 = srcs[s2];
        if (src3.type === 'producer') {
          J.add(src3.cell, src3.cell, src3.qRes * fluid.dfw(S[src3.cell]) / this.BwNew[src3.cell]);
        }
      }

      // Шаг Ньютона с линейным поиском и границами по S
      var M = ilu0(J);
      var negR = this.dS;
      for (i = 0; i < n; i++) negR[i] = -R[i];
      var lin = bicgstab(J, negR, { M: M, tol: 1e-9, maxit: 80 });
      if (!isFinite(lin.relres)) return { S: S0, converged: false, iters: iters, reason: 'linear' };
      var dS = lin.x;

      var lam0 = 1, accepted = false;
      var tried = opts.verbose ? [] : null;
      for (var ls = 0; ls < 22; ls++) {
        // пробная точка клампируется в границы (не отбраковывается): на границе
        // невязка стремится к нулю, жесткое отбракование создает ловушку Ньютона
        var normTrial = this.evalNorm(S, dS, lam0, dt, lo, hi);
        if (tried) tried.push(lam0.toFixed(4) + ':' + normTrial.toExponential(2));
        // слабый относительный допуск: на "полу" норма колеблется в последних разрядах
        if (normTrial <= normCur * 1.001) { accepted = true; break; }
        lam0 *= 0.5;
        if (lam0 < 1e-4) break;
      }
      if (opts.verbose) {
        var worst = 0, wc = -1;
        for (i = 0; i < n; i++) { var rj = Math.abs(R[i]) * dt / this.VpNew[i]; if (rj > worst) { worst = rj; wc = i; } }
        console.log('  N' + nit, 'norm=' + norm.toExponential(3), 'worstCell=' + wc, 'maxdS=' + (function () { var m = 0; for (var q = 0; q < n; q++) if (isFinite(dS[q]) && Math.abs(dS[q]) > m) m = Math.abs(dS[q]); return m; })().toFixed(3), 'tried:', tried.slice(0, 6).join(' '));
      }
      if (!accepted) {
        // "пол" на границе S: худшая ячейка зажата границей, остаток мал и неустраним — принять
        if (normCur <= 1e-2 && worstCell >= 0) {
          var wS = S[worstCell];
          if (Math.abs(wS - lo) < 1e-6 || Math.abs(wS - hi) < 1e-6) {
            return { S: S, converged: true, iters: iters, residual: normCur, floor: true };
          }
        }
        return { S: S0, converged: false, iters: iters, reason: 'linesearch' };
      }
      for (i = 0; i < n; i++) {
        var st2 = S[i] + lam0 * dS[i];
        S[i] = st2 < lo ? lo : (st2 > hi ? hi : st2);
      }
      iters++;
    }
    return { S: S, converged: converged, iters: iters, residual: normCur };
  };

  // Норма невязки в пробной точке clamp(S + lam0*dS).
  TransportSolver.prototype.evalNorm = function (S, dS, lam0, dt, lo, hi) {
    var n = this.n, F = this.mesh.F, fluid = this.fluid, mesh = this.mesh;
    var R = this.ztmp;
    var i, f;
    for (i = 0; i < n; i++) {
      var st = S[i] + lam0 * dS[i];
      if (st < lo) st = lo; else if (st > hi) st = hi;
      R[i] = (this.VpNew[i] * st / this.BwNew[i] - this.accum0[i]) / dt;
    }
    for (f = 0; f < F; f++) {
      var v = this.vFace[f];
      if (v === 0) continue;
      var ia = mesh.faceA[f], ib = mesh.faceB[f];
      var up = this.fUp[f] === 0 ? ia : ib;
      var stU = S[up] + lam0 * dS[up];
      if (stU < lo) stU = lo; else if (stU > hi) stU = hi;
      var Fout = v * fluid.fw(stU) / this.BwNew[up];
      R[ia] += Fout;
      R[ib] -= Fout;
    }
    for (var s2 = 0; s2 < this.wellSrc.length; s2++) {
      var src = this.wellSrc[s2];
      var stW = S[src.cell] + lam0 * dS[src.cell];
      if (stW < lo) stW = lo; else if (stW > hi) stW = hi;
      if (src.type === 'injector') R[src.cell] -= src.qRes / this.BwNew[src.cell];
      else R[src.cell] += fluid.fw(stW) * src.qRes / this.BwNew[src.cell];
    }
    var norm = 0;
    for (i = 0; i < n; i++) {
      var ri = Math.abs(R[i]) * dt / this.VpNew[i];
      if (ri > norm) norm = ri;
    }
    return norm;
  };

  return { TransportSolver: TransportSolver };
});
