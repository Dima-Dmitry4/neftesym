// Параметры ОФП по модели Corey (водо-смачиваемый песчаник).
// Подробнее — plan.md §3.2.

export interface RelPermParameters {
  /** Связанная вода (минимум S_w, ниже которого k_rw = 0). */
  swc: number;
  /** Остаточная нефть (максимум S_o, ниже которого k_ro = 0). */
  sor: number;
  /** Максимум k_ro (при S_w = S_wc). */
  kroMax: number;
  /** Максимум k_rw (при S_w = 1 - S_or). */
  krwMax: number;
  /** Corey exponent для нефти. */
  nOil: number;
  /** Corey exponent для воды. */
  nWater: number;
}
