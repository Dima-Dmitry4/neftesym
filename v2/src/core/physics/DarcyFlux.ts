// Закон Дарси на гранях: F = T · (P_high - P_low).
//
// «Геометрические» T (из TransmissibilityMap) дают F после
// домножения на подвижность. В этой реализации считаем:
//
//   F_t_face = T_g_face · λ_t(upstream) · (P_i - P_j)
//
// Полный поток (total) идёт в сторону убывания давления. Upstream
// — ячейка, из которой течёт жидкость (высокое P). Фазовые потоки
// получаются умножением на f_α = λ_α(upstream) / λ_t(upstream).
//
// Положительное F = из ячейки A в ячейку B (т.е. P_A > P_B).

import { coreyRelPerm, mobility } from '../properties/Corey.ts';
import type { RelPermParameters } from '../properties/RelativePermeability.ts';
import type { FluidProperties } from '../properties/FluidProperties.ts';
import type { TransmissibilityMap } from './TransmissibilityMap.ts';
import type { Grid2D } from '../grid/Grid2D.ts';

export interface FluxResult {
  /** Полный поток на X-гранях (м³/сут). Положительный = вправо. */
  fx: Float64Array;
  /** Полный поток на Y-гранях (м³/сут). Положительный = вниз. */
  fy: Float64Array;
  /** Поток воды на X-гранях (м³/сут). */
  fxw: Float64Array;
  /** Поток воды на Y-гранях (м³/сут). */
  fyw: Float64Array;
  /** Поток нефти на X-гранях (м³/сут). */
  fxo: Float64Array;
  /** Поток нефти на Y-гранях (м³/сут). */
  fyo: Float64Array;
}

/** Вычислить потоки на всех гранях.
 *
 *  Использует upwind-схему для разделения фаз.
 *  Возвращает суммарные (F_t) и фазовые (F_w, F_o) потоки.
 */
export function computeFluxes(
  grid: Grid2D,
  tMap: TransmissibilityMap,
  p: Float64Array,
  sw: Float64Array,
  relperm: RelPermParameters,
  fluid: FluidProperties,
): FluxResult {
  const fx = new Float64Array(grid.nXfaces);
  const fy = new Float64Array(grid.nYfaces);
  const fxw = new Float64Array(grid.nXfaces);
  const fyw = new Float64Array(grid.nYfaces);
  const fxo = new Float64Array(grid.nXfaces);
  const fyo = new Float64Array(grid.nYfaces);

  // X-грани
  for (let j = 0; j < grid.ny; j++) {
    for (let i = 0; i < grid.nx - 1; i++) {
      const idxA = grid.cellIndex(i, j);
      const idxB = grid.cellIndex(i + 1, j);
      const fid = grid.xFaceIndex(i, j);
      const tG = (tMap.txG[fid] ?? 0) * (tMap.xOpen[fid] ?? 0);
      if (tG <= 0) continue;
      const pA = p[idxA] ?? 0;
      const pB = p[idxB] ?? 0;
      const dP = pA - pB;
      const upstream = dP >= 0 ? idxA : idxB;
      const kr = coreyRelPerm(sw[upstream] ?? relperm.swc, relperm);
      const lt = mobility(kr.kro, fluid.muOilCP, fluid.bo) + mobility(kr.krw, fluid.muWaterCP, fluid.bw);
      const total = tG * lt * dP;
      const lw = mobility(kr.krw, fluid.muWaterCP, fluid.bw);
      const fw = lt > 0 ? lw / lt : 0;
      fx[fid] = total;
      fxw[fid] = total * fw;
      fxo[fid] = total * (1 - fw);
    }
  }

  // Y-грани
  for (let j = 0; j < grid.ny - 1; j++) {
    for (let i = 0; i < grid.nx; i++) {
      const idxA = grid.cellIndex(i, j);
      const idxB = grid.cellIndex(i, j + 1);
      const fid = grid.yFaceIndex(i, j);
      const tG = (tMap.tyG[fid] ?? 0) * (tMap.yOpen[fid] ?? 0);
      if (tG <= 0) continue;
      const pA = p[idxA] ?? 0;
      const pB = p[idxB] ?? 0;
      const dP = pA - pB;
      const upstream = dP >= 0 ? idxA : idxB;
      const kr = coreyRelPerm(sw[upstream] ?? relperm.swc, relperm);
      const lt = mobility(kr.kro, fluid.muOilCP, fluid.bo) + mobility(kr.krw, fluid.muWaterCP, fluid.bw);
      const total = tG * lt * dP;
      const lw = mobility(kr.krw, fluid.muWaterCP, fluid.bw);
      const fw = lt > 0 ? lw / lt : 0;
      fy[fid] = total;
      fyw[fid] = total * fw;
      fyo[fid] = total * (1 - fw);
    }
  }

  return { fx, fy, fxw, fyw, fxo, fyo };
}
