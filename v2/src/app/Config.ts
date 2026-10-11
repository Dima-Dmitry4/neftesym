// Конфиг приложения.
//
// Сейчас просто отдаёт DEFAULTS из data/defaultParameters.ts.
// В Phase 5 сюда добавится localStorage override для пользовательских
// настроек, но это не критично для Phase 2.

import { DEFAULTS } from '../data/defaultParameters.ts';
import type { FluidProperties } from '../core/properties/FluidProperties.ts';
import type { RockProperties } from '../core/properties/RockProperties.ts';
import type { RelPermParameters } from '../core/properties/RelativePermeability.ts';
import type { Grid2D } from '../core/grid/Grid2D.ts';

export interface AppConfig {
  grid: {
    nx: number;
    ny: number;
    dx: number;
    dy: number;
    depthTop: number;
  };
  fluid: FluidProperties;
  rock: RockProperties;
  relperm: RelPermParameters;
  wellControls: {
    producerBHPAtm: number;
    injectorBHPAtm: number;
    producerBHPMinAtm: number;
    injectorBHPMaxAtm: number;
    producerRateLimit: number;
    injectorRateLimit: number;
  };
  solver: {
    dtMaxHours: number;
    dtMinHours: number;
    cflTarget: number;
    cgTolerance: number;
    cgMaxIterations: number;
    pressureRelaxation: number;
    historyIntervalHours: number;
    /** Демпфер дрейфа P_avg, 0 < ω ≤ 1 (1 = без сглаживания). */
    pAvgDamping: number;
    /** Релаксация дебитов, 0 < ω ≤ 1 (1 = выключена). */
    rateRelaxation: number;
    /** Целевое изменение дебита за подшаг, доля мощности. */
    rateChangeTarget: number;
    /** Доля запаса (P_avg − BHP) на подшаг, 0 < f ≤ 1. */
    cflPressureFraction: number;
    /** Нижняя граница запаса до BHP, атм. */
    pressureMarginFloorAtm: number;
  };
  pressureModel: {
    radiusMode: 'dynamic' | 'fixed';
    fixedRadiusM: number;
    effectiveKMethod: 'mean-in-radius' | 'max-in-radius' | 'constant';
    constantKEffMD: number;
    totalCompressibilityAtmInv: number;
  };
  time: {
    startDateMs: number;
    realtimeSecondsPerSimDay: number;
    speedOptions: readonly number[];
  };
  ui: {
    cellSizePx: number;
    mapPaddingPx: number;
    chartPanelWidthPx: number;
  };
}

/** Загрузить конфиг. Сейчас — просто DEFAULTS. */
export function loadConfig(): AppConfig {
  const startIso = DEFAULTS.time.startDateIso;
  const startMs = Date.parse(startIso);
  if (Number.isNaN(startMs)) {
    throw new Error(`Invalid startDateIso in DEFAULTS: ${startIso}`);
  }
  return {
    grid: { ...DEFAULTS.grid },
    fluid: { ...DEFAULTS.fluid },
    rock: { ...DEFAULTS.rock },
    relperm: { ...DEFAULTS.relperm },
    wellControls: { ...DEFAULTS.wellControls },
    solver: { ...DEFAULTS.solver },
    pressureModel: { ...DEFAULTS.pressureModel },
    time: {
      startDateMs: startMs,
      realtimeSecondsPerSimDay: DEFAULTS.time.realtimeSecondsPerSimDay,
      speedOptions: [...DEFAULTS.time.speedOptions],
    },
    ui: { ...DEFAULTS.ui },
  };
}

/** Утилита: параметры для TimeStepper из конфига. */
export function stepperParamsFromConfig(cfg: AppConfig): {
  dtMaxHours: number;
  dtMinHours: number;
  cflTarget: number;
  cgTolerance: number;
  cgMaxIterations: number;
  crAtm: number;
  historyIntervalHours: number;
  pressureRelaxation: number;
} {
  return {
    dtMaxHours: cfg.solver.dtMaxHours,
    dtMinHours: cfg.solver.dtMinHours,
    cflTarget: cfg.solver.cflTarget,
    cgTolerance: cfg.solver.cgTolerance,
    cgMaxIterations: cfg.solver.cgMaxIterations,
    crAtm: cfg.rock.crAtm,
    historyIntervalHours: cfg.solver.historyIntervalHours,
    pressureRelaxation: cfg.solver.pressureRelaxation,
  };
}

/** Сигнатура-маркер: нельзя забыть подкинуть grid конфига в дефолтное поле. */
export function configGrid(_: Grid2D): boolean {
  return true;
}
