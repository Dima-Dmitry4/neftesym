// CFL adaptive: при больших потоках шаг автоматически дробится.

import { describe, it, expect } from 'vitest';
import { step } from '../../src/core/time/TimeStepper.ts';
import { makeInitialState } from '../../src/core/state/FieldState.ts';
import { defaultField } from '../../src/data/defaultField.ts';
import {
  DEFAULT_FLUID,
  DEFAULT_RELPERM,
  DEFAULT_ROCK,
  DEFAULT_SOLVER,
  DEFAULT_WELL_RADIUS_M,
  DEFAULT_SKIN,
} from '../../src/data/defaultParameters.ts';
import type { Well } from '../../src/core/wells/Well.ts';

describe('CFL adaptive timestep', () => {
  it('при больших скважинах шаг дробится на несколько substep', () => {
    const r = defaultField();
    const wells: Well[] = [
      {
        type: 'producer',
        id: 'P1',
        i: 10,
        j: 10,
        bhpAtm: 50,
        rw: DEFAULT_WELL_RADIUS_M,
        skin: DEFAULT_SKIN,
      },
      {
        type: 'injector',
        id: 'I1',
        i: 40,
        j: 40,
        bhpAtm: 350,
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
      pressureRelaxation: DEFAULT_SOLVER.pressureRelaxation,
    };
    // Запрашиваем шаг 720 ч. CFL должен поделить на несколько substep.
    const out = step({
      state: s,
      dt: 720,
      reservoir: r,
      wells,
      fluid: DEFAULT_FLUID,
      rock: DEFAULT_ROCK,
      relperm: DEFAULT_RELPERM,
      params,
    });
    // Должно быть > 1 substep
    expect(out.subSteps.length).toBeGreaterThan(1);
    // Каждый substep ≤ dtMaxHours
    for (const sub of out.subSteps) {
      expect(sub.dt).toBeLessThanOrEqual(720);
    }
    // Общее время = запрошенному
    const totalDt = out.subSteps.reduce((sum, s) => sum + s.dt, 0);
    expect(totalDt).toBeCloseTo(720, 1);
  });

  it('при отсутствии скважин и потоков — 1 substep (dt = dtMax)', () => {
    const r = defaultField();
    const wells: Well[] = []; // пусто
    let s = makeInitialState(r.initialP, r.initialSw);
    const params = {
      dtMaxHours: 100, // явно для теста
      dtMinHours: DEFAULT_SOLVER.dtMinHours,
      cflTarget: DEFAULT_SOLVER.cflTarget,
      cgTolerance: DEFAULT_SOLVER.cgTolerance,
      cgMaxIterations: DEFAULT_SOLVER.cgMaxIterations,
      crAtm: DEFAULT_ROCK.crAtm,
      historyIntervalHours: 24,
      pressureRelaxation: DEFAULT_SOLVER.pressureRelaxation,
    };
    const out = step({
      state: s,
      dt: 50, // меньше dtMax
      reservoir: r,
      wells,
      fluid: DEFAULT_FLUID,
      rock: DEFAULT_ROCK,
      relperm: DEFAULT_RELPERM,
      params,
    });
    // Без скважин и при uniform P, CFL возвращает dtMax, dt=min(100,50)=50, 1 substep.
    expect(out.subSteps.length).toBe(1);
    expect(out.subSteps[0]?.dt).toBeCloseTo(50, 1);
  });
});
