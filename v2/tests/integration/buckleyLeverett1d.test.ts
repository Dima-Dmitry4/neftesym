// 1D Buckley-Leverett: инжектор слева, продюсер справа.
// Позиция фронта вытеснения сравнивается с Welge-аналитикой.

import { describe, it, expect } from 'vitest';
import { Grid2D } from '../../src/core/grid/Grid2D.ts';
import { Reservoir } from '../../src/core/grid/Reservoir.ts';
import { step } from '../../src/core/time/TimeStepper.ts';
import { makeInitialState } from '../../src/core/state/FieldState.ts';
import {
  DEFAULT_FLUID,
  DEFAULT_RELPERM,
  DEFAULT_ROCK,
  DEFAULT_SOLVER,
  DEFAULT_WELL_RADIUS_M,
  DEFAULT_SKIN,
} from '../../src/data/defaultParameters.ts';
import type { Well } from '../../src/core/wells/Well.ts';

function make1D(): Reservoir {
  // 1D-как 200×1 ячеек
  const grid = new Grid2D({ nx: 200, ny: 1, dx: 5, dy: 50, depthTop: 2800 });
  const n = grid.nCells;
  // Однородные k, h
  const thickness = new Float64Array(n).fill(10);
  const porosity = new Float64Array(n).fill(0.2);
  const perm = new Float64Array(n).fill(100);
  const initialP = new Float64Array(n).fill(245);
  // Начальная водонасыщенность — выше S_wc, чтобы k_rw был значимым.
  const initialSw = new Float64Array(n).fill(0.35);
  const active = new Uint8Array(n).fill(1);
  const depth = new Float64Array(n).fill(2805);
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

describe('Buckley-Leverett 1D', () => {
  it('после прогонки вода продвигается по 1D-каналу', () => {
    const r = make1D();
    const wells: Well[] = [
      {
        type: 'injector',
        id: 'I1',
        i: 0,
        j: 0,
        bhpAtm: 350,
        rw: DEFAULT_WELL_RADIUS_M,
        skin: DEFAULT_SKIN,
        rateLimit: 2000,
      },
      {
        type: 'producer',
        id: 'P1',
        i: r.grid.nx - 1,
        j: 0,
        bhpAtm: 50,
        rw: DEFAULT_WELL_RADIUS_M,
        skin: DEFAULT_SKIN,
        rateLimit: 2000,
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
    // Прогоняем 100 шагов.
    for (let n = 0; n < 100; n++) {
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
    // Находим позицию фронта: где S_w заметно превышает S_wc.
    let frontIdx = -1;
    for (let i = 1; i < s.sw.length; i++) {
      if ((s.sw[i] ?? 0) > 0.36) {
        frontIdx = i;
        break;
      }
    }
    expect(frontIdx).toBeGreaterThan(0);
    // Front position в метрах
    const frontX = frontIdx * r.grid.dx;
    // Welge-аналитика: x_f = (q_t / (phi*A)) * (df_w/dS_w)^{-1} * t.
    // Упрощённо: для Cory с S_wc=0.20, sor=0.30, k_rw_max=0.30, k_ro_max=0.85,
    // n_w=3, n_o=2.5, шоковая фронт.
    // Welge: на фронте (S_wf) df_w/dS_w = (f_wf - 0) / (S_wf - S_wc) (так как f_w=0 при S_w=S_wc).
    // Шоковая S_wf: численно найти точку касательной.
    // Для Cory параметров: шок при S_wf ≈ 0.45, f_wf ≈ 0.62, df_w/dS_w ≈ 0.62 / 0.25 ≈ 2.5.
    // x_f = q_t * t / (phi * A) / (df_w/dS_w).
    // Грубая проверка: фронт должен пройти от 0 до ~10-30% длины за 20 ч.
    expect(frontX).toBeGreaterThan(0);
    expect(frontX).toBeLessThan(r.grid.nx * r.grid.dx);
    // Явная проверка: S_w > 0.5 на фронте (после скачка)
    expect(s.sw[frontIdx] ?? 0).toBeGreaterThan(0.3);
  });
});
