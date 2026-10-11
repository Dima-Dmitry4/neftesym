/* Движок симулятора: состояние, сценарий по умолчанию, история, материальный баланс. */
(function (root, factory) {
  var api = factory(root.Pebi || {});
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.Pebi = root.Pebi || {}; Object.assign(root.Pebi, api); }
})(typeof self !== 'undefined' ? self : this, function (Pebi) {
  'use strict';
  var fluidMod = (typeof Pebi !== 'undefined' && Pebi.createFluid) ? Pebi : require('./fluid.js');
  var wellsMod = (typeof Pebi !== 'undefined' && Pebi.createWells) ? Pebi : require('./wells.js');
  var pressureMod = (typeof Pebi !== 'undefined' && Pebi.PressureSolver) ? Pebi : require('./pressure.js');
  var transportMod = (typeof Pebi !== 'undefined' && Pebi.TransportSolver) ? Pebi : require('./transport.js');
  var stepper = (typeof Pebi !== 'undefined' && Pebi.adaptiveStep) ? Pebi : require('./timestepper.js');

  function defaultParams() {
    return {
      domain: { Lx: 1000, Ly: 500, h: 10 },
      rock: { k: 100, phi: 0.2, cr: 5.0e-5 },
      fluid: {
        muw: 0.5, muo: 2.0, krw0: 0.3, kro0: 1.0, nw: 2, no: 2,
        swc: 0.2, sor: 0.2, cw: 4.4e-5, co: 1.0e-4, pref: 150
      },
      init: { p0: 150, sw0: 0.2 },
      wells: [
        { type: 'injector', name: 'Нагнетательная', x: 250, y: 250, rw: 0.1, mode: 'bhp', value: 180 },
        { type: 'producer', name: 'Добывающая', x: 750, y: 250, rw: 0.1, mode: 'bhp', value: 120 }
      ],
      mesh: { targetCells: 3000, RGrad: 130, seed: 42 },
      control: {
        dSMax: 0.2, dpMax: 1e9, // dp-контроль выключен: у скважин давление мгновенно привязано к BHP (квазистационарно)
        dt0: 0.05, dtMin: 0.001, dtMax: 60,
        newtonTol: 1e-6, pcgTol: 1e-10, outerIters: 4
      }
    };
  }

  function Simulator(params, mesh) {
    // базовая валидация входных параметров
    var dS = params.fluid.swc + params.fluid.sor;
    if (!(params.rock.k > 0) || !(params.rock.phi > 0) || !(params.domain.h > 0)) {
      throw new Error('Параметры пласта: k, пористость и толщина должны быть > 0');
    }
    if (!(dS < 1)) throw new Error('Сумма S_wc + S_or должна быть < 1');
    if (params.fluid.muw <= 0 || params.fluid.muo <= 0) throw new Error('Вязкости должны быть > 0');
    this.params = params;
    this.mesh = mesh;
    this.fluid = fluidMod.createFluid(params.fluid);
    this.wellsModule = wellsMod;
    // rock с толщиной слоя (h живет в domain)
    var rock = Object.assign({ h: params.domain.h }, params.rock);
    this.wells = wellsMod.createWells(mesh, params.wells, rock.k, rock.h);
    this.pressure = new pressureMod.PressureSolver(mesh, this.fluid, rock);
    this.transport = new transportMod.TransportSolver(mesh, this.fluid, rock);
    this.controls = params.wells.map(function (w) { return { mode: w.mode, value: w.value }; });
    this.diag = { ms: 0, newtonIters: 0, pcgIters: 0, maxDS: 0, maxDP: 0, imbW: 0, imbO: 0 };
    this.history = { t: [], dt: [], qo: [], qw: [], wcut: [], qinj: [], ii: [], pwfIn: [], pwfPr: [], pavg: [], Np: [], imbW: [], imbO: [] };
    this._vTmp = null;
    this.reset();
  }

  Simulator.prototype.reset = function () {
    var n = this.mesh.N;
    var p = new Float64Array(n), S = new Float64Array(n);
    p.fill(this.params.init.p0);
    // начальная насыщенность не ниже swc (иначе транспорт сразу у клампа)
    var sw0 = Math.max(this.params.init.sw0, this.fluid.swc);
    S.fill(sw0);
    this.state = { t: 0, step: 0, p: p, S: S, dtCurrent: this.params.control.dt0, lastDt: 0 };
    var H = this.history;
    for (var k in H) H[k].length = 0;
    this.cums = { Np: 0, Wp: 0, Wi: 0 };
    for (var wI = 0; wI < this.wells.length; wI++) {
      this.wells[wI].qRes = 0; this.wells[wI].qws = 0; this.wells[wI].qos = 0;
      this.wells[wI].pwfActual = this.controls[wI].mode === 'bhp' ? this.controls[wI].value : 0;
    }
    // начальная точка истории
    this._pushHistory(0, { qo: 0, qw: 0, qinj: 0 });
    this._inPlaceRef = this._inPlace();
  };

  Simulator.prototype._inPlace = function () {
    var n = this.mesh.N, fluid = this.fluid, st = this.state;
    var wip = 0, oip = 0;
    for (var i = 0; i < n; i++) {
      var vp = this.transport.VpRef[i] * fluid.vpScale(st.p[i]);
      wip += vp * st.S[i] / fluid.Bw(st.p[i]);
      oip += vp * (1 - st.S[i]) / fluid.Bo(st.p[i]);
    }
    return { wip: wip, oip: oip };
  };

  Simulator.prototype._pushHistory = function (dt, extra) {
    var H = this.history, st = this.state;
    var wells = this.wells;
    var inj = null, prod = null;
    for (var wI = 0; wI < wells.length; wI++) {
      if (wells[wI].type === 'injector') inj = wells[wI];
      else prod = wells[wI];
    }
    var qo = extra && extra.qo !== undefined ? extra.qo : (prod ? prod.qos : 0);
    var qw = extra && extra.qw !== undefined ? extra.qw : (prod ? prod.qws : 0);
    var qinj = extra && extra.qinj !== undefined ? extra.qinj : (inj ? inj.qws : 0);
    var liq = qo + qw;
    var pavg = this.avgPressure();
    H.t.push(st.t); H.dt.push(dt);
    H.qo.push(qo); H.qw.push(qw);
    H.wcut.push(liq > 0 ? qw / liq : 0);
    H.qinj.push(qinj);
    var pwfIn = inj ? inj.pwfActual : 0, pwfPr = prod ? prod.pwfActual : 0;
    H.pwfIn.push(pwfIn); H.pwfPr.push(pwfPr);
    H.ii.push(inj && pwfIn - pavg > 0.1 ? qinj / (pwfIn - pavg) : 0);
    H.pavg.push(pavg);
    H.Np.push(this.cums.Np);
    H.imbW.push(this.diag.imbW);
    if (H.imbO) H.imbO.push(this.diag.imbO);
  };

  Simulator.prototype.commit = function (pNew, SNew, dt, info) {
    var st = this.state, fluid = this.fluid, wells = this.wells;

    // 1. Статусы скважин (референсные дебиты и факт. BHP; подвижности с n — st.S еще старый)
    for (var wI = 0; wI < wells.length; wI++) {
      var wl = wells[wI];
      if (!wl.flowing || wl.qRes === 0) { wl.qws = 0; wl.qos = 0; if (wl.mode === 'rate') wl.pwfActual = 0; continue; }
      var c = wl.cell;
      var Bw = fluid.Bw(pNew[c]), Bo = fluid.Bo(pNew[c]);
      var fw1 = fluid.fw(SNew[c]);
      if (wl.type === 'injector') {
        wl.qws = wl.qRes / Bw; wl.qos = 0;
        wl.pwfActual = wl.mode === 'bhp' ? wl.value : (pNew[c] + wl.qRes / (wl.WI * fluid.lamT(st.S[c])));
      } else {
        wl.qws = fw1 * wl.qRes / Bw;
        wl.qos = (1 - fw1) * wl.qRes / Bo;
        wl.pwfActual = wl.mode === 'bhp' ? wl.value : (pNew[c] - wl.qRes / (wl.WI * fluid.lamT(st.S[c])));
      }
    }
    var inj = null, prod = null;
    for (wI = 0; wI < wells.length; wI++) {
      if (wells[wI].type === 'injector') inj = wells[wI]; else prod = wells[wI];
    }
    var injW = inj && inj.flowing ? inj.qws : 0;
    var prodW = prod && prod.flowing ? prod.qws : 0;
    var prodO = prod && prod.flowing ? prod.qos : 0;

    // 2. Обновить состояние ДО баланса (иначе dWIP считается по старому состоянию)
    st.p.set(pNew);
    st.S.set(SNew);
    st.t += dt;
    st.step++;

    // 3. Балансы
    var ip = this._inPlace();
    this.diag.imbW = dt > 0 ? (ip.wip - this._inPlaceRef.wip) / dt - (injW - prodW) : 0;
    this.diag.imbO = dt > 0 ? (ip.oip - this._inPlaceRef.oip) / dt - (-prodO) : 0;
    this._inPlaceRef = ip;
    this.cums.Np += prodO * dt;
    this.cums.Wp += prodW * dt;
    this.cums.Wi += injW * dt;

    this.diag.ms = info.ms; this.diag.newtonIters = info.newtonIters;
    this.diag.pcgIters = info.pcgIters; this.diag.maxDS = info.maxDS; this.diag.maxDP = info.maxDP;
    this.diag.floored = info.floored;
    this._pushHistory(dt, {});
  };

  Simulator.prototype.stepOnce = function () {
    return stepper.adaptiveStep(this);
  };

  // Серия шагов с ограничением по времени (для UI). Возвращает число выполненных шагов.
  Simulator.prototype.runSteps = function (maxSteps, budgetMs) {
    var t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    var done = 0;
    while (done < maxSteps) {
      var r = this.stepOnce();
      if (!r.ok) { this.lastError = r.error; break; }
      done++;
      if (budgetMs && (typeof performance !== 'undefined' ? performance : Date).now() - t0 > budgetMs) break;
    }
    return done;
  };

  Simulator.prototype.avgPressure = function () {
    var n = this.mesh.N, st = this.state, Vp = this.transport.VpRef;
    var s = 0, v = 0;
    for (var i = 0; i < n; i++) { s += Vp[i] * st.p[i]; v += Vp[i]; }
    return v > 0 ? s / v : 0;
  };

  Simulator.prototype.setWellControl = function (idx, mode, value) {
    this.controls[idx].mode = mode;
    this.controls[idx].value = value;
  };

  return { defaultParams: defaultParams, Simulator: Simulator };
});
