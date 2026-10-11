// Property: после серии случайных шагов P остаётся в
// разумном диапазоне. С rate limits чтобы не было взрывного роста.

import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { step } from '../../src/core/time/TimeStepper.ts';
import { makeInitialState } from '../../src/core/state/FieldState.ts';
import { generateDefaultField } from '../../src/data/defaultField.ts';
import {
  DEFAULT_FLUID,
  DEFAULT_RELPERM,
  DEFAULT_ROCK,
  DEFAULT_SOLVER,
  DEFAULT_WELL_RADIUS_M,
  DEFAULT_SKIN,
} from '../../src/data/defaultParameters.ts';
import type { Well } from '../../src/core/wells/Well.ts';

describe('Pressure bounds (property-based)', () => {
  it('P в [minBHP, max(P_0, maxBHP)] с rate limits', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.double({ min: 50, max: 150 }),
        fc.double({ min: 200, max: 350 }),
        (seed, prodBhp, injBhp) => {
          const r = generateDefaultField({
            seed,
            grid: { nx: 15, ny: 15, dx: 20, dy: 20, depthTop: 2800 },
          });
          // Rate limits, чтобы избежать перепадов давления > 50 атм за 1 ч.
          const wells: Well[] = [
            {
              type: 'producer',
              id: 'P1',
              i: 3,
              j: 3,
              bhpAtm: prodBhp,
              rw: DEFAULT_WELL_RADIUS_M,
              skin: DEFAULT_SKIN,
              rateLimit: 20,
            },
            {
              type: 'injector',
              id: 'I1',
              i: 11,
              j: 11,
              bhpAtm: injBhp,
              rw: DEFAULT_WELL_RADIUS_M,
              skin: DEFAULT_SKIN,
              rateLimit: 20,
            },
          ];
          let s = makeInitialState(r.initialP, r.initialSw);
          const params = {
            dtMaxHours: DEFAULT_SOLVER.dtMaxHours,
            dtMinHours: DEFAULT_SOLVER.dtMinHours,
            cflTarget: DEFAULT_SOLVER.cflTarget,
            cgTolerance: DEFAULT_SOLVER.cgTolerance,
            cgMaxIterations: DEFAULT_SOLVER.cgMaxIterations,
            crAtm: DEFAULT_ROCK.crAtm,
            historyIntervalHours: 24,
          pressureRelaxation: 0.8,
          };
          for (let n = 0; n < 20; n++) {
            const out = step({
              state: s,
              dt: 1,
              reservoir: r,
              wells,
              fluid: DEFAULT_FLUID,
              rock: DEFAULT_ROCK,
              relperm: DEFAULT_RELPERM,
              params,
            });
            s = out.state;
          }
          // Проверка: P в [minBHP - 30, max(maxBHP, maxP0) + 30]
          let pMaxInitial = -Infinity;
          for (let idx = 0; idx < r.initialP.length; idx++) {
            if (!r.active[idx]) continue;
            const p0 = r.initialP[idx] ?? 0;
            if (p0 > pMaxInitial) pMaxInitial = p0;
          }
          const lower = Math.min(prodBhp, injBhp) - 30;
          const upper = Math.max(injBhp, pMaxInitial) + 30;
          for (let idx = 0; idx < s.pressure.length; idx++) {
            if (!r.active[idx]) continue;
            const v = s.pressure[idx] ?? 0;
            if (v < lower || v > upper) return false;
          }
          return true;
        },
      ),
      { numRuns: 5 },
    );
  });
});
