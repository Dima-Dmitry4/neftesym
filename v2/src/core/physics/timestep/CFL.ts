// Адаптивный шаг по времени на основе CFL-условия.
//
// Корректная форма — ПОЯЧЕЙКАЯ, а не глобальная:
//
//   Δt_i = cflTarget · V_p,i / (Σ_грани |F_грани| + |q_well,i|)
//
// и общий шаг Δt = min_i Δt_i.
//
// Раньше использовалось min_i V_p,i в паре с max_грани |F| — то есть
// поровый объём ОДНОЙ ячейки делился на поток СОВСЕМ ДРУГОЙ, несвязанной
// ячейки. Это давало искусственно заниженный шаг при наличии в поле
// разнородной ячейки и мощной скважины в другом месте, и одновременно
// НЕ защищало реально «горячую» ячейку при равномерном поле потока.
//
// Единицы: F и q — м³/сут, V_p — м³, Δt из формулы — сутки → ×24 = часы.

import type { Reservoir } from '../../grid/Reservoir.ts';
import type { FluxResult } from '../DarcyFlux.ts';
import { HOURS_PER_DAY } from '../../units.ts';

export interface CFLInput {
  reservoir: Reservoir;
  flux: FluxResult;
  cflTarget: number;
  dtMaxHours: number;
  /**
   * Нижняя граница шага, ч. ИСПОЛЬЗУЕТСЯ ТОЛЬКО как «пожелание» вызывающего:
   * результат CFL не поднимается до неё (см. cflTimestep). Оставлено в
   * интерфейсе для совместимости с существующими вызовами.
   */
  dtMinHours?: number;
  /** Скважины для учёта в CFL (по модулю qLiq). */
  wellLiqByCell?: Float64Array | number[];
}

/** Абсолютный нижний предел шага, ч.
 *
 *  Страховка от бесконечного цикла дробления при почти вырожденном
 *  поле потока. Это НЕ «минимальный физически осмысленный шаг»: если
 *  CFL требует меньше, возвращается HARD_MIN_HOURS, а не dtMinHours. */
export const HARD_MIN_HOURS = 1e-4;

/** Вычислить безопасный шаг (часы) по поячеечному CFL.
 *
 *  ВАЖНО: результат НЕ поднимается до `dtMinHours`. Раньше CFL-ограничение
 *  «сбрасывалось» до dtMin, то есть при жёстком поле потока безопасный
 *  шаг игнорировался — это ломало сходимость по dt. Теперь возвращается
 *  честное значение, ограниченное снизу только HARD_MIN_HOURS. */
export function cflTimestep(input: CFLInput): number {
  const { reservoir, flux, cflTarget, dtMaxHours, wellLiqByCell } = input;
  const grid = reservoir.grid;
  const n = grid.nCells;
  const target = cflTarget > 0 ? cflTarget : 1;

  // Суммарный модуль оттока из каждой ячейки, м³/сут:
  //   Σ |F| по граням + |q_well|
  // Считаем накопительно, чтобы не хранить второй массив.
  const outflow = new Float64Array(n);

  // X-грани: грань (i, j) соединяет ячейки i и i+1, F > 0 = вправо.
  for (let j = 0; j < grid.ny; j++) {
    for (let i = 0; i < grid.nx - 1; i++) {
      const f = Math.abs(flux.fx[grid.xFaceIndex(i, j)] ?? 0);
      if (f <= 0) continue;
      const a = grid.cellIndex(i, j);
      const bIdx = grid.cellIndex(i + 1, j);
      outflow[a] = (outflow[a] ?? 0) + f;
      outflow[bIdx] = (outflow[bIdx] ?? 0) + f;
    }
  }
  // Y-грани: F > 0 = вниз.
  for (let j = 0; j < grid.ny - 1; j++) {
    for (let i = 0; i < grid.nx; i++) {
      const f = Math.abs(flux.fy[grid.yFaceIndex(i, j)] ?? 0);
      if (f <= 0) continue;
      const a = grid.cellIndex(i, j);
      const bIdx = grid.cellIndex(i, j + 1);
      outflow[a] = (outflow[a] ?? 0) + f;
      outflow[bIdx] = (outflow[bIdx] ?? 0) + f;
    }
  }
  // Скважины: q_liq в ячейке тоже ограничивает шаг, иначе скважина
  // «выкачает» весь V_p за один шаг.
  if (wellLiqByCell) {
    for (let idx = 0; idx < n; idx++) {
      outflow[idx] = (outflow[idx] ?? 0) + Math.abs(wellLiqByCell[idx] ?? 0);
    }
  }

  let dtHours = dtMaxHours;
  for (let idx = 0; idx < n; idx++) {
    if (!reservoir.active[idx]) continue;
    const q = outflow[idx] ?? 0;
    if (q <= 0) continue;
    const vp = reservoir.poreVolume(idx);
    if (vp <= 0) continue;
    // cfl — доля ячейки, которую разрешено «пересечь» потоком за шаг.
    const dt = ((vp / q) * HOURS_PER_DAY) / target;
    if (dt < dtHours) dtHours = dt;
  }

  if (dtHours < HARD_MIN_HOURS) dtHours = HARD_MIN_HOURS;
  return dtHours;
}