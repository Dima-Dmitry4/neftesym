// Базовый sanity-тест на конверсии из core/units.ts.
// Должен проходить на Phase 0, чтобы мы знали, что vitest
// подключён и работает.

import { describe, it, expect } from 'vitest';
import {
  C_DARCY,
  BARREL_PER_M3,
  HOURS_PER_DAY,
  resOilRateToTons,
  reservoirM3ToSurfaceM3,
  surfaceM3ToReservoirM3,
  surfaceM3ToTons,
  tonsToSurfaceM3,
} from '../../src/core/units.ts';

describe('units constants', () => {
  it('C_DARCY = 0.0543 для полевых метрических', () => {
    expect(C_DARCY).toBe(0.0543);
  });
  it('BARREL_PER_M3 ≈ 6.29', () => {
    expect(BARREL_PER_M3).toBeGreaterThan(6.28);
    expect(BARREL_PER_M3).toBeLessThan(6.30);
  });
  it('HOURS_PER_DAY = 24', () => {
    expect(HOURS_PER_DAY).toBe(24);
  });
});

describe('oil mass conversions', () => {
  it('reservoir → surface → tons', () => {
    const resM3 = 100; // м³/сут в пласте
    const b = 1.25;
    const rhoSurf = 850; // кг/м³
    const surfM3 = reservoirM3ToSurfaceM3(resM3, b);
    const tons = surfaceM3ToTons(surfM3, rhoSurf);
    // 100 / 1.25 = 80 м³ на поверхности
    // 80 * 850 / 1000 = 68 т/сут
    expect(surfM3).toBeCloseTo(80, 6);
    expect(tons).toBeCloseTo(68, 6);
  });
  it('tons → surface → reservoir (roundtrip)', () => {
    const tons = 68;
    const rhoSurf = 850;
    const b = 1.25;
    const surfM3 = tonsToSurfaceM3(tons, rhoSurf);
    const resM3 = surfaceM3ToReservoirM3(surfM3, b);
    expect(resM3).toBeCloseTo(100, 6);
  });
  it('resOilRateToTons shortcut', () => {
    const tons = resOilRateToTons(100, 1.25, 850);
    expect(tons).toBeCloseTo(68, 6);
  });
});
