// Тесты для RateSolver — линейная система взаимного влияния.

import { describe, it, expect } from 'vitest';
import {
  solveRates,
  resolveWells,
  type RateSolverConfig,
} from '../../src/core/wells/RateSolver.ts';
import { Grid2D } from '../../src/core/grid/Grid2D.ts';
import { Reservoir } from '../../src/core/grid/Reservoir.ts';
import { circleContour } from '../../src/core/grid/Contour.ts';
import type { Well } from '../../src/core/wells/Well.ts';

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

function mkWell(
  id: string,
  i: number,
  j: number,
  type: 'producer' | 'injector',
  bhp: number,
  rateLimit = 0,
): Well {
  return {
    type,
    id,
    i,
    j,
    bhpAtm: bhp,
    rw: 0.1,
    skin: 0,
    rateLimit: rateLimit > 0 ? rateLimit : undefined,
  };
}

const baseConfig: RateSolverConfig = {
  muB: 0.5,
  radiusMode: 'dynamic',
  effectiveK: 'mean-in-radius',
};

describe('RateSolver', () => {
  it('пустой список: возвращает пустые rates', () => {
    const r = makeReservoir();
    const res = solveRates([], r, 245, baseConfig);
    expect(res.rates.size).toBe(0);
    expect(res.resolved.size).toBe(0);
  });

  it('одна producer скважина: q > 0 при BHP < P_avg', () => {
    const r = makeReservoir();
    const wells: Well[] = [mkWell('P1', 10, 10, 'producer', 100)];
    const res = solveRates(wells, r, 245, baseConfig);
    const q = res.rates.get('P1') ?? 0;
    expect(q).toBeGreaterThan(0);
  });

  it('один injector: q < 0 при BHP > P_avg', () => {
    const r = makeReservoir();
    const wells: Well[] = [mkWell('I1', 10, 10, 'injector', 290)];
    const res = solveRates(wells, r, 245, baseConfig);
    const q = res.rates.get('I1') ?? 0;
    expect(q).toBeLessThan(0);
  });

  it('P_bhp = P_avg: q ≈ 0', () => {
    const r = makeReservoir();
    const wells: Well[] = [mkWell('P1', 10, 10, 'producer', 245)];
    const res = solveRates(wells, r, 245, baseConfig);
    const q = res.rates.get('P1') ?? 0;
    expect(Math.abs(q)).toBeLessThan(1e-6);
  });

  it('5-spot симметрия: 4 producer равны (по симметрии геометрии)', () => {
    const r = makeReservoir();
    const cx = 10;
    const cy = 10;
    const off = 4;
    const wells: Well[] = [
      mkWell('I1', cx, cy, 'injector', 290),
      mkWell('P1', cx - off, cy - off, 'producer', 100),
      mkWell('P2', cx + off, cy - off, 'producer', 100),
      mkWell('P3', cx - off, cy + off, 'producer', 100),
      mkWell('P4', cx + off, cy + off, 'producer', 100),
    ];
    const res = solveRates(wells, r, 245, baseConfig);
    const qP1 = res.rates.get('P1') ?? 0;
    const qP2 = res.rates.get('P2') ?? 0;
    const qP3 = res.rates.get('P3') ?? 0;
    const qP4 = res.rates.get('P4') ?? 0;
    const qI1 = res.rates.get('I1') ?? 0;
    // Все 4 producer должны быть равны (геометрия симметрична).
    expect(qP1).toBeCloseTo(qP2, 4);
    expect(qP2).toBeCloseTo(qP3, 4);
    expect(qP3).toBeCloseTo(qP4, 4);
    // producer: positive rate. injector: negative rate.
    expect(qP1).toBeGreaterThan(0);
    expect(qI1).toBeLessThan(0);
    // Замечание: сумма rates НЕ обязана быть 0 — это не steady state.
    // P_avg в модели дрейфует, чтобы погасить дисбаланс.
  });

  it('rate limit: q обрезается при превышении', () => {
    const r = makeReservoir();
    const wells: Well[] = [mkWell('P1', 10, 10, 'producer', 100, 50)];
    const res = solveRates(wells, r, 245, baseConfig);
    const q = res.rates.get('P1') ?? 0;
    expect(q).toBeLessThanOrEqual(50);
    expect(q).toBeGreaterThan(0);
  });

  it('rate limit: injector ограничивается по модулю', () => {
    const r = makeReservoir();
    const wells: Well[] = [mkWell('I1', 10, 10, 'injector', 290, 100)];
    const res = solveRates(wells, r, 245, baseConfig);
    const q = res.rates.get('I1') ?? 0;
    expect(Math.abs(q)).toBeLessThanOrEqual(100);
    expect(q).toBeLessThan(0);
  });

  it('resolveWells: возвращает R_e, k_eff, h_eff', () => {
    const r = makeReservoir();
    const wells: Well[] = [
      mkWell('P1', 10, 10, 'producer', 100),
      mkWell('I1', 15, 10, 'injector', 290),
    ];
    const resolved = resolveWells(wells, r, baseConfig);
    expect(resolved.size).toBe(2);
    const p1 = resolved.get('P1');
    const i1 = resolved.get('I1');
    expect(p1).toBeDefined();
    expect(i1).toBeDefined();
    expect(p1!.radiusM).toBeGreaterThan(0);
    expect(p1!.kEffMD).toBeGreaterThan(0);
    expect(p1!.hEffM).toBeGreaterThan(0);
    // R_e ограничен половиной расстояния до соседа.
    const d = Math.hypot((10 - 15) * 20, 0);
    const halfD = 0.5 * d;
    expect(p1!.radiusM).toBeLessThanOrEqual(halfD + 1e-6);
  });

  it('2 скважины на расстоянии > R_e друг друга: каждая решает свою ОСВ', () => {
    const r = makeReservoir();
    // Две скважины далеко друг от друга, rateMode=fixed маленький R_e.
    // (2, 10) и (18, 10) — на одной горизонтали, расстояние 16·20 = 320 м.
    // Активная зона — круг радиуса 0.45·21·20 = 189 вокруг центра (210, 210).
    // (2.5·20, 10.5·20) = (50, 210) — расстояние от центра 160 м, в круге.
    // (18.5·20, 10.5·20) = (370, 210) — расстояние 160 м, в круге.
    const wells: Well[] = [
      mkWell('P1', 2, 10, 'producer', 100),
      mkWell('I1', 18, 10, 'injector', 290),
    ];
    const cfg: RateSolverConfig = {
      ...baseConfig,
      radiusMode: 'fixed',
      fixedRadiusM: 30, // 1.5 ячейки; расстояние между скважинами 320 м >> 30
    };
    const res = solveRates(wells, r, 245, cfg);
    const qP = res.rates.get('P1') ?? 0;
    const qI = res.rates.get('I1') ?? 0;
    expect(qP).toBeGreaterThan(0);
    expect(qI).toBeLessThan(0);
    expect(Math.abs(qP)).toBeGreaterThan(0);
    expect(Math.abs(qI)).toBeGreaterThan(0);
  });

  it('P_avg изменение: повышение P_avg увеличивает добычу (при том же BHP)', () => {
    const r = makeReservoir();
    // rate limit выше типичного расчётного q, чтобы не упираться в cap.
    const wells: Well[] = [mkWell('P1', 10, 10, 'producer', 100, 1_000_000)];
    const q1 = solveRates(wells, r, 245, baseConfig).rates.get('P1') ?? 0;
    const q2 = solveRates(wells, r, 250, baseConfig).rates.get('P1') ?? 0;
    // P_avg растёт → ΔP = P_avg - P_bhp растёт → q растёт.
    expect(q2).toBeGreaterThan(q1);
  });
});
