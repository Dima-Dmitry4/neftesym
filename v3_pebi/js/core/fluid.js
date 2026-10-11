/* Свойства флюидов и породы: ОФП Кори, дробный поток, объемные коэффициенты. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.Pebi = root.Pebi || {}; Object.assign(root.Pebi, api); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Переводной коэффициент: мД·м·бар/сП -> м3/сут (q = C * k[mD] * A[m2] * dp[bar] / (mu[cP] * L[m])).
  var C = 8.527e-3;

  function createFluid(p) {
    p = p || {};
    var f = {
      muw: p.muw || 0.5,          // сП
      muo: p.muo || 2.0,          // сП
      krw0: p.krw0 || 0.3,
      kro0: p.kro0 || 1.0,
      nw: p.nw || 2,
      no: p.no || 2,
      swc: p.swc || 0.2,
      sor: p.sor || 0.2,
      cw: p.cw || 4.4e-5,         // 1/бар
      co: p.co || 1.0e-4,         // 1/бар
      cr: p.cr || 5.0e-5,         // 1/бар (порода)
      pref: p.pref || 150.0       // бар
    };
    f.dS = 1 - f.swc - f.sor;
    if (f.dS <= 0) throw new Error('fluid: swc+sor >= 1');

    function sn(S) {
      var s = (S - f.swc) / f.dS;
      return s < 0 ? 0 : (s > 1 ? 1 : s);
    }

    f.krw = function (S) { return f.krw0 * Math.pow(sn(S), f.nw); };
    f.kro = function (S) { var s = sn(S); return f.kro0 * Math.pow(1 - s, f.no); };

    // Подвижности, 1/(сП) (умножаются на k отдельно).
    f.lamW = function (S) { return f.krw(S) / f.muw; };
    f.lamO = function (S) { return f.kro(S) / f.muo; };
    f.lamT = function (S) { return f.lamW(S) + f.lamO(S); };

    f.fw = function (S) {
      var a = f.krw(S) / f.muw, b = f.kro(S) / f.muo;
      var t = a + b;
      return t > 0 ? a / t : 0;
    };

    // df_w/dS аналитически (через нормированную насыщенность).
    f.dfw = function (S) {
      var s = sn(S);
      var a = f.krw0 * Math.pow(s, f.nw) / f.muw;
      var b = f.kro0 * Math.pow(1 - s, f.no) / f.muo;
      var da = f.nw >= 1 ? f.krw0 * f.nw * Math.pow(s, f.nw - 1) / f.muw / f.dS : 0;
      var db = f.no >= 1 ? -f.kro0 * f.no * Math.pow(1 - s, f.no - 1) / f.muo / f.dS : 0;
      var t = a + b;
      if (t <= 0) return 0;
      return (da * t - a * (da + db)) / (t * t);
    };

    // Объемные коэффициенты B(p) = 1/(1 + c(p - pref)) — пласт. м3 / референс. м3.
    f.Bw = function (pBar) { return 1 / (1 + f.cw * (pBar - f.pref)); };
    f.Bo = function (pBar) { return 1 / (1 + f.co * (pBar - f.pref)); };
    // Породный множитель Vp(p)/Vp_ref.
    f.vpScale = function (pBar) { return 1 + f.cr * (pBar - f.pref); };
    // Общая сжимаемость (насыщенности с n).
    f.ct = function (S) { return S * f.cw + (1 - S) * f.co + f.cr; };

    f.C = C;
    return f;
  }

  return { createFluid: createFluid, C: C };
});
