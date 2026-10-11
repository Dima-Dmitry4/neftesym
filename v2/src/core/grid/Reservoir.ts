// Карты месторождения: толщина, пористость, проницаемости,
// начальные P и S_w, маска активности. Все 2D-поля — flat
// Float64Array (или Uint8Array для active) длины nx*ny.

import type { Grid2D } from './Grid2D.ts';

/** Месторождение: набор карт на регулярной сетке. Иммутабельный. */
export class Reservoir {
  readonly grid: Grid2D;
  /** Толщина пласта, м. Flat Float64Array длины nCells. */
  readonly thickness: Float64Array;
  /** Пористость, доли (0..1). */
  readonly porosity: Float64Array;
  /** Горизонтальная проницаемость по x, мД. */
  readonly permX: Float64Array;
  /** Горизонтальная проницаемость по y, мД. */
  readonly permY: Float64Array;
  /** Вертикальная проницаемость, мД. */
  readonly permZ: Float64Array;
  /** Начальное пластовое давление, атм. */
  readonly initialP: Float64Array;
  /** Начальная водонасыщенность, доли. */
  readonly initialSw: Float64Array;
  /** Маска активности (1 = ячейка в контуре, 0 = вне). Uint8Array. */
  readonly active: Uint8Array;
  /** Глубина центра ячейки, м (для гидростатики). */
  readonly depthCenter: Float64Array;

  constructor(
    grid: Grid2D,
    maps: {
      thickness: Float64Array;
      porosity: Float64Array;
      permX: Float64Array;
      permY: Float64Array;
      permZ: Float64Array;
      initialP: Float64Array;
      initialSw: Float64Array;
      active: Uint8Array;
      depthCenter: Float64Array;
    },
  ) {
    this.grid = grid;
    const n = grid.nCells;
    if (maps.thickness.length !== n) throw new Error('thickness length mismatch');
    if (maps.porosity.length !== n) throw new Error('porosity length mismatch');
    if (maps.permX.length !== n) throw new Error('permX length mismatch');
    if (maps.permY.length !== n) throw new Error('permY length mismatch');
    if (maps.permZ.length !== n) throw new Error('permZ length mismatch');
    if (maps.initialP.length !== n) throw new Error('initialP length mismatch');
    if (maps.initialSw.length !== n) throw new Error('initialSw length mismatch');
    if (maps.active.length !== n) throw new Error('active length mismatch');
    if (maps.depthCenter.length !== n) throw new Error('depthCenter length mismatch');
    this.thickness = maps.thickness;
    this.porosity = maps.porosity;
    this.permX = maps.permX;
    this.permY = maps.permY;
    this.permZ = maps.permZ;
    this.initialP = maps.initialP;
    this.initialSw = maps.initialSw;
    this.active = maps.active;
    this.depthCenter = maps.depthCenter;
  }

  /** Число активных ячеек. */
  activeCount(): number {
    let n = 0;
    for (let i = 0; i < this.active.length; i++) if (this.active[i]) n++;
    return n;
  }

  /** Поровый объём ячейки idx (м³) = φ · h · dx · dy. */
  poreVolume(idx: number): number {
    return (
      (this.porosity[idx] ?? 0) *
      (this.thickness[idx] ?? 0) *
      this.grid.dx *
      this.grid.dy
    );
  }

  /** Средняя проницаемость для грани (мД) — гармоническое среднее.
   *  Возвращает 0, если хотя бы одна из ячеек неактивна. */
  facePerm(permField: Float64Array, idxA: number, idxB: number): number {
    if (!this.active[idxA] || !this.active[idxB]) return 0;
    const a = permField[idxA] ?? 0;
    const b = permField[idxB] ?? 0;
    return harmonicMean(a, b);
  }

  /** Средняя толщина для грани — арифметическое среднее (м). */
  faceThickness(idxA: number, idxB: number): number {
    return ((this.thickness[idxA] ?? 0) + (this.thickness[idxB] ?? 0)) * 0.5;
  }
}

/** Гармоническое среднее для T_ij. */
export function harmonicMean(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0;
  return (2 * a * b) / (a + b);
}
