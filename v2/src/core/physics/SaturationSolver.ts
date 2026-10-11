// Решатель насыщенности: явный upwind 1-го порядка.
//
//   S_w^{n+1}_i = S_w^n_i + dt / V_p_i · (F_w_in - F_w_out + q_w_well)
//
// где F_w = f_w · F_t, f_w = λ_w / λ_t в upstream-ячейке.
// Кламп к [S_wc, 1 - S_or] после шага.

import { clampSw } from '../properties/Corey.ts';
import type { RelPermParameters } from '../properties/RelativePermeability.ts';
import type { Reservoir } from '../grid/Reservoir.ts';
import type { FluxResult } from './DarcyFlux.ts';
import type { WellState } from '../wells/BHPControl.ts';

export interface UpdateSaturationInput {
  reservoir: Reservoir;
  sw: Float64Array;
  flux: FluxResult;
  wellStates: readonly WellState[];
  dt: number;
  relperm: RelPermParameters;
}

/** Обновить S_w по upwind-схеме. Возвращает новый Float64Array. */
export function updateSaturation(input: UpdateSaturationInput): Float64Array {
  const { reservoir, sw, flux, wellStates, dt, relperm } = input;
  const grid = reservoir.grid;
  const n = grid.nCells;
  const swNew = sw.slice();
  // Скважины: per-cell net q_w (м³/сут).
  // ВНИМАНИЕ: qWater > 0 — добыча (отток), qWater < 0 — закачка (приток).
  // В уравнении баланса netIn = (inflow - outflow), поэтому для
  // producer: netIn -= qWater, для injector: netIn -= qWater (т.к. qWater < 0).
  // Т.е. во всех случаях netIn -= qWater.
  const wellQw = new Float64Array(n);
  for (const ws of wellStates) {
    if (!ws) continue;
    if (!reservoir.active[ws.cellIndex]) continue;
    wellQw[ws.cellIndex] = (wellQw[ws.cellIndex] ?? 0) + ws.qWater;
  }
  for (let idx = 0; idx < n; idx++) {
    if (!reservoir.active[idx]) continue;
    const vp = reservoir.poreVolume(idx);
    if (vp <= 0) continue;
    let netInW = 0;
    const i = idx % grid.nx;
    const j = Math.floor(idx / grid.nx);
    // X-face right: F (i → i+1), > 0 = вправо.
    if (i < grid.nx - 1) {
      const f = flux.fxw[grid.xFaceIndex(i, j)] ?? 0;
      netInW -= f; // outflow (вода уходит из idx)
    }
    // X-face left: F (i-1 → i), > 0 = вправо (в idx).
    if (i > 0) {
      const f = flux.fxw[grid.xFaceIndex(i - 1, j)] ?? 0;
      netInW += f; // inflow
    }
    // Y-face down
    if (j < grid.ny - 1) {
      const f = flux.fyw[grid.yFaceIndex(i, j)] ?? 0;
      netInW -= f;
    }
    // Y-face up
    if (j > 0) {
      const f = flux.fyw[grid.yFaceIndex(i, j - 1)] ?? 0;
      netInW += f;
    }
    netInW -= wellQw[idx] ?? 0;
    // dS_w = dt_days * netInW / V_p  (м³/сут * сут / м³ = доля)
    // dt в коде приходит в часах, конвертируем в сутки.
    const dSw = ((dt / 24) * netInW) / vp;
    const newSw = (sw[idx] ?? 0) + dSw;
    swNew[idx] = clampSw(newSw, relperm);
  }
  return swNew;
}
