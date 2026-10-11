// Диагностика материального баланса: проверяем, что
// (сумма притоков) - (сумма оттоков) = Δ(запас) на каждом шаге.
//
// ΔS_w · V_p = dt · (F_w_in - F_w_out + q_w)
//
// Эта величина вычисляется «из потоков» (FluxResult) и
// сравнивается с «из состояния» (ΔS_w * V_p). Разница —
// ошибка баланса, для upwind 1-го порядка она машинная.

import type { Reservoir } from '../grid/Reservoir.ts';
import type { FluxResult } from './DarcyFlux.ts';
import type { WellState } from '../wells/BHPControl.ts';

export interface MaterialBalanceResult {
  /** Изменение водонасыщенности · поровый объём (м³), просуммированное по ячейкам. */
  dSwVpFromState: number;
  /** То же, рассчитанное из потоков и скважин. */
  dSwVpFromFlux: number;
  /** Абсолютная ошибка баланса (м³). */
  absError: number;
  /** Относительная ошибка (нормирована на масштаб сигнала). */
  relError: number;
}

export interface MaterialBalanceInput {
  reservoir: Reservoir;
  dt: number;
  swBefore: Float64Array;
  swAfter: Float64Array;
  flux: FluxResult;
  /** Карта индекс скважины → индекс ячейки, длиной = числу wellStates. */
  wellsByCell: Int32Array;
  /** Состояние каждой скважины (qWater, qOil — м³/сут). */
  wellStates: readonly WellState[];
}

/** Оценить материальный баланс за один шаг. */
export function computeMaterialBalance(input: MaterialBalanceInput): MaterialBalanceResult {
  const { reservoir, dt, swBefore, swAfter, flux, wellStates } = input;
  void input.wellsByCell;
  const grid = reservoir.grid;
  const n = grid.nCells;
  // dSwVp из состояния
  let dSwVpFromState = 0;
  for (let idx = 0; idx < n; idx++) {
    if (!reservoir.active[idx]) continue;
    const vp = reservoir.poreVolume(idx);
    const dSw = (swAfter[idx] ?? 0) - (swBefore[idx] ?? 0);
    dSwVpFromState += dSw * vp;
  }
  // dSwVp из потоков — per-cell net приток воды.
  const netIn = new Float64Array(n);
  for (let j = 0; j < grid.ny; j++) {
    for (let i = 0; i < grid.nx - 1; i++) {
      const fid = grid.xFaceIndex(i, j);
      const f = flux.fxw[fid] ?? 0;
      const idxA = grid.cellIndex(i, j);
      const idxB = grid.cellIndex(i + 1, j);
      netIn[idxA] = (netIn[idxA] ?? 0) - f;
      netIn[idxB] = (netIn[idxB] ?? 0) + f;
    }
  }
  for (let j = 0; j < grid.ny - 1; j++) {
    for (let i = 0; i < grid.nx; i++) {
      const fid = grid.yFaceIndex(i, j);
      const f = flux.fyw[fid] ?? 0;
      const idxA = grid.cellIndex(i, j);
      const idxB = grid.cellIndex(i, j + 1);
      netIn[idxA] = (netIn[idxA] ?? 0) - f;
      netIn[idxB] = (netIn[idxB] ?? 0) + f;
    }
  }
  for (let w = 0; w < wellStates.length; w++) {
    const ws = wellStates[w];
    if (!ws) continue;
    const cellIdx = ws.cellIndex;
    if (cellIdx === undefined || cellIdx < 0) continue;
    if (!reservoir.active[cellIdx]) continue;
    // netIn = inflow - outflow. qWater > 0 = отток (production), < 0 = приток (injection).
    netIn[cellIdx] = (netIn[cellIdx] ?? 0) - ws.qWater;
  }
  let dSwVpFromFlux = 0;
  // dt в коде приходит в часах; для потоков (м³/сут) переводим в сутки.
  const dtDays = dt / 24;
  for (let idx = 0; idx < n; idx++) {
    if (!reservoir.active[idx]) continue;
    dSwVpFromFlux += (netIn[idx] ?? 0) * dtDays;
  }
  const absError = Math.abs(dSwVpFromState - dSwVpFromFlux);
  const scale = Math.max(1, Math.abs(dSwVpFromState), Math.abs(dSwVpFromFlux));
  const relError = absError / scale;
  return { dSwVpFromState, dSwVpFromFlux, absError, relError };
}
