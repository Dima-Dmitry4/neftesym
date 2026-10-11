// Fault block: разлом как no-flow barrier.

import { describe, it, expect } from 'vitest';
import { step } from '../../src/core/time/TimeStepper.ts';
import { makeInitialState } from '../../src/core/state/FieldState.ts';
import { faultBlockScenario } from '../../src/data/presets/faultBlock.ts';
import {
  DEFAULT_FLUID,
  DEFAULT_RELPERM,
  DEFAULT_ROCK,
  DEFAULT_SOLVER,
} from '../../src/data/defaultParameters.ts';

describe('Fault block', () => {
  it('разлом блокирует поток: P по разные стороны разлома различается', () => {
    const scenario = faultBlockScenario();
    const r = scenario.reservoir;
    const wells = scenario.wells;
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
        dt: 2,
        reservoir: r,
        wells,
        fluid: DEFAULT_FLUID,
        rock: DEFAULT_ROCK,
        relperm: DEFAULT_RELPERM,
        params,
        xFault: scenario.xFault,
        yFault: scenario.yFault,
      });
      s = out.state;
    }
    // Инжектор слева (i=12), продюсер справа (i=37), разлом на i=25.
    // Давление в ячейках слева должно быть выше, чем справа.
    const leftIdx = r.grid.cellIndex(15, Math.floor(r.grid.ny / 2));
    const rightIdx = r.grid.cellIndex(35, Math.floor(r.grid.ny / 2));
    if (r.active[leftIdx] && r.active[rightIdx]) {
      const pLeft = s.pressure[leftIdx] ?? 0;
      const pRight = s.pressure[rightIdx] ?? 0;
      expect(pLeft).toBeGreaterThan(pRight);
    }
  });
});
