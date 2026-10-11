// Тесты CFL timestep.

import { describe, it, expect } from 'vitest';
import { cflTimestep, HARD_MIN_HOURS } from '../../src/core/physics/timestep/CFL.ts';
import { generateDefaultField } from '../../src/data/defaultField.ts';
import { Grid2D } from '../../src/core/grid/Grid2D.ts';
import { Reservoir } from '../../src/core/grid/Reservoir.ts';

function makeFluxWith(fxMax: number, fyMax: number = 0) {
  const grid = new Grid2D({ nx: 10, ny: 10, dx: 20, dy: 20, depthTop: 2800 });
  return {
    fx: new Float64Array(grid.nXfaces).fill(fxMax),
    fy: new Float64Array(grid.nYfaces).fill(fyMax),
    fxw: new Float64Array(grid.nXfaces),
    fyw: new Float64Array(grid.nYfaces),
    fxo: new Float64Array(grid.nXfaces),
    fyo: new Float64Array(grid.nYfaces),
  };
}

describe('cflTimestep', () => {
  it('при F=0 возвращает dtMaxHours', () => {
    const r = generateDefaultField({ grid: { nx: 10, ny: 10, dx: 20, dy: 20, depthTop: 2800 } });
    const flux = makeFluxWith(0);
    const dt = cflTimestep({
      reservoir: r,
      flux,
      cflTarget: 1,
      dtMaxHours: 720,
      dtMinHours: 1,
    });
    expect(dt).toBe(720);
  });
  it('dt уменьшается с ростом F_t', () => {
    const r = generateDefaultField({ grid: { nx: 10, ny: 10, dx: 20, dy: 20, depthTop: 2800 } });
    const flux1 = makeFluxWith(10);
    const flux2 = makeFluxWith(100);
    const dt1 = cflTimestep({ reservoir: r, flux: flux1, cflTarget: 1, dtMaxHours: 720, dtMinHours: 1 });
    const dt2 = cflTimestep({ reservoir: r, flux: flux2, cflTarget: 1, dtMaxHours: 720, dtMinHours: 1 });
    expect(dt2).toBeLessThan(dt1);
  });
  it('dt ≤ dtMaxHours', () => {
    const r = generateDefaultField({ grid: { nx: 10, ny: 10, dx: 20, dy: 20, depthTop: 2800 } });
    const flux = makeFluxWith(0.0001);
    const dt = cflTimestep({ reservoir: r, flux, cflTarget: 1, dtMaxHours: 720, dtMinHours: 1 });
    expect(dt).toBeLessThanOrEqual(720);
  });
  it('dt НЕ поднимается до dtMinHours (иначе ломается сходимость по dt)', () => {
    const r = generateDefaultField({ grid: { nx: 10, ny: 10, dx: 20, dy: 20, depthTop: 2800 } });
    const flux = makeFluxWith(1e9); // очень большой поток
    const dt = cflTimestep({ reservoir: r, flux, cflTarget: 1, dtMaxHours: 720, dtMinHours: 1 });
    // Раньше здесь стояло `dt = max(dt, dtMinHours)`, и при таком потоке
    // CFL-ограничение просто сбрасывалось — результат переставал зависеть
    // от шага корректным образом. Теперь возвращается честное значение,
    // ограниченное снизу только HARD_MIN_HOURS.
    expect(dt).toBeGreaterThan(0);
    expect(dt).toBeLessThan(1);
    expect(dt).toBeGreaterThanOrEqual(HARD_MIN_HOURS);
  });
  it('wellLiqByCell ограничивает dt при больших дебитах', () => {
    const r = generateDefaultField({ grid: { nx: 10, ny: 10, dx: 20, dy: 20, depthTop: 2800 } });
    const flux = makeFluxWith(10); // маленький inter-cell flux
    // qLiq = 1000 м³/сут в одной ячейке → dt = V_p / 1000 = маленький
    const wellLiq = new Float64Array(r.grid.nCells);
    wellLiq[55] = 1000; // центр
    const dtNoWells = cflTimestep({
      reservoir: r,
      flux,
      cflTarget: 1,
      dtMaxHours: 720,
      dtMinHours: 1,
    });
    const dtWithWells = cflTimestep({
      reservoir: r,
      flux,
      cflTarget: 1,
      dtMaxHours: 720,
      dtMinHours: 1,
      wellLiqByCell: wellLiq,
    });
    // с wells dt должен быть меньше (либо равен, если уже ограничен)
    expect(dtWithWells).toBeLessThanOrEqual(dtNoWells);
  });
  it('wellLiqByCell = 0 не меняет поведение', () => {
    const r = generateDefaultField({ grid: { nx: 10, ny: 10, dx: 20, dy: 20, depthTop: 2800 } });
    const flux = makeFluxWith(10);
    const dtNoWells = cflTimestep({ reservoir: r, flux, cflTarget: 1, dtMaxHours: 720, dtMinHours: 1 });
    const dtZeroWells = cflTimestep({
      reservoir: r,
      flux,
      cflTarget: 1,
      dtMaxHours: 720,
      dtMinHours: 1,
      wellLiqByCell: new Float64Array(r.grid.nCells), // все нули
    });
    expect(dtZeroWells).toBeCloseTo(dtNoWells, 5);
  });
  it('пустое поле (active=0) → dt = dtMaxHours', () => {
    const grid = new Grid2D({ nx: 5, ny: 5, dx: 20, dy: 20, depthTop: 2800 });
    const n = grid.nCells;
    const empty = new Reservoir(grid, {
      thickness: new Float64Array(n).fill(10),
      porosity: new Float64Array(n).fill(0.2),
      permX: new Float64Array(n).fill(100),
      permY: new Float64Array(n).fill(100),
      permZ: new Float64Array(n).fill(10),
      initialP: new Float64Array(n).fill(245),
      initialSw: new Float64Array(n).fill(0.25),
      active: new Uint8Array(n),
      depthCenter: new Float64Array(n).fill(2800),
    });
    const flux = makeFluxWith(10);
    const dt = cflTimestep({ reservoir: empty, flux, cflTarget: 1, dtMaxHours: 720, dtMinHours: 1 });
    expect(dt).toBe(720);
  });
});
