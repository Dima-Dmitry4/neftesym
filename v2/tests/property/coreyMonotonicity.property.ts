// Property: k_rw растёт с S_w, k_ro убывает (для S_w в [S_wc, 1-S_or]).

import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { coreyRelPerm } from '../../src/core/properties/Corey.ts';
import { DEFAULT_RELPERM } from '../../src/data/defaultParameters.ts';

describe('Corey monotonicity (property-based)', () => {
  it('k_rw не убывает с S_w', () => {
    const lower = DEFAULT_RELPERM.swc;
    const upper = 1 - DEFAULT_RELPERM.sor;
    fc.assert(
      fc.property(
        fc.double({ min: lower, max: upper, noNaN: true }),
        fc.double({ min: lower, max: upper, noNaN: true }),
        (sw1, sw2) => {
          const lo = Math.min(sw1, sw2);
          const hi = Math.max(sw1, sw2);
          const klo = coreyRelPerm(lo, DEFAULT_RELPERM).krw;
          const khi = coreyRelPerm(hi, DEFAULT_RELPERM).krw;
          return khi >= klo - 1e-9;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('k_ro не возрастает с S_w', () => {
    const lower = DEFAULT_RELPERM.swc;
    const upper = 1 - DEFAULT_RELPERM.sor;
    fc.assert(
      fc.property(
        fc.double({ min: lower, max: upper, noNaN: true }),
        fc.double({ min: lower, max: upper, noNaN: true }),
        (sw1, sw2) => {
          const lo = Math.min(sw1, sw2);
          const hi = Math.max(sw1, sw2);
          const klo = coreyRelPerm(lo, DEFAULT_RELPERM).kro;
          const khi = coreyRelPerm(hi, DEFAULT_RELPERM).kro;
          return khi <= klo + 1e-9;
        },
      ),
      { numRuns: 200 },
    );
  });
});
