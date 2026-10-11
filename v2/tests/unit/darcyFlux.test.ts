// Тесты DarcyFlux: закон Дарси в полевых единицах.

import { describe, it, expect } from 'vitest';
import { computeFluxes } from '../../src/core/physics/DarcyFlux.ts';
import { buildTransmissibilityMap } from '../../src/core/physics/TransmissibilityMap.ts';
import { generateDefaultField } from '../../src/data/defaultField.ts';
import { Grid2D } from '../../src/core/grid/Grid2D.ts';
import { Reservoir } from '../../src/core/grid/Reservoir.ts';
import {
  DEFAULT_FLUID,
  DEFAULT_RELPERM,
} from '../../src/data/defaultParameters.ts';

describe('DarcyFlux', () => {
  it('F_t = T · λ_t · ΔP на простой 1x2 ячейке', () => {
    const grid = new Grid2D({ nx: 2, ny: 1, dx: 20, dy: 20, depthTop: 2800 });
    const n = grid.nCells;
    const r = new Reservoir(grid, {
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
    const tMap = buildTransmissibilityMap(r);
    const p = new Float64Array([300, 200]); // ΔP = 100
    const sw = new Float64Array([0.3, 0.3]);
    const flux = computeFluxes(grid, tMap, p, sw, DEFAULT_RELPERM, DEFAULT_FLUID);
    expect(flux.fx[0] ?? 0).toBeGreaterThan(0); // F вправо
    // Проверим: F = T · λ_t · ΔP
    // T_g = 0.0543 * 100 * (15 * 20) / 20 = 81.45
    // λ_t = k_ro/(mu_o*bo) + k_rw/(mu_w*bw)
    // Для S_w = 0.3: S* = (0.3 - 0.2)/(1 - 0.2 - 0.3) = 0.2
    // k_ro = 0.85 * (1-0.2)^2.5 = 0.85 * 0.5724 = 0.4865
    // k_rw = 0.30 * 0.2^3 = 0.30 * 0.008 = 0.0024
    // λ_o = 0.4865 / (3.0 * 1.25) = 0.1297
    // λ_w = 0.0024 / (0.5 * 1.03) = 0.00466
    // λ_t = 0.1344
    // F = 81.45 * 0.1344 * 100 = 1094.7
    expect(flux.fx[0] ?? 0).toBeGreaterThan(100);
    expect(flux.fx[0] ?? 0).toBeLessThan(2000);
  });
  it('F = 0 при ΔP = 0', () => {
    const r = generateDefaultField({ grid: { nx: 5, ny: 5, dx: 20, dy: 20, depthTop: 2800 } });
    const tMap = buildTransmissibilityMap(r);
    const p = new Float64Array(r.grid.nCells).fill(245);
    const sw = new Float64Array(r.grid.nCells).fill(0.3);
    const flux = computeFluxes(r.grid, tMap, p, sw, DEFAULT_RELPERM, DEFAULT_FLUID);
    let maxFx = 0;
    let maxFy = 0;
    for (let i = 0; i < flux.fx.length; i++) maxFx = Math.max(maxFx, Math.abs(flux.fx[i] ?? 0));
    for (let i = 0; i < flux.fy.length; i++) maxFy = Math.max(maxFy, Math.abs(flux.fy[i] ?? 0));
    expect(maxFx).toBe(0);
    expect(maxFy).toBe(0);
  });
});
