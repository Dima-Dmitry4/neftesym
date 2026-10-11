// Реестр пресетов: name → сценарий.

import { fiveSpotScenario } from './fiveSpot.ts';
import { invertedFiveSpotScenario } from './invertedFiveSpot.ts';
import { lineDriveScenario } from './lineDrive.ts';
import { channelScenario } from './channel.ts';
import { faultBlockScenario } from './faultBlock.ts';
import { emptyScenario } from './empty.ts';
import type { ScenarioConfig } from './ScenarioConfig.ts';

export type ScenarioName =
  | 'five-spot'
  | 'inverted-five-spot'
  | 'line-drive'
  | 'channel'
  | 'fault-block'
  | 'empty';

export const PRESETS: Record<ScenarioName, () => ScenarioConfig> = {
  'five-spot': fiveSpotScenario,
  'inverted-five-spot': invertedFiveSpotScenario,
  'line-drive': lineDriveScenario,
  'channel': channelScenario,
  'fault-block': faultBlockScenario,
  'empty': emptyScenario,
};

export const PRESET_NAMES: ScenarioName[] = [
  'five-spot',
  'inverted-five-spot',
  'line-drive',
  'channel',
  'fault-block',
  'empty',
];

export function getScenario(name: string): ScenarioConfig {
  if (name in PRESETS) {
    return PRESETS[name as ScenarioName]();
  }
  throw new Error(
    `Unknown preset: ${name}. Available: ${PRESET_NAMES.join(', ')}`,
  );
}
