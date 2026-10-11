// Решатель взаимного влияния скважин (BHP-контроль).
//
// Идея: стационарная суперпозиция линейна по дебитам. Для каждой
// скважины j её забойное давление P_bhp_j связано с дебитами
// всех скважин через матрицу влияния A:
//
//   P_bhp_j - P_avg = -Σ_i A_ji · q_i
//
// где A_ji = (μ·B) / (2π·k_i·h_i) · ln(R_e_i / d_ij),
//       d_jj = r_wj (самовлияние через ln(R_e_j / r_wj)),
//       d_ij = расстояние между скважинами i и j (i ≠ j).
//
// Если d_ij > R_e_i — влияние = 0 (A_ji = 0), скважина «не дотягивается».
//
// Решаем A · q = (P_avg - P_bhp), откуда q = A^{-1} · (P_avg - P_bhp).
//
// Знаковая конвенция: q > 0 = production (отток), q < 0 = injection (приток).
// Это согласовано с Superposition.ts и SaturationSolver.

import type { Reservoir } from '../grid/Reservoir.ts';
import type { Well } from './Well.ts';
import { distanceBetweenWells, distanceToBoundary } from '../pressure/Superposition.ts';

export interface RateSolverConfig {
  /** μ · B (одинаковое для всех фаз в упрощённой модели). */
  muB: number;
  /** Режим расчёта R_e. */
  radiusMode: 'dynamic' | 'fixed';
  /** Фиксированный R_e (если mode === 'fixed'). */
  fixedRadiusM?: number;
  /** Способ расчёта k_eff. */
  effectiveK: 'mean-in-radius' | 'max-in-radius' | 'constant';
  /** Константа k_eff (если effectiveK === 'constant'). */
  constantKEffMD?: number;
}

export interface ResolvedWell {
  well: Well;
  i: number;
  j: number;
  /** Радиус влияния, м. */
  radiusM: number;
  /** Эффективная проницаемость, мД. */
  kEffMD: number;
  /** Эффективная толщина, м. */
  hEffM: number;
}

export interface RateSolverResult {
  /** Дебит каждой скважины, м³/сут. q > 0 = production, q < 0 = injection. */
  rates: Map<string, number>;
  /** Разрешённые параметры (для передачи в Superposition). */
  resolved: Map<string, ResolvedWell>;
}

/** Вычислить R_e в динамическом режиме: половина расстояния до
 *  ближайшего соседа или до границы месторождения. */
function computeDynamicRadius(
  well: Well,
  allWells: ReadonlyArray<Well>,
  reservoir: Reservoir,
): number {
  const { grid } = reservoir;
  let minD = distanceToBoundary(well, grid.nx, grid.ny, grid.dx, grid.dy);
  for (const other of allWells) {
    if (other.id === well.id) continue;
    const d = distanceBetweenWells(well, other, grid.dx, grid.dy);
    if (d < minD) minD = d;
  }
  return 0.5 * minD;
}

/** Вычислить k_eff для одной скважины по её окрестности радиуса R_e. */
function computeEffectiveK(
  well: Well,
  reservoir: Reservoir,
  radiusM: number,
  method: 'mean-in-radius' | 'max-in-radius',
): number {
  const { grid } = reservoir;
  const wx = (well.i + 0.5) * grid.dx;
  const wy = (well.j + 0.5) * grid.dy;
  let sumK = 0;
  let maxK = 0;
  let count = 0;
  for (let j = 0; j < grid.ny; j++) {
    for (let i = 0; i < grid.nx; i++) {
      const idx = grid.cellIndex(i, j);
      if (!reservoir.active[idx]) continue;
      const cx = (i + 0.5) * grid.dx;
      const cy = (j + 0.5) * grid.dy;
      const r = Math.hypot(cx - wx, cy - wy);
      if (r > radiusM) continue;
      const k = reservoir.permX[idx] ?? 0;
      if (k <= 0) continue;
      sumK += k;
      if (k > maxK) maxK = k;
      count++;
    }
  }
  if (count === 0) return 0;
  if (method === 'max-in-radius') return maxK;
  return sumK / count;
}

/** Вычислить h_eff — средняя толщина в окрестности радиуса R_e. */
function computeEffectiveH(
  well: Well,
  reservoir: Reservoir,
  radiusM: number,
): number {
  const { grid } = reservoir;
  const wx = (well.i + 0.5) * grid.dx;
  const wy = (well.j + 0.5) * grid.dy;
  let hSum = 0;
  let hCount = 0;
  for (let j = 0; j < grid.ny; j++) {
    for (let i = 0; i < grid.nx; i++) {
      const idx = grid.cellIndex(i, j);
      if (!reservoir.active[idx]) continue;
      const cx = (i + 0.5) * grid.dx;
      const cy = (j + 0.5) * grid.dy;
      if (Math.hypot(cx - wx, cy - wy) > radiusM) continue;
      hSum += reservoir.thickness[idx] ?? 0;
      hCount++;
    }
  }
  return hCount > 0 ? hSum / hCount : 0;
}

/** Разрешить параметры скважин (R_e, k_eff, h_eff) — кешируется между шагами. */
export function resolveWells(
  wells: ReadonlyArray<Well>,
  reservoir: Reservoir,
  config: RateSolverConfig,
): Map<string, ResolvedWell> {
  const out = new Map<string, ResolvedWell>();
  for (const w of wells) {
    if (!w) continue;
    const idx = reservoir.grid.cellIndex(w.i, w.j);
    if (idx < 0 || idx >= reservoir.grid.nCells) continue;
    if (!reservoir.active[idx]) continue;
    const radiusM =
      config.radiusMode === 'fixed' && config.fixedRadiusM !== undefined
        ? config.fixedRadiusM
        : computeDynamicRadius(w, wells, reservoir);
    let kEff: number;
    if (config.effectiveK === 'constant' && config.constantKEffMD !== undefined) {
      kEff = config.constantKEffMD;
    } else {
      const method = config.effectiveK === 'max-in-radius' ? 'max-in-radius' : 'mean-in-radius';
      kEff = computeEffectiveK(w, reservoir, radiusM, method);
    }
    const hEff = computeEffectiveH(w, reservoir, radiusM);
    out.set(w.id, {
      well: w,
      i: w.i,
      j: w.j,
      radiusM,
      kEffMD: kEff,
      hEffM: hEff,
    });
  }
  return out;
}

/** Решить линейную систему A·q = b методом Гаусса с частичным выбором
 *  главного элемента. Возвращает массив длины n (или пустой, если
 *  n = 0). При вырожденной матрице возвращает нули. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = A.length;
  if (n === 0) return [];
  const M: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = A[i] ?? [];
    const r = row.slice();
    r.push(b[i] ?? 0);
    M.push(r);
  }
  for (let k = 0; k < n; k++) {
    let pivotRow = k;
    let pivotVal = Math.abs(M[k]?.[k] ?? 0);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(M[i]?.[k] ?? 0);
      if (v > pivotVal) {
        pivotVal = v;
        pivotRow = i;
      }
    }
    if (pivotVal < 1e-15) {
      return new Array(n).fill(0);
    }
    if (pivotRow !== k) {
      const tmp = M[k]!;
      M[k] = M[pivotRow]!;
      M[pivotRow] = tmp;
    }
    for (let i = k + 1; i < n; i++) {
      const factor = (M[i]?.[k] ?? 0) / (M[k]?.[k] ?? 1);
      for (let j = k; j <= n; j++) {
        M[i]![j] = (M[i]?.[j] ?? 0) - factor * (M[k]?.[j] ?? 0);
      }
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = M[i]?.[n] ?? 0;
    for (let j = i + 1; j < n; j++) {
      sum -= (M[i]?.[j] ?? 0) * (x[j] ?? 0);
    }
    const diag = M[i]?.[i] ?? 1;
    x[i] = sum / diag;
  }
  return x;
}

/** Границы дебита для одной скважины, м³/сут.
 *
 *  КЛЮЧЕВОЕ ФИЗИЧЕСКОЕ ОГРАНИЧЕНИЕ: продюсер не может закачивать, а
 *  инжектор — добывать. Знак `q` в системе определяется только величиной
 *  `P_avg − BHP_j`, поэтому без этого ограничения при падении P_avg ниже
 *  BHP продюсер «переворачивается» в закачку на полный rateLimit и
 *  возникает предельный цикл (limit cycle).
 *
 *  Границы по модулю берутся из `rateLimit` (0 = без лимита, тогда
 *  действует safety cap). */
export interface RateBounds {
  qMin: number;
  qMax: number;
}

/**
 * Аварийный предел дебита для скважин без явного rateLimit, м³/сут.
 *
 * Нужен как страховка от вырожденной системы (A_ii → 0), но ставить его
 * слишком высоким нельзя: при 100 000 м³/сут скважина выпивает поровый
 * объём активной зоны (~2·10⁶ м³) за 20 сут, и это уже не физика, а
 * числовой мусор — насыщенность и давление начинают «скакать».
 *
 * 10 000 м³/сут — это в 5 раз больше крупнейшего штатного приёмистости
 * инжектора (2000) и достаточно далеко от вырожденности.
 */
const SAFETY_CAP_M3_PER_DAY = 10_000;

function boundsForWell(well: Well): RateBounds {
  const lim = well.rateLimit ?? 0;
  const cap = lim > 0 ? lim : SAFETY_CAP_M3_PER_DAY;
  return well.type === 'producer' ? { qMin: 0, qMax: cap } : { qMin: -cap, qMax: 0 };
}

/** Решить A·q = b с box-ограничениями qMin ≤ q_j ≤ qMax
 *  (active set + подстановка столбцов).
 *
 *  Итеративно:
 *   1. решить без ограничений,
 *   2. найти скважины, нарушившие границы, и «приколоть» их к
 *      ближайшей границе,
 *   3. в системе заменить столбец j на e_j и b_j на значение границы,
 *   4. пересчитать; если появились новые нарушители — повторить.
 *
 *  Так ограничения учитываются В САМОЙ системе взаимного влияния:
 *  скважина на лимите продолжает «чувствовать» соседей через
 *  неизвестные дебиты остальных, а не просто обрезается постфактум. */
function solveBoundedLinear(
  A: readonly number[][],
  b: readonly number[],
  bounds: readonly RateBounds[],
  maxIter = 32,
): number[] {
  const n = b.length;
  if (n === 0) return [];
  const tol = 1e-9;
  let q = solveLinear(A as number[][], b as number[]);
  const pinned = new Set<number>();

  for (let iter = 0; iter < maxIter; iter++) {
    let violated = false;
    for (let j = 0; j < n; j++) {
      if (pinned.has(j)) continue;
      const bd = bounds[j];
      if (!bd) continue;
      const qj = q[j] ?? 0;
      if (qj < bd.qMin - tol || qj > bd.qMax + tol) {
        pinned.add(j);
        violated = true;
      }
    }
    if (!violated) break;

    const Am: number[][] = A.map((row) => row.slice());
    const bm: number[] = b.slice();
    for (const j of pinned) {
      const bd = bounds[j];
      if (!bd) continue;
      bm[j] = (q[j] ?? 0) < 0 ? bd.qMin : bd.qMax;
      for (let i = 0; i < n; i++) Am[i]![j] = i === j ? 1 : 0;
    }
    const qNew = solveLinear(Am, bm);
    // Вырожденная подсистема — оставляем предыдущее решение.
    if (qNew.some((v) => !isFinite(v))) break;
    q = qNew;
  }

  // Финальный кламп — страховка от численного мусора на границах.
  for (let j = 0; j < n; j++) {
    const bd = bounds[j];
    if (!bd) continue;
    const v = q[j] ?? 0;
    q[j] = Math.min(bd.qMax, Math.max(bd.qMin, v));
  }
  return q;
}

/** Главный вход: вычислить дебиты по BHP с учётом взаимного влияния. */
export function solveRates(
  wells: ReadonlyArray<Well>,
  reservoir: Reservoir,
  pAvg: number,
  config: RateSolverConfig,
): RateSolverResult {
  const resolved = resolveWells(wells, reservoir, config);
  const ids = Array.from(resolved.keys());
  const n = ids.length;
  if (n === 0) return { rates: new Map(), resolved };
  const gridDx = reservoir.grid.dx;
  const gridDy = reservoir.grid.dy;
  const A: number[][] = [];
  for (let i = 0; i < n; i++) A.push(new Array(n).fill(0));
  const b: number[] = [];
  for (let j = 0; j < n; j++) {
    const wj = resolved.get(ids[j]!);
    if (!wj) {
      b.push(0);
      continue;
    }
    b.push(pAvg - wj.well.bhpAtm);
    for (let i = 0; i < n; i++) {
      const wi = resolved.get(ids[i]!);
      if (!wi) continue;
      let entry: number;
      if (i === j) {
        if (wi.kEffMD <= 0 || wi.hEffM <= 0 || wi.radiusM <= 0 || wj.well.rw <= 0) {
          entry = 0;
        } else {
          const ratio = wi.radiusM / wj.well.rw;
          if (ratio <= 1) entry = 0;
          else entry = (config.muB * Math.log(ratio)) / (2 * Math.PI * wi.kEffMD * wi.hEffM);
        }
      } else {
        const d = distanceBetweenWells(wi, wj, gridDx, gridDy);
        if (d > wi.radiusM) {
          entry = 0;
        } else if (wi.kEffMD <= 0 || wi.hEffM <= 0) {
          entry = 0;
        } else {
          entry = (config.muB * Math.log(wi.radiusM / d)) / (2 * Math.PI * wi.kEffMD * wi.hEffM);
        }
      }
      A[j]![i] = entry;
    }
  }
  // Ограничения (знак по типу скважины + rateLimit) встраиваются в
  // систему через active set, а не применяются постфактум.
  const bounds: RateBounds[] = [];
  for (let i = 0; i < n; i++) {
    const wi = resolved.get(ids[i] ?? '');
    if (!wi) {
      bounds.push({ qMin: -SAFETY_CAP_M3_PER_DAY, qMax: SAFETY_CAP_M3_PER_DAY });
      continue;
    }
    bounds.push(boundsForWell(wi.well));
  }
  const x = solveBoundedLinear(A, b, bounds);
  const rates = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const id = ids[i] ?? '';
    const wi = resolved.get(id);
    if (!wi) continue;
    rates.set(id, x[i] ?? 0);
  }
  return { rates, resolved };
}
