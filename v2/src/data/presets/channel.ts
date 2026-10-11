// Channel: месторождение с «sandy channel» (полосой повышенной
// проницаемости). 1 инжектор на одном конце канала, 1 продюсер —
// на другом. Вода «прорывается» через канал.

import { generateDefaultField } from '../defaultField.ts';
import {
  DEFAULT_WELL_CONTROLS,
  DEFAULT_WELL_RADIUS_M,
  DEFAULT_SKIN,
} from '../defaultParameters.ts';
import type { Well } from '../../core/wells/Well.ts';
import type { ScenarioConfig } from './ScenarioConfig.ts';

export function channelScenario(): ScenarioConfig {
  const reservoir = generateDefaultField({ seed: 42 });
  const nx = reservoir.grid.nx;
  const ny = reservoir.grid.ny;
  // Повысим проницаемость в горизонтальной полосе (channel).
  for (let idx = 0; idx < reservoir.permX.length; idx++) {
    const i = idx % nx;
    const j = Math.floor(idx / nx);
    // Канал — горизонтальная полоса вокруг j = ny/2 ± 4. ×2 множитель
    // (выше дефолтного 1000 мД, но rateLimit всё равно обрежет).
    if (Math.abs(j - Math.floor(ny / 2)) <= 4) {
      const cur = reservoir.permX[idx] ?? 0;
      reservoir.permX[idx] = cur * 2;
      reservoir.permY[idx] = cur * 2;
    }
    void i;
  }
  // Скважины: инжектор слева, продюсер справа, в канале.
  const cy = Math.floor(ny / 2);
  const wells: Well[] = [
    {
      type: 'injector',
      id: 'I1',
      i: Math.floor(nx * 0.15),
      j: cy,
      bhpAtm: DEFAULT_WELL_CONTROLS.injectorBHPAtm,
      rw: DEFAULT_WELL_RADIUS_M,
      skin: DEFAULT_SKIN,
      rateLimit: DEFAULT_WELL_CONTROLS.injectorRateLimit,
    },
    {
      type: 'producer',
      id: 'P1',
      i: Math.floor(nx * 0.85),
      j: cy,
      bhpAtm: DEFAULT_WELL_CONTROLS.producerBHPAtm,
      rw: DEFAULT_WELL_RADIUS_M,
      skin: DEFAULT_SKIN,
      rateLimit: DEFAULT_WELL_CONTROLS.producerRateLimit,
    },
  ];
  return {
    name: 'channel',
    description: 'Sandy channel: вода прорывается по каналу высокой k.',
    reservoir,
    wells,
    defaultDurationDays: 365,
  };
}
