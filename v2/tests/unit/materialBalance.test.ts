// Тесты материального баланса: ΔS_w · V_p == ∑(F_in - F_out + q_w) · dt.

import { describe, it, expect } from 'vitest';
import { computeMaterialBalance } from '../../src/core/physics/MaterialBalance.ts';
import { Grid2D } from '../../src/core/grid/Grid2D.ts';
import { Reservoir } from '../../src/core/grid/Reservoir.ts';
import type { FluxResult } from '../../src/core/physics/DarcyFlux.ts';

function makeRes(): Reservoir {
  const grid = new Grid2D({ nx: 5, ny: 5, dx: 20, dy: 20, depthTop: 2800 });
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

describe('computeMaterialBalance', () => {
  it('err = 0 при нулевых потоках и q_w = 0', () => {
    const r = makeRes();
    const swBefore = new Float64Array(r.grid.nCells).fill(0.3);
    const swAfter = new Float64Array(r.grid.nCells).fill(0.3);
    const flux: FluxResult = {
      fx: new Float64Array(r.grid.nXfaces),
      fy: new Float64Array(r.grid.nYfaces),
      fxw: new Float64Array(r.grid.nXfaces),
      fyw: new Float64Array(r.grid.nYfaces),
      fxo: new Float64Array(r.grid.nXfaces),
      fyo: new Float64Array(r.grid.nYfaces),
    };
    const res = computeMaterialBalance({
      reservoir: r,
      dt: 1,
      swBefore,
      swAfter,
      flux,
      wellsByCell: new Int32Array(0),
      wellStates: [],
    });
    expect(res.dSwVpFromState).toBeCloseTo(0, 6);
    expect(res.dSwVpFromFlux).toBeCloseTo(0, 6);
    expect(res.absError).toBeCloseTo(0, 6);
  });

  it('err = 0 при постоянном потоке влево', () => {
    const r = makeRes();
    const n = r.grid.nCells;
    // Поток воды влево 5 м³/сут по всем X-граням
    const flux: FluxResult = {
      fx: new Float64Array(r.grid.nXfaces).fill(-5),
      fy: new Float64Array(r.grid.nYfaces),
      fxw: new Float64Array(r.grid.nXfaces).fill(-5),
      fyw: new Float64Array(r.grid.nYfaces),
      fxo: new Float64Array(r.grid.nXfaces),
      fyo: new Float64Array(r.grid.nYfaces),
    };
    // Имитируем корректное обновление S_w.
    const dt = 2;
    const swBefore = new Float64Array(n).fill(0.3);
    const swAfter = new Float64Array(n);
    for (let idx = 0; idx < n; idx++) {
      const i = idx % r.grid.nx;
      let net = 0;
      if (i < r.grid.nx - 1) net -= -5; // right face
      if (i > 0) net += -5; // left face
      const vp = r.poreVolume(idx);
      swAfter[idx] = (swBefore[idx] ?? 0) + (dt * net) / vp;
    }
    const res = computeMaterialBalance({
      reservoir: r,
      dt,
      swBefore,
      swAfter,
      flux,
      wellsByCell: new Int32Array(0),
      wellStates: [],
    });
    expect(res.absError).toBeLessThan(1e-6);
  });
});
