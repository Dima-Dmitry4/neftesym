// Аналитическое стационарное поле давления через суперпозицию
// цилиндрических решений (steady-state radial Darcy + superposition).
//
// Одиночная скважина с дебитом q (м³/сут, q > 0 = production,
// q < 0 = injection) и радиусом влияния R_e (м) даёт в окружающей
// среде:
//
//   P(r) = P_avg + (q · μ · B) / (2π · k · h) · ln(r / R_e)  for r ≤ R_e
//   P(r) = P_avg                                            for r > R_e
//
// Заметим: ln(r/R_e) ≤ 0 (т.к. r ≤ R_e), поэтому для q > 0
// (producer) ΔP ≤ 0 — корректно (воронка депрессии).
//
// Для нескольких скважин — линейная суперпозиция: ΔP(x) = Σ ΔP_w(x).
//
// Этот модуль не знает про уравнения в частных производных: формула
// чисто алгебраическая, O(N_cells · N_wells) на оценку.
//
// Все единицы — полевые метрические (атм, м, мД, сП, м³/м³, м³/сут).

import type { Reservoir } from '../grid/Reservoir.ts';

/** Параметры одной скважины для суперпозиции. */
export interface SuperpositionWellState {
  /** ID скважины. */
  wellId: string;
  /** Индекс ячейки по x. */
  i: number;
  /** Индекс ячейки по y. */
  j: number;
  /** Радиус влияния, м. */
  radiusM: number;
  /** Эффективная проницаемость для радиальной задачи, мД. */
  kEffMD: number;
  /** Эффективная толщина для радиальной задачи, м. */
  hEffM: number;
  /** Произведение μ · B (вязкость · объёмный коэф.). */
  muB: number;
  /** Радиус скважины, м (используется для самовлияния). */
  rwM: number;
  /** Дебит, м³/сут. q > 0 = production, q < 0 = injection. */
  rateM3PerDay: number;
}

export interface SuperpositionInput {
  reservoir: Reservoir;
  wells: ReadonlyArray<SuperpositionWellState>;
  /** Среднее давление по месторождению, атм. */
  pAvgAtm: number;
}

export interface SuperpositionResult {
  /** Давление в каждой ячейке, атм. Float64Array длины nCells. */
  pressure: Float64Array;
}

/** Вычислить поле давления через суперпозицию. */
export function computeCellPressures(input: SuperpositionInput): SuperpositionResult {
  const { reservoir, wells, pAvgAtm } = input;
  const n = reservoir.grid.nCells;
  const p = new Float64Array(n);
  // Базовое значение — P_avg.
  for (let i = 0; i < n; i++) p[i] = pAvgAtm;
  for (const w of wells) {
    if (!w) continue;
    if (w.rateM3PerDay === 0) continue;
    if (w.kEffMD <= 0 || w.hEffM <= 0 || w.radiusM <= 0) continue;
    const idx0 = reservoir.grid.cellIndex(w.i, w.j);
    if (idx0 < 0 || idx0 >= n) continue;
    if (!reservoir.active[idx0]) continue;
    const coeff = (w.rateM3PerDay * w.muB) / (2 * Math.PI * w.kEffMD * w.hEffM);
    const centerX = (w.i + 0.5) * reservoir.grid.dx;
    const centerY = (w.j + 0.5) * reservoir.grid.dy;
    const re = w.radiusM;
    // Для собственной ячейки скважины используем r = max(rw, half-cell) —
    // иначе ln(0) → −∞, что физически неверно (это уже «забой»).
    const rSelf = Math.max(w.rwM, 0.5 * reservoir.grid.dx);
    for (let j = 0; j < reservoir.grid.ny; j++) {
      for (let i = 0; i < reservoir.grid.nx; i++) {
        const idx = reservoir.grid.cellIndex(i, j);
        if (!reservoir.active[idx]) continue;
        const cx = (i + 0.5) * reservoir.grid.dx;
        const cy = (j + 0.5) * reservoir.grid.dy;
        const dx = cx - centerX;
        const dy = cy - centerY;
        const r = Math.hypot(dx, dy);
        if (r > re) continue;
        // На собственной ячейке — берём rSelf, чтобы не было −∞.
        const rEff = i === w.i && j === w.j ? rSelf : Math.max(r, 1e-3);
        // ΔP = coeff · ln(rEff / re). ln ≤ 0 ⇒ при q > 0 ΔP < 0.
        p[idx] = (p[idx] ?? pAvgAtm) + coeff * Math.log(rEff / re);
      }
    }
  }
  return { pressure: p };
}

/** Расстояние между двумя скважинами (по центрам ячеек), м. */
export function distanceBetweenWells(
  a: { i: number; j: number },
  b: { i: number; j: number },
  dx: number,
  dy: number,
): number {
  const ax = (a.i + 0.5) * dx;
  const ay = (a.j + 0.5) * dy;
  const bx = (b.i + 0.5) * dx;
  const by = (b.j + 0.5) * dy;
  return Math.hypot(ax - bx, ay - by);
}

/** Расстояние от скважины до границы месторождения (в одном из 4 направлений), м. */
export function distanceToBoundary(
  w: { i: number; j: number },
  nx: number,
  ny: number,
  dx: number,
  dy: number,
): number {
  const wx = (w.i + 0.5) * dx;
  const wy = (w.j + 0.5) * dy;
  const dLeft = wx;
  const dRight = nx * dx - wx;
  const dTop = wy;
  const dBottom = ny * dy - wy;
  return Math.min(dLeft, dRight, dTop, dBottom);
}
