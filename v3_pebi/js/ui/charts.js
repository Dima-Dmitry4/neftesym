/* Компактные canvas-графики временных рядов (без внешних зависимостей). */
(function (root) {
  'use strict';
  root.PebiUI = root.PebiUI || {};

  var BG = '#222834', GRID = '#2e3644', TEXT = '#8a94a4', TXT2 = '#c8d0da';

  function Chart(el, series, opts) {
    this.el = el;
    this.series = series;          // [{key, label, color, scale?, fmt?}]
    this.opts = opts || {};
    this.data = null;              // {t: [], [key]: []}
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    el.style.position = 'relative';
    el.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.dpr = 1;
    this.resize();
  }

  Chart.prototype.resize = function () {
    var r = this.el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) return;
    this.dpr = window.devicePixelRatio || 1;
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.draw();
  };

  Chart.prototype.setData = function (data) {
    this.data = data;
    this.draw();
  };

  Chart.prototype._xRange = function () {
    var t = this.data.t, n = t.length;
    if (!n) return [0, 1];
    return [t[0], t[n - 1] || 1];
  };

  Chart.prototype._yRange = function (s) {
    var arr = this.data[s.key], mn = Infinity, mx = -Infinity;
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (!isFinite(v)) continue;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (!isFinite(mn)) { mn = 0; mx = 1; }
    if (this.opts.y0Fixed) mn = Math.min(mn, 0);
    if (mx - mn < 1e-9) mx = mn + 1;
    return [mn, mx];
  };

  Chart.prototype.draw = function () {
    var ctx = this.ctx, W = this.canvas.width, H = this.canvas.height, dpr = this.dpr;
    ctx.clearRect(0, 0, W, H);
    if (!this.data || !this.data.t || this.data.t.length < 2) return;
    // серии по шкалам (левая/правая) — до расчета отступов
    var left = [], right = [];
    for (var s = 0; s < this.series.length; s++) {
      (this.series[s].scale === 'right' ? right : left).push(this.series[s]);
    }
    var padL = 38 * dpr, padR = (right.length ? 30 : 10) * dpr, padT = 6 * dpr, padB = 16 * dpr;
    var pw = W - padL - padR, ph = H - padT - padB;
    if (pw < 10 || ph < 10) return;
    var xr = this._xRange();
    var x0 = xr[0], x1 = Math.max(xr[1], xr[0] + 1e-9);

    // шкалы Y (одна общая либо левая/правая)
    function yExtent(list) {
      var mn = Infinity, mx = -Infinity;
      for (var i = 0; i < list.length; i++) {
        var r = this._yRange(list[i]);
        mn = Math.min(mn, r[0]); mx = Math.max(mx, r[1]);
      }
      if (!isFinite(mn)) { mn = 0; mx = 1; }
      return [mn, mx];
    }
    var ly = yExtent.call(this, left.length ? left : this.series);
    var ry = right.length ? yExtent.call(this, right) : null;
    var padY = (ly[1] - ly[0]) * 0.06;
    ly[0] -= padY; ly[1] += padY;
    var self = this;

    function X(t) { return padL + (t - x0) / (x1 - x0) * pw; }
    function Y(v) { return padT + (1 - (v - ly[0]) / (ly[1] - ly[0])) * ph; }

    // сетка + подписи Y
    ctx.font = (9.5 * dpr) + 'px "Segoe UI", sans-serif';
    ctx.fillStyle = TEXT;
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    for (var g = 0; g <= 3; g++) {
      var gy = padT + g / 3 * ph;
      ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(W - padR, gy); ctx.stroke();
      var val = ly[1] - g / 3 * (ly[1] - ly[0]);
      ctx.textAlign = 'right';
      ctx.fillText(this._fmtVal(val, ly), padL - 4 * dpr, gy + 3 * dpr);
    }
    // подписи X
    ctx.textAlign = 'center';
    for (g = 0; g <= 4; g++) {
      var gx = padL + g / 4 * pw;
      var tv = x0 + g / 4 * (x1 - x0);
      ctx.fillText(this._fmtT(tv), gx, H - 4 * dpr);
    }
    // правая шкала
    if (ry) {
      ctx.fillStyle = TEXT; ctx.textAlign = 'left';
      for (g = 0; g <= 3; g++) {
        var rv = ry[1] - g / 3 * (ry[1] - ry[0]);
        var py = padT + g / 3 * ph;
        ctx.fillText(this._fmtVal(rv, ry), W - padR + 2 * dpr, py + 3 * dpr);
      }
    }

    // кривые
    var t = this.data.t, n = t.length;
    function drawLine(s2, YF) {
      var arr = self.data[s2.key];
      ctx.strokeStyle = s2.color;
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      var started = false;
      for (var i = 0; i < n; i++) {
        var v = arr[i];
        if (!isFinite(v)) { started = false; continue; }
        var px = X(t[i]), py = YF(v);
        if (!started) { ctx.moveTo(px, py); started = true; }
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    for (s = 0; s < left.length; s++) drawLine(left[s], Y);
    for (s = 0; s < right.length; s++) drawLine(right[s], function (v) {
      return padT + (1 - (v - ry[0]) / (ry[1] - ry[0])) * ph;
    });

    // легенда (вверх слева)
    ctx.textAlign = 'left';
    var lx = padL + 2 * dpr, ly2 = padT + 9 * dpr;
    for (s = 0; s < this.series.length; s++) {
      var s3 = this.series[s];
      ctx.fillStyle = s3.color;
      ctx.fillRect(lx, ly2 - 7 * dpr, 8 * dpr, 8 * dpr);
      ctx.fillStyle = TXT2;
      ctx.fillText(s3.label, lx + 11 * dpr, ly2);
      lx += (11 + s3.label.length * 5.6 + 14) * dpr;
    }
  };

  Chart.prototype._fmtVal = function (v, range) {
    var span = range[1] - range[0];
    if (span <= 1.01) return v.toFixed(2);
    if (span <= 10) return v.toFixed(1);
    return Math.round(v).toString();
  };
  Chart.prototype._fmtT = function (t) {
    if (t >= 730) return (t / 365).toFixed(1) + ' г';
    if (t >= 10) return Math.round(t).toString();
    return t.toFixed(1);
  };

  function Charts() {
    this.ch1 = new Chart(document.getElementById('ch1'), [
      { key: 'qo', label: 'нефть', color: '#35c46f' },
      { key: 'qw', label: 'вода', color: '#3f8cff' }
    ]);
    this.ch2 = new Chart(document.getElementById('ch2'), [
      { key: 'wcut', label: 'обводн.', color: '#c9a0ff' },
      { key: 'qinj', label: 'закачка', color: '#ffb547', scale: 'right' }
    ]);
    this.ch3 = new Chart(document.getElementById('ch3'), [
      { key: 'pwfIn', label: 'p заб. нагн.', color: '#3f8cff' },
      { key: 'pwfPr', label: 'p заб. доб.', color: '#35c46f' },
      { key: 'pavg', label: 'p сред', color: '#d7dde6' }
    ]);
    this.ch4 = new Chart(document.getElementById('ch4'), [
      { key: 'Np', label: 'нефть накопл.', color: '#ffb547' }
    ], { y0Fixed: true });
    var self = this;
    window.addEventListener('resize', function () { self.resizeAll(); });
    setTimeout(function () { self.resizeAll(); }, 60);
  }

  Charts.prototype.update = function (hist) {
    this.ch1.setData(hist);
    this.ch2.setData(hist);
    this.ch3.setData(hist);
    this.ch4.setData(hist);
  };

  Charts.prototype.resizeAll = function () {
    this.ch1.resize(); this.ch2.resize(); this.ch3.resize(); this.ch4.resize();
  };

  root.PebiUI.Charts = Charts;
})(window);
