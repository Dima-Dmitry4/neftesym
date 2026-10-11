// Transmissibility между двумя ячейками (TPFA — двухточечная
// аппроксимация потока). Единицы — м³/(сут·атм).
//
//   T_ij = C_DARCY · k_harm · A / (μ_eff · B_eff · d)
//
// k_harm = 2·k_i·k_j / (k_i + k_j) — гармоническое среднее,
// устойчиво к скачкам проницаемости. На границе `active` T = 0.

import { C_DARCY } from '../units.ts';
import { harmonicMean } from '../grid/Reservoir.ts';

export interface TransmissibilityInput {
  /** Абсолютная проницаемость ячейки A, мД. */
  k1: number;
  /** Абсолютная проницаемость ячейки B, мД. */
  k2: number;
  /** Площадь грани, м². */
  A: number;
  /** Вязкость в «восходящем» направлении, сП. */
  mu: number;
  /** Объёмный коэффициент в «восходящем» направлении. */
  B: number;
  /** Расстояние между центрами ячеек, м. */
  d: number;
  /** Конверсионный множитель; по умолчанию C_DARCY. */
  cDarcy?: number;
}

/** Transmissibility в м³/(сут·атм). */
export function transmissibility(input: TransmissibilityInput): number {
  const k = harmonicMean(input.k1, input.k2);
  if (k <= 0) return 0;
  if (input.A <= 0 || input.mu <= 0 || input.B <= 0 || input.d <= 0) return 0;
  const c = input.cDarcy ?? C_DARCY;
  return (c * k * input.A) / (input.mu * input.B * input.d);
}

/** Геометрическая transmissibility (без учёта флюидов).
 *  Используется для согласования с upwind-схемой насыщенности:
 *  T_g_ij = C_DARCY · k_harm · A / d.
 *  Дальше фазовые transmissibility получаются умножением
 *  на λ_α(upstream). */
export function geometricTransmissibility(
  k1: number,
  k2: number,
  A: number,
  d: number,
  cDarcy: number = C_DARCY,
): number {
  const k = harmonicMean(k1, k2);
  if (k <= 0 || A <= 0 || d <= 0) return 0;
  return (cDarcy * k * A) / d;
}

export { harmonicMean };
