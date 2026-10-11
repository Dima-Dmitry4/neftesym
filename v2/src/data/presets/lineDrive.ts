// Line drive: 1 линия инжекторов, параллельная линия продюсеров.

import { defaultField } from '../defaultField.ts';
import {
  DEFAULT_WELL_CONTROLS,
  DEFAULT_WELL_RADIUS_M,
  DEFAULT_SKIN,
} from '../defaultParameters.ts';
import type { Well } from '../../core/wells/Well.ts';
import type { ScenarioConfig } from './ScenarioConfig.ts';

export function lineDriveScenario(): ScenarioConfig {
  const reservoir = defaultField();
  const nx = reservoir.grid.nx;
  const ny = reservoir.grid.ny;
  // Две горизонтальные линии: продюсеры сверху, инжекторы снизу.
  const prodJ = Math.floor(ny * 0.25);
  const injJ = Math.floor(ny * 0.75);
  const wells: Well[] = [];
  // 4 продюсера с шагом по x.
  for (let n = 0; n < 4; n++) {
    const i = Math.floor((nx * (n + 1)) / 5);
    wells.push({
      type: 'producer',
      id: `P${n + 1}`,
      i,
      j: prodJ,
      bhpAtm: DEFAULT_WELL_CONTROLS.producerBHPAtm,
      rw: DEFAULT_WELL_RADIUS_M,
      skin: DEFAULT_SKIN,
      rateLimit: DEFAULT_WELL_CONTROLS.producerRateLimit,
    });
  }
  // 4 инжектора.
  for (let n = 0; n < 4; n++) {
    const i = Math.floor((nx * (n + 1)) / 5);
    wells.push({
      type: 'injector',
      id: `I${n + 1}`,
      i,
      j: injJ,
      bhpAtm: DEFAULT_WELL_CONTROLS.injectorBHPAtm,
      rw: DEFAULT_WELL_RADIUS_M,
      skin: DEFAULT_SKIN,
      rateLimit: DEFAULT_WELL_CONTROLS.injectorRateLimit,
    });
  }
  return {
    name: 'line-drive',
    description: 'Линейное заводнение: 1 ряд продюсеров + 1 ряд инжекторов.',
    reservoir,
    wells,
    defaultDurationDays: 365,
  };
}
