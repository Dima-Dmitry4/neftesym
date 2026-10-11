// Fault block: месторождение с разломом (вертикальная линия
// нулевой transmissibility). Скважины по разные стороны от разлома.

import { generateDefaultField } from '../defaultField.ts';
import { faultBarrier } from '../../core/grid/Contour.ts';
import {
  DEFAULT_WELL_CONTROLS,
  DEFAULT_WELL_RADIUS_M,
  DEFAULT_SKIN,
} from '../defaultParameters.ts';
import type { Well } from '../../core/wells/Well.ts';
import type { ScenarioConfig } from './ScenarioConfig.ts';

export function faultBlockScenario(): ScenarioConfig {
  const reservoir = generateDefaultField({ seed: 42 });
  // Разлом: вертикальная линия через центр.
  const x1 = reservoir.grid.dx * reservoir.grid.nx * 0.5;
  const y1 = 0;
  const x2 = x1;
  const y2 = reservoir.grid.dy * reservoir.grid.ny;
  const barriers = faultBarrier(reservoir.grid, x1, y1, x2, y2, reservoir.grid.dx);
  // Скважины по разные стороны.
  const nx = reservoir.grid.nx;
  const ny = reservoir.grid.ny;
  const cy = Math.floor(ny / 2);
  const wells: Well[] = [
    {
      type: 'injector',
      id: 'I1',
      i: Math.floor(nx * 0.25),
      j: cy,
      bhpAtm: DEFAULT_WELL_CONTROLS.injectorBHPAtm,
      rw: DEFAULT_WELL_RADIUS_M,
      skin: DEFAULT_SKIN,
      rateLimit: DEFAULT_WELL_CONTROLS.injectorRateLimit,
    },
    {
      type: 'producer',
      id: 'P1',
      i: Math.floor(nx * 0.75),
      j: cy,
      bhpAtm: DEFAULT_WELL_CONTROLS.producerBHPAtm,
      rw: DEFAULT_WELL_RADIUS_M,
      skin: DEFAULT_SKIN,
      rateLimit: DEFAULT_WELL_CONTROLS.producerRateLimit,
    },
  ];
  return {
    name: 'fault-block',
    description: 'Разлом — барьер между двумя half-blocks.',
    reservoir,
    wells,
    defaultDurationDays: 365,
    xFault: barriers.xFaces,
    yFault: barriers.yFaces,
  };
}
