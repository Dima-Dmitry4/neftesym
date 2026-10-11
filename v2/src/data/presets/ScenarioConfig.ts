// Общий тип для сценариев-пресетов.

import type { Reservoir } from '../../core/grid/Reservoir.ts';
import type { Well } from '../../core/wells/Well.ts';

export interface ScenarioConfig {
  /** Имя пресета (для логов). */
  name: string;
  /** Краткое описание. */
  description: string;
  /** Месторождение. */
  reservoir: Reservoir;
  /** Скважины. */
  wells: Well[];
  /** Длительность прогона по умолчанию, сут. */
  defaultDurationDays: number;
  /** Опционально: маска X-граней, блокированных разломом. */
  xFault?: Uint8Array;
  /** Опционально: маска Y-граней, блокированных разломом. */
  yFault?: Uint8Array;
}
