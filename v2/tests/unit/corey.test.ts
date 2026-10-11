// Тесты ОФП по Corey: граничные значения и монотонности.

import { describe, it, expect } from 'vitest';
import { coreyRelPerm, clampSw, waterFraction } from '../../src/core/properties/Corey.ts';
import { DEFAULT_RELPERM } from '../../src/data/defaultParameters.ts';

describe('Corey relative permeability', () => {
  it('k_rw(swc) = 0, k_ro(swc) = kroMax', () => {
    const r = coreyRelPerm(DEFAULT_RELPERM.swc, DEFAULT_RELPERM);
    expect(r.krw).toBeCloseTo(0, 10);
    expect(r.kro).toBeCloseTo(DEFAULT_RELPERM.kroMax, 10);
  });

  it('k_ro(1-sor) = 0, k_rw(1-sor) = krwMax', () => {
    const swUpper = 1 - DEFAULT_RELPERM.sor;
    const r = coreyRelPerm(swUpper, DEFAULT_RELPERM);
    expect(r.kro).toBeCloseTo(0, 10);
    expect(r.krw).toBeCloseTo(DEFAULT_RELPERM.krwMax, 10);
  });

  it('k_ro убывает с ростом S_w (монотонно)', () => {
    const n = 50;
    const swc = DEFAULT_RELPERM.swc;
    const sor = DEFAULT_RELPERM.sor;
    const upper = 1 - sor;
    let prev = Infinity;
    for (let i = 0; i < n; i++) {
      const sw = swc + (upper - swc) * (i / (n - 1));
      const r = coreyRelPerm(sw, DEFAULT_RELPERM);
      expect(r.kro).toBeLessThanOrEqual(prev + 1e-12);
      prev = r.kro;
    }
  });

  it('k_rw растёт с ростом S_w (монотонно)', () => {
    const n = 50;
    const swc = DEFAULT_RELPERM.swc;
    const sor = DEFAULT_RELPERM.sor;
    const upper = 1 - sor;
    let prev = -1;
    for (let i = 0; i < n; i++) {
      const sw = swc + (upper - swc) * (i / (n - 1));
      const r = coreyRelPerm(sw, DEFAULT_RELPERM);
      expect(r.krw).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = r.krw;
    }
  });

  it('clampSw удерживает S_w в [S_wc, 1-S_or]', () => {
    expect(clampSw(-0.1, DEFAULT_RELPERM)).toBe(DEFAULT_RELPERM.swc);
    expect(clampSw(0.0, DEFAULT_RELPERM)).toBe(DEFAULT_RELPERM.swc);
    expect(clampSw(1.0, DEFAULT_RELPERM)).toBe(1 - DEFAULT_RELPERM.sor);
    expect(clampSw(0.4, DEFAULT_RELPERM)).toBe(0.4);
  });

  it('waterFraction f_w = 0 при S_w = S_wc, f_w → 1 при S_w → 1-S_or', () => {
    const fw0 = waterFraction(
      DEFAULT_RELPERM.swc,
      DEFAULT_RELPERM,
      3.0,
      0.5,
      1.25,
      1.03,
    );
    const fw1 = waterFraction(
      1 - DEFAULT_RELPERM.sor,
      DEFAULT_RELPERM,
      3.0,
      0.5,
      1.25,
      1.03,
    );
    expect(fw0).toBe(0);
    expect(fw1).toBeCloseTo(1, 6);
  });
});
