// Капиллярное давление P_c(S_w).
//
// В MVP капиллярное давление выключено: P_c(S_w) ≡ 0 на всём
// диапазоне. Это даёт чёткий фронт Бакли-Леверетта — проще учиться.
// Подключение табличной P_c(S_w) планируется после Phase 8.

import type { RelPermParameters } from './RelativePermeability.ts';

/** Параметры капиллярного давления. Заглушка — пока не используется. */
export interface CapillaryPressureParameters {
  /** Включено ли капиллярное давление. */
  enabled: boolean;
  /** Входная капиллярное давление при S_wc (атм). */
  pcAtSwcAtm: number;
  /** Входная капиллярное давление при 1 - S_or (атм). */
  pcAtSorAtm: number;
  /** Опциональная таблица (S_w, P_c) для нелинейной формы. */
  table?: ReadonlyArray<readonly [number, number]>;
}

export const NO_CAPILLARY_PRESSURE: CapillaryPressureParameters = {
  enabled: false,
  pcAtSwcAtm: 0,
  pcAtSorAtm: 0,
};

/** Капиллярное давление в зависимости от водонасыщенности (атм).
 *
 *  В MVP — константный ноль. Если включить `enabled` и задать
 *  таблицу, можно реализовать нелинейную форму позже.
 *
 *  S_w клампится в `[S_wc, 1 - S_or]`.
 */
export function capillaryPressure(
  sw: number,
  _relperm: RelPermParameters,
  params: CapillaryPressureParameters = NO_CAPILLARY_PRESSURE,
): number {
  if (!params.enabled) return 0;
  // Заглушка: линейная интерполяция по таблице, если задана.
  if (params.table && params.table.length >= 2) {
    const table = params.table;
    if (sw <= (table[0]?.[0] ?? 0)) return table[0]?.[1] ?? 0;
    const last = table[table.length - 1];
    if (sw >= (last?.[0] ?? 1)) return last?.[1] ?? 0;
    for (let i = 1; i < table.length; i++) {
      const lo = table[i - 1];
      const hi = table[i];
      if (lo && hi && sw >= lo[0] && sw <= hi[0]) {
        const t = (sw - lo[0]) / (hi[0] - lo[0]);
        return lo[1] + t * (hi[1] - lo[1]);
      }
    }
  }
  // Линейный fallback: pc(swc) → pc(1-sor).
  if (sw <= params.pcAtSwcAtm * 0 + (_relperm.swc ?? 0)) return params.pcAtSwcAtm;
  const sor = _relperm.sor;
  const upper = 1 - sor;
  if (sw >= upper) return params.pcAtSorAtm;
  const t = (sw - _relperm.swc) / (upper - _relperm.swc);
  return params.pcAtSwcAtm + t * (params.pcAtSorAtm - params.pcAtSwcAtm);
}
