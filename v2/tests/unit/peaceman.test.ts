// Тесты Peaceman Well Index.

import { describe, it, expect } from 'vitest';
import { peacemanWI, peacemanEquivalentRadius } from '../../src/core/physics/WellIndex.ts';

describe('peacemanEquivalentRadius', () => {
  it('r_e = 0.2 * dx для изотропной квадратной ячейки', () => {
    expect(peacemanEquivalentRadius(20)).toBe(4);
    expect(peacemanEquivalentRadius(20, 20)).toBe(4);
  });
  it('r_e = 0.2 * min(dx, dy) при dx != dy', () => {
    expect(peacemanEquivalentRadius(20, 10)).toBe(2);
  });
});

describe('peacemanWI', () => {
  it('J = 0 при k=0', () => {
    expect(peacemanWI({ k: 0, h: 10, mu: 1, b: 1, dx: 20, rw: 0.1 })).toBe(0);
  });
  it('J = 0 при h=0', () => {
    expect(peacemanWI({ k: 100, h: 0, mu: 1, b: 1, dx: 20, rw: 0.1 })).toBe(0);
  });
  it('J > 0 в реалистичном диапазоне 10–1000 м³/(сут·атм)', () => {
    // k=100 мД, h=15 м, dx=20 м, rw=0.1, mu=1, B=1
    // J = 0.0543 * 2π * 100 * 15 / (ln(4/0.1) + 0)
    //   = 0.0543 * 6.2832 * 1500 / ln(40)
    //   = 0.0543 * 9424.78 / 3.6889
    //   ≈ 138.7
    const j = peacemanWI({ k: 100, h: 15, mu: 1, b: 1, dx: 20, rw: 0.1 });
    expect(j).toBeGreaterThan(10);
    expect(j).toBeLessThan(1000);
    // Проверим формулу
    const re = peacemanEquivalentRadius(20);
    const expected = (0.0543 * 2 * Math.PI * 100 * 15) / Math.log(re / 0.1);
    expect(j).toBeCloseTo(expected, 4);
  });
  it('J учитывает скин-фактор', () => {
    const j0 = peacemanWI({ k: 100, h: 10, mu: 1, b: 1, dx: 20, rw: 0.1, skin: 0 });
    const j5 = peacemanWI({ k: 100, h: 10, mu: 1, b: 1, dx: 20, rw: 0.1, skin: 5 });
    expect(j5).toBeLessThan(j0);
  });
  it('J ~ 1/mu*B', () => {
    const j1 = peacemanWI({ k: 100, h: 10, mu: 1, b: 1, dx: 20, rw: 0.1 });
    const j2 = peacemanWI({ k: 100, h: 10, mu: 2, b: 1, dx: 20, rw: 0.1 });
    expect(j2).toBeCloseTo(j1 / 2, 6);
  });
});
