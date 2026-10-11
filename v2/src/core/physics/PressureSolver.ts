// Решатель давления для IMPES: Conjugate Gradient с preconditioner
// Jacobi на SPD-системе A·P = b.
//
// Матрица A — разреженная, формат CSR. Структура: для каждой
// активной ячейки — диагональ + до 4 соседей (5-точечный шаблон).
// Неактивные ячейки — «пин» (A_ii = 1, A_ij = 0, b_i = 0).
//
// Сборка системы `buildPressureSystem` (см. ниже).
//
// IMPES (однопроходный):
//   A_ii = c_t · V_p / dt + Σ T_ij + Σ_w J_base · λ_t
//   A_ij = -T_ij   (i ≠ j, соседи)
//   b_i  = c_t · V_p / dt · P^n + Σ_w J_base · λ_t · BHP
//
//   T_ij = T_g_ij · λ_t (upstream по P^n, т.е. заморожено на n-шаге).

import { coreyRelPerm, mobility } from '../properties/Corey.ts';
import type { RelPermParameters } from '../properties/RelativePermeability.ts';
import type { FluidProperties } from '../properties/FluidProperties.ts';
import type { Reservoir } from '../grid/Reservoir.ts';
import type { TransmissibilityMap } from './TransmissibilityMap.ts';
import type { WellState } from '../wells/BHPControl.ts';

/** Разреженная матрица в формате CSR. */
export interface CSRMatrix {
  n: number;
  /** rowPtr[i+1] - rowPtr[i] = nnz в строке i. */
  rowPtr: Int32Array;
  /** colIdx[k] — индекс столбца для k-го ненулевого. */
  colIdx: Int32Array;
  /** values[k] — значение. */
  values: Float64Array;
}

/** Собрать CSR из списка (row, col, val) триплетов.
 *  Дубликаты суммируются, строки/столбцы сортируются. */
export function csrFromTriplets(
  n: number,
  triplets: Array<readonly [number, number, number]>,
): CSRMatrix {
  if (triplets.length === 0) {
    return {
      n,
      rowPtr: new Int32Array(n + 1),
      colIdx: new Int32Array(0),
      values: new Float64Array(0),
    };
  }
  // Сортируем
  const sorted = [...triplets].sort((a, b) =>
    a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1],
  );
  // Сливаем дубликаты
  const merged: Array<[number, number, number]> = [];
  for (const t of sorted) {
    const last = merged[merged.length - 1];
    if (last && last[0] === t[0] && last[1] === t[1]) {
      last[2] += t[2];
    } else {
      merged.push([t[0], t[1], t[2]]);
    }
  }
  // Строим CSR
  const nnz = merged.length;
  const rowPtr = new Int32Array(n + 1);
  const colIdx = new Int32Array(nnz);
  const values = new Float64Array(nnz);
  let p = 0;
  for (let i = 0; i < n; i++) {
    rowPtr[i] = p;
    while (p < nnz) {
      const m = merged[p];
      if (!m || m[0] !== i) break;
      colIdx[p] = m[1];
      values[p] = m[2];
      p++;
    }
  }
  rowPtr[n] = p;
  return { n, rowPtr, colIdx, values };
}

/** y = A · x (CSR SpMV). */
export function spmv(A: CSRMatrix, x: Float64Array, y: Float64Array): void {
  const n = A.n;
  for (let i = 0; i < n; i++) {
    const start = A.rowPtr[i] ?? 0;
    const end = A.rowPtr[i + 1] ?? 0;
    let sum = 0;
    for (let k = start; k < end; k++) {
      sum += (A.values[k] ?? 0) * (x[A.colIdx[k] ?? 0] ?? 0);
    }
    y[i] = sum;
  }
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

function norm2(a: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i] ?? 0;
    s += v * v;
  }
  return Math.sqrt(s);
}

/** Результат CG-решателя. */
export interface CGResult {
  x: Float64Array;
  iterations: number;
  /** ||r|| / ||b|| (нормированный невязок). */
  residual: number;
  /** Сходился ли по tolerance. */
  converged: boolean;
}

/** Conjugate Gradient с Jacobi preconditioner.
 *
 *  @param A SPD-матрица (CSR)
 *  @param b правая часть
 *  @param x0 начальное приближение
 *  @param tolerance критерий сходимости по ||r||/||b||
 *  @param maxIter макс. итераций
 */
export function solveCG(
  A: CSRMatrix,
  b: Float64Array,
  x0: Float64Array,
  tolerance: number,
  maxIter: number,
): CGResult {
  const n = A.n;
  const x = x0.slice();
  // r = b - A*x
  const ax = new Float64Array(n);
  spmv(A, x, ax);
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) r[i] = (b[i] ?? 0) - (ax[i] ?? 0);
  // Preconditioner: Jacobi.
  const Minv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const start = A.rowPtr[i] ?? 0;
    const end = A.rowPtr[i + 1] ?? 0;
    let diag = 0;
    for (let k = start; k < end; k++) {
      if (A.colIdx[k] === i) {
        diag = A.values[k] ?? 0;
        break;
      }
    }
    Minv[i] = Math.abs(diag) > 0 ? 1 / diag : 1;
  }
  // z = M^-1 r
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) z[i] = (Minv[i] ?? 0) * (r[i] ?? 0);
  // p = z
  const p = z.slice();
  // rz = r · z
  let rz = dot(r, z);
  const bNorm = Math.max(1, norm2(b));
  let residual = norm2(r) / bNorm;
  let iter = 0;
  const Ap = new Float64Array(n);
  let converged = residual < tolerance;
  for (; iter < maxIter && !converged; iter++) {
    spmv(A, p, Ap);
    const pAp = dot(p, Ap);
    if (Math.abs(pAp) < 1e-30) {
      // Вырожденное направление — стоп.
      break;
    }
    const alpha = rz / pAp;
    for (let i = 0; i < n; i++) {
      x[i] = (x[i] ?? 0) + alpha * (p[i] ?? 0);
      r[i] = (r[i] ?? 0) - alpha * (Ap[i] ?? 0);
    }
    for (let i = 0; i < n; i++) z[i] = (Minv[i] ?? 0) * (r[i] ?? 0);
    const rzNew = dot(r, z);
    if (Math.abs(rz) < 1e-30) break;
    const beta = rzNew / rz;
    for (let i = 0; i < n; i++) {
      p[i] = (z[i] ?? 0) + beta * (p[i] ?? 0);
    }
    rz = rzNew;
    residual = norm2(r) / bNorm;
    converged = residual < tolerance;
  }
  return { x, iterations: iter, residual, converged };
}

/** Полная сжимаемость c_t в ячейке. */
export function totalCompressibility(
  sw: number,
  phi: number,
  relperm: RelPermParameters,
  fluid: FluidProperties,
  crAtm: number,
): number {
  void relperm;
  return phi * (sw * fluid.cwAtm + (1 - sw) * fluid.coAtm) + crAtm;
}

export interface BuildPressureSystemInput {
  reservoir: Reservoir;
  tMap: TransmissibilityMap;
  sw: Float64Array;
  p: Float64Array;
  relperm: RelPermParameters;
  fluid: FluidProperties;
  crAtm: number;
  dt: number;
  wellStates: readonly WellState[];
  /**
   * Давление «аквифера» (внешнего источника) на границе, атм.
   * Если задано, для активных граничных ячеек добавляется
   * фиктивная transmissibility к ячейке с этим давлением —
   * это leaky constant-pressure BC, имитирующий подпитку от
   * прилегающего ВНК. По умолчанию = 0 (no-flow).
   */
  pAquiferAtm?: number;
  /**
   * Коэффициент «проницаемости» аквифера (доля от средней T между
   * ячейками). По умолчанию 0.01. Чем больше — тем сильнее
   * подпитка.
   */
  aquiferTransmissibilityFrac?: number;
}

/** Собрать линейную систему для IMPES давления. */
export function buildPressureSystem(input: BuildPressureSystemInput): {
  matrix: CSRMatrix;
  rhs: Float64Array;
} {
  const {
    reservoir, tMap, sw, p, relperm, fluid, crAtm, dt, wellStates,
    pAquiferAtm = 0,
    aquiferTransmissibilityFrac = 0.01,
  } = input;
  const grid = reservoir.grid;
  const n = grid.nCells;
  const triplets: Array<[number, number, number]> = [];
  const rhs = new Float64Array(n);

  // Группируем скважины по ячейкам для быстрого доступа.
  const wellsByCellLocal = new Map<number, WellState[]>();
  for (const ws of wellStates) {
    if (!ws || ws.jBase <= 0) continue;
    const list = wellsByCellLocal.get(ws.cellIndex) ?? [];
    list.push(ws);
    wellsByCellLocal.set(ws.cellIndex, list);
  }

  // Предвычисляем среднюю inter-cell transmissibility (по gt)
  // для масштабирования aquifer-tx.
  let tAvg = 0;
  let tCount = 0;
  for (let f = 0; f < grid.nXfaces; f++) {
    const v = tMap.txG[f] ?? 0;
    if (v > 0) {
      tAvg += v;
      tCount++;
    }
  }
  for (let f = 0; f < grid.nYfaces; f++) {
    const v = tMap.tyG[f] ?? 0;
    if (v > 0) {
      tAvg += v;
      tCount++;
    }
  }
  tAvg = tCount > 0 ? tAvg / tCount : 0;
  const tAquiferBase = pAquiferAtm > 0 ? aquiferTransmissibilityFrac * tAvg : 0;

  for (let idx = 0; idx < n; idx++) {
    if (!reservoir.active[idx]) {
      // Иначе — вырожденная строка. Пин к нулю.
      triplets.push([idx, idx, 1]);
      continue;
    }
    const swCell = sw[idx] ?? relperm.swc;
    const phi = reservoir.porosity[idx] ?? 0;
    const ct = totalCompressibility(swCell, phi, relperm, fluid, crAtm);
    const vp = reservoir.poreVolume(idx);
    // dt в часах; для согласования с потоками (м³/сут) переводим в сутки.
    const dtDays = Math.max(dt / 24, 1e-12);
    const accum = (ct * vp) / dtDays;
    let diag = accum;
    rhs[idx] = accum * (p[idx] ?? 0);
    const i = idx % grid.nx;
    const j = Math.floor(idx / grid.nx);

    // X-face right
    if (i < grid.nx - 1) {
      const idxB = grid.cellIndex(i + 1, j);
      const fid = grid.xFaceIndex(i, j);
      const tG = (tMap.txG[fid] ?? 0) * (tMap.xOpen[fid] ?? 0);
      if (tG > 0) {
        const upstream = (p[idx] ?? 0) >= (p[idxB] ?? 0) ? idx : idxB;
        const kr = coreyRelPerm(sw[upstream] ?? relperm.swc, relperm);
        const lt = mobility(kr.kro, fluid.muOilCP, fluid.bo) + mobility(kr.krw, fluid.muWaterCP, fluid.bw);
        const t = tG * lt;
        diag += t;
        triplets.push([idx, idxB, -t]);
      }
    }
    // X-face left
    if (i > 0) {
      const idxB = grid.cellIndex(i - 1, j);
      const fid = grid.xFaceIndex(i - 1, j);
      const tG = (tMap.txG[fid] ?? 0) * (tMap.xOpen[fid] ?? 0);
      if (tG > 0) {
        const upstream = (p[idx] ?? 0) >= (p[idxB] ?? 0) ? idx : idxB;
        const kr = coreyRelPerm(sw[upstream] ?? relperm.swc, relperm);
        const lt = mobility(kr.kro, fluid.muOilCP, fluid.bo) + mobility(kr.krw, fluid.muWaterCP, fluid.bw);
        const t = tG * lt;
        diag += t;
        triplets.push([idx, idxB, -t]);
      }
    }
    // Y-face down
    if (j < grid.ny - 1) {
      const idxB = grid.cellIndex(i, j + 1);
      const fid = grid.yFaceIndex(i, j);
      const tG = (tMap.tyG[fid] ?? 0) * (tMap.yOpen[fid] ?? 0);
      if (tG > 0) {
        const upstream = (p[idx] ?? 0) >= (p[idxB] ?? 0) ? idx : idxB;
        const kr = coreyRelPerm(sw[upstream] ?? relperm.swc, relperm);
        const lt = mobility(kr.kro, fluid.muOilCP, fluid.bo) + mobility(kr.krw, fluid.muWaterCP, fluid.bw);
        const t = tG * lt;
        diag += t;
        triplets.push([idx, idxB, -t]);
      }
    }
    // Y-face up
    if (j > 0) {
      const idxB = grid.cellIndex(i, j - 1);
      const fid = grid.yFaceIndex(i, j - 1);
      const tG = (tMap.tyG[fid] ?? 0) * (tMap.yOpen[fid] ?? 0);
      if (tG > 0) {
        const upstream = (p[idx] ?? 0) >= (p[idxB] ?? 0) ? idx : idxB;
        const kr = coreyRelPerm(sw[upstream] ?? relperm.swc, relperm);
        const lt = mobility(kr.kro, fluid.muOilCP, fluid.bo) + mobility(kr.krw, fluid.muWaterCP, fluid.bw);
        const t = tG * lt;
        diag += t;
        triplets.push([idx, idxB, -t]);
      }
    }

    // Скважины
    const wells = wellsByCellLocal.get(idx);
    if (wells) {
      for (const w of wells) {
        const lt = w.lambdaTotal;
        const contr = w.jBase * lt;
        diag += contr;
        // q = J_base · λ_t · (P_cell - BHP)
        // Подставляем в уравнение давления: на LHS diag += contr,
        // на RHS (после переноса) b_i += J_base · λ_t · BHP.
        rhs[idx] = (rhs[idx] ?? 0) + contr * w.bhp;
      }
    }

    // «Аквифер» — leaky constant-P BC на границе.
    // Считаем количество неактивных соседей; для каждого добавляем
    // маленькую фиктивную tx к «бесконечной» ячейке с P_aquifer.
    if (tAquiferBase > 0) {
      const i = idx % grid.nx;
      const j = Math.floor(idx / grid.nx);
      let nInactive = 0;
      if (i === 0 || (reservoir.active[idx - 1] ?? 0) === 0) nInactive++;
      if (i === grid.nx - 1 || (reservoir.active[idx + 1] ?? 0) === 0) nInactive++;
      if (j === 0 || (reservoir.active[idx - grid.nx] ?? 0) === 0) nInactive++;
      if (j === grid.ny - 1 || (reservoir.active[idx + grid.nx] ?? 0) === 0) nInactive++;
      if (nInactive > 0) {
        const tAq = tAquiferBase * nInactive;
        diag += tAq;
        rhs[idx] = (rhs[idx] ?? 0) + tAq * pAquiferAtm;
      }
    }

    triplets.push([idx, idx, diag]);
  }
  return { matrix: csrFromTriplets(n, triplets), rhs };
}
