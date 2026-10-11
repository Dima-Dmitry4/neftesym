// Карты transmissibility для всех граней сетки.
//
// В IMPES обычно используется «геометрическая» transmissibility T_g,
// а фазовые transmissibility получаются домножением на подвижность
// в восходящем направлении. Это позволяет pressure solver быть
// неявным по полной подвижности (λ_t), а saturation solver —
// явным по фазовым долям.
//
// Структура:
// - xFaces: (nx-1) * ny граней, ориентация по x, нормаль по x.
// - yFaces: nx * (ny-1) граней, ориентация по y, нормаль по y.
//
// Каждая грань хранит:
//   - tx_g: геометрическая transmissibility (м³/(сут·атм) / (1/(сП·B)))
//          T_g = C_DARCY · k_harm · A / d
//   - k_eff: гармоническая k (для отчёта)
//   - active: грань открыта? (false для границ контура и разломов)

import { geometricTransmissibility } from './Transmissibility.ts';
import type { Reservoir } from '../grid/Reservoir.ts';
import type { Grid2D } from '../grid/Grid2D.ts';

export interface TransmissibilityMap {
  /** Геометрическая T для X-граней, длина nXfaces. */
  txG: Float64Array;
  /** Геометрическая T для Y-граней, длина nYfaces. */
  tyG: Float64Array;
  /** X-грань открыта (T != 0)? Длина nXfaces. */
  xOpen: Uint8Array;
  /** Y-грань открыта? */
  yOpen: Uint8Array;
  /** X-грани, блокированные разломом (T = 0). */
  xFault: Uint8Array;
  /** Y-грани, блокированные разломом. */
  yFault: Uint8Array;
}

/** Построить карту transmissibility для месторождения.
 *
 *  Опциональные `xFault` и `yFault` — маски блокированных граней
 *  (для разломов). Если не заданы, разломов нет.
 */
export function buildTransmissibilityMap(
  reservoir: Reservoir,
  xFault?: Uint8Array,
  yFault?: Uint8Array,
): TransmissibilityMap {
  const grid = reservoir.grid;
  const txG = new Float64Array(grid.nXfaces);
  const tyG = new Float64Array(grid.nYfaces);
  const xOpen = new Uint8Array(grid.nXfaces);
  const yOpen = new Uint8Array(grid.nYfaces);
  const xF = xFault ?? new Uint8Array(grid.nXfaces);
  const yF = yFault ?? new Uint8Array(grid.nYfaces);

  // X-грани: между (i, j) и (i+1, j). Площадь A = h_face * dy.
  for (let j = 0; j < grid.ny; j++) {
    for (let i = 0; i < grid.nx - 1; i++) {
      const idxA = grid.cellIndex(i, j);
      const idxB = grid.cellIndex(i + 1, j);
      // T=0 если любая из ячеек неактивна — для no-flow на контуре.
      if (!reservoir.active[idxA] || !reservoir.active[idxB]) continue;
      const kA = reservoir.permX[idxA] ?? 0;
      const kB = reservoir.permX[idxB] ?? 0;
      const hFace = reservoir.faceThickness(idxA, idxB);
      const A = grid.xFaceArea(hFace);
      const d = grid.dx;
      const t = geometricTransmissibility(kA, kB, A, d);
      const fid = grid.xFaceIndex(i, j);
      txG[fid] = t;
      xOpen[fid] = t > 0 ? 1 : 0;
    }
  }

  // Y-грани: между (i, j) и (i, j+1). Площадь A = h_face * dx.
  for (let j = 0; j < grid.ny - 1; j++) {
    for (let i = 0; i < grid.nx; i++) {
      const idxA = grid.cellIndex(i, j);
      const idxB = grid.cellIndex(i, j + 1);
      if (!reservoir.active[idxA] || !reservoir.active[idxB]) continue;
      const kA = reservoir.permY[idxA] ?? 0;
      const kB = reservoir.permY[idxB] ?? 0;
      const hFace = reservoir.faceThickness(idxA, idxB);
      const A = grid.yFaceArea(hFace);
      const d = grid.dy;
      const t = geometricTransmissibility(kA, kB, A, d);
      const fid = grid.yFaceIndex(i, j);
      tyG[fid] = t;
      yOpen[fid] = t > 0 ? 1 : 0;
    }
  }

  // Применяем разломы: блокируем соответствующие грани.
  for (let f = 0; f < grid.nXfaces; f++) {
    if (xF[f]) {
      txG[f] = 0;
      xOpen[f] = 0;
    }
  }
  for (let f = 0; f < grid.nYfaces; f++) {
    if (yF[f]) {
      tyG[f] = 0;
      yOpen[f] = 0;
    }
  }

  return { txG, tyG, xOpen, yOpen, xFault: xF, yFault: yF };
}

/** Сумма transmissibility, выходящих из ячейки idx (геометрических). */
export function sumTransmissibilityFromCell(
  map: TransmissibilityMap,
  grid: Grid2D,
  idx: number,
): { tx: number; ty: number } {
  const i = idx % grid.nx;
  const j = Math.floor(idx / grid.nx);
  let tx = 0;
  let ty = 0;
  // X-грань вправо от (i, j)
  if (i < grid.nx - 1) {
    const fid = grid.xFaceIndex(i, j);
    tx += (map.txG[fid] ?? 0) * (map.xOpen[fid] ?? 0);
  }
  // X-грань влево от (i, j) — это (i-1, j)
  if (i > 0) {
    const fid = grid.xFaceIndex(i - 1, j);
    tx += (map.txG[fid] ?? 0) * (map.xOpen[fid] ?? 0);
  }
  // Y-грань вниз от (i, j)
  if (j < grid.ny - 1) {
    const fid = grid.yFaceIndex(i, j);
    ty += (map.tyG[fid] ?? 0) * (map.yOpen[fid] ?? 0);
  }
  // Y-грань вверх от (i, j) — это (i, j-1)
  if (j > 0) {
    const fid = grid.yFaceIndex(i, j - 1);
    ty += (map.tyG[fid] ?? 0) * (map.yOpen[fid] ?? 0);
  }
  return { tx, ty };
}
