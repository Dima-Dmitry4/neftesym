// Утилиты для генерации масок контура месторождения.
//
// Возвращают Uint8Array длины nCells, где 1 = ячейка входит
// в активный контур, 0 = нет. В неактивных ячейках transmissibility
// обнуляется и они «выпадают» из уравнений.

import type { Grid2D } from './Grid2D.ts';

/** Круглый контур: расстояние от центра меньше `r`. */
export function circleContour(
  grid: Grid2D,
  cx: number,
  cy: number,
  r: number,
): Uint8Array {
  const n = grid.nCells;
  const out = new Uint8Array(n);
  for (let idx = 0; idx < n; idx++) {
    const i = idx % grid.nx;
    const j = Math.floor(idx / grid.nx);
    const x = (i + 0.5) * grid.dx;
    const y = (j + 0.5) * grid.dy;
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy <= r * r) out[idx] = 1;
  }
  return out;
}

/** Эллиптический контур, опционально повёрнутый на угол `angle` рад. */
export function ellipseContour(
  grid: Grid2D,
  cx: number,
  cy: number,
  a: number,
  b: number,
  angle = 0,
): Uint8Array {
  const n = grid.nCells;
  const out = new Uint8Array(n);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let idx = 0; idx < n; idx++) {
    const i = idx % grid.nx;
    const j = Math.floor(idx / grid.nx);
    const x = (i + 0.5) * grid.dx;
    const y = (j + 0.5) * grid.dy;
    const dx = x - cx;
    const dy = y - cy;
    // Поворот обратно в систему координат эллипса.
    const xr = dx * cos + dy * sin;
    const yr = -dx * sin + dy * cos;
    const v = (xr * xr) / (a * a) + (yr * yr) / (b * b);
    if (v <= 1) out[idx] = 1;
  }
  return out;
}

/** Прямоугольный контур. */
export function rectContour(
  grid: Grid2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Uint8Array {
  const n = grid.nCells;
  const out = new Uint8Array(n);
  for (let idx = 0; idx < n; idx++) {
    const i = idx % grid.nx;
    const j = Math.floor(idx / grid.nx);
    const x = (i + 0.5) * grid.dx;
    const y = (j + 0.5) * grid.dy;
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) out[idx] = 1;
  }
  return out;
}

/** Канал (полоса) с возможной синусоидой. Полезно для сценария «channel».
 *
 *  Задаёт маску ячеек, попадающих в полосу шириной `width` вокруг
 *  ломаной, соединяющей `points` (в метрах). `width` в м.
 */
export function channelMask(
  grid: Grid2D,
  points: ReadonlyArray<{ x: number; y: number }>,
  width: number,
): Uint8Array {
  const n = grid.nCells;
  const out = new Uint8Array(n);
  const half = width * 0.5;
  for (let idx = 0; idx < n; idx++) {
    const i = idx % grid.nx;
    const j = Math.floor(idx / grid.nx);
    const x = (i + 0.5) * grid.dx;
    const y = (j + 0.5) * grid.dy;
    let minDist = Infinity;
    for (let s = 0; s < points.length - 1; s++) {
      const p0 = points[s];
      const p1 = points[s + 1];
      if (!p0 || !p1) continue;
      const vx = p1.x - p0.x;
      const vy = p1.y - p0.y;
      const len2 = vx * vx + vy * vy;
      if (len2 <= 0) continue;
      let t = ((x - p0.x) * vx + (y - p0.y) * vy) / len2;
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      const px = p0.x + t * vx;
      const py = p0.y + t * vy;
      const ddx = x - px;
      const ddy = y - py;
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      if (d < minDist) minDist = d;
    }
    if (minDist <= half) out[idx] = 1;
  }
  return out;
}

/** Линейный барьер (разлом). Возвращает Uint8Array масок
 *  для xFaces и yFaces: 1 = грань «закрыта» (T = 0).
 *
 *  Разлом — отрезок от `x1,y1` до `x2,y2` в метрах. Все грани,
 *  центр которых ближе `tol` метров к отрезку, блокируются.
 */
export function faultBarrier(
  grid: Grid2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  tol: number,
): { xFaces: Uint8Array; yFaces: Uint8Array } {
  const xFaces = new Uint8Array(grid.nXfaces);
  const yFaces = new Uint8Array(grid.nYfaces);
  const vx = x2 - x1;
  const vy = y2 - y1;
  const len2 = vx * vx + vy * vy;
  if (len2 <= 0) return { xFaces, yFaces };
  const len = Math.sqrt(len2);
  // X-грани: между (i,j) и (i+1,j), центр (i+0.5)*dx, (j+0.5)*dy.
  for (let j = 0; j < grid.ny; j++) {
    for (let i = 0; i < grid.nx - 1; i++) {
      const xc = (i + 0.5) * grid.dx;
      const yc = (j + 0.5) * grid.dy;
      const d = pointToSegmentDist(xc, yc, x1, y1, x2, y2, vx, vy, len2);
      if (d <= tol) xFaces[grid.xFaceIndex(i, j)] = 1;
    }
  }
  for (let j = 0; j < grid.ny - 1; j++) {
    for (let i = 0; i < grid.nx; i++) {
      const xc = (i + 0.5) * grid.dx;
      const yc = (j + 0.5) * grid.dy;
      const d = pointToSegmentDist(xc, yc, x1, y1, x2, y2, vx, vy, len2);
      if (d <= tol) yFaces[grid.yFaceIndex(i, j)] = 1;
    }
  }
  // Нужно явно «подавить» неиспользуемый binding, чтобы линтер
  // не ругался. len используется при вычислении метрики.
  void len;
  return { xFaces, yFaces };
}

function pointToSegmentDist(
  px: number,
  py: number,
  x1: number,
  y1: number,
  _x2: number,
  _y2: number,
  vx: number,
  vy: number,
  len2: number,
): number {
  let t = ((px - x1) * vx + (py - y1) * vy) / len2;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  const cx = x1 + t * vx;
  const cy = y1 + t * vy;
  const dx = px - cx;
  const dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy);
}
