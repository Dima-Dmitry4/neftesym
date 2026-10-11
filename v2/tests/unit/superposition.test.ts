// Тесты для Superposition — аналитическое поле давления.

import { describe, it, expect } from 'vitest';
import {
  computeCellPressures,
  distanceBetweenWells,
  distanceToBoundary,
  type SuperpositionWellState,
} from '../../src/core/pressure/Superposition.ts';
import { Grid2D } from '../../src/core/grid/Grid2D.ts';
import { Reservoir } from '../../src/core/grid/Reservoir.ts';
import { circleContour } from '../../src/core/grid/Contour.ts';

function makeReservoir(nx = 21, ny = 21, dx = 20, dy = 20): Reservoir {
  const grid = new Grid2D({ nx, ny, dx, dy, depthTop: 2800 });
  const n = grid.nCells;
  const thickness = new Float64Array(n).fill(15);
  const porosity = new Float64Array(n).fill(0.2);
  const perm = new Float64Array(n).fill(100);
  const initialP = new Float64Array(n).fill(245);
  const initialSw = new Float64Array(n).fill(0.25);
  const cx = (nx / 2) * dx;
  const cy = (ny / 2) * dy;
  const active = circleContour(grid, cx, cy, Math.min(nx, ny) * dx * 0.45);
  return new Reservoir(grid, {
    thickness,
    porosity,
    permX: perm,
    permY: new Float64Array(perm),
    permZ: new Float64Array(perm).map((v) => v * 0.1),
    initialP,
    initialSw,
    active,
    depthCenter: new Float64Array(n).fill(2807.5),
  });
}

describe('Superposition', () => {
  it('без скважин: P = P_avg везде', () => {
    const r = makeReservoir();
    const pAvg = 245;
    const { pressure } = computeCellPressures({
      reservoir: r,
      wells: [],
      pAvgAtm: pAvg,
    });
    for (let i = 0; i < r.grid.nCells; i++) {
      expect(pressure[i]).toBe(pAvg);
    }
  });

  it('одна скважина producer: P в собственной ячейке < P_avg', () => {
    const r = makeReservoir();
    const cx = 10;
    const cy = 10;
    const wells: SuperpositionWellState[] = [
      {
        wellId: 'P1',
        i: cx,
        j: cy,
        radiusM: 150,
        kEffMD: 100,
        hEffM: 15,
        muB: 0.5, // μ_w · B_w
        rwM: 0.1,
        rateM3PerDay: 100, // production
      },
    ];
    const pAvg = 245;
    const { pressure } = computeCellPressures({
      reservoir: r,
      wells,
      pAvgAtm: pAvg,
    });
    const idx = r.grid.cellIndex(cx, cy);
    expect(pressure[idx]).toBeLessThan(pAvg);
    // ΔP = (q · μB) / (2π · k · h) · ln(r / R_e)
    // При r = max(rw, 10) = 10, R_e = 150:
    // ln(10/150) = ln(0.0667) = -2.708
    // ΔP = 100 · 0.5 / (2π · 100 · 15) · (-2.708) ≈ -0.0144 атм
    expect(pressure[idx]).toBeGreaterThan(pAvg - 1.0);
    // Далёкие ячейки за R_e — без изменений.
    const farIdx = r.grid.cellIndex(0, 0);
    expect(pressure[farIdx]).toBe(pAvg);
  });

  it('одна скважина injector: P в собственной ячейке > P_avg', () => {
    const r = makeReservoir();
    const cx = 10;
    const cy = 10;
    const wells: SuperpositionWellState[] = [
      {
        wellId: 'I1',
        i: cx,
        j: cy,
        radiusM: 150,
        kEffMD: 100,
        hEffM: 15,
        muB: 0.5,
        rwM: 0.1,
        rateM3PerDay: -100, // injection
      },
    ];
    const pAvg = 245;
    const { pressure } = computeCellPressures({
      reservoir: r,
      wells,
      pAvgAtm: pAvg,
    });
    const idx = r.grid.cellIndex(cx, cy);
    expect(pressure[idx]).toBeGreaterThan(pAvg);
  });

  it('суперпозиция: 2 producer + 1 injector ⇒ min P у producer, max у injector', () => {
    const r = makeReservoir();
    const wells: SuperpositionWellState[] = [
      {
        wellId: 'P1',
        i: 5,
        j: 10,
        radiusM: 100,
        kEffMD: 100,
        hEffM: 15,
        muB: 0.5,
        rwM: 0.1,
        rateM3PerDay: 200,
      },
      {
        wellId: 'P2',
        i: 15,
        j: 10,
        radiusM: 100,
        kEffMD: 100,
        hEffM: 15,
        muB: 0.5,
        rwM: 0.1,
        rateM3PerDay: 200,
      },
      {
        wellId: 'I1',
        i: 10,
        j: 10,
        radiusM: 100,
        kEffMD: 100,
        hEffM: 15,
        muB: 0.5,
        rwM: 0.1,
        rateM3PerDay: -300,
      },
    ];
    const pAvg = 245;
    const { pressure } = computeCellPressures({
      reservoir: r,
      wells,
      pAvgAtm: pAvg,
    });
    const pP1 = pressure[r.grid.cellIndex(5, 10)] ?? pAvg;
    const pP2 = pressure[r.grid.cellIndex(15, 10)] ?? pAvg;
    const pI1 = pressure[r.grid.cellIndex(10, 10)] ?? pAvg;
    expect(pP1).toBeLessThan(pAvg);
    expect(pP2).toBeLessThan(pAvg);
    expect(pI1).toBeGreaterThan(pAvg);
  });

  it('distanceBetweenWells: симметрия и правильность', () => {
    const d = distanceBetweenWells({ i: 0, j: 0 }, { i: 3, j: 4 }, 10, 10);
    // 3·dx = 30, 4·dy = 40, distance = 50
    expect(d).toBeCloseTo(50, 6);
    const dBack = distanceBetweenWells({ i: 3, j: 4 }, { i: 0, j: 0 }, 10, 10);
    expect(dBack).toBe(d);
  });

  it('distanceToBoundary: min из 4 направлений', () => {
    // Скважина в (2, 10) на сетке 21x21 с dx=dy=10.
    // Левый край: 25 м, верхний: 105 м, нижний: 95 м, правый: 175 м. Min = 25.
    const d = distanceToBoundary({ i: 2, j: 10 }, 21, 21, 10, 10);
    expect(d).toBeCloseTo(25, 6);
  });

  it('за пределами R_e влияния нет', () => {
    const r = makeReservoir(11, 11, 10, 10);
    const wells: SuperpositionWellState[] = [
      {
        wellId: 'P1',
        i: 5,
        j: 5,
        radiusM: 30, // 3 ячейки
        kEffMD: 100,
        hEffM: 15,
        muB: 0.5,
        rwM: 0.1,
        rateM3PerDay: 200,
      },
    ];
    const pAvg = 245;
    const { pressure } = computeCellPressures({
      reservoir: r,
      wells,
      pAvgAtm: pAvg,
    });
    // Внутри R_e: P != P_avg
    expect(pressure[r.grid.cellIndex(5, 5)]).not.toBe(pAvg);
    expect(pressure[r.grid.cellIndex(5, 4)]).not.toBe(pAvg);
    // За R_e (расстояние > 30 м): P = P_avg
    const farIdx = r.grid.cellIndex(0, 0);
    const d = Math.hypot((0 + 0.5 - 5.5) * 10, (0 + 0.5 - 5.5) * 10);
    if (d > 30) {
      expect(pressure[farIdx]).toBe(pAvg);
    }
  });

  it('иммутабельность: входной массив wells не модифицируется', () => {
    const r = makeReservoir();
    const wells: SuperpositionWellState[] = [
      {
        wellId: 'P1',
        i: 5,
        j: 5,
        radiusM: 100,
        kEffMD: 100,
        hEffM: 15,
        muB: 0.5,
        rwM: 0.1,
        rateM3PerDay: 100,
      },
    ];
    const originalRate = wells[0]?.rateM3PerDay;
    computeCellPressures({ reservoir: r, wells, pAvgAtm: 245 });
    expect(wells[0]?.rateM3PerDay).toBe(originalRate);
  });
});
