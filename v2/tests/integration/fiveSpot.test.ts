// 5-spot: симметрия P и S_w относительно центра.

import { describe, it, expect } from 'vitest';
import { step } from '../../src/core/time/TimeStepper.ts';
import { makeInitialState } from '../../src/core/state/FieldState.ts';
import { fiveSpotScenario } from '../../src/data/presets/fiveSpot.ts';
import { Grid2D } from '../../src/core/grid/Grid2D.ts';
import { Reservoir } from '../../src/core/grid/Reservoir.ts';
import { circleContour } from '../../src/core/grid/Contour.ts';
import {
  DEFAULT_FLUID,
  DEFAULT_RELPERM,
  DEFAULT_ROCK,
  DEFAULT_SOLVER,
  DEFAULT_WELL_RADIUS_M,
  DEFAULT_WELL_CONTROLS,
  DEFAULT_SKIN,
  DEFAULT_THICKNESS_M,
  DEFAULT_PRESSURE_ATM,
  DEFAULT_INITIAL_SW,
} from '../../src/data/defaultParameters.ts';
import type { Well } from '../../src/core/wells/Well.ts';

function makeHomogeneousReservoir(): Reservoir {
  // Однородное круглое месторождение 51x51 (нечётное — для 4-fold симметрии).
  const grid = new Grid2D({ nx: 51, ny: 51, dx: 20, dy: 20, depthTop: 2800 });
  const n = grid.nCells;
  const thickness = new Float64Array(n).fill(DEFAULT_THICKNESS_M);
  const porosity = new Float64Array(n).fill(DEFAULT_ROCK.porosity);
  const perm = new Float64Array(n).fill(DEFAULT_ROCK.permHMeanMD);
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
    permZ: new Float64Array(perm).map((v) => v * DEFAULT_ROCK.permAnisotropy),
    initialP,
    initialSw,
    active,
    depthCenter: depth,
  });
}

describe('Five-spot', () => {
  it('на однородном поле P симметрично относительно центра', () => {
    const r = makeHomogeneousReservoir();
    const cx = 25; // центр 51x51 — индекс (25, 25)
    const cy = 25;
    const offX = 12;
    const offY = 12;
    const wells: Well[] = [
      { type: 'injector', id: 'I1', i: cx, j: cy, bhpAtm: DEFAULT_WELL_CONTROLS.injectorBHPAtm, rw: DEFAULT_WELL_RADIUS_M, skin: DEFAULT_SKIN },
      { type: 'producer', id: 'P1', i: cx - offX, j: cy - offY, bhpAtm: DEFAULT_WELL_CONTROLS.producerBHPAtm, rw: DEFAULT_WELL_RADIUS_M, skin: DEFAULT_SKIN },
      { type: 'producer', id: 'P2', i: cx + offX, j: cy - offY, bhpAtm: DEFAULT_WELL_CONTROLS.producerBHPAtm, rw: DEFAULT_WELL_RADIUS_M, skin: DEFAULT_SKIN },
      { type: 'producer', id: 'P3', i: cx - offX, j: cy + offY, bhpAtm: DEFAULT_WELL_CONTROLS.producerBHPAtm, rw: DEFAULT_WELL_RADIUS_M, skin: DEFAULT_SKIN },
      { type: 'producer', id: 'P4', i: cx + offX, j: cy + offY, bhpAtm: DEFAULT_WELL_CONTROLS.producerBHPAtm, rw: DEFAULT_WELL_RADIUS_M, skin: DEFAULT_SKIN },
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
    // 5-spot симметрия: P(i, j) = P(nx-1-i, j) = P(i, ny-1-j) = P(nx-1-i, ny-1-j).
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
        const p1 = s.pressure[idx1] ?? 0;
        const p2 = s.pressure[idx2] ?? 0;
        const p3 = s.pressure[idx3] ?? 0;
        const p4 = s.pressure[idx4] ?? 0;
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
    // На однородном поле с симметричной геометрией — точная симметрия.
    // Допуск 20 атм на численные ошибки + гетерогенность у круглого контура.
    expect(maxSymErr).toBeLessThan(20);
  });

  it('5-spot сценарий возвращает 5 скважин', () => {
    const scenario = fiveSpotScenario();
    expect(scenario.wells.length).toBe(5);
    expect(scenario.wells.filter((w) => w.type === 'producer').length).toBe(4);
    expect(scenario.wells.filter((w) => w.type === 'injector').length).toBe(1);
  });
});
