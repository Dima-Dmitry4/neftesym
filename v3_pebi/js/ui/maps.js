/* Отрисовка карты: заливка ячеек по давлению/насыщенности, легенда, скважины, tooltip. */
(function (root) {
  'use strict';
  root.PebiUI = root.PebiUI || {};

  // Цветовые шкалы (остановки [t, #hex])
  function makeCmap(stops) {
    return function (t) {
      if (t <= 0) return stops[0];
      if (t >= 1) return stops[stops.length - 1];
      for (var i = 1; i < stops.length; i++) {
        if (t <= stops[i][0]) {
          var a = stops[i - 1], b = stops[i];
          var u = (t - a[0]) / (b[0] - a[0]);
          return [
            Math.round(a[1] + u * (b[1] - a[1])),
            Math.round(a[2] + u * (b[2] - a[2])),
            Math.round(a[3] + u * (b[3] - a[3]))
          ];
        }
      }
      return stops[stops.length - 1];
    };
  }
  function hex2rgb(h) {
    return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)];
  }
  function cmapFromHex(list) {
    var n = list.length - 1;
    return makeCmap(list.map(function (h, i) {
      var rgb = hex2rgb(h[0]);
      return [i / n, rgb[0], rgb[1], rgb[2]];
    }));
  }
  // Turbo-подобная шкала (давление): синий -> красный
  var cmapPressure = cmapFromHex([
    ['#30123b'], ['#4148ad'], ['#4675ed'], ['#3e9df5'], ['#3cc5f0'], ['#45e6b0'],
    ['#6ffb73'], ['#a4fc3c'], ['#d7e838'], ['#f9c832'], ['#fb9926'], ['#f5691c'],
    ['#e13f19'], ['#b81a19'], ['#8b000a']
  ]);
  // Насыщенность: песок (нефть) -> голубой -> синий (вода)
  var cmapSw = cmapFromHex([
    ['#8c5a2b'], ['#b98a4e'], ['#d9bd82'], ['#cfd0a4'], ['#8fc4bb'], ['#4a9dc9'], ['#2a6fd6'], ['#1c3fb8']
  ]);
  var NBUCKETS = 72;

  function rgbStr(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }

  function MapView(canvas, tooltipEl) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tooltip = tooltipEl;
    this.mesh = null;
    this.sim = null;
    this.field = 'p';          // 'p' | 's'
    this.showGrid = false;
    this.selectedWell = 0;
    this.dirty = true;         // перерисовать при следующем _tick
    this._gridPath = null;
    this._dpr = 1;
    var self = this;
    canvas.addEventListener('mousemove', function (e) { self._onMove(e); });
    canvas.addEventListener('mouseleave', function () { self.tooltip.hidden = true; });
    window.addEventListener('resize', function () { self.resize(); });
  }

  MapView.prototype.setMesh = function (mesh, sim) {
    this.mesh = mesh;
    this.sim = sim;
    this._gridPath = null;
    this.dirty = true;
    this.resize();
  };

  MapView.prototype.resize = function () {
    if (!this.mesh) return;
    var r = this.canvas.getBoundingClientRect();
    // вырожденный layout (карта схлопнулась) — не портим трансформацию, повторим позже
    if (r.width < 60 || r.height < 60) return;
    var dpr = window.devicePixelRatio || 1;
    this._dpr = dpr;
    this._cssW = r.width; this._cssH = r.height;
    this.canvas.width = Math.max(2, Math.round(r.width * dpr));
    this.canvas.height = Math.max(2, Math.round(r.height * dpr));
    // преобразование координат: вписать область в канвас
    var pad = 18 * dpr;
    var sx = (this.canvas.width - 2 * pad) / this.mesh.Lx;
    var sy = (this.canvas.height - 2 * pad) / this.mesh.Ly;
    var s = Math.min(sx, sy);
    if (!(s > 0)) return;
    this._scale = s;
    this._ox = (this.canvas.width - s * this.mesh.Lx) / 2;
    this._oy = (this.canvas.height - s * this.mesh.Ly) / 2;
    this._gridPath = null;
    this.dirty = true; // canvas.width сбросил растровое содержимое — нужна перерисовка
  };

  MapView.prototype._tx = function (x) { return this._ox + x * this._scale; };
  MapView.prototype._ty = function (y) { return this.canvas.height - (this._oy + y * this._scale); };

  // Значение поля для ячейки и границы шкалы
  MapView.prototype._fieldRange = function () {
    if (this.field === 'p') {
      var mn = Infinity, mx = -Infinity, S = this.sim.state.p;
      for (var i = 0; i < this.mesh.N; i++) {
        if (S[i] < mn) mn = S[i];
        if (S[i] > mx) mx = S[i];
      }
      return [mn, mx];
    }
    var f = this.sim.fluid, smax = 1 - f.sor;
    var Sv = this.sim.state.S;
    for (var j = 0; j < this.mesh.N; j++) if (Sv[j] > smax) smax = Sv[j];
    return [f.swc, Math.min(1, Math.max(smax, f.swc + 0.05))];
  };

  MapView.prototype.render = function () {
    if (!this.mesh || !this.sim) return;
    // самовосстановление: если CSS-размер изменился (или был вырожден) — пересчитать трансформацию
    var r = this.canvas.getBoundingClientRect();
    if (r.width > 60 && r.height > 60 &&
        (Math.abs(r.width - (this._cssW || 0)) > 1 || Math.abs(r.height - (this._cssH || 0)) > 1 || !(this._scale > 0))) {
      this.resize();
    }
    if (!(this._scale > 0)) return;
    var ctx = this.ctx, mesh = this.mesh, st = this.sim.state;
    var W = this.canvas.width, H = this.canvas.height;
    ctx.fillStyle = '#0f1216';
    ctx.fillRect(0, 0, W, H);

    var range = this._fieldRange();
    var lo = range[0], hi = Math.max(range[0] + 1e-9, range[1]);
    var vals = this.field === 'p' ? st.p : st.S;
    var cmap = this.field === 'p' ? cmapPressure : cmapSw;

    // прямая поячеечная заливка (~8 мс на 3-4 тыс. ячеек; заливка общих Path2D
    // корзин давала недетерминированные дыры в растеризаторе)
    for (var i = 0; i < mesh.N; i++) {
      var t = (vals[i] - lo) / (hi - lo);
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      var c = cmap(t);
      ctx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
      ctx.beginPath();
      var k0 = mesh.polyStart[i], k1 = mesh.polyStart[i + 1];
      ctx.moveTo(this._tx(mesh.polyCoords[2 * k0]), this._ty(mesh.polyCoords[2 * k0 + 1]));
      for (var k = k0 + 1; k < k1; k++) {
        ctx.lineTo(this._tx(mesh.polyCoords[2 * k]), this._ty(mesh.polyCoords[2 * k + 1]));
      }
      ctx.closePath();
      ctx.fill();
    }

    // контур ячеек (по запросу)
    if (this.showGrid) {
      if (!this._gridPath) {
        var gp = new Path2D();
        for (i = 0; i < mesh.N; i++) {
          k0 = mesh.polyStart[i]; k1 = mesh.polyStart[i + 1];
          gp.moveTo(this._tx(mesh.polyCoords[2 * k0]), this._ty(mesh.polyCoords[2 * k0 + 1]));
          for (k = k0 + 1; k < k1; k++) {
            gp.lineTo(this._tx(mesh.polyCoords[2 * k]), this._ty(mesh.polyCoords[2 * k + 1]));
          }
          gp.closePath();
        }
        this._gridPath = gp;
      }
      ctx.strokeStyle = 'rgba(20,24,30,0.55)';
      ctx.lineWidth = this._dpr * 0.5;
      ctx.stroke(this._gridPath);
    }

    // внешняя граница
    ctx.strokeStyle = '#8a94a4';
    ctx.lineWidth = this._dpr * 1.2;
    ctx.strokeRect(this._tx(0), this._ty(mesh.Ly), mesh.Lx * this._scale, mesh.Ly * this._scale);

    // скважины
    this._drawWells(ctx);

    // легенда
    this._drawLegend(lo, hi);
    this._range = [lo, hi];
    this.dirty = false;
  };

  MapView.prototype._drawWells = function (ctx) {
    var dpr = this._dpr;
    for (var w = 0; w < this.sim.wells.length; w++) {
      var wl = this.sim.wells[w];
      var x = this._tx(wl.x), y = this._ty(wl.y);
      var col = wl.type === 'injector' ? '#3f8cff' : '#35c46f';
      var r = (this.selectedWell === w ? 13 : 10) * dpr;
      // внешнее кольцо выбранной скважины
      if (this.selectedWell === w) {
        ctx.beginPath();
        ctx.arc(x, y, r + 4 * dpr, 0, 2 * Math.PI);
        ctx.strokeStyle = '#ffffffcc';
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = '#0f1216';
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 3 * dpr;
      ctx.stroke();
      // стрелка направления (внутрь для нагнетательной, наружу для добывающей)
      ctx.beginPath();
      if (wl.type === 'injector') {
        ctx.moveTo(x, y - 5 * dpr); ctx.lineTo(x, y + 4 * dpr);
        ctx.lineTo(x - 3.5 * dpr, y); ctx.moveTo(x, y + 4 * dpr); ctx.lineTo(x + 3.5 * dpr, y);
      } else {
        ctx.moveTo(x, y + 5 * dpr); ctx.lineTo(x, y - 4 * dpr);
        ctx.lineTo(x - 3.5 * dpr, y); ctx.moveTo(x, y - 4 * dpr); ctx.lineTo(x + 3.5 * dpr, y);
      }
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.8 * dpr;
      ctx.stroke();
      // подпись
      var label = (wl.type === 'injector' ? 'Нагн. ' : 'Доб. ') +
        (wl.mode === 'bhp' ? 'P=' + wl.value.toFixed(0) + ' бар' : 'q=' + wl.value.toFixed(0) + ' м³/сут');
      ctx.font = (11 * dpr) + 'px "Segoe UI", sans-serif';
      var tw = ctx.measureText(label).width;
      ctx.fillStyle = '#0f1216cc';
      ctx.fillRect(x - tw / 2 - 4 * dpr, y + r + 4 * dpr, tw + 8 * dpr, 15 * dpr);
      ctx.fillStyle = col;
      ctx.textAlign = 'center';
      ctx.fillText(label, x, y + r + 15.5 * dpr);
      ctx.textAlign = 'left';
    }
  };

  MapView.prototype._drawLegend = function (lo, hi) {
    var leg = document.getElementById('legend-canvas');
    var dpr = this._dpr;
    leg.width = 24 * dpr;
    leg.height = Math.round(this.canvas.height / dpr * 0.55);
    var ctx = leg.getContext('2d');
    var H = leg.height;
    var cmap = this.field === 'p' ? cmapPressure : cmapSw;
    for (var y = 0; y < H; y++) {
      var t = 1 - y / (H - 1);
      ctx.fillStyle = rgbStr(cmap(t));
      ctx.fillRect(0, y, leg.width, 1);
    }
    document.getElementById('leg-max').textContent = this._fmt(hi);
    document.getElementById('leg-min').textContent = this._fmt(lo);
    document.getElementById('leg-title').textContent = this.field === 'p' ? 'p, бар' : 'S воды';
  };

  MapView.prototype._fmt = function (v) {
    if (this.field === 's') return v.toFixed(2);
    return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
  };

  MapView.prototype._onMove = function (e) {
    if (!this.mesh || !this.sim) return;
    var rect = this.canvas.getBoundingClientRect();
    var dpr = this._dpr;
    var mx = (e.clientX - rect.left) * dpr, my = (e.clientY - rect.top) * dpr;
    // обратное преобразование
    var dx = (mx - this._ox) / this._scale;
    var dy = (this.canvas.height - my - this._oy) / this._scale;
    var i = this.mesh.delaunay.find(dx, dy);
    if (i < 0) { this.tooltip.hidden = true; return; }
    var st = this.sim.state;
    this.tooltip.innerHTML =
      '<b>ячейка #' + i + '</b><br>' +
      'p = ' + st.p[i].toFixed(1) + ' бар<br>' +
      'S_water = ' + st.S[i].toFixed(3) + '<br>' +
      'x = ' + this.mesh.sites[2 * i].toFixed(0) + ' м, y = ' + this.mesh.sites[2 * i + 1].toFixed(0) + ' м';
    this.tooltip.hidden = false;
    var r = this.canvas.getBoundingClientRect();
    this.tooltip.style.left = Math.min(e.clientX - r.left + 14, r.width - 150) + 'px';
    this.tooltip.style.top = (e.clientY - r.top + 14) + 'px';
  };

  // клик: выбор ближайшей скважины (< 25 px)
  MapView.prototype.pickWell = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    var dpr = this._dpr;
    var mx = (e.clientX - rect.left) * dpr, my = (e.clientY - rect.top) * dpr;
    var best = -1, bestD = 25 * dpr * 25 * dpr;
    for (var w = 0; w < this.sim.wells.length; w++) {
      var wl = this.sim.wells[w];
      var dx = mx - this._tx(wl.x), dy = my - this._ty(wl.y);
      var d2 = dx * dx + dy * dy;
      if (d2 < bestD) { bestD = d2; best = w; }
    }
    return best;
  };

  root.PebiUI.MapView = MapView;
  root.PebiUI.cmapPressure = cmapPressure;
  root.PebiUI.cmapSw = cmapSw;
})(window);
