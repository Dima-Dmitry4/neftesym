// IMPES: 1 шаг на 2×2 сетке, проверка что P и S_w ведут себя разумно.

import { describe, it, expect } from 'vitest';
import { Grid2D } from '../../src/core/grid/Grid2D.ts';
import { Reservoir } from '../../src/core/grid/Reservoir.ts';
import { step } from '../../src/core/time/TimeStepper.ts';
import { makeInitialState, type FieldState } from '../../src/core/state/FieldState.ts';
import {
  DEFAULT_FLUID,
  DEFAULT_RELPERM,
  DEFAULT_ROCK,
  DEFAULT_SOLVER,
  DEFAULT_WELL_RADIUS_M,
  DEFAULT_WELL_CONTROLS,
  DEFAULT_SKIN,
} from '../../src/data/defaultParameters.ts';
import { defaultField } from '../../src/data/defaultField.ts';
import type { Well } from '../../src/core/wells/Well.ts';

function avgP(s: FieldState, r: Reservoir): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < s.pressure.length; i++) {
    if ((r.active[i] ?? 0) === 0) continue;
    sum += s.pressure[i] ?? 0;
    n++;
  }
  return n > 0 ? sum / n : 0;
}

function make2x2Reservoir(): Reservoir {
  const grid = new Grid2D({ nx: 2, ny: 2, dx: 20, dy: 20, depthTop: 2800 });
  const n = grid.nCells;
  const thickness = new Float64Array(n).fill(15);
  const porosity = new Float64Array(n).fill(0.2);
  const perm = new Float64Array(n).fill(100);
  const initialP = new Float64Array(n).fill(245);
  const initialSw = new Float64Array(n).fill(0.3);
  const active = new Uint8Array(n).fill(1);
  const depth = new Float64Array(n).fill(2807.5);
  return new Reservoir(grid, {
    thickness,
    porosity,
    permX: perm,
    permY: new Float64Array(perm),
    permZ: new Float64Array(perm).map((v) => v * 0.1),
    initialP,
    initialSw,
    active,
    depthCenter: depth,
  });
}

describe('IMPES step', () => {
  it('aquifer support держит среднее P при большом отборе', () => {
    const r = defaultField();
    const wells: Well[] = [
      {
        type: 'producer',
        id: 'P1',
        i: 10,
        j: 10,
        bhpAtm: 100,
        rw: DEFAULT_WELL_RADIUS_M,
        skin: DEFAULT_SKIN,
        rateLimit: 1000,
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
    const pInit = avgP(s, r);
    for (let n = 0; n < 1000; n++) {
      const out = step({ state: s, dt: 1, reservoir: r, wells, fluid: DEFAULT_FLUID, rock: DEFAULT_ROCK, relperm: DEFAULT_RELPERM, params });
      s = out.state;
    }
    const pFinal = avgP(s, r);
    // С аквифером P не должен коллапсировать (без аквифера упал бы до BHP=100).
    expect(pFinal).toBeGreaterThan(pInit - 30);
  });

  it('1 шаг на 2×2 без скважин: P и S_w практически не меняются', () => {
    const r = make2x2Reservoir();
    const s0 = makeInitialState(r.initialP, r.initialSw);
    const out = step({
      state: s0,
      dt: 24,
      reservoir: r,
      wells: [],
      fluid: DEFAULT_FLUID,
      rock: DEFAULT_ROCK,
      relperm: DEFAULT_RELPERM,
      params: {
        dtMaxHours: DEFAULT_SOLVER.dtMaxHours,
        dtMinHours: DEFAULT_SOLVER.dtMinHours,
        cflTarget: DEFAULT_SOLVER.cflTarget,
        cgTolerance: DEFAULT_SOLVER.cgTolerance,
        cgMaxIterations: DEFAULT_SOLVER.cgMaxIterations,
        crAtm: DEFAULT_ROCK.crAtm,
        historyIntervalHours: 24,
      pressureRelaxation: DEFAULT_SOLVER.pressureRelaxation,
      },
    });
    for (let i = 0; i < s0.pressure.length; i++) {
      expect(out.state.pressure[i] ?? 0).toBeCloseTo(s0.pressure[i] ?? 0, 3);
      expect(out.state.sw[i] ?? 0).toBeCloseTo(s0.sw[i] ?? 0, 6);
    }
    expect(out.state.time).toBeGreaterThan(0);
  });

  it('1 шаг с producer+injector: P падает в зоне producer, растёт у injector', () => {
    const r = make2x2Reservoir();
    const s0 = makeInitialState(r.initialP, r.initialSw);
    const wells: Well[] = [
      {
        type: 'producer',
        id: 'P1',
        i: 0,
        j: 0,
        bhpAtm: DEFAULT_WELL_CONTROLS.producerBHPAtm,
        rw: DEFAULT_WELL_RADIUS_M,
        skin: DEFAULT_SKIN,
      },
      {
        type: 'injector',
        id: 'I1',
        i: 1,
        j: 1,
        bhpAtm: DEFAULT_WELL_CONTROLS.injectorBHPAtm,
        rw: DEFAULT_WELL_RADIUS_M,
        skin: DEFAULT_SKIN,
      },
    ];
    const out = step({
      state: s0,
      dt: 24,
      reservoir: r,
      wells,
      fluid: DEFAULT_FLUID,
      rock: DEFAULT_ROCK,
      relperm: DEFAULT_RELPERM,
      params: {
        dtMaxHours: DEFAULT_SOLVER.dtMaxHours,
        dtMinHours: DEFAULT_SOLVER.dtMinHours,
        cflTarget: DEFAULT_SOLVER.cflTarget,
        cgTolerance: DEFAULT_SOLVER.cgTolerance,
        cgMaxIterations: DEFAULT_SOLVER.cgMaxIterations,
        crAtm: DEFAULT_ROCK.crAtm,
        historyIntervalHours: 24,
      pressureRelaxation: DEFAULT_SOLVER.pressureRelaxation,
      },
    });
    // P[1,1] (injector) > P[0,0] (producer)
    const pProd = out.state.pressure[0] ?? 0;
    const pInj = out.state.pressure[3] ?? 0;
    expect(pInj).toBeGreaterThan(pProd);
  });

  it('100 шагов: S_w остаётся в физическом диапазоне', () => {
    const r = make2x2Reservoir();
    let s = makeInitialState(r.initialP, r.initialSw);
    const wells: Well[] = [
      {
        type: 'injector',
        id: 'I1',
        i: 0,
        j: 0,
        bhpAtm: DEFAULT_WELL_CONTROLS.injectorBHPAtm,
        rw: DEFAULT_WELL_RADIUS_M,
        skin: DEFAULT_SKIN,
      },
    ];
    for (let step_n = 0; step_n < 100; step_n++) {
      const out = step({
        state: s,
        dt: 1,
        reservoir: r,
        wells,
        fluid: DEFAULT_FLUID,
        rock: DEFAULT_ROCK,
        relperm: DEFAULT_RELPERM,
        params: {
          dtMaxHours: DEFAULT_SOLVER.dtMaxHours,
          dtMinHours: DEFAULT_SOLVER.dtMinHours,
          cflTarget: DEFAULT_SOLVER.cflTarget,
          cgTolerance: DEFAULT_SOLVER.cgTolerance,
          cgMaxIterations: DEFAULT_SOLVER.cgMaxIterations,
          crAtm: DEFAULT_ROCK.crAtm,
          historyIntervalHours: 24,
        pressureRelaxation: DEFAULT_SOLVER.pressureRelaxation,
        },
      });
      s = out.state;
    }
    for (let i = 0; i < s.sw.length; i++) {
      expect(s.sw[i] ?? 0).toBeGreaterThanOrEqual(DEFAULT_RELPERM.swc - 1e-9);
      expect(s.sw[i] ?? 0).toBeLessThanOrEqual(1 - DEFAULT_RELPERM.sor + 1e-9);
    }
  });
});
