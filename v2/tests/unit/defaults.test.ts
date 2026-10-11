// Тест на дефолтные параметры — что они в реалистичных диапазонах
// и согласованы между собой.

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FLUID,
  DEFAULT_RELPERM,
  DEFAULT_ROCK,
  DEFAULT_GRID,
  DEFAULT_WELL_CONTROLS,
  DEFAULT_SOLVER,
  DEFAULT_INITIAL_SW,
  DEFAULT_PRESSURE_ATM,
} from '../../src/data/defaultParameters.ts';

describe('default parameters are realistic', () => {
  it('grid: 50×50 ячеек, шаг 20 м', () => {
    expect(DEFAULT_GRID.nx).toBe(50);
    expect(DEFAULT_GRID.ny).toBe(50);
    expect(DEFAULT_GRID.dx).toBe(20);
  });

  it('fluid: вязкости в типичных диапазонах', () => {
    expect(DEFAULT_FLUID.muOilCP).toBeGreaterThan(1);
    expect(DEFAULT_FLUID.muOilCP).toBeLessThan(10);
    expect(DEFAULT_FLUID.muWaterCP).toBeGreaterThan(0.3);
    expect(DEFAULT_FLUID.muWaterCP).toBeLessThan(1.0);
  });

  it('rock: пористость и сжимаемость реалистичны', () => {
    expect(DEFAULT_ROCK.porosity).toBeGreaterThan(0.15);
    expect(DEFAULT_ROCK.porosity).toBeLessThan(0.30);
    expect(DEFAULT_ROCK.crAtm).toBeGreaterThan(1e-6);
    expect(DEFAULT_ROCK.crAtm).toBeLessThan(1e-3);
  });

  it('relperm: Corey параметры в водо-смачиваемом диапазоне', () => {
    expect(DEFAULT_RELPERM.swc + DEFAULT_RELPERM.sor).toBeLessThan(1);
    expect(DEFAULT_RELPERM.kroMax).toBeGreaterThan(0.5);
    expect(DEFAULT_RELPERM.krwMax).toBeLessThan(DEFAULT_RELPERM.kroMax);
    expect(DEFAULT_RELPERM.nOil).toBeGreaterThan(1);
    expect(DEFAULT_RELPERM.nWater).toBeGreaterThan(1);
  });

  it('initial state: S_w0 выше S_wc (нефть подвижна)', () => {
    expect(DEFAULT_INITIAL_SW).toBeGreaterThan(DEFAULT_RELPERM.swc);
  });

  it('BHP controls: producer < initial P < injector', () => {
    expect(DEFAULT_WELL_CONTROLS.producerBHPAtm).toBeLessThan(DEFAULT_PRESSURE_ATM);
    expect(DEFAULT_WELL_CONTROLS.injectorBHPAtm).toBeGreaterThan(DEFAULT_PRESSURE_ATM);
  });

  it('solver: dtMax > dtMin, cflTarget в разумном диапазоне', () => {
    expect(DEFAULT_SOLVER.dtMaxHours).toBeGreaterThan(DEFAULT_SOLVER.dtMinHours);
    expect(DEFAULT_SOLVER.cflTarget).toBeGreaterThan(0);
    expect(DEFAULT_SOLVER.cflTarget).toBeLessThanOrEqual(2);
  });
});
