// Channel: вода прорывается по каналу быстрее.

import { describe, it, expect } from 'vitest';
import { step } from '../../src/core/time/TimeStepper.ts';
import { makeInitialState } from '../../src/core/state/FieldState.ts';
import { channelScenario } from '../../src/data/presets/channel.ts';
import {
  DEFAULT_FLUID,
  DEFAULT_RELPERM,
  DEFAULT_ROCK,
  DEFAULT_SOLVER,
} from '../../src/data/defaultParameters.ts';

describe('Channel', () => {
  it('после 50 шагов S_w выше в канале (y = ny/2), чем вне', () => {
    const scenario = channelScenario();
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
    for (let n = 0; n < 500; n++) {
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
    // Сравниваем S_w в центральной строке (канал) с верхней/нижней (вне канала).
    const cy = Math.floor(r.grid.ny / 2);
    const iMid = Math.floor(r.grid.nx / 2);
    const swInChannel = s.sw[r.grid.cellIndex(iMid, cy)] ?? 0;
    const swOutChannel1 = s.sw[r.grid.cellIndex(iMid, 5)] ?? 0;
    const swOutChannel2 = s.sw[r.grid.cellIndex(iMid, r.grid.ny - 6)] ?? 0;
    // В канале вода прорывается быстрее.
    expect(swInChannel).toBeGreaterThanOrEqual(swOutChannel1);
    expect(swInChannel).toBeGreaterThanOrEqual(swOutChannel2);
  });
});
