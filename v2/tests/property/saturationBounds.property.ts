// Property: после серии случайных шагов S_w остаётся в [S_wc, 1-S_or].

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
  DEFAULT_WELL_CONTROLS,
  DEFAULT_SKIN,
} from '../../src/data/defaultParameters.ts';
import type { Well } from '../../src/core/wells/Well.ts';

describe('Saturation bounds (property-based)', () => {
  it('S_w в [S_wc, 1-S_or] после случайных шагов', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 30 }),
        (seed, iWell, jWell) => {
          const r = generateDefaultField({
            seed,
            grid: { nx: 20, ny: 20, dx: 20, dy: 20, depthTop: 2800 },
          });
          const iw = iWell % r.grid.nx;
          const jw = jWell % r.grid.ny;
          const wells: Well[] = [
            {
              type: 'producer',
              id: 'P1',
              i: iw,
              j: jw,
              bhpAtm: DEFAULT_WELL_CONTROLS.producerBHPAtm,
              rw: DEFAULT_WELL_RADIUS_M,
              skin: DEFAULT_SKIN,
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
          for (let n = 0; n < 30; n++) {
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
          // Проверка границ
          const lower = DEFAULT_RELPERM.swc - 1e-9;
          const upper = 1 - DEFAULT_RELPERM.sor + 1e-9;
          for (let idx = 0; idx < s.sw.length; idx++) {
            if (!r.active[idx]) continue;
            const v = s.sw[idx] ?? 0;
            if (v < lower || v > upper) return false;
          }
          return true;
        },
      ),
      { numRuns: 10 },
    );
  });
});
