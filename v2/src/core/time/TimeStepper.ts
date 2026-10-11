// Один шаг IMPES.
//
//   1. applyWells (текущее P, S_w)
//   2. buildPressureSystem (T_g · λ_t на P^n, c_t от S_w^n)
//   3. solveCG → P^{n+1}
//   4. computeFluxes → F_t, F_w, F_o
//   5. updateSaturation → S_w^{n+1}
//   6. clamp S_w в [S_wc, 1 - S_or] (внутри updateSaturation)
//   7. вернуть новое FieldState
//
// Внутри может быть несколько sub-step'ов при dt больше CFL_max —
// адаптивный шаг. Но API верхнего уровня — `step(state, dt, ...)`
// отдаёт новый state, пройдя нужное число IMPES-итераций.

import { applyWells, type WellState } from '../wells/BHPControl.ts';
import { buildTransmissibilityMap } from '../physics/TransmissibilityMap.ts';
import { buildPressureSystem, solveCG } from '../physics/PressureSolver.ts';
import { computeFluxes } from '../physics/DarcyFlux.ts';
import { updateSaturation } from '../physics/SaturationSolver.ts';
import { cflTimestep } from '../physics/timestep/CFL.ts';
import type { RelPermParameters } from '../properties/RelativePermeability.ts';
import type { FluidProperties } from '../properties/FluidProperties.ts';
import type { RockProperties } from '../properties/RockProperties.ts';
import type { Reservoir } from '../grid/Reservoir.ts';
import type { TransmissibilityMap } from '../physics/TransmissibilityMap.ts';
import type { FluxResult } from '../physics/DarcyFlux.ts';
import type { Well } from '../wells/Well.ts';
import type { FieldState } from '../state/FieldState.ts';
import { clampSw } from '../properties/Corey.ts';

export interface StepperParams {
  dtMaxHours: number;
  dtMinHours: number;
  cflTarget: number;
  cgTolerance: number;
  cgMaxIterations: number;
  /** Сжимаемость породы, атм⁻¹. */
  crAtm: number;
  /** Интервал записи в history, ч. */
  historyIntervalHours: number;
  /** Коэффициент under-relaxation для P (0 < ω ≤ 1). */
  pressureRelaxation: number;
}

export interface StepInput {
  state: FieldState;
  dt: number;
  reservoir: Reservoir;
  wells: readonly Well[];
  fluid: FluidProperties;
  rock: RockProperties;
  relperm: RelPermParameters;
  params: StepperParams;
  /** Опциональная маска transmissibility (для разломов). */
  xFault?: Uint8Array;
  yFault?: Uint8Array;
  /** Колбэк на каждом подшаге (для history/event log). */
  onSubStep?: (info: SubStepInfo) => void;
}

export interface SubStepInfo {
  /** Индекс подшага внутри одного step(). */
  subStep: number;
  /** Длина подшага, ч. */
  dt: number;
  /** Текущее симуляционное время, ч. */
  time: number;
  /** Среднее давление, атм. */
  pAvg: number;
  /** Средняя водонасыщенность. */
  swAvg: number;
  /** Число итераций CG на подшаге. */
  cgIterations: number;
  /** Невязка CG. */
  cgResidual: number;
  /** Полный дебит жидкости producer'ов, м³/сут. */
  totalProduction: number;
  /** Полная закачка, м³/сут (отрицательное число). */
  totalInjection: number;
  /** Флюксы после шага. */
  flux: FluxResult;
  /** Состояния скважин после шага. */
  wellStates: ReadonlyArray<WellState>;
}

/** Один подшаг IMPES (без адаптации). */
function impesSubStep(
  state: FieldState,
  dt: number,
  reservoir: Reservoir,
  tMap: TransmissibilityMap,
  wells: readonly Well[],
  fluid: FluidProperties,
  relperm: RelPermParameters,
  params: StepperParams,
): { state: FieldState; flux: FluxResult; cgIterations: number; cgResidual: number } {
  // 1) Применяем скважины (нужен pCell = p^n).
  const wellRes = applyWells(reservoir, state.pressure, state.sw, wells, relperm, fluid);
  // 2) Строим систему давления.
  // pAquiferAtm = среднее начальное давление в активной зоне — это
  // «давление подпитки» от прилегающего ВНК (постоянное).
  let pAquiferAtm = 0;
  if (reservoir.active.length > 0) {
    let pSum = 0;
    let nAct = 0;
    for (let i = 0; i < reservoir.initialP.length; i++) {
      if ((reservoir.active[i] ?? 0) === 0) continue;
      pSum += reservoir.initialP[i] ?? 0;
      nAct++;
    }
    if (nAct > 0) pAquiferAtm = pSum / nAct;
  }
  const { matrix, rhs } = buildPressureSystem({
    reservoir,
    tMap,
    sw: state.sw,
    p: state.pressure,
    relperm,
    fluid,
    crAtm: params.crAtm,
    dt,
    wellStates: wellRes.states,
    pAquiferAtm,
    aquiferTransmissibilityFrac: 0.05,
  });
  // 3) Решаем CG, начиная с текущего P.
  const cg = solveCG(matrix, rhs, state.pressure, params.cgTolerance, params.cgMaxIterations);
  // 4) Under-relaxation: P_new = ω·P_cg + (1-ω)·P^n.
  // Это гасит «звон» при больших dt и сильных BHP-источниках.
  const omega = params.pressureRelaxation;
  if (omega > 0 && omega < 1) {
    for (let i = 0; i < cg.x.length; i++) {
      if (!reservoir.active[i]) continue;
      const pn = state.pressure[i] ?? 0;
      cg.x[i] = omega * (cg.x[i] ?? 0) + (1 - omega) * pn;
    }
  }
  // 5) Считаем потоки.
  const flux = computeFluxes(reservoir.grid, tMap, cg.x, state.sw, relperm, fluid);
  // 6) Обновляем насыщенность.
  const swNew = updateSaturation({
    reservoir,
    sw: state.sw,
    flux,
    wellStates: wellRes.states,
    dt,
    relperm,
  });
  // 7) Дополнительный кламп S_w на всякий случай.
  for (let i = 0; i < swNew.length; i++) {
    if (!reservoir.active[i]) continue;
    swNew[i] = clampSw(swNew[i] ?? relperm.swc, relperm);
  }
  return {
    state: {
      pressure: cg.x,
      sw: swNew,
      time: state.time + dt,
      step: state.step + 1,
      lastDt: dt,
    },
    flux,
    cgIterations: cg.iterations,
    cgResidual: cg.residual,
  };
}

/** Выполнить `step` с адаптивным внутренним дроблением. */
export function step(input: StepInput): {
  state: FieldState;
  subSteps: SubStepInfo[];
} {
  const { state, reservoir, wells, fluid, rock: _rock, relperm, params } = input;
  void _rock;
  const tMap = buildTransmissibilityMap(reservoir, input.xFault, input.yFault);
  let cur = state;
  let remaining = input.dt;
  let subStep = 0;
  const subSteps: SubStepInfo[] = [];
  while (remaining > 1e-9) {
    let dt: number;
    if (subStep === 0) {
      // Первый подшаг — оценочный CFL на основе начального давления + wells.
      const initialFlux = computeFluxes(
        reservoir.grid,
        tMap,
        cur.pressure,
        cur.sw,
        relperm,
        fluid,
      );
      const wellLiqByCell = computeWellLiqByCell(
        reservoir,
        cur.pressure,
        cur.sw,
        wells,
        relperm,
        fluid,
      );
      dt = cflTimestep({
        reservoir,
        flux: initialFlux,
        cflTarget: params.cflTarget,
        dtMaxHours: Math.min(params.dtMaxHours, remaining),
        dtMinHours: params.dtMinHours,
        wellLiqByCell,
      });
    } else {
      dt = Math.min(params.dtMaxHours, remaining);
      if (dt < params.dtMinHours) dt = params.dtMinHours;
    }
    dt = Math.min(dt, remaining);
    if (dt < 1e-9) break;
    const out = impesSubStep(cur, dt, reservoir, tMap, wells, fluid, relperm, params);
    // Статистика.
    let pSum = 0;
    let swSum = 0;
    let nAct = 0;
    for (let idx = 0; idx < cur.pressure.length; idx++) {
      if (!reservoir.active[idx]) continue;
      pSum += out.state.pressure[idx] ?? 0;
      swSum += out.state.sw[idx] ?? 0;
      nAct++;
    }
    const pAvg = nAct > 0 ? pSum / nAct : 0;
    const swAvg = nAct > 0 ? swSum / nAct : 0;
    const wellRes = applyWells(reservoir, out.state.pressure, out.state.sw, wells, relperm, fluid);
    const info: SubStepInfo = {
      subStep,
      dt,
      time: out.state.time,
      pAvg,
      swAvg,
      cgIterations: out.cgIterations,
      cgResidual: out.cgResidual,
      totalProduction: wellRes.totalProduction,
      totalInjection: wellRes.totalInjection,
      flux: out.flux,
      wellStates: wellRes.states,
    };
    subSteps.push(info);
    if (input.onSubStep) input.onSubStep(info);
    cur = out.state;
    remaining -= dt;
    subStep++;
  }
  return { state: cur, subSteps };
}

/** Собрать массив |qLiq| по ячейкам для CFL. */
function computeWellLiqByCell(
  reservoir: Reservoir,
  p: Float64Array,
  sw: Float64Array,
  wells: readonly Well[],
  relperm: RelPermParameters,
  fluid: FluidProperties,
): Float64Array {
  const n = reservoir.grid.nCells;
  const out = new Float64Array(n);
  const wres = applyWells(reservoir, p, sw, wells, relperm, fluid);
  for (const ws of wres.states) {
    out[ws.cellIndex] = Math.abs(ws.qLiq);
  }
  return out;
}
