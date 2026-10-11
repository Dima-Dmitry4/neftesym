// Тесты transmissibility и гармонического среднего.

import { describe, it, expect } from 'vitest';
import { transmissibility, harmonicMean, geometricTransmissibility } from '../../src/core/physics/Transmissibility.ts';

describe('harmonicMean', () => {
  it('HM(0, x) = 0', () => {
    expect(harmonicMean(0, 100)).toBe(0);
    expect(harmonicMean(100, 0)).toBe(0);
  });
  it('HM(a, a) = a', () => {
    expect(harmonicMean(50, 50)).toBe(50);
  });
  it('HM корректно для контрастных k', () => {
    // HM(10, 1000) = 2*10*1000/(10+1000) ≈ 19.8
    expect(harmonicMean(10, 1000)).toBeCloseTo((2 * 10 * 1000) / 1010, 6);
  });
  it('HM(a, b) = HM(b, a)', () => {
    expect(harmonicMean(10, 1000)).toBeCloseTo(harmonicMean(1000, 10), 10);
  });
  it('HM ≤ geometric mean (для разных a, b)', () => {
    const a = 10;
    const b = 1000;
    const hm = harmonicMean(a, b);
    const gm = Math.sqrt(a * b);
    expect(hm).toBeLessThanOrEqual(gm + 1e-12);
  });
});

describe('transmissibility', () => {
  it('T = 0 при k=0', () => {
    expect(transmissibility({ k1: 0, k2: 100, A: 100, mu: 1, B: 1, d: 10 })).toBe(0);
  });
  it('T масштабируется линейно по A', () => {
    const t1 = transmissibility({ k1: 100, k2: 100, A: 100, mu: 1, B: 1, d: 10 });
    const t2 = transmissibility({ k1: 100, k2: 100, A: 200, mu: 1, B: 1, d: 10 });
    expect(t2).toBeCloseTo(2 * t1, 6);
  });
  it('T ~ 1/d', () => {
    const t1 = transmissibility({ k1: 100, k2: 100, A: 100, mu: 1, B: 1, d: 10 });
    const t2 = transmissibility({ k1: 100, k2: 100, A: 100, mu: 1, B: 1, d: 20 });
    expect(t2).toBeCloseTo(t1 / 2, 6);
  });
  it('T ~ 1/mu', () => {
    const t1 = transmissibility({ k1: 100, k2: 100, A: 100, mu: 1, B: 1, d: 10 });
    const t2 = transmissibility({ k1: 100, k2: 100, A: 100, mu: 2, B: 1, d: 10 });
    expect(t2).toBeCloseTo(t1 / 2, 6);
  });
  it('геометрическая T_g не зависит от mu/B', () => {
    const tg = geometricTransmissibility(100, 100, 100, 10);
    expect(tg).toBeGreaterThan(0);
  });
  it('реалистичный пример: 100 мД, A=300 м², d=20 м', () => {
    const t = transmissibility({ k1: 100, k2: 100, A: 300, mu: 1, B: 1, d: 20 });
    // T = 0.0543 * 100 * 300 / (1 * 1 * 20) = 81.45
    expect(t).toBeCloseTo((0.0543 * 100 * 300) / 20, 4);
  });
});
