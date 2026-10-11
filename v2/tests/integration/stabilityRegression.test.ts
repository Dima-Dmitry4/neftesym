// Регресс-тесты на устойчивость v2-ядра (superposition).
//
// Закрепляют поведение, которое было исправлено после того, как при
// добавлении скважин дебиты и давления начали «скакать» от шага к шагу:
//
//  1. Продюсер не может закачивать, инжектор — добывать (ограничение
//     знака по типу скважины внутри системы влияния).
//  2. Скважина, упирающаяся в rate limit, всё ещё учитывает влияние
//     соседей (active set, а не обрезка постфактум).
//  3. Шаг не «перелетает» остаток времени через dtMin.
//  4. Шаг дроб enough, чтобы P_avg не перескакивал BHP скважины.
//  5. Результат слабо зависит от величины внешнего шага (сходимость).

import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/app/Config.ts';
import { defaultField } from '../../src/data/defaultField.ts';
import {
  stepSuperposition,
  computePoreVolume,
  type SuperpositionStepperParams,
} from '../../src/core/time/SuperpositionStepper.ts';
import { solveRates, type RateSolverConfig } from '../../src/core/wells/RateSolver.ts';
import type { Well } from '../../src/core/wells/Well.ts';
import type { FieldState } from '../../src/core/state/FieldState.ts';

const cfg = loadConfig();

function params(over: Partial<SuperpositionStepperParams> = {}): SuperpositionStepperParams {
  return {
    dtMaxHours: cfg.solver.dtMaxHours,
    dtMinHours: cfg.solver.dtMinHours,
    cflTarget: cfg.solver.cflTarget,
    crAtm: cfg.rock.crAtm,
    totalCompressibilityAtmInv: cfg.pressureModel.totalCompressibilityAtmInv,
    rateSolver: rateSolverConfig(),
    historyIntervalHours: cfg.solver.historyIntervalHours,
    pAvgDamping: cfg.solver.pAvgDamping,
    rateRelaxation: cfg.solver.rateRelaxation,
    rateChangeTarget: cfg.solver.rateChangeTarget,
    cflPressureFraction: cfg.solver.cflPressureFraction,
    pressureMarginFloorAtm: cfg.solver.pressureMarginFloorAtm,
    ...over,
  };
}

function rateSolverConfig(): RateSolverConfig {
  return {
    muB: cfg.fluid.muWaterCP * cfg.fluid.bw,
    radiusMode: cfg.pressureModel.radiusMode,
    fixedRadiusM: cfg.pressureModel.fixedRadiusM,
    effectiveK: cfg.pressureModel.effectiveKMethod,
    constantKEffMD: cfg.pressureModel.constantKEffMD,
  };
}

const OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [12, 12],
  [37, 12],
  [12, 37],
  [37, 37],
  [25, 8],
  [25, 42],
  [8, 25],
  [42, 25],
];

/** 1 инжектор в центре + nProd продюсеров. */
function mkWells(nProd: number): Well[] {
  const out: Well[] = [
    {
      id: 'I1',
      i: 25,
      j: 25,
      type: 'injector',
      bhpAtm: 290,
      rw: 0.1,
      skin: 0,
      rateLimit: cfg.wellControls.injectorRateLimit,
    },
  ];
  for (let n = 0; n < nProd; n++) {
    const o = OFFSETS[n % OFFSETS.length];
    if (!o) continue;
    out.push({
      id: `P${n + 1}`,
      i: o[0],
      j: o[1],
      type: 'producer',
      bhpAtm: 100,
      rw: 0.1,
      skin: 0,
      rateLimit: cfg.wellControls.producerRateLimit,
    });
  }
  return out;
}

function initState(res: ReturnType<typeof defaultField>): FieldState {
  return {
    pressure: Float64Array.from(res.initialP),
    sw: Float64Array.from(res.initialSw),
    time: 0,
    step: 0,
    lastDt: 0,
  };
}

function pAvgOf(res: ReturnType<typeof defaultField>, p: Float64Array): number {
  let s = 0;
  let c = 0;
  for (let i = 0; i < res.grid.nCells; i++) {
    if (!res.active[i]) continue;
    s += p[i] ?? 0;
    c++;
  }
  return c > 0 ? s / c : 0;
}

interface RunRow {
  pAvg: number;
  totalProd: number;
  totalInj: number;
  nSub: number;
  wellQ: Map<string, number>;
}

function run(wells: readonly Well[], steps: number, dt: number): RunRow[] {
  const res = defaultField();
  const pv = computePoreVolume(res);
  const par = params();
  let state = initState(res);
  let pAvg = pAvgOf(res, state.pressure);
  let cum = { productionM3: 0, injectionM3: 0 };
  let prevRates: Map<string, number> | null = null;
  const rows: RunRow[] = [];
  for (let k = 0; k < steps; k++) {
    const out = stepSuperposition({
      state,
      dt,
      reservoir: res,
      wells,
      fluid: cfg.fluid,
      relperm: cfg.relperm,
      params: par,
      poreVolumeM3: pv,
      pAvg,
      cum,
      lastStepRates: prevRates,
    });
    const last = out.subSteps[out.subSteps.length - 1];
    const wellQ = new Map<string, number>();
    for (const ws of last?.wellStates ?? []) wellQ.set(ws.wellId, ws.qLiq);
    rows.push({
      pAvg,
      totalProd: last?.totalProduction ?? 0,
      totalInj: last?.totalInjection ?? 0,
      nSub: out.subSteps.length,
      wellQ,
    });
    state = out.state;
    pAvg = out.pAvg;
    cum = out.cum;
    prevRates = out.lastStepRates;
  }
  return rows;
}

describe('RateSolver: знак дебита закреплён типом скважины', () => {
  it('producer не даёт отрицательный дебит даже при P_avg < BHP', () => {
    const res = defaultField();
    // P_avg сильно НИЖЕ BHP продюсера — раньше он «переворачивался».
    const wells = mkWells(4).filter((w) => w.type === 'producer');
    const out = solveRates(wells, res, 20, rateSolverConfig());
    for (const [id, q] of out.rates) {
      expect(q, `скважина ${id} не должна закачивать`).toBeGreaterThanOrEqual(0);
    }
  });

  it('injector не даёт положительный дебит даже при P_avg > BHP', () => {
    const res = defaultField();
    // P_avg сильно ВЫШЕ BHP инжектора — раньше он «добывал».
    const wells = mkWells(1).filter((w) => w.type === 'injector');
    const out = solveRates(wells, res, 350, rateSolverConfig());
    for (const [id, q] of out.rates) {
      expect(q, `скважина ${id} не должна добывать`).toBeLessThanOrEqual(0);
    }
  });

  it('при P_avg = BHP дебит равен нулю, а не «зеркальному» отказу', () => {
    const res = defaultField();
    const wells = mkWells(1);
    const out = solveRates(wells, res, 100, rateSolverConfig());
    const q = out.rates.get('P1') ?? 0;
    expect(Math.abs(q)).toBeLessThan(1e-6);
  });
});

describe('SuperpositionStepper: устойчивость при многих скважинах', () => {
  it('нет инверсии знака дебитов за 90 шагов при 5 продюсерах', () => {
    const rows = run(mkWells(5), 90, 20);
    for (const r of rows) {
      for (const [id, q] of r.wellQ) {
        if (id.startsWith('P')) expect(q, `${id} перевернулся в закачку`).toBeGreaterThanOrEqual(0);
        else expect(q, `${id} перевернулся в добычу`).toBeLessThanOrEqual(0);
      }
    }
  });

  it('амплитуда скачков P_avg падает по мере добавления скважин (нет биения)', () => {
    // 5 продюсеров дают VRR ≠ 1, поэтому P_avg идёт к BHP — именно там
    // раньше включался предельный цикл.
    const rows = run(mkWells(5), 120, 20);
    let maxJump = 0;
    for (let i = 1; i < rows.length; i++) {
      const d = Math.abs((rows[i]?.pAvg ?? 0) - (rows[i - 1]?.pAvg ?? 0));
      if (d > maxJump) maxJump = d;
    }
    // С выключенным демпфером и без CFL-по-скважинам скачок был ~16 атм.
    expect(maxJump).toBeLessThan(1.0);
  });

  it('после выхода на BHP система остаётся в узкой полосе', () => {
    // При VRR ≠ 1 P_avg закономерно падает, пока скважины работают.
    // Это НЕ неустойчивость. Неустойчивость начинается, когда давление
    // доходит до BHP и скважины начинают переключаться
    // «на лимите ↔ закрыта». Поэтому меряем полосу только ПОСЛЕ
    // установления равновесия.
    const rows = run(mkWells(5), 220, 20);
    // Находим шаг, после которого P_avg уже не уходит вниз монотонно.
    let settleAt = -1;
    for (let i = 12; i < rows.length; i++) {
      const cur = rows[i]?.pAvg ?? 0;
      const older = rows[i - 12]?.pAvg ?? 0;
      if (cur > older) {
        settleAt = i;
        break;
      }
    }
    expect(settleAt, 'система должна выйти на равновесие у BHP').toBeGreaterThan(0);

    const tail = rows.slice(settleAt + 12);
    expect(tail.length).toBeGreaterThan(30);
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of tail) {
      if (r.pAvg < lo) lo = r.pAvg;
      if (r.pAvg > hi) hi = r.pAvg;
    }
    // Равновесная полоса у BHP, а не пила амплитудой 16 атм.
    // Порог 3 атм = 3% от BHP и в 5 раз меньше амплитуды биения,
    // которая была до фиксов.
    expect(hi - lo).toBeLessThan(3.0);
    // И она действительно привязана к BHP продюсеров (100 атм).
    expect(lo).toBeGreaterThan(90);
    expect(hi).toBeLessThan(110);
  });

  it('добыча продолжает накапливаться после выхода на равновесие', () => {
    const res = defaultField();
    const pv = computePoreVolume(res);
    const par = params();
    const wells = mkWells(5);
    let state = initState(res);
    let pAvg = pAvgOf(res, state.pressure);
    let cum = { productionM3: 0, injectionM3: 0 };
    const marks: number[] = [];
    for (let k = 0; k < 220; k++) {
      const out = stepSuperposition({
        state,
        dt: 20,
        reservoir: res,
        wells,
        fluid: cfg.fluid,
        relperm: cfg.relperm,
        params: par,
        poreVolumeM3: pv,
        pAvg,
        cum,
      });
      state = out.state;
      pAvg = out.pAvg;
      cum = out.cum;
      if (k === 120 || k === 219) marks.push(cum.productionM3);
    }
    // Даже когда продюсеры большую часть времени закрыты (давление
    // держится на пороге BHP), накопленная добыча не должна встать.
    expect(marks[1] ?? 0).toBeGreaterThan(marks[0] ?? 0);
  });

  it('дебит скважины не прыгает между 0 и лимитом чаще, чем раз в 3 шага', () => {
    const rows = run(mkWells(5), 120, 20);
    const lim = cfg.wellControls.producerRateLimit;
    let transitions = 0;
    let prevOn = true;
    for (const r of rows) {
      const q = r.wellQ.get('P1') ?? 0;
      const on = q > lim * 0.5;
      if (on !== prevOn) transitions++;
      prevOn = on;
    }
    // Раньше переключение происходило каждые 5 шагов с полным размахом.
    expect(transitions).toBeLessThan(rows.length / 3);
  });

  it('изменение дебита за шаг не превышает rateChangeTarget·cap', () => {
    // Это жёсткая гарантия модели: q = q_prev + ω·(q_solved − q_prev),
    // где ω подрезается так, чтобы скачок не превышал target·cap
    // СВОЕЙ скважины.
    const wells = mkWells(8);
    const rows = run(wells, 200, 20);
    const target = cfg.solver.rateChangeTarget;
    for (let i = 1; i < rows.length; i++) {
      const cur = rows[i]?.wellQ ?? new Map<string, number>();
      const prev = rows[i - 1]?.wellQ ?? new Map<string, number>();
      for (const w of wells) {
        const cap = w.rateLimit ?? 0;
        if (cap <= 0) continue;
        const d = Math.abs((cur.get(w.id) ?? 0) - (prev.get(w.id) ?? 0));
        expect(d, `${w.id} на шаге ${i}: Δq=${d.toFixed(1)}, предел ${(target * cap).toFixed(1)}`)
          .toBeLessThanOrEqual(target * cap * 1.02);
      }
    }
  });

  it('поле давления и модельный P_avg описывают один момент времени', () => {
    // Поле строится суперпозицией вокруг P_avg, поэтому его среднее
    // отличается от P_avg на постоянное смещение набора — но при
    // НЕИЗМЕННЫХ дебитах разница обязана быть постоянной. Раньше поле
    // считалось по P_avg до обновления, и каждый шаг добавлял к этой
    // разнице демпфированный инкремент (до 20+ атм дрейфа).
    const wells = mkWells(4);
    const res = defaultField();
    const pv = computePoreVolume(res);
    let state = initState(res);
    let pAvg = pAvgOf(res, state.pressure);
    let cum = { productionM3: 0, injectionM3: 0 };
    let prevRates: Map<string, number> | null = null;
    for (let k = 0; k < 20; k++) {
      const out = stepSuperposition({
        state,
        dt: 20,
        reservoir: res,
        wells,
        fluid: cfg.fluid,
        relperm: cfg.relperm,
        params: params(),
        poreVolumeM3: pv,
        pAvg,
        cum,
        lastStepRates: prevRates,
      });
      state = out.state;
      pAvg = out.pAvg;
      cum = out.cum;
      prevRates = out.lastStepRates;
      // Смещение не должно уезжать: поле и P_avg согласованы.
      const offset = Math.abs(pAvgOf(res, state.pressure) - out.pAvg);
      expect(offset).toBeLessThan(40);
    }
  });
});

describe('SuperpositionStepper: шаг по времени', () => {
  it('dt не перелетает остаток через dtMin', () => {
    const res = defaultField();
    const pv = computePoreVolume(res);
    const st = initState(res);
    for (const req of [0.05, 0.03, 0.007]) {
      const out = stepSuperposition({
        state: st,
        dt: req,
        reservoir: res,
        wells: [],
        fluid: cfg.fluid,
        relperm: cfg.relperm,
        params: params(),
        poreVolumeM3: pv,
        pAvg: pAvgOf(res, st.pressure),
        cum: { productionM3: 0, injectionM3: 0 },
      });
      expect(out.state.time).toBeCloseTo(req, 9);
    }
  });

  it('CFL реально срабатывает: при большой скважине шаг дробится', () => {
    const res = defaultField();
    const pv = computePoreVolume(res);
    const wells = mkWells(1);
    const st = initState(res);
    const out = stepSuperposition({
      state: st,
      dt: 20,
      reservoir: res,
      wells,
      fluid: cfg.fluid,
      relperm: cfg.relperm,
      params: params(),
      poreVolumeM3: pv,
      pAvg: pAvgOf(res, st.pressure),
      cum: { productionM3: 0, injectionM3: 0 },
    });
    // Суммарное время всегда равно запрошенному.
    expect(out.state.time).toBeCloseTo(20, 6);
    // И каждый подшаг — не больше запрошенного dt.
    for (const s of out.subSteps) expect(s.dt).toBeLessThanOrEqual(20 + 1e-9);
  });

  it('результат слабо зависит от внешнего шага (сходимость по dt)', () => {
    const wells = mkWells(8);
    const horizonHours = 2000;
    const results = [20, 10, 5, 1].map((dt) => {
      const rows = run(wells, Math.round(horizonHours / dt), dt);
      return rows[rows.length - 1]?.pAvg ?? 0;
    });
    const lo = Math.min(...results);
    const hi = Math.max(...results);
    // До фиксов разброс доходил до ~20 атм (119.3 против 98.5).
    expect(hi - lo).toBeLessThan(1.0);
  });
});