// Один шаг симулятора на основе суперпозиции стационарных
// аналитических решений + материального баланса для дрейфа P_avg.
//
// Pipeline (один sub-step, dt — часы):
//   1. solveRates(wells, pAvg, ...) → q_total по BHP (линейная система)
//   2. computeCellPressures(pAvg, q) → P_grid (суперпозиция)
//   3. buildWellStates(q, P, S_w) → qOil/qWater per well, водяной cut
//   4. computeFluxes(grid, T_g, P, S_w) → F_t, F_w, F_o
//   5. updateSaturation(..., wellStates) → S_w^{n+1}
//   6. updateAveragePressure(pAvg, qProd, qInj) → P_avg^{n+1}
//
// Адаптивный шаг: внутри одного engine.step(dtGame) может быть
// несколько sub-step'ов по CFL (dtSub ≤ dtMax).
//
// Параметры итератора — те же, что у TimeStepper. Иммутабельность:
// возвращается новый FieldState.

import { coreyRelPerm, mobility } from '../properties/Corey.ts';
import type { FluidProperties } from '../properties/FluidProperties.ts';
import type { RelPermParameters } from '../properties/RelativePermeability.ts';
import type { Reservoir } from '../grid/Reservoir.ts';
import type { TransmissibilityMap } from '../physics/TransmissibilityMap.ts';
import type { FluxResult } from '../physics/DarcyFlux.ts';
import type { FieldState } from '../state/FieldState.ts';
import type { Well } from '../wells/Well.ts';
import type { WellState } from '../wells/BHPControl.ts';
import {
  computeCellPressures,
  type SuperpositionWellState,
} from '../pressure/Superposition.ts';
import {
  solveRates,
  resolveWells,
  type RateSolverConfig,
  type ResolvedWell,
} from '../wells/RateSolver.ts';
import {
  pressureDriftStep,
  totalPoreVolume,
  type MaterialBalanceConfig,
} from '../pressure/MaterialBalanceDrift.ts';
import { computeFluxes } from '../physics/DarcyFlux.ts';
import { updateSaturation } from '../physics/SaturationSolver.ts';
import { cflTimestep, HARD_MIN_HOURS } from '../physics/timestep/CFL.ts';
import { buildTransmissibilityMap } from '../physics/TransmissibilityMap.ts';
import { clampSw } from '../properties/Corey.ts';
import { HOURS_PER_DAY } from '../units.ts';

export interface SuperpositionStepperParams {
  dtMaxHours: number;
  dtMinHours: number;
  cflTarget: number;
  /** Сжимаемость породы, атм⁻¹ (для совместимости с c_t). */
  crAtm: number;
  /** Полная сжимаемость (rock + fluid), атм⁻¹. */
  totalCompressibilityAtmInv: number;
  /** Конфиг для RateSolver. */
  rateSolver: RateSolverConfig;
  /** Интервал записи в history, ч. */
  historyIntervalHours: number;
  /**
   * Демпфер дрейфа P_avg, 0 < ω ≤ 1. 1 = без сглаживания (чистый
   * материальный баланс). Меньше 1 — экспоненциальное сглаживание,
   * гасящее предельный цикл возле BHP скважин.
   *
   * По умолчанию в defaultParameters — 0.35.
   */
  pAvgDamping?: number;
  /**
   * Доля от «запаса» (P_avg − BHP) до переключения скважины, которую
   * разрешаем израсходовать за один подшаг, 0 < f ≤ 1.
   *
   * Это второй, помимо потокового CFL, ограничитель шага. Он нужен
   * потому, что P_avg — единственная «динамическая» переменная модели,
   * и при грубом шаге давление ПЕРЕПРЫГИВАЕТ BHP скважины: та успевает
   * отработать на полном rateLimit, потом захлопнуться, потом снова
   * открыться — то самое биение 500 → 0 → 500.
   *
   * Ограничение вида `|ΔP_avg| ≤ f · max(|P_avg − BHP|, marginFloor)`
   * заставляет шаг мельчать по мере приближения к порогу, так что
   * давление ПОДХОДИТ к нему асимптотически и не перескакивает.
   */
  cflPressureFraction?: number;
  /**
   * Нижняя граница «запаса» до BHP, атм. Защищает от деления на
   * почти нулевой запас (иначе dt уходит в ноль и цикл дробления
   * не terminates). По умолчанию 0.5.
   */
  pressureMarginFloorAtm?: number;
  /**
   * Допустимое изменение дебита скважины за один подшаг в долях её
   * мощности (rate limit, либо safety cap). 0 < f ≤ 1.
   *
   * Нужен потому, что дебиты — нелинейная функция P_avg: рядом с порогом
   * включения одна скважина может уйти на полный rateLimit, пока
   * соседняя ещё стоит на нуле. Эвристика по «запасу» до BHP это не
   * ловит, потому что переключение может вызвать не собственное давление
   * скважины, а влияние соседей через систему A.
   *
   * Контроллер наблюдает фактическое изменение дебитов на прошлом
   * подшаге и подрезает следующий шаг так, чтобы относительное изменение
   * не превышало f. Это обычный адаптивный шаговый регулятор.
   *
   * По умолчанию 0.2 (за подшаг дебит меняется не более чем на 20%).
   */
  rateChangeTarget?: number;
  /**
   * Релаксация дебитов, 0 < ω ≤ 1.
   *
   *   q_new = ω · q_solved + (1 − ω) · q_prev
   *
   * Дебиты здесь — мгновенная функция от P_avg, без инерции. У порога
   * включения это даёт «дребезг»: скважина щёлкает между нулём и полным
   * rateLimit, потому что знак движущей силы меняется от шага к шагу.
   *
   * Релаксация — стандартный приём промышленных симуляторов (well rate
   * relaxation / wellbore storage): дебит не может измениться мгновенно.
   * Она убирает дребезг, не смещая установившегося режима: при постоянном
   * P_avg частное решение неподвижно, и q сходится к нему.
   *
   * 1 = без релаксации. По умолчанию 0.5.
   */
  rateRelaxation?: number;
}

export interface SuperpositionStepInput {
  state: FieldState;
  dt: number;
  reservoir: Reservoir;
  wells: readonly Well[];
  fluid: FluidProperties;
  relperm: RelPermParameters;
  params: SuperpositionStepperParams;
  /** Суммарный поровый объём активной зоны, м³. Кешируется снаружи. */
  poreVolumeM3: number;
  /** Текущее среднее давление, атм (обновляется в step). */
  pAvg: number;
  /** Накопленные объёмы (для дрейфа P_avg). */
  cum: { productionM3: number; injectionM3: number };
  /** Опциональные маски разломов. */
  xFault?: Uint8Array;
  yFault?: Uint8Array;
  /** Колбэк на каждом подшаге (для history/event log). */
  onSubStep?: (info: SuperpositionSubStepInfo) => void;
  /** Дебиты последнего подшага — вход релаксации дебитов. */
  prevRates?: ReadonlyMap<string, number> | null;
  /** Дебиты последнего внешнего шага (для межшаговой релаксации). */
  lastStepRates?: ReadonlyMap<string, number> | null;
  /**
   * Поток последнего подшага — переиспользуется для первичной CFL-оценки
   * следующего вызова вместо полного пробного расчёта.
   */
  prevFlux?: FluxResult | null;
}

export interface SuperpositionSubStepInfo {
  subStep: number;
  /** Длина подшага, ч. */
  dt: number;
  /** Текущее симуляционное время, ч. */
  time: number;
  /** Среднее давление после подшага, атм. */
  pAvg: number;
  /** Средняя водонасыщенность. */
  swAvg: number;
  /** Суммарный дебит добычи, м³/сут (> 0). */
  totalProduction: number;
  /** Суммарная закачка, м³/сут (< 0). */
  totalInjection: number;
  /** Поле давления после подшага, атм. */
  pressure: Float64Array;
  /** Поле водонасыщенности после подшага. */
  sw: Float64Array;
  /** Состояния скважин после подшага. */
  wellStates: ReadonlyArray<WellState>;
  /** Флюксы после подшага. */
  flux: FluxResult;
}

/** Эффективный μ·B для упрощённой модели (одинаковые свойства).
 *  Используем μ_w · B_w (вода — вытесняющий флюид). */
function effectiveMuB(fluid: FluidProperties): number {
  return fluid.muWaterCP * fluid.bw;
}

/** Разделить q_total на qOil и qWater по водяному cut на ячейке.
 *  q_total > 0 = producer, < 0 = injector. */
function splitRateByWaterCut(
  qTotal: number,
  swWell: number,
  relperm: RelPermParameters,
  fluid: FluidProperties,
  type: 'producer' | 'injector',
): { qOil: number; qWater: number; waterCut: number; pCell: number } {
  if (type === 'injector') {
    return { qOil: 0, qWater: qTotal, waterCut: 0, pCell: 0 };
  }
  const { kro, krw } = coreyRelPerm(swWell, relperm);
  const lo = mobility(kro, fluid.muOilCP, fluid.bo);
  const lw = mobility(krw, fluid.muWaterCP, fluid.bw);
  const lt = lo + lw;
  const fw = lt > 0 ? lw / lt : 0;
  return {
    qOil: qTotal * (1 - fw),
    qWater: qTotal * fw,
    waterCut: fw,
    pCell: 0,
  };
}

/** Построить WellState[] из rate map и pressure grid. */
function buildWellStates(
  wells: ReadonlyArray<Well>,
  rates: ReadonlyMap<string, number>,
  pressure: Float64Array,
  sw: Float64Array,
  relperm: RelPermParameters,
  fluid: FluidProperties,
  reservoir: Reservoir,
): WellState[] {
  const states: WellState[] = [];
  for (let w = 0; w < wells.length; w++) {
    const well = wells[w];
    if (!well) continue;
    const q = rates.get(well.id) ?? 0;
    const cellIndex = reservoir.grid.cellIndex(well.i, well.j);
    if (cellIndex < 0 || cellIndex >= reservoir.grid.nCells) continue;
    const pCell = pressure[cellIndex] ?? 0;
    const swCell = sw[cellIndex] ?? relperm.swc;
    const split = splitRateByWaterCut(q, swCell, relperm, fluid, well.type);
    states.push({
      wellId: well.id,
      pCell,
      bhp: well.bhpAtm,
      jBase: 0, // не используется в superposition-модели
      lambdaTotal: 0,
      lambdaWater: 0,
      qOil: split.qOil,
      qWater: split.qWater,
      qLiq: q,
      waterCut: split.waterCut,
      cellIndex,
      type: well.type,
    });
  }
  return states;
}

/** Один sub-step: один шаг dt с фиксированными BHP и текущим P_avg. */
function superpositionSubStep(
  state: FieldState,
  dt: number,
  reservoir: Reservoir,
  tMap: TransmissibilityMap,
  wells: ReadonlyArray<Well>,
  fluid: FluidProperties,
  relperm: RelPermParameters,
  params: SuperpositionStepperParams,
  pAvg: number,
  prevRates?: ReadonlyMap<string, number> | null,
): { state: FieldState; flux: FluxResult; rates: Map<string, number>; wellStates: WellState[] } {
  // 1) Решаем rates по BHP.
  const rateResult = solveRates(wells, reservoir, pAvg, params.rateSolver);
  const omega = Math.min(1, Math.max(0, params.rateRelaxation ?? 1));
  // Опорные дебиты — результат ПРЕДЫДУЩЕГО ВНЕШНЕГО шага, а не предыдущего
  // подшага. Иначе внутри одного внешнего шага дебиты «доезжают» до
  // решения, и наблюдаемый на выходе дебит скачет между шагами: раскачка
  // длиной во весь шаг. С постоянной опорой q = ω·q_solved + (1−ω)·q_ref
  // одинаков на всех подшагах, и изменение за внешний шаг ограничено
  // величиной ω·|q_solved − q_ref|.
  const rates =
    omega < 1 && prevRates
      ? relaxRates(
          wells,
          rateResult.rates,
          prevRates,
          omega,
          Math.min(1, Math.max(0.01, params.rateChangeTarget ?? 0.2)),
        )
      : rateResult.rates;
  // 2) Собираем SuperpositionWellState[] из resolved + rates.
  const superWells: SuperpositionWellState[] = [];
  for (const [id, rw] of rateResult.resolved) {
    if (!rw) continue;
    const rate = rates.get(id) ?? 0;
    if (rate === 0) continue;
    superWells.push({
      wellId: id,
      i: rw.i,
      j: rw.j,
      radiusM: rw.radiusM,
      kEffMD: rw.kEffMD,
      hEffM: rw.hEffM,
      muB: params.rateSolver.muB,
      rwM: rw.well.rw,
      rateM3PerDay: rate,
    });
  }
  // 3) Считаем поле давления.
  const { pressure } = computeCellPressures({ reservoir, wells: superWells, pAvgAtm: pAvg });
  // 4) Считаем флюксы (используем существующий модуль — он берёт P и S_w).
  const flux = computeFluxes(reservoir.grid, tMap, pressure, state.sw, relperm, fluid);
  // 5) Строим per-well qOil/qWater и обновляем S_w.
  const wellStates = buildWellStates(
    wells,
    rates,
    pressure,
    state.sw,
    relperm,
    fluid,
    reservoir,
  );
  const swNew = updateSaturation({
    reservoir,
    sw: state.sw,
    flux,
    wellStates,
    dt,
    relperm,
  });
  // Доп. кламп S_w.
  for (let i = 0; i < swNew.length; i++) {
    if (!reservoir.active[i]) continue;
    swNew[i] = clampSw(swNew[i] ?? relperm.swc, relperm);
  }
  return {
    state: {
      pressure,
      sw: swNew,
      time: state.time + dt,
      step: state.step + 1,
      lastDt: dt,
    },
    flux,
    rates,
    wellStates,
  };
}

/** Порядок границ дебита по типу скважины: продублировано здесь, чтобы
 *  релаксация не могла вытолкнуть скважину за физически невозможный знак. */
function clampToWellBounds(q: number, type: 'producer' | 'injector', cap: number): number {
  return type === 'producer'
    ? Math.min(cap, Math.max(0, q))
    : Math.max(-cap, Math.min(0, q));
}

/** Релаксация дебитов относительно предыдущего ВНЕШНЕГО шага.
 *
 *  Верхняя граница изменения за шаг — не просто ω·cap, а жёсткая
 *  величина `target · cap`: если частное решение требует скачка больше
 *  допустимого, ω для этой скважины уменьшается пропорционально.
 *
 *  Это важно потому, что уменьшать dt здесь бесполезно: когда решение
 *  насыщено ограничением, q_solved не зависит от размера шага, и
 *  изменение дебита остаётся прежним. Единственный способ удержать
 *  скачок — ограничить долю, с которой новый дебит подменяет старый.
 */
function relaxRates(
  wells: ReadonlyArray<Well>,
  solved: ReadonlyMap<string, number>,
  prev: ReadonlyMap<string, number> | null,
  omega: number,
  targetFraction: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const w of wells) {
    if (!w) continue;
    const cap = wellCapacity(w);
    const qNew = solved.get(w.id) ?? 0;
    const qOld = prev?.get(w.id) ?? 0;
    const needed = Math.abs(qNew - qOld);
    const allowed = targetFraction * cap;
    // ω не может превысить ни базовую релаксацию, ни то, что нужно,
    // чтобы уложиться в allowed.
    const wEff = needed > allowed && needed > 0 ? Math.min(omega, allowed / needed) : omega;
    const blended = qOld + wEff * (qNew - qOld);
    out.set(w.id, clampToWellBounds(blended, w.type, cap));
  }
  return out;
}

/** Ёмкость (предельный дебит) скважины, м³/сут. */
function wellCapacity(w: Well): number {
  const lim = w.rateLimit ?? 0;
  return lim > 0 ? lim : 10_000;
}

/** Максимальное относительное изменение дебита между двумя наборами. */
function maxRelativeRateChange(
  wells: ReadonlyArray<Well>,
  prev: ReadonlyMap<string, number>,
  next: ReadonlyMap<string, number>,
): number {
  let worst = 0;
  for (const w of wells) {
    if (!w) continue;
    const cap = wellCapacity(w);
    if (cap <= 0) continue;
    const d = Math.abs((next.get(w.id) ?? 0) - (prev.get(w.id) ?? 0));
    const rel = d / cap;
    if (rel > worst) worst = rel;
  }
  return worst;
}

/** Ограничитель шага dt по реакции скважин, ч.
 *
 *  Возвращает dt, при котором давление за подшаг смещается не более чем
 *  на `f · max(|P_avg − BHP_j|, floor)` хотя бы по самой «близкой к
 *  порогу» скважине. Это не даёт шагу перескочить порог, на котором
 *  скважина переключается между режимом «на лимите» и режимом «закрыта».
 *
 *  @param netVoidageRate м³/сут — дефицит замещения (добыча минус закачка),
 *        со знаком.
 *  @param damping 0 < ω ≤ 1 — демпфер из params.pAvgDamping (влияет на
 *        фактическую скорость дрейфа, поэтому входит в оценку).
 */
function wellResponseTimestep(
  wells: ReadonlyArray<Well>,
  pAvg: number,
  netVoidageRateM3PerDay: number,
  fluid: FluidProperties,
  poreVolumeM3: number,
  totalCompressibilityAtmInv: number,
  damping: number,
  fraction: number,
  marginFloorAtm: number,
  dtMaxHours: number,
): number {
  if (wells.length === 0) return dtMaxHours;
  if (poreVolumeM3 <= 0 || totalCompressibilityAtmInv <= 0) return dtMaxHours;

  // Фактическая скорость дрейфа P_avg, атм/ч.
  const netAbs = Math.abs(netVoidageRateM3PerDay);
  if (netAbs <= 0) return dtMaxHours;
  const atmPerDay = (netAbs * fluid.bo) / (poreVolumeM3 * totalCompressibilityAtmInv);
  const atmPerHour = (atmPerDay / HOURS_PER_DAY) * damping;
  if (atmPerHour <= 0) return dtMaxHours;

  // Ближайшая к порогу скважина: минимальный запас |P_avg − BHP|.
  let minMargin = Infinity;
  for (const w of wells) {
    if (!w) continue;
    const margin = Math.abs(pAvg - w.bhpAtm);
    if (margin < minMargin) minMargin = margin;
  }
  if (!isFinite(minMargin)) return dtMaxHours;

  const usable = Math.max(minMargin, marginFloorAtm);
  const dt = (fraction * usable) / atmPerHour;
  return dt < dtMaxHours ? dt : dtMaxHours;
}

/** Адаптивный шаг dt для superposition pipeline по уже известному flux. */
function superpositionCflTimestep(
  reservoir: Reservoir,
  flux: FluxResult,
  rates: Map<string, number>,
  wells: ReadonlyArray<Well>,
  cflTarget: number,
  dtMaxHours: number,
  dtMinHours: number,
): number {
  const wellLiqByCell = new Float64Array(reservoir.grid.nCells);
  for (const w of wells) {
    if (!w) continue;
    const cellIndex = reservoir.grid.cellIndex(w.i, w.j);
    if (cellIndex < 0) continue;
    const q = rates.get(w.id) ?? 0;
    wellLiqByCell[cellIndex] = Math.abs(q);
  }
  return cflTimestep({
    reservoir,
    flux,
    cflTarget,
    dtMaxHours,
    dtMinHours,
    wellLiqByCell,
  });
}

/** Первичная оценка CFL для самого первого подшага.
 *
 *  Flux'а ещё нет, поэтому делаем пробный расчёт: solveRates →
 *  computeCellPressures → computeFluxes на текущем S_w. Это ровно тот же
 *  путь, что и у настоящего подшага, только без updateSaturation.
 *
 *  Раньше первый подшаг просто брал min(dtMax, remaining) — то есть при
 *  dt ≤ dtMax CFL не вычислялся НИКОГДА, и адаптация шага была мёртвым
 *  кодом. */
function probeCflTimestep(
  state: FieldState,
  reservoir: Reservoir,
  tMap: TransmissibilityMap,
  wells: ReadonlyArray<Well>,
  fluid: FluidProperties,
  relperm: RelPermParameters,
  params: SuperpositionStepperParams,
  pAvg: number,
): number {
  if (wells.length === 0) return params.dtMaxHours;
  const rateResult = solveRates(wells, reservoir, pAvg, params.rateSolver);
  const superWells: SuperpositionWellState[] = [];
  for (const [id, rw] of rateResult.resolved) {
    if (!rw) continue;
    const rate = rateResult.rates.get(id) ?? 0;
    if (rate === 0) continue;
    superWells.push({
      wellId: id,
      i: rw.i,
      j: rw.j,
      radiusM: rw.radiusM,
      kEffMD: rw.kEffMD,
      hEffM: rw.hEffM,
      muB: params.rateSolver.muB,
      rwM: rw.well.rw,
      rateM3PerDay: rate,
    });
  }
  const { pressure } = computeCellPressures({ reservoir, wells: superWells, pAvgAtm: pAvg });
  const flux = computeFluxes(reservoir.grid, tMap, pressure, state.sw, relperm, fluid);
  const dtFlux = superpositionCflTimestep(
    reservoir,
    flux,
    rateResult.rates,
    wells,
    params.cflTarget,
    params.dtMaxHours,
    params.dtMinHours,
  );

  // Дефицит замещения для оценки скорости дрейфа P_avg.
  let netVoidage = 0;
  for (const q of rateResult.rates.values()) netVoidage += q;

  const dtWell = wellResponseTimestep(
    wells,
    pAvg,
    netVoidage,
    fluid,
    computePoreVolume(reservoir),
    params.totalCompressibilityAtmInv,
    Math.min(1, Math.max(0, params.pAvgDamping ?? 1)),
    Math.min(1, Math.max(0.01, params.cflPressureFraction ?? 0.3)),
    params.pressureMarginFloorAtm ?? 0.5,
    params.dtMaxHours,
  );
  return dtWell < dtFlux ? dtWell : dtFlux;
}

/** Главный вход: step() с адаптивным внутренним дроблением по CFL. */
export function stepSuperposition(input: SuperpositionStepInput): {
  state: FieldState;
  pAvg: number;
  cum: { productionM3: number; injectionM3: number };
  subSteps: SuperpositionSubStepInfo[];
  /** Дебиты последнего подшага — передать обратно как prevRates. */
  lastStepRates: Map<string, number>;
  /** Поток последнего подшага — передать обратно как prevFlux. */
  lastFlux: FluxResult | null;
} {
  const { state, reservoir, wells, fluid, relperm, params, pAvg, cum, poreVolumeM3 } = input;
  void fluid; // fluid подаётся, но в superposition используется внутри модулей
  const tMap = buildTransmissibilityMap(reservoir, input.xFault, input.yFault);
  let cur = state;
  let curPavg = pAvg;
  let curCum = { ...cum };
  let remaining = input.dt;
  let subStep = 0;
  const subSteps: SuperpositionSubStepInfo[] = [];
  // Дебиты предыдущего ВНЕШНЕГО шага — опора для релаксации.
  const extRefRates = input.lastStepRates ?? null;
  // Наблюдённые дебиты двух последних внешних шагов — для адаптивного
  // контроллера шага. Внутри шага подшаги дают одинаковый результат
  // (релаксация привязана к внешней опоре), поэтому сравнивать нужно
  // именно внешние шаги.
  let observedRates: Map<string, number> | null = null;
  let prevObserved: Map<string, number> | null = null;
  let prevStepDt = 0;
  const rateTarget = Math.min(1, Math.max(0.01, params.rateChangeTarget ?? 0.2));
  const matBalanceCfg: MaterialBalanceConfig = {
    muB: effectiveMuB(fluid),
    totalCompressibilityAtmInv: params.totalCompressibilityAtmInv,
    volumeFactor: fluid.bo,
  };
  // Базовый «внешний» dt, запрошенный движком. Делим его на CFL-куски.
  while (remaining > 1e-9) {
    let dt: number;
    if (subStep === 0) {
      // Первичная оценка шага. Полный пробный расчёт (solveRates →
      // суперпозиция → потоки) нужен только на самом первом вызове;
      // дальше поле потока меняется медленно, и его можно взять с
      // предыдущего шага — это экономит один полный расчёт на кадр.
      const cachedFlux = input.prevFlux ?? null;
      const cachedRates = extRefRates;
      if (cachedFlux && cachedRates) {
        dt = superpositionCflTimestep(
          reservoir,
          cachedFlux,
          new Map<string, number>(cachedRates),
          wells,
          params.cflTarget,
          params.dtMaxHours,
          params.dtMinHours,
        );
        let netVoidage0 = 0;
        for (const q of cachedRates.values()) netVoidage0 += q;
        const dtWell0 = wellResponseTimestep(
          wells,
          curPavg,
          netVoidage0,
          input.fluid,
          poreVolumeM3,
          params.totalCompressibilityAtmInv,
          Math.min(1, Math.max(0, params.pAvgDamping ?? 1)),
          Math.min(1, Math.max(0.01, params.cflPressureFraction ?? 0.3)),
          params.pressureMarginFloorAtm ?? 0.5,
          params.dtMaxHours,
        );
        if (dtWell0 < dt) dt = dtWell0;
      } else {
        dt = probeCflTimestep(
          cur,
          reservoir,
          tMap,
          wells,
          input.fluid,
          relperm,
          params,
          curPavg,
        );
      }
    } else {
      // На последующих — адаптивно по CFL на основе прошлого flux.
      const last = subSteps[subSteps.length - 1];
      if (last) {
        const rates = new Map<string, number>();
        for (const ws of last.wellStates) {
          if (ws) rates.set(ws.wellId, ws.qLiq);
        }
        dt = superpositionCflTimestep(
          reservoir,
          last.flux,
          rates,
          wells,
          params.cflTarget,
          params.dtMaxHours,
          params.dtMinHours,
        );
        let netVoidage = 0;
        for (const q of rates.values()) netVoidage += q;
        const dtWell = wellResponseTimestep(
          wells,
          curPavg,
          netVoidage,
          input.fluid,
          poreVolumeM3,
          params.totalCompressibilityAtmInv,
          Math.min(1, Math.max(0, params.pAvgDamping ?? 1)),
          Math.min(1, Math.max(0.01, params.cflPressureFraction ?? 0.3)),
          params.pressureMarginFloorAtm ?? 0.5,
          params.dtMaxHours,
        );
        if (dtWell < dt) dt = dtWell;
      } else {
        dt = Math.min(params.dtMaxHours, remaining);
      }
    }
    // Адаптивный контроллер по изменению дебитов между внешними шагами.
    if (prevObserved && observedRates && prevStepDt > 0) {
      const rel = maxRelativeRateChange(wells, prevObserved, observedRates);
      if (rel > rateTarget && rel > 0) {
        const scaled = (prevStepDt * rateTarget) / rel;
        if (scaled < dt) dt = scaled;
      }
    }
    dt = Math.min(dt, remaining);
    if (dt < 1e-9) break;
    // Нижняя граница — HARD_MIN, а НЕ params.dtMinHours.
    // Раньше стояло `if (dt < dtMin) dt = dtMin` ПОСЛЕ min(dt, remaining),
    // из-за чего подшаг удлинялся за пределы остатка времени и симуляция
    // уходила вперёд по часам. Теперь dtMin — только «пожелание»,
    // которому CFL может не подчиниться, а последний подшаг вправе
    // быть короче dtMin.
    if (dt < HARD_MIN_HOURS) dt = HARD_MIN_HOURS;

    const out = superpositionSubStep(
      cur,
      dt,
      reservoir,
      tMap,
      wells,
      input.fluid,
      relperm,
      params,
      curPavg,
      extRefRates,
    );
    // Обновляем P_avg по материальному балансу.
    let totalProductionM3PerDay = 0;
    let totalInjectionM3PerDay = 0;
    for (const ws of out.wellStates) {
      if (!ws) continue;
      if (ws.qLiq > 0) totalProductionM3PerDay += ws.qLiq;
      else if (ws.qLiq < 0) totalInjectionM3PerDay += -ws.qLiq;
    }
    const dPavgRaw = pressureDriftStep(
      totalProductionM3PerDay,
      totalInjectionM3PerDay,
      dt,
      matBalanceCfg,
      poreVolumeM3,
    );
    // Демпфер: экспоненциальное сглаживание дрейфа P_avg.
    // Чистый баланс (ω=1) даёт жёсткую реакцию — когда P_avg подходит
    // к BHP скважины, дебиты меняются рывком и графики «дёргаются».
    // Частичное применение инкремента сглаживает фронт, не меняя
    // установившегося тренда (суммарный дрейф за тот же интервал
    // остаётся тем же, просто размазан по большему числу подшагов).
    const damping = Math.min(1, Math.max(0, params.pAvgDamping ?? 1));
    const dPavg = dPavgRaw * damping;
    curPavg = curPavg + dPavg;

    // Пересчитываем поле давления по ОБНОВЛЁННОМУ P_avg.
    //
    // Раньше поле соответствовало P_avg ДО обновления, а наружу
    // отдавался уже обновлённый. Из-за этого среднее по полю систематически
    // отставало от модельного P_avg на один демпфированный инкремент, и
    // переход между шагами выглядел как скачок до 20+ атм даже при
    // полностью неподвижных дебитах. Теперь state.pressure, pAvg и
    // wellStates описывают один и тот же момент времени.
    //
    // Важно: пересчитываем НЕ полной суперпозицией, а сдвигом. Поле имеет
    // вид P(x) = P_avg + Σ_j f_j(x), и Σ_j f_j(x) зависит только от дебитов
    // и геометрии, а не от P_avg. Поэтому изменение P_avg на Δ эквивалентно
    // прибавлению Δ к каждой ячейке. Это O(nCells) вместо повторного
    // solveRates (O(n³)) + суперпозиции (O(nCells·nWells)) — на 50×50 сетке
    // разница в стоимости кадра была критичной.
    const stepRates = new Map<string, number>();
    for (const ws of out.wellStates) if (ws) stepRates.set(ws.wellId, ws.qLiq);
    if (dPavg !== 0) {
      const shifted = new Float64Array(out.state.pressure.length);
      for (let idx = 0; idx < shifted.length; idx++) {
        shifted[idx] = (out.state.pressure[idx] ?? 0) + dPavg;
      }
      out.state = { ...out.state, pressure: shifted };
    }

    // Наблюдаем результат внешнего шага для следующего вызова контроллера.
    prevObserved = observedRates;
    observedRates = stepRates;
    prevStepDt = dt;
    // Обновляем накопленные объёмы.
    const dtDays = dt / HOURS_PER_DAY;
    curCum = {
      productionM3: curCum.productionM3 + totalProductionM3PerDay * dtDays,
      injectionM3: curCum.injectionM3 + totalInjectionM3PerDay * dtDays,
    };

    let pSum = 0;
    let swSum = 0;
    let nAct = 0;
    for (let idx = 0; idx < cur.pressure.length; idx++) {
      if (!reservoir.active[idx]) continue;
      pSum += out.state.pressure[idx] ?? 0;
      swSum += out.state.sw[idx] ?? 0;
      nAct++;
    }
    const pAvgNew = nAct > 0 ? pSum / nAct : curPavg;
    const swAvg = nAct > 0 ? swSum / nAct : 0;
    const info: SuperpositionSubStepInfo = {
      subStep,
      dt,
      time: out.state.time,
      pAvg: pAvgNew,
      swAvg,
      totalProduction: totalProductionM3PerDay,
      totalInjection: totalInjectionM3PerDay,
      pressure: out.state.pressure,
      sw: out.state.sw,
      wellStates: out.wellStates,
      flux: out.flux,
    };
    subSteps.push(info);
    if (input.onSubStep) input.onSubStep(info);
    cur = out.state;
    remaining -= dt;
    subStep++;
  }
  // Отдаём дебиты последнего подшага: движок хранит их и подставляет
  // в следующий вызов как prevRates для межшаговой релаксации.
  const finalRates = new Map<string, number>();
  const finalStates = subSteps[subSteps.length - 1]?.wellStates;
  if (finalStates) for (const ws of finalStates) if (ws) finalRates.set(ws.wellId, ws.qLiq);
  return {
    state: cur,
    pAvg: curPavg,
    cum: curCum,
    subSteps,
    lastStepRates: finalRates,
    lastFlux: subSteps[subSteps.length - 1]?.flux ?? null,
  };
}

/** Утилита: разово посчитать V_pore для месторождения. */
export function computePoreVolume(reservoir: Reservoir): number {
  return totalPoreVolume(reservoir);
}

/** Вспомогательное: разрешённые wells (для UI, отладки). */
export function resolveWellsPublic(
  wells: ReadonlyArray<Well>,
  reservoir: Reservoir,
  config: RateSolverConfig,
): Map<string, ResolvedWell> {
  return resolveWells(wells, reservoir, config);
}
