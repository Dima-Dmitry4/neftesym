// Регулярная декартова 2D-сетка.
//
// Координаты: i — по x (колонка), j — по y (строка).
// Линейный индекс: idx = i + j*nx. Векторизация row-major.
//
// Используется для всех 2D-карт (P, S_w, k, h, phi, active) и
// для обхода граней.

export interface Grid2DSpec {
  /** Число ячеек по x. */
  nx: number;
  /** Число ячеек по y. */
  ny: number;
  /** Шаг по x, м. */
  dx: number;
  /** Шаг по y, м. */
  dy: number;
  /** Глубина кровли пласта, м. */
  depthTop: number;
}

/** Класс-обёртка над сеткой. Неизменяемый — только read-only. */
export class Grid2D {
  readonly nx: number;
  readonly ny: number;
  readonly dx: number;
  readonly dy: number;
  readonly depthTop: number;
  /** Полное число ячеек. */
  readonly nCells: number;
  /** Число граней между ячейками по x. */
  readonly nXfaces: number;
  /** Число граней между ячейками по y. */
  readonly nYfaces: number;
  /** Полное число граней. */
  readonly nFaces: number;

  constructor(spec: Grid2DSpec) {
    this.nx = spec.nx;
    this.ny = spec.ny;
    this.dx = spec.dx;
    this.dy = spec.dy;
    this.depthTop = spec.depthTop;
    this.nCells = spec.nx * spec.ny;
    this.nXfaces = (spec.nx - 1) * spec.ny;
    this.nYfaces = spec.nx * (spec.ny - 1);
    this.nFaces = this.nXfaces + this.nYfaces;
  }

  /** Линейный индекс по (i, j). i ∈ [0, nx), j ∈ [0, ny). */
  cellIndex(i: number, j: number): number {
    return i + j * this.nx;
  }

  /** Извлечь (i, j) из линейного индекса. */
  indexToIJ(idx: number): { i: number; j: number } {
    const i = idx % this.nx;
    const j = Math.floor(idx / this.nx);
    return { i, j };
  }

  /** Проверка, что (i, j) внутри сетки. */
  isInside(i: number, j: number): boolean {
    return i >= 0 && i < this.nx && j >= 0 && j < this.ny;
  }

  /** Линейный индекс X-грани: между (i, j) и (i+1, j).
   *  i ∈ [0, nx-1), j ∈ [0, ny). */
  xFaceIndex(i: number, j: number): number {
    return i + j * (this.nx - 1);
  }

  /** Линейный индекс Y-грани: между (i, j) и (i, j+1).
   *  i ∈ [0, nx), j ∈ [0, ny-1). */
  yFaceIndex(i: number, j: number): number {
    return i + j * this.nx;
  }

  /** Координаты центра ячейки (i, j) в метрах от верхнего левого угла. */
  cellCenter(i: number, j: number): { x: number; y: number } {
    return { x: (i + 0.5) * this.dx, y: (j + 0.5) * this.dy };
  }

  /** Объём ячейки (м³). */
  cellVolume(h: number): number {
    return this.dx * this.dy * h;
  }

  /** Площадь X-грани (между (i, j) и (i+1, j)) — для TPFA. */
  xFaceArea(hFace: number): number {
    return hFace * this.dy;
  }

  /** Площадь Y-грани. */
  yFaceArea(hFace: number): number {
    return hFace * this.dx;
  }

  /** Все X-грани в виде массива пар индексов ячеек. */
  xFaceCells(): Int32Array {
    const out = new Int32Array(this.nXfaces * 2);
    let k = 0;
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx - 1; i++) {
        out[k++] = this.cellIndex(i, j);
        out[k++] = this.cellIndex(i + 1, j);
      }
    }
    return out;
  }

  /** Все Y-грани в виде массива пар индексов ячеек. */
  yFaceCells(): Int32Array {
    const out = new Int32Array(this.nYfaces * 2);
    let k = 0;
    for (let j = 0; j < this.ny - 1; j++) {
      for (let i = 0; i < this.nx; i++) {
        out[k++] = this.cellIndex(i, j);
        out[k++] = this.cellIndex(i, j + 1);
      }
    }
    return out;
  }
}
