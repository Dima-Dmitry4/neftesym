// Индекс продуктивности / приёмистости скважины (Peaceman).
//
// Для изотропной квадратной ячейки:
//
//   r_e = 0.2 · dx
//   J   = C_DARCY · 2π · k · h / (μ · B · (ln(r_e / r_w) + S))
//
// J в м³/(сут·атм). При анизотропной k (kx != ky) — обобщённая
// формула Пиcмена (см. plan.md §3.4 — для MVP используем
// гармоническое среднее kx, ky как «эквивалентную» горизонтальную
// проницаемость).

import { C_DARCY } from '../units.ts';

export interface PeacemanInput {
  /** Горизонтальная проницаемость, мД. */
  k: number;
  /** Толщина пласта в ячейке, м. */
  h: number;
  /** Вязкость фазы, сП (нефть — для producer, вода — для injector). */
  mu: number;
  /** Объёмный коэффициент фазы. */
  b: number;
  /** Шаг сетки по x, м. */
  dx: number;
  /** Шаг сетки по y, м (для анизотропии). */
  dy?: number;
  /** Радиус скважины, м. */
  rw: number;
  /** Скин-фактор, безразмерный. */
  skin?: number;
}

/** Эквивалентный радиус Писмана для изотропной ячейки. */
export function peacemanEquivalentRadius(dx: number, dy: number = dx): number {
  // Для изотропной квадратной ячейки: r_e = 0.2 * dx.
  // Для dx != dy: r_e ≈ 0.28 * sqrt(kx*ky) ... (формула опущена в MVP).
  return 0.2 * Math.min(dx, dy);
}

/** Индекс продуктивности / приёмистости по Писману (м³/(сут·атм)). */
export function peacemanWI(input: PeacemanInput): number {
  if (input.k <= 0 || input.h <= 0 || input.rw <= 0) return 0;
  if (input.mu <= 0 || input.b <= 0) return 0;
  const re = peacemanEquivalentRadius(input.dx, input.dy);
  if (re <= input.rw) return 0;
  const skin = input.skin ?? 0;
  const denom = Math.log(re / input.rw) + skin;
  if (denom <= 0) return 0;
  return (C_DARCY * 2 * Math.PI * input.k * input.h) / (input.mu * input.b * denom);
}
