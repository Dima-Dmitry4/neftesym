// ОФП по модели Corey (водо-смачиваемый песчаник).
//
//   S*     = (S_w - S_wc) / (1 - S_wc - S_or)
//   k_rw   = k_rw_max · (S*)^n_w
//   k_ro   = k_ro_max · (1 - S*)^n_o
//
// S_w клампится в `[S_wc, 1 - S_or]`. За пределами диапазона
// экстраполяция не производится — мы возвращаем граничные значения
// (0 для соответствующей фазы), что согласуется с физикой:
// ниже S_wc вода неподвижна, выше 1-S_or нефть неподвижна.

import type { RelPermParameters } from './RelativePermeability.ts';

/** Результат ОФП при заданной S_w. */
export interface RelPermResult {
  /** Относительная проницаемость нефти (доля, 0..1). */
  kro: number;
  /** Относительная проницаемость воды (доля, 0..1). */
  krw: number;
}

/** Кламп S_w в физический диапазон `[S_wc, 1 - S_or]`. */
export function clampSw(sw: number, params: RelPermParameters): number {
  const lower = params.swc;
  const upper = 1 - params.sor;
  if (sw < lower) return lower;
  if (sw > upper) return upper;
  return sw;
}

/** Кламп S* в `[0, 1]`. */
function clampSStar(s: number): number {
  if (s < 0) return 0;
  if (s > 1) return 1;
  return s;
}

/** ОФП Corey при заданной S_w.
 *
 *  За пределами `[S_wc, 1 - S_or]` возвращает граничные значения:
 *  - при S_w ≤ S_wc: kro = kroMax, krw = 0
 *  - при S_w ≥ 1 - S_or: kro = 0, krw = krwMax
 */
export function coreyRelPerm(sw: number, params: RelPermParameters): RelPermResult {
  const lower = params.swc;
  const upper = 1 - params.sor;
  // За пределами диапазона — фиксируем граничные значения.
  if (sw <= lower) {
    return { kro: params.kroMax, krw: 0 };
  }
  if (sw >= upper) {
    return { kro: 0, krw: params.krwMax };
  }
  const sStar = clampSStar((sw - lower) / (upper - lower));
  const krw = params.krwMax * Math.pow(sStar, params.nWater);
  const kro = params.kroMax * Math.pow(1 - sStar, params.nOil);
  return { kro, krw };
}

/** Подвижность фазы α (1/(сП·м³/м³)) = k_rα / (μ_α · B_α). */
export function mobility(kr: number, muCP: number, b: number): number {
  return kr / (muCP * b);
}

/** Полная подвижность = λ_o + λ_w. */
export function totalMobility(
  sw: number,
  params: RelPermParameters,
  muOilCP: number,
  muWaterCP: number,
  bo: number,
  bw: number,
): number {
  const { kro, krw } = coreyRelPerm(sw, params);
  return mobility(kro, muOilCP, bo) + mobility(krw, muWaterCP, bw);
}

/** Доля воды в потоке f_w = λ_w / λ_t. */
export function waterFraction(
  sw: number,
  params: RelPermParameters,
  muOilCP: number,
  muWaterCP: number,
  bo: number,
  bw: number,
): number {
  const lt = totalMobility(sw, params, muOilCP, muWaterCP, bo, bw);
  if (lt <= 0) return 0;
  const { krw } = coreyRelPerm(sw, params);
  return mobility(krw, muWaterCP, bw) / lt;
}
