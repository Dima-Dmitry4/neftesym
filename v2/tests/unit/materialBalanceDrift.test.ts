// Тесты для MaterialBalanceDrift — дрейф среднего давления.

import { describe, it, expect } from 'vitest';
import {
  pressureDriftStep,
  totalPoreVolume,
  accumulateVolumes,
  type MaterialBalanceConfig,
} from '../../src/core/pressure/MaterialBalanceDrift.ts';
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

const cfg: MaterialBalanceConfig = {
  muB: 0.5,
  totalCompressibilityAtmInv: 1e-4,
  volumeFactor: 1.2,
};

describe('MaterialBalanceDrift', () => {
  it('нулевая добыча: ΔP = 0', () => {
    const r = makeReservoir();
    const vp = totalPoreVolume(r);
    const dP = pressureDriftStep(0, 0, 24, cfg, vp);
    // toBeCloseTo вместо toBe — иначе -0 vs 0 даёт Object.is-fail.
    expect(dP).toBeCloseTo(0, 10);
  });

  it('добыча без закачки: ΔP < 0 (P_avg падает)', () => {
    const r = makeReservoir();
    const vp = totalPoreVolume(r);
    const dP = pressureDriftStep(100, 0, 24, cfg, vp);
    expect(dP).toBeLessThan(0);
  });

  it('закачка без добычи: ΔP > 0 (P_avg растёт)', () => {
    const r = makeReservoir();
    const vp = totalPoreVolume(r);
    const dP = pressureDriftStep(0, 100, 24, cfg, vp);
    expect(dP).toBeGreaterThan(0);
  });

  it('добыча = закачка (VRR=1): ΔP ≈ 0', () => {
    const r = makeReservoir();
    const vp = totalPoreVolume(r);
    const dP = pressureDriftStep(100, 100, 24, cfg, vp);
    expect(Math.abs(dP)).toBeLessThan(1e-10);
  });

  it('дрейф пропорционален dt', () => {
    const r = makeReservoir();
    const vp = totalPoreVolume(r);
    const dP1 = pressureDriftStep(100, 0, 24, cfg, vp);
    const dP2 = pressureDriftStep(100, 0, 48, cfg, vp);
    expect(dP2).toBeCloseTo(2 * dP1, 10);
  });

  it('дрейф пропорционален (N_p - N_inj)', () => {
    const r = makeReservoir();
    const vp = totalPoreVolume(r);
    const dP1 = pressureDriftStep(100, 0, 24, cfg, vp);
    const dP2 = pressureDriftStep(200, 0, 24, cfg, vp);
    expect(dP2).toBeCloseTo(2 * dP1, 10);
  });

  it('дрейф обратно пропорционален V_pore', () => {
    const r = makeReservoir();
    const vp1 = totalPoreVolume(r);
    const dP1 = pressureDriftStep(100, 0, 24, cfg, vp1);
    const dP2 = pressureDriftStep(100, 0, 24, cfg, 2 * vp1);
    expect(dP2).toBeCloseTo(dP1 / 2, 10);
  });

  it('дрейф обратно пропорционален c_t', () => {
    const r = makeReservoir();
    const vp = totalPoreVolume(r);
    const dP1 = pressureDriftStep(100, 0, 24, cfg, vp);
    const dP2 = pressureDriftStep(100, 0, 24, { ...cfg, totalCompressibilityAtmInv: 2e-4 }, vp);
    expect(dP2).toBeCloseTo(dP1 / 2, 10);
  });

  it('V_pore = 0 → ΔP = 0 (защита от деления на ноль)', () => {
    const dP = pressureDriftStep(100, 0, 24, cfg, 0);
    expect(dP).toBe(0);
  });

  it('c_t = 0 → ΔP = 0 (защита)', () => {
    const r = makeReservoir();
    const vp = totalPoreVolume(r);
    const dP = pressureDriftStep(100, 0, 24, { ...cfg, totalCompressibilityAtmInv: 0 }, vp);
    expect(dP).toBe(0);
  });

  it('totalPoreVolume: только активные ячейки', () => {
    const r = makeReservoir();
    const vp = totalPoreVolume(r);
    // V_pore = Σ_active(φ · h · dx · dy) = φ · h · dx · dy · nActive
    // φ=0.2, h=15, dx=dy=20, area=400. per cell: 0.2·15·400 = 1200 м³.
    // activeCount < nCells (есть круглый контур).
    const expected = 0.2 * 15 * 20 * 20 * r.activeCount();
    expect(vp).toBeCloseTo(expected, 6);
  });

  it('accumulateVolumes: накапливает с учётом dt', () => {
    const before = { cumProductionM3: 100, cumInjectionM3: 50 };
    const after = accumulateVolumes(before, 100, 50, 24);
    // dt=24 ч = 1 сут. +100 м³ production, +50 м³ injection.
    expect(after.cumProductionM3).toBeCloseTo(200, 6);
    expect(after.cumInjectionM3).toBeCloseTo(100, 6);
  });

  it('accumulateVolumes: dt=12 ч даёт половинный прирост', () => {
    const before = { cumProductionM3: 0, cumInjectionM3: 0 };
    const after = accumulateVolumes(before, 100, 50, 12);
    expect(after.cumProductionM3).toBeCloseTo(50, 6);
    expect(after.cumInjectionM3).toBeCloseTo(25, 6);
  });
});
