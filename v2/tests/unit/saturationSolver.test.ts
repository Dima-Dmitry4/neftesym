// Тесты SaturationSolver: upwind 1-го порядка на 1D.

import { describe, it, expect } from 'vitest';
import { updateSaturation } from '../../src/core/physics/SaturationSolver.ts';
import { Grid2D } from '../../src/core/grid/Grid2D.ts';
import { Reservoir } from '../../src/core/grid/Reservoir.ts';
import { DEFAULT_RELPERM } from '../../src/data/defaultParameters.ts';
import type { FluxResult } from '../../src/core/physics/DarcyFlux.ts';
import type { WellState } from '../../src/core/wells/BHPControl.ts';

function makeRes10x1(): Reservoir {
  const grid = new Grid2D({ nx: 10, ny: 1, dx: 20, dy: 20, depthTop: 2800 });
  const n = grid.nCells;
  return new Reservoir(grid, {
    thickness: new Float64Array(n).fill(15),
    porosity: new Float64Array(n).fill(0.2),
    permX: new Float64Array(n).fill(100),
    permY: new Float64Array(n).fill(100),
    permZ: new Float64Array(n).fill(10),
    initialP: new Float64Array(n).fill(245),
    initialSw: new Float64Array(n).fill(0.3),
    active: new Uint8Array(n).fill(1),
    depthCenter: new Float64Array(n).fill(2807.5),
  });
}

describe('updateSaturation (upwind 1D)', () => {
  it('постоянный поток вправо: S_w убывает слева', () => {
    const r = makeRes10x1();
    const sw = new Float64Array(r.grid.nCells).fill(0.3);
    const flux: FluxResult = {
      fx: new Float64Array(r.grid.nXfaces).fill(10), // вправо
      fy: new Float64Array(r.grid.nYfaces),
      fxw: new Float64Array(r.grid.nXfaces).fill(10),
      fyw: new Float64Array(r.grid.nYfaces),
      fxo: new Float64Array(r.grid.nXfaces),
      fyo: new Float64Array(r.grid.nYfaces),
    };
    const swNew = updateSaturation({
      reservoir: r,
      sw,
      flux,
      wellStates: [],
      dt: 1,
      relperm: DEFAULT_RELPERM,
    });
    // Левая ячейка теряет воду (нет inflow, есть outflow)
    // V_p = 0.2 * 15 * 20 * 20 = 1200 м³
    // dSw = -10 / 1200 ≈ -0.0083
    expect(swNew[0] ?? 0).toBeLessThan(0.3);
    expect(swNew[0] ?? 0).toBeGreaterThan(0.29);
  });
  it('S_w остаётся в [S_wc, 1-S_or]', () => {
    const r = makeRes10x1();
    const sw = new Float64Array(r.grid.nCells).fill(0.3);
    const flux: FluxResult = {
      fx: new Float64Array(r.grid.nXfaces).fill(1e6),
      fy: new Float64Array(r.grid.nYfaces),
      fxw: new Float64Array(r.grid.nXfaces).fill(1e6),
      fyw: new Float64Array(r.grid.nYfaces),
      fxo: new Float64Array(r.grid.nXfaces),
      fyo: new Float64Array(r.grid.nYfaces),
    };
    const swNew = updateSaturation({
      reservoir: r,
      sw,
      flux,
      wellStates: [],
      dt: 24,
      relperm: DEFAULT_RELPERM,
    });
    for (let i = 0; i < swNew.length; i++) {
      expect(swNew[i] ?? 0).toBeGreaterThanOrEqual(DEFAULT_RELPERM.swc - 1e-9);
      expect(swNew[i] ?? 0).toBeLessThanOrEqual(1 - DEFAULT_RELPERM.sor + 1e-9);
    }
  });
  it('инжектор добавляет воду (qWater < 0 → S_w растёт)', () => {
    const r = makeRes10x1();
    const sw = new Float64Array(r.grid.nCells).fill(0.3);
    const flux: FluxResult = {
      fx: new Float64Array(r.grid.nXfaces),
      fy: new Float64Array(r.grid.nYfaces),
      fxw: new Float64Array(r.grid.nXfaces),
      fyw: new Float64Array(r.grid.nYfaces),
      fxo: new Float64Array(r.grid.nXfaces),
      fyo: new Float64Array(r.grid.nYfaces),
    };
    const wellStates: WellState[] = [
      {
        wellId: 'I1',
        pCell: 250,
        bhp: 290,
        jBase: 100,
        lambdaTotal: 0,
        lambdaWater: 0,
        qOil: 0,
        qWater: -50, // закачка 50 м³/сут
        qLiq: -50,
        waterCut: 0,
        cellIndex: 0,
        type: 'injector',
      },
    ];
    const swNew = updateSaturation({
      reservoir: r,
      sw,
      flux,
      wellStates,
      dt: 1,
      relperm: DEFAULT_RELPERM,
    });
    expect(swNew[0] ?? 0).toBeGreaterThan(0.3);
  });
});
