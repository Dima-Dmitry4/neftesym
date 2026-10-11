/* Главный контроллер приложения: сборка, цикл расчета, привязка управления. */
(function (root) {
  'use strict';
  var Pebi = root.Pebi, UI = root.PebiUI;

  function toast(msg, hideMs) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._h);
    toast._h = setTimeout(function () { t.hidden = true; }, hideMs || 3500);
  }

  function App() {
    this.params = Pebi.defaultParams();
    this.sim = null;
    this.map = null;
    this.charts = null;
    this.playing = false;
    this.stepsPerFrame = 4;
    this.budgetMs = 0; // 0 = без бюджета по числу шагов
    this._chartsTimer = 0;
  }

  App.prototype.boot = function () {
    if (!Pebi || !Pebi.generate) { toast('Не загружено числовое ядро (js/core)'); return; }
    if (!root.d3 || !root.d3.Delaunay) { toast('Не загружена библиотека d3-delaunay (vendor/)'); return; }

    this.map = new UI.MapView(document.getElementById('map-canvas'), document.getElementById('tooltip'));
    this.charts = new UI.Charts();
    this._bindWellCards();
    this._bindRunControls();
    this._bindMeshControls();
    this._bindProps();
    this._bindMapToolbar();

    var self = this;
    this.rebuildMesh(true);

    // главный цикл: rAF + резервный setInterval (rAF замирает у невидимых вкладок)
    this._lastTick = 0;
    this._ticking = false;
    var loop = function () {
      self._safeTick();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    setInterval(function () {
      if (performance.now() - self._lastTick > 300) self._safeTick();
    }, 250);
  };

  App.prototype._safeTick = function () {
    if (this._ticking) return;
    this._ticking = true;
    try { this._tick(); } catch (e) {
      console.error(e);
      toast('Ошибка кадра: ' + e.message, 6000);
    } finally {
      this._ticking = false;
      this._lastTick = performance.now();
    }
  };

  // ---------- сборка сетки / симулятора ----------
  App.prototype.rebuildMesh = function (first) {
    var self = this;
    var btn = document.getElementById('btn-rebuild');
    btn.disabled = true;
    btn.textContent = 'Строю сетку…';
    this.playing = false;
    this._updatePlayBtn();
    setTimeout(function () { self._buildMeshNow(); }, 30);
  };

  App.prototype._buildMeshNow = function () {
    var self = this;
    try {
      var p = self.params;
      var mesh = Pebi.generate({
        Lx: p.domain.Lx, Ly: p.domain.Ly, wells: p.wells,
        sMin: Math.max(3, 27 * p.wells[0].rw),
        targetCells: p.mesh.targetCells, RGrad: p.mesh.RGrad, seed: p.mesh.seed
      }, root.d3.Delaunay);
      self.mesh = mesh;
      self.sim = new Pebi.Simulator(p, mesh);
      self.map.setMesh(mesh, self.sim);
      self.map.render();
      self.charts.update(self.sim.history);
      document.getElementById('st-cells').textContent = mesh.N;
      var warns = self.sim.wells.filter(function (w) { return w.warn; });
      if (warns.length) toast('Предупреждение: ' + warns[0].warn, 6000);
    } catch (e) {
      toast('Ошибка построения сетки: ' + e.message);
      console.error(e);
    }
    var btn = document.getElementById('btn-rebuild');
    btn.disabled = false;
    btn.textContent = 'Перестроить сетку';
    self._updateWellFacts();
  };

  App.prototype.applyProps = function () {
    var self = this;
    // собрать кандидат параметров из полей, провалидировать, только потом применять
    var candidate = JSON.parse(JSON.stringify(this.params));
    var invalid = null;
    document.querySelectorAll('.prop').forEach(function (inp) {
      var path = inp.dataset.p.split('.');
      var v = parseFloat(inp.value);
      var obj = candidate;
      for (var i = 0; i < path.length - 1; i++) obj = obj[path[i]];
      if (!isFinite(v)) { invalid = inp.dataset.p + ': не число'; return; }
      obj[path[path.length - 1]] = v;
    });
    if (!invalid) {
      if (!(candidate.rock.k > 0)) invalid = 'проницаемость должна быть > 0';
      else if (!(candidate.rock.phi > 0 && candidate.rock.phi <= 1)) invalid = 'пористость — в (0, 1]';
      else if (!(candidate.domain.h > 0)) invalid = 'толщина должна быть > 0';
      else if (!(candidate.fluid.muw > 0 && candidate.fluid.muo > 0)) invalid = 'вязкости должны быть > 0';
      else if (candidate.fluid.swc + candidate.fluid.sor >= 1) invalid = 'S_wc + S_or должно быть < 1';
      else if (candidate.fluid.cw < 0 || candidate.fluid.co < 0 || candidate.rock.cr < 0) invalid = 'сжимаемости должны быть >= 0';
      else if (!(candidate.init.p0 > 0)) invalid = 'начальное давление должно быть > 0';
    }
    if (invalid) { toast('Параметры не применены: ' + invalid); return; }
    this.params = candidate;
    // сохранить текущее управление скважинами
    for (var i = 0; i < this.params.wells.length; i++) {
      this.params.wells[i].mode = this.sim.controls[i].mode;
      this.params.wells[i].value = this.sim.controls[i].value;
    }
    try {
      this.sim = new Pebi.Simulator(this.params, this.mesh);
    } catch (e) {
      toast('Ошибка параметров: ' + e.message, 6000);
      return;
    }
    this.map.setMesh(this.mesh, this.sim);
    this.sim.controls.forEach(function (c, i) {
      // вернуть управление из карточек
      var card = document.getElementById('well-' + i);
      var mode = card.querySelector('.well-mode').value;
      var val = parseFloat(card.querySelector('.well-slider').value);
      c.mode = mode; c.value = val;
    });
    this.sim.reset();
    this.playing = false;
    this._updatePlayBtn();
    this.map.dirty = true;
    this.charts.update(this.sim.history);
    toast('Параметры применены, расчет сброшен');
  };

  // ---------- цикл ----------
  App.prototype._tick = function () {
    if (!this.sim) return;
    if (this.playing) {
      try {
        if (this.budgetMs > 0) this.sim.runSteps(100000, this.budgetMs);
        else this.sim.runSteps(this.stepsPerFrame, 0);
        this.map.dirty = true;
        if (this.sim.lastError) {
          toast('Расчет остановлен: ' + this.sim.lastError, 8000);
          this.sim.lastError = null;
          this.playing = false;
          this._updatePlayBtn();
        }
      } catch (e) {
        toast('Ошибка расчета: ' + e.message, 8000);
        console.error(e);
        this.playing = false;
        this._updatePlayBtn();
      }
    }
    if (this.map.dirty) this.map.render();
    this._updateStatus();
    this._updateWellFacts();
    var now = performance.now();
    if (now - this._chartsTimer > 250) {
      this._chartsTimer = now;
      this.charts.update(this.sim.history);
    }
  };

  App.prototype._updateStatus = function () {
    var st = this.sim.state;
    var t = st.t;
    document.getElementById('st-time').textContent =
      t >= 365 ? (t / 365).toFixed(2) + ' лет' : t.toFixed(1) + ' сут';
    document.getElementById('st-step').textContent = st.step;
    document.getElementById('st-dt').textContent = st.lastDt >= 1 ? st.lastDt.toFixed(1) + ' сут' : (st.lastDt * 24).toFixed(1) + ' ч';
    var imb = this.sim.diag.imbW;
    document.getElementById('st-imb').textContent = Math.abs(imb) < 0.01 ? '0' : imb.toExponential(1);
    document.getElementById('st-ms').textContent = this.sim.diag.ms.toFixed(0);
  };

  App.prototype._updateWellFacts = function () {
    for (var i = 0; i < this.sim.wells.length; i++) {
      var wl = this.sim.wells[i];
      var card = document.getElementById('well-' + i);
      card.querySelector('.fact-pwf').textContent = wl.mode === 'bhp' ? wl.value.toFixed(0) : wl.pwfActual.toFixed(0);
      card.querySelector('.fact-q').textContent = (wl.qws + wl.qos).toFixed(1);
    }
  };

  // ---------- привязка ----------
  App.prototype._bindWellCards = function () {
    var self = this;
    for (var i = 0; i < 2; i++) {
      (function (idx) {
        var card = document.getElementById('well-' + idx);
        var modeSel = card.querySelector('.well-mode');
        var slider = card.querySelector('.well-slider');
        var label = card.querySelector('.well-slider-label');
        var val = card.querySelector('.well-value');
        var well = self.params.wells[idx];

        function applyRange() {
          var m = modeSel.value;
          // при смене режима сохраняем текущее число слайдера, если оно в новом диапазоне
          var cur = parseFloat(slider.value);
          if (m === 'bhp') {
            label.textContent = 'Забойное давление, бар';
            slider.min = 50; slider.max = 350; slider.step = 1;
            slider.value = Math.min(350, Math.max(50, isFinite(cur) ? cur : well.value));
          } else {
            label.textContent = idx === 0 ? 'Приемистость, м³/сут' : 'Дебит жидкости, м³/сут';
            slider.min = 0; slider.max = idx === 0 ? 5000 : 3000; slider.step = 10;
            slider.value = Math.min(slider.max, Math.max(0, isFinite(cur) ? cur : well.value));
          }
          val.textContent = (+slider.value).toFixed(0);
        }
        modeSel.addEventListener('change', function () {
          applyRange();
          self.sim.setWellControl(idx, modeSel.value, parseFloat(slider.value));
        });
        slider.addEventListener('input', function () {
          val.textContent = (+slider.value).toFixed(0);
          self.sim.setWellControl(idx, modeSel.value, parseFloat(slider.value));
        });
        card.addEventListener('click', function (e) {
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
          self.selectWell(idx);
        });
        applyRange();
      })(i);
    }
    this.selectWell(0);
  };

  App.prototype.selectWell = function (idx) {
    this.selectedWell = idx;
    this.map.selectedWell = idx;
    this.map.dirty = true;
    for (var i = 0; i < 2; i++) {
      document.getElementById('well-' + i).classList.toggle('selected', i === idx);
    }
  };

  App.prototype._bindRunControls = function () {
    var self = this;
    document.getElementById('btn-play').addEventListener('click', function () {
      self.playing = !self.playing;
      self._updatePlayBtn();
    });
    document.getElementById('btn-step').addEventListener('click', function () {
      if (!self.sim) return;
      var r = self.sim.stepOnce();
      if (!r.ok) toast('Шаг не выполнился: ' + r.error);
      self.map.dirty = true;
    });
    document.getElementById('btn-reset').addEventListener('click', function () {
      if (!self.sim) return;
      self.sim.reset();
      self.map.dirty = true;
      self.charts.update(self.sim.history);
      self.map.render();
    });
    document.getElementById('sel-speed').addEventListener('change', function (e) {
      var v = parseInt(e.target.value, 10);
      if (v === 0) { self.budgetMs = 25; self.stepsPerFrame = 100000; }
      else { self.budgetMs = 0; self.stepsPerFrame = v; }
    });
  };

  App.prototype._updatePlayBtn = function () {
    var b = document.getElementById('btn-play');
    b.textContent = this.playing ? '⏸ Пауза' : '▶ Пуск';
    b.classList.toggle('running', this.playing);
  };

  App.prototype._bindMeshControls = function () {
    var self = this;
    document.getElementById('mesh-cells').addEventListener('input', function (e) {
      self.params.mesh.targetCells = parseInt(e.target.value, 10);
      document.getElementById('cells-label').textContent = e.target.value;
    });
    document.getElementById('mesh-grad').addEventListener('input', function (e) {
      self.params.mesh.RGrad = parseInt(e.target.value, 10);
      document.getElementById('grad-label').textContent = e.target.value + ' м';
    });
    document.getElementById('btn-rebuild').addEventListener('click', function () {
      self.rebuildMesh(false);
    });
  };

  App.prototype._bindProps = function () {
    var self = this;
    document.querySelectorAll('.prop').forEach(function (inp) {
      inp.addEventListener('change', function () { self.applyProps(); });
    });
  };

  App.prototype._bindMapToolbar = function () {
    var self = this;
    var bp = document.getElementById('btn-field-p');
    var bs = document.getElementById('btn-field-s');
    bp.addEventListener('click', function () {
      self.map.field = 'p';
      self.map.dirty = true;
      bp.classList.add('active'); bs.classList.remove('active');
    });
    bs.addEventListener('click', function () {
      self.map.field = 's';
      self.map.dirty = true;
      bs.classList.add('active'); bp.classList.remove('active');
    });
    document.getElementById('chk-grid').addEventListener('change', function (e) {
      self.map.showGrid = e.target.checked;
      self.map.dirty = true;
    });
    document.getElementById('map-canvas').addEventListener('click', function (e) {
      var w = self.map.pickWell(e);
      if (w >= 0) self.selectWell(w);
    });
  };

  window.addEventListener('DOMContentLoaded', function () {
    var app = new App();
    root.PebiApp = app;
    app.boot();
  });
})(window);
