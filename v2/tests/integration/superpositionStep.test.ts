// Интеграционный тест: 5-spot через SuperpositionStepper.

import { describe, it, expect } from 'vitest';
import {
  stepSuperposition,
  computePoreVolume,
  type SuperpositionStepperParams,
} from '../../src/core/time/SuperpositionStepper.ts';
import { makeInitialState } from '../../src/core/state/FieldState.ts';
import { Grid2D } from '../../src/core/grid/Grid2D.ts';
import { Reservoir } from '../../src/core/grid/Reservoir.ts';
import { circleContour } from '../../src/core/grid/Contour.ts';
import {
  DEFAULT_FLUID,
  DEFAULT_RELPERM,
  DEFAULT_PRESSURE_MODEL,
  DEFAULT_WELL_RADIUS_M,
  DEFAULT_WELL_CONTROLS,
  DEFAULT_SKIN,
  DEFAULT_THICKNESS_M,
  DEFAULT_PRESSURE_ATM,
  DEFAULT_INITIAL_SW,
} from '../../src/data/defaultParameters.ts';
import type { Well } from '../../src/core/wells/Well.ts';

function makeHomogeneousReservoir(): Reservoir {
  const grid = new Grid2D({ nx: 51, ny: 51, dx: 20, dy: 20, depthTop: 2800 });
  const n = grid.nCells;
  const thickness = new Float64Array(n).fill(DEFAULT_THICKNESS_M);
  const porosity = new Float64Array(n).fill(0.2);
  const perm = new Float64Array(n).fill(100);
  const initialP = new Float64Array(n).fill(DEFAULT_PRESSURE_ATM);
  const initialSw = new Float64Array(n).fill(DEFAULT_INITIAL_SW);
  const cx = 25 * 20 + 10;
  const cy = 25 * 20 + 10;
  const active = circleContour(grid, cx, cy, 24 * 20);
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

function defaultParams(): SuperpositionStepperParams {
  return {
    dtMaxHours: 4,
    dtMinHours: 0.1,
    cflTarget: 0.3,
    crAtm: 5e-5,
    totalCompressibilityAtmInv: DEFAULT_PRESSURE_MODEL.totalCompressibilityAtmInv,
    rateSolver: {
      muB: DEFAULT_FLUID.muWaterCP * DEFAULT_FLUID.bw,
      radiusMode: DEFAULT_PRESSURE_MODEL.radiusMode,
      fixedRadiusM: DEFAULT_PRESSURE_MODEL.fixedRadiusM,
      effectiveK: DEFAULT_PRESSURE_MODEL.effectiveKMethod,
      constantKEffMD: DEFAULT_PRESSURE_MODEL.constantKEffMD,
    },
    historyIntervalHours: 24,
  };
}

describe('SuperpositionStepper (5-spot)', () => {
  it('прогон 5 сут: P остаётся в разумных пределах, S_w клампится', () => {
    const r = makeHomogeneousReservoir();
    const cx = 25;
    const cy = 25;
    const off = 12;
    const wells: Well[] = [
      {
        type: 'injector',
        id: 'I1',
        i: cx,
        j: cy,
        bhpAtm: DEFAULT_WELL_CONTROLS.injectorBHPAtm,
        rw: DEFAULT_WELL_RADIUS_M,
        skin: DEFAULT_SKIN,
        rateLimit: DEFAULT_WELL_CONTROLS.injectorRateLimit,
      },
      {
        type: 'producer',
        id: 'P1',
        i: cx - off,
        j: cy - off,
        bhpAtm: DEFAULT_WELL_CONTROLS.producerBHPAtm,
        rw: DEFAULT_WELL_RADIUS_M,
        skin: DEFAULT_SKIN,
        rateLimit: DEFAULT_WELL_CONTROLS.producerRateLimit,
      },
      {
        type: 'producer',
        id: 'P2',
        i: cx + off,
        j: cy - off,
        bhpAtm: DEFAULT_WELL_CONTROLS.producerBHPAtm,
        rw: DEFAULT_WELL_RADIUS_M,
        skin: DEFAULT_SKIN,
        rateLimit: DEFAULT_WELL_CONTROLS.producerRateLimit,
      },
      {
        type: 'producer',
        id: 'P3',
        i: cx - off,
        j: cy + off,
        bhpAtm: DEFAULT_WELL_CONTROLS.producerBHPAtm,
        rw: DEFAULT_WELL_RADIUS_M,
        skin: DEFAULT_SKIN,
        rateLimit: DEFAULT_WELL_CONTROLS.producerRateLimit,
      },
      {
        type: 'producer',
        id: 'P4',
        i: cx + off,
        j: cy + off,
        bhpAtm: DEFAULT_WELL_CONTROLS.producerBHPAtm,
        rw: DEFAULT_WELL_RADIUS_M,
        skin: DEFAULT_SKIN,
        rateLimit: DEFAULT_WELL_CONTROLS.producerRateLimit,
      },
    ];
    let state = makeInitialState(r.initialP, r.initialSw);
    const vp = computePoreVolume(r);
    let pAvg = DEFAULT_PRESSURE_ATM;
    let cum = { productionM3: 0, injectionM3: 0 };
    const params = defaultParams();
    // Прогоняем 5 сут (120 ч) маленькими шагами.
    for (let n = 0; n < 60; n++) {
      const out = stepSuperposition({
        state,
        dt: 2,
        reservoir: r,
        wells,
        fluid: DEFAULT_FLUID,
        relperm: DEFAULT_RELPERM,
        params,
        poreVolumeM3: vp,
        pAvg,
        cum,
      });
      state = out.state;
      pAvg = out.pAvg;
      cum = out.cum;
    }
    // P остаётся в разумных пределах.
    let pMin = Infinity;
    let pMax = -Infinity;
    for (let i = 0; i < state.pressure.length; i++) {
      if (!r.active[i]) continue;
      const p = state.pressure[i] ?? 0;
      if (p < pMin) pMin = p;
      if (p > pMax) pMax = p;
    }
    expect(pMin).toBeGreaterThan(50);
    expect(pMin).toBeLessThan(DEFAULT_PRESSURE_ATM); // producer занижает
    expect(pMax).toBeGreaterThan(DEFAULT_PRESSURE_ATM); // injector завышает
    expect(pMax).toBeLessThan(400);
    // S_w в [S_wc, 1 - S_or].
    for (let i = 0; i < state.sw.length; i++) {
      if (!r.active[i]) continue;
      const sw = state.sw[i] ?? 0;
      expect(sw).toBeGreaterThanOrEqual(DEFAULT_RELPERM.swc - 1e-9);
      expect(sw).toBeLessThanOrEqual(1 - DEFAULT_RELPERM.sor + 1e-9);
    }
  });

  it('5-spot симметрия: P симметрично относительно центра', () => {
    const r = makeHomogeneousReservoir();
    const cx = 25;
    const cy = 25;
    const off = 12;
    const wells: Well[] = [
      {
        type: 'injector',
        id: 'I1',
        i: cx,
        j: cy,
        bhpAtm: DEFAULT_WELL_CONTROLS.injectorBHPAtm,
        rw: DEFAULT_WELL_RADIUS_M,
        skin: DEFAULT_SKIN,
        rateLimit: DEFAULT_WELL_CONTROLS.injectorRateLimit,
      },
      {
        type: 'producer',
        id: 'P1',
        i: cx - off,
        j: cy - off,
        bhpAtm: DEFAULT_WELL_CONTROLS.producerBHPAtm,
        rw: DEFAULT_WELL_RADIUS_M,
        skin: DEFAULT_SKIN,
        rateLimit: DEFAULT_WELL_CONTROLS.producerRateLimit,
      },
      {
        type: 'producer',
        id: 'P2',
        i: cx + off,
        j: cy - off,
        bhpAtm: DEFAULT_WELL_CONTROLS.producerBHPAtm,
        rw: DEFAULT_WELL_RADIUS_M,
        skin: DEFAULT_SKIN,
        rateLimit: DEFAULT_WELL_CONTROLS.producerRateLimit,
      },
      {
        type: 'producer',
        id: 'P3',
        i: cx - off,
        j: cy + off,
        bhpAtm: DEFAULT_WELL_CONTROLS.producerBHPAtm,
        rw: DEFAULT_WELL_RADIUS_M,
        skin: DEFAULT_SKIN,
        rateLimit: DEFAULT_WELL_CONTROLS.producerRateLimit,
      },
      {
        type: 'producer',
        id: 'P4',
        i: cx + off,
        j: cy + off,
        bhpAtm: DEFAULT_WELL_CONTROLS.producerBHPAtm,
        rw: DEFAULT_WELL_RADIUS_M,
        skin: DEFAULT_SKIN,
        rateLimit: DEFAULT_WELL_CONTROLS.producerRateLimit,
      },
    ];
    let state = makeInitialState(r.initialP, r.initialSw);
    const vp = computePoreVolume(r);
    let pAvg = DEFAULT_PRESSURE_ATM;
    let cum = { productionM3: 0, injectionM3: 0 };
    const params = defaultParams();
    // 1 шаг достаточно для проверки симметрии давления (P стационарно).
    const out = stepSuperposition({
      state,
      dt: 1,
      reservoir: r,
      wells,
      fluid: DEFAULT_FLUID,
      relperm: DEFAULT_RELPERM,
      params,
      poreVolumeM3: vp,
      pAvg,
      cum,
    });
    const nx = r.grid.nx;
    const ny = r.grid.ny;
    let maxSymErr = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx / 2; i++) {
        const idx1 = r.grid.cellIndex(i, j);
        const idx2 = r.grid.cellIndex(nx - 1 - i, j);
        const idx3 = r.grid.cellIndex(i, ny - 1 - j);
        const idx4 = r.grid.cellIndex(nx - 1 - i, ny - 1 - j);
        if (!r.active[idx1] || !r.active[idx2] || !r.active[idx3] || !r.active[idx4]) continue;
        const p1 = out.state.pressure[idx1] ?? 0;
        const p2 = out.state.pressure[idx2] ?? 0;
        const p3 = out.state.pressure[idx3] ?? 0;
        const p4 = out.state.pressure[idx4] ?? 0;
        const avg = (p1 + p2 + p3 + p4) / 4;
        const err = Math.max(
          Math.abs(p1 - avg),
          Math.abs(p2 - avg),
          Math.abs(p3 - avg),
          Math.abs(p4 - avg),
        );
        if (err > maxSymErr) maxSymErr = err;
      }
    }
    // На однородном поле симметрия должна быть очень точной.
    expect(maxSymErr).toBeLessThan(1e-3);
  });

  it('5-spot: вода распространяется от injector к producers за 1 год', () => {
    const r = makeHomogeneousReservoir();
    const cx = 25;
    const cy = 25;
    const off = 12;
    const wells: Well[] = [
      {
        type: 'injector',
        id: 'I1',
        i: cx,
        j: cy,
        bhpAtm: DEFAULT_WELL_CONTROLS.injectorBHPAtm,
        rw: DEFAULT_WELL_RADIUS_M,
        skin: DEFAULT_SKIN,
        rateLimit: DEFAULT_WELL_CONTROLS.injectorRateLimit,
      },
      {
        type: 'producer',
        id: 'P1',
        i: cx - off,
        j: cy - off,
        bhpAtm: DEFAULT_WELL_CONTROLS.producerBHPAtm,
        rw: DEFAULT_WELL_RADIUS_M,
        skin: DEFAULT_SKIN,
        rateLimit: DEFAULT_WELL_CONTROLS.producerRateLimit,
      },
      {
        type: 'producer',
        id: 'P2',
        i: cx + off,
        j: cy - off,
        bhpAtm: DEFAULT_WELL_CONTROLS.producerBHPAtm,
        rw: DEFAULT_WELL_RADIUS_M,
        skin: DEFAULT_SKIN,
        rateLimit: DEFAULT_WELL_CONTROLS.producerRateLimit,
      },
      {
        type: 'producer',
        id: 'P3',
        i: cx - off,
        j: cy + off,
        bhpAtm: DEFAULT_WELL_CONTROLS.producerBHPAtm,
        rw: DEFAULT_WELL_RADIUS_M,
        skin: DEFAULT_SKIN,
        rateLimit: DEFAULT_WELL_CONTROLS.producerRateLimit,
      },
      {
        type: 'producer',
        id: 'P4',
        i: cx + off,
        j: cy + off,
        bhpAtm: DEFAULT_WELL_CONTROLS.producerBHPAtm,
        rw: DEFAULT_WELL_RADIUS_M,
        skin: DEFAULT_SKIN,
        rateLimit: DEFAULT_WELL_CONTROLS.producerRateLimit,
      },
    ];
    let state = makeInitialState(r.initialP, r.initialSw);
    const vp = computePoreVolume(r);
    let pAvg = DEFAULT_PRESSURE_ATM;
    let cum = { productionM3: 0, injectionM3: 0 };
    const params = defaultParams();
    // Прогоняем 1 год (8760 ч) по 24 ч.
    for (let n = 0; n < 365; n++) {
      const out = stepSuperposition({
        state,
        dt: 24,
        reservoir: r,
        wells,
        fluid: DEFAULT_FLUID,
        relperm: DEFAULT_RELPERM,
        params,
        poreVolumeM3: vp,
        pAvg,
        cum,
      });
      state = out.state;
      pAvg = out.pAvg;
      cum = out.cum;
    }
    // После 1 года S_w около injector должна вырасти.
    const swInjector = state.sw[r.grid.cellIndex(cx, cy)] ?? 0;
    const swAway = state.sw[r.grid.cellIndex(0, 0)] ?? 0;
    expect(swInjector).toBeGreaterThan(DEFAULT_INITIAL_SW + 0.05);
    expect(swAway).toBeLessThan(swInjector);
  });
});
