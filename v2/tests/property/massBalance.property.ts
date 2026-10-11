// Property: баланс массы на малом dt (1 substep) —
// ΔS_w · V_p == dt_days · Σ (F_in - F_out + q_w).
//
// Используем малый dt (1 ч), чтобы CFL не дробил шаг, и смотрим
// материальный баланс «из потоков» vs «из состояния».

import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { step } from '../../src/core/time/TimeStepper.ts';
import { makeInitialState } from '../../src/core/state/FieldState.ts';
import { computeMaterialBalance } from '../../src/core/physics/MaterialBalance.ts';
import { defaultField } from '../../src/data/defaultField.ts';
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
import { applyWells } from '../../src/core/wells/BHPControl.ts';

describe('Mass balance (property-based)', () => {
  it('после серии шагов с малым dt err < 1e-3 (один substep на шаг)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        (seed) => {
          const r = defaultField();
          void seed;
          // Используем rate limits, чтобы избежать насыщения и агрессивного CFL.
          const wells: Well[] = [
            {
              type: 'producer',
              id: 'P1',
              i: 10,
              j: 10,
              bhpAtm: DEFAULT_WELL_CONTROLS.producerBHPAtm,
              rw: DEFAULT_WELL_RADIUS_M,
              skin: DEFAULT_SKIN,
              rateLimit: 50,
            },
            {
              type: 'injector',
              id: 'I1',
              i: 40,
              j: 40,
              bhpAtm: DEFAULT_WELL_CONTROLS.injectorBHPAtm,
              rw: DEFAULT_WELL_RADIUS_M,
              skin: DEFAULT_SKIN,
              rateLimit: 50,
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
            const swBefore = s.sw.slice();
            const pBefore = s.pressure.slice();
            // Используем dt = 1 ч, что меньше CFL_dt для типичных потоков.
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
            // Только если ровно 1 substep — иначе баланс аккумулируется.
            if (out.subSteps.length !== 1) {
              s = out.state;
              continue;
            }
            const subStep = out.subSteps[0]!;
            const wellRes = applyWells(r, pBefore, swBefore, wells, DEFAULT_RELPERM, DEFAULT_FLUID);
            const mb = computeMaterialBalance({
              reservoir: r,
              dt: 1,
              swBefore,
              swAfter: out.state.sw,
              flux: subStep.flux,
              wellsByCell: wellRes.wellsByCell,
              wellStates: wellRes.states,
            });
            const tol = 1e-2; // м³
            if (mb.absError > tol) return false;
            s = out.state;
          }
          return true;
        },
      ),
      { numRuns: 5 },
    );
  });
});
