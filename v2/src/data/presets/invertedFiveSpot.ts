// Inverted 5-spot: 1 продюсер в центре + 4 инжектора по углам.

import { defaultField } from '../defaultField.ts';
import {
  DEFAULT_WELL_CONTROLS,
  DEFAULT_WELL_RADIUS_M,
  DEFAULT_SKIN,
} from '../defaultParameters.ts';
import type { Well } from '../../core/wells/Well.ts';
import type { ScenarioConfig } from './ScenarioConfig.ts';

export function invertedFiveSpotScenario(): ScenarioConfig {
  const reservoir = defaultField();
  const nx = reservoir.grid.nx;
  const ny = reservoir.grid.ny;
  const cx = Math.floor(nx / 2);
  const cy = Math.floor(ny / 2);
  const offX = Math.floor(nx / 4);
  const offY = Math.floor(ny / 4);
  const wells: Well[] = [
    {
      type: 'producer',
      id: 'P1',
      i: cx,
      j: cy,
      bhpAtm: DEFAULT_WELL_CONTROLS.producerBHPAtm,
      rw: DEFAULT_WELL_RADIUS_M,
      skin: DEFAULT_SKIN,
      rateLimit: DEFAULT_WELL_CONTROLS.producerRateLimit,
    },
    {
      type: 'injector',
      id: 'I1',
      i: cx - offX,
      j: cy - offY,
      bhpAtm: DEFAULT_WELL_CONTROLS.injectorBHPAtm,
      rw: DEFAULT_WELL_RADIUS_M,
      skin: DEFAULT_SKIN,
      rateLimit: DEFAULT_WELL_CONTROLS.injectorRateLimit,
    },
    {
      type: 'injector',
      id: 'I2',
      i: cx + offX,
      j: cy - offY,
      bhpAtm: DEFAULT_WELL_CONTROLS.injectorBHPAtm,
      rw: DEFAULT_WELL_RADIUS_M,
      skin: DEFAULT_SKIN,
      rateLimit: DEFAULT_WELL_CONTROLS.injectorRateLimit,
    },
    {
      type: 'injector',
      id: 'I3',
      i: cx - offX,
      j: cy + offY,
      bhpAtm: DEFAULT_WELL_CONTROLS.injectorBHPAtm,
      rw: DEFAULT_WELL_RADIUS_M,
      skin: DEFAULT_SKIN,
      rateLimit: DEFAULT_WELL_CONTROLS.injectorRateLimit,
    },
    {
      type: 'injector',
      id: 'I4',
      i: cx + offX,
      j: cy + offY,
      bhpAtm: DEFAULT_WELL_CONTROLS.injectorBHPAtm,
      rw: DEFAULT_WELL_RADIUS_M,
      skin: DEFAULT_SKIN,
      rateLimit: DEFAULT_WELL_CONTROLS.injectorRateLimit,
    },
  ];
  return {
    name: 'inverted-5-spot',
    description: '1 продюсер в центре, 4 инжектора по углам (pressure support).',
    reservoir,
    wells,
    defaultDurationDays: 365,
  };
}
