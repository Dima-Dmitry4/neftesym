// Empty field: дефолтное месторождение без скважин.

import { defaultField } from '../defaultField.ts';
import type { ScenarioConfig } from './ScenarioConfig.ts';

export function emptyScenario(): ScenarioConfig {
  const reservoir = defaultField();
  return {
    name: 'empty',
    description: 'Пустое месторождение. Скважины добавляются вручную.',
    reservoir,
    wells: [],
    defaultDurationDays: 365,
  };
}
