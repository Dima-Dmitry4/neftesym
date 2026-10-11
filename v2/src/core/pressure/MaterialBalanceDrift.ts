// Дрейф среднего давления от материального баланса.
//
// В упрощённой модели (superposition) среднее давление —
// аналитическая функция от накопленного дефицита замещения
// (cumulative net voidage = N_p - N_inj):
//
//   P_avg_new = P_avg_old - (N_p - N_inj) · B / (V_pore · c_t)
//
// где:
//   N_p, N_inj — накопленные объёмы (reservoir m³) добычи и закачки
//   B — объёмный коэффициент (одинаковый для воды и нефти в упрощённой модели)
//   V_pore = Σ V_p_active — суммарный поровый объём активной зоны, м³
//   c_t — полная сжимаемость (rock + fluid), атм⁻¹
//
// В пределе «добыча = закачка» (VRR = 1) P_avg не меняется
// (стационар). При дефиците замещения (VRR < 1) P_avg падает,
// при избытке (VRR > 1) — растёт.
//
// Формула классическая (van Everdingen–Hurst), здесь — упрощённый
// вариант: P_avg считается по всему объёму, без разделения
// на «зону дренирования» отдельных скважин.

import type { Reservoir } from '../grid/Reservoir.ts';

export interface MaterialBalanceConfig {
  /** μ · B (для пересчёта reservoir m³ → surface-equivalent при желании,
   *  здесь используется как «эффективный объёмный коэффициент»). */
  muB: number;
  /** Полная сжимаемость (rock + fluid), атм⁻¹. */
  totalCompressibilityAtmInv: number;
  /** Объёмный коэффициент B (reservoir m³ / surface m³). */
  volumeFactor: number;
}

export interface CumulativeVolumes {
  /** Накопленная добыча (жидкость = нефть + вода), reservoir m³. */
  cumProductionM3: number;
  /** Накопленная закачка воды, reservoir m³. */
  cumInjectionM3: number;
}

/** Суммарный поровый объём активной зоны, м³. */
export function totalPoreVolume(reservoir: Reservoir): number {
  let v = 0;
  for (let idx = 0; idx < reservoir.grid.nCells; idx++) {
    if (!reservoir.active[idx]) continue;
    v += reservoir.poreVolume(idx);
  }
  return v;
}

/** Приращение среднего давления за один шаг Δt (ч) при заданных
 *  мгновенных дебитах (м³/сут). Возвращает ΔP_avg (атм), который
 *  прибавляется к P_avg. */
export function pressureDriftStep(
  totalProductionM3PerDay: number,
  totalInjectionM3PerDay: number,
  dtHours: number,
  config: MaterialBalanceConfig,
  poreVolumeM3: number,
): number {
  if (poreVolumeM3 <= 0) return 0;
  if (config.totalCompressibilityAtmInv <= 0) return 0;
  // Net voidage rate (reservoir m³/сут) = production - injection
  // > 0 ⇒ дефицит замещения ⇒ P_avg падает ⇒ ΔP_avg < 0.
  const netRate = totalProductionM3PerDay - totalInjectionM3PerDay;
  // ΔV (м³) = rate · dt (сут).
  const dtDays = dtHours / 24;
  const deltaV = netRate * dtDays;
  // ΔP_avg = -ΔV · B / (V_pore · c_t)
  return -(deltaV * config.volumeFactor) / (poreVolumeM3 * config.totalCompressibilityAtmInv);
}

/** Приращение накопленных объёмов (для хранения в state). */
export function accumulateVolumes(
  prev: CumulativeVolumes,
  totalProductionM3PerDay: number,
  totalInjectionM3PerDay: number,
  dtHours: number,
): CumulativeVolumes {
  const dtDays = dtHours / 24;
  return {
    cumProductionM3: prev.cumProductionM3 + totalProductionM3PerDay * dtDays,
    cumInjectionM3: prev.cumInjectionM3 + totalInjectionM3PerDay * dtDays,
  };
}
