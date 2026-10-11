// Дефолтные параметры симуляции и UI.
//
// Все единицы — полевые метрические (см. core/units.ts).
// Источники типичных значений:
//   - plan.md §4 (дефолтное месторождение «Западно-Сибирский аналог»)
//   - реальные диапазоны для водо-смачиваемого песчаника

import type { FluidProperties } from '../core/properties/FluidProperties.ts';
import type { RockProperties } from '../core/properties/RockProperties.ts';
import type { RelPermParameters } from '../core/properties/RelativePermeability.ts';

/** Параметры дефолтной сетки 50×50 на 1×1 км. */
export const DEFAULT_GRID = {
  nx: 50,
  ny: 50,
  dx: 20, // м
  dy: 20, // м
  depthTop: 2800, // м (глубина кровли)
} as const;

/** Толщина пласта — однородная по умолчанию, меняется в defaultField. */
export const DEFAULT_THICKNESS_M = 15;

/** Давление. */
export const DEFAULT_PRESSURE_ATM = 245; // ~ 24 МПа, типично для Зап. Сибири

/** Начальная водонасыщенность — выше S_wc, чтобы нефть была подвижна. */
export const DEFAULT_INITIAL_SW = 0.25;

/** Радиус скважины (одинаков для producer и injector). */
export const DEFAULT_WELL_RADIUS_M = 0.1;

/** Скин-фактор по умолчанию. */
export const DEFAULT_SKIN = 0;

/** Свойства флюидов (in-situ). */
export const DEFAULT_FLUID: FluidProperties = {
  muOilCP: 3.0, // сП
  muWaterCP: 0.5, // сП
  rhoOilKgM3: 760, // кг/м³ (в пласте)
  rhoWaterKgM3: 1015, // кг/м³ (в пласте)
  rhoOilSurface: 850, // кг/м³ (поверхн., для пересчёта в т)
  coAtm: 1.0e-4, // атм⁻¹ (≈ 1e-9 Па⁻¹)
  cwAtm: 4.1e-5, // атм⁻¹ (≈ 4e-10 Па⁻¹)
  bo: 1.25, // м³/м³
  bw: 1.03, // м³/м³
};

/** Свойства породы. */
export const DEFAULT_ROCK: RockProperties = {
  porosity: 0.20, // доли
  permHMeanMD: 100, // мД
  permAnisotropy: 0.1, // k_v / k_h
  crAtm: 5.0e-5, // атм⁻¹ (≈ 5e-10 Па⁻¹)
};

/** ОФП (Corey, water-wet sandstone). */
export const DEFAULT_RELPERM: RelPermParameters = {
  swc: 0.20,
  sor: 0.30,
  kroMax: 0.85,
  krwMax: 0.30,
  nOil: 2.5,
  nWater: 3.0,
};

/** Дефолтные режимы скважин. */
export const DEFAULT_WELL_CONTROLS = {
  /** BHP продюсера по умолчанию (атм). */
  producerBHPAtm: 100,
  /** BHP инжектора по умолчанию (атм). */
  injectorBHPAtm: 290,
  /** Минимальный BHP продюсера (атм). */
  producerBHPMinAtm: 50,
  /** Максимальный BHP инжектора (атм). */
  injectorBHPMaxAtm: 350,
  /**
   * Лимит по дебиту жидкости (м³/сут) — 0 = без лимита.
   * Подобран под 5-spot 1×1 км без аквифера: 4 producer × 500 = 2000,
   * 1 injector = 2000. Маленький field (1.9e6 м³ порового) с такими rates
   * истощается за ~1.5 года, что хватает для учебной задачи.
   * Юзер может поднять через UI, но при отсутствии аквифера
   * система быстро выйдет на истощение.
   */
  producerRateLimit: 500,
  injectorRateLimit: 2000,
} as const;

/** Численные параметры решателя. */
export const DEFAULT_SOLVER = {
  /** Максимальный шаг по времени (ч). */
  dtMaxHours: 20, // 5 сут (было 720; уменьшено для стабильности)
  /** Минимальный шаг по времени (ч). */
  dtMinHours: 0.1,
  /** Целевое CFL-число (безразмерное). */
  cflTarget: 0.3,
  /** Допуск CG-решателя давления. */
  cgTolerance: 1e-6,
  /** Максимум итераций CG. */
  cgMaxIterations: 400,
  /** Коэффициент under-relaxation для P (0 < ω ≤ 1). 1 = без релаксации. */
  pressureRelaxation: 0.5,
  /** Интервал записи в history (ч). */
  historyIntervalHours: 1, // 1 сут
  /**
   * Демпфер дрейфа P_avg, 0 < ω ≤ 1.
   *
   * 1 = чистый материальный баланс (жёсткая реакция: при подходе P_avg
   * к BHP скважины дебит меняется рывком). Меньше 1 — инкремент P_avg
   * применяется частично, что сглаживает фронт и гасит предельный цикл
   * дебитов, не меняя установившегося тренда давления.
   *
   * 0.35 подобрано так, чтобы 5-spot и линейное заводнение давали
   * плавные графики при разном числе скважин.
   */
  pAvgDamping: 0.35,
  /**
   * Релаксация дебитов, 0 < ω ≤ 1.
   *
   * q_new = ω·q_solved + (1−ω)·q_prev.
   *
   * Дебиты в superposition-модели — мгновенная функция от P_avg, без
   * инерции. У порога включения (P_avg ≈ BHP) это даёт дребезг: скважина
   * щёлкает между 0 и полным rateLimit. Релаксация — стандартный приём
   * промысловых симуляторов (wellbore storage), она убирает дребезг и
   * не смещает установившийся режим.
   *
   * 1 = выключить. 0.5 — компромисс: реакция достаточно быстрая, чтобы
   * графики не «плыли», и достаточно инерционная, чтобы гасить chatter.
   */
  rateRelaxation: 0.5,
  /**
   * Целевое изменение дебита за подшаг, доля мощности скважины.
   * Управляет адаптивным дроблением шага: если фактическое изменение
   * дебитов больше цели, шаг уменьшается пропорционально.
   */
  rateChangeTarget: 0.2,
  /**
   * Доля от «запаса» (P_avg − BHP), израсходуемая за один подшаг.
   * Заставляет давление подходить к порогу асимптотически.
   */
  cflPressureFraction: 0.3,
  /** Нижняя граница запаса до BHP для этого ограничения, атм. */
  pressureMarginFloorAtm: 0.5,
} as const;

/** Параметры экономики (Phase 6). */
export const DEFAULT_ECONOMICS = {
  oilPriceUsdPerBarrel: 70,
  waterInjectionCostUsdPerM3: 3,
  opexPerWellPerMonthUsd: 80_000,
  capexPerWellUsd: 3_000_000,
  discountRateAnnual: 0.10,
  budgetUsd: 50_000_000,
} as const;

/** Параметры симуляции времени. */
export const DEFAULT_TIME = {
  /** Стартовая дата (для UI). */
  startDateIso: '2026-01-01T00:00:00Z',
  /** Базовая скорость (1x) — реальных секунд за 1 симуляционные сутки. */
  realtimeSecondsPerSimDay: 1.0,
  /** Доступные скорости (множители). */
  speedOptions: [0.25, 0.5, 1, 2, 5, 10, 30, 100] as const,
} as const;

/**
 * Параметры суперпозиционной модели давления (v2).
 *
 * R_e — радиус влияния скважины, в пределах которого сказывается её
 * воронка депрессии/нагнетания. Динамический режим (по умолчанию)
 * использует половину расстояния до ближайшего соседа/границы —
 * естественно адаптируется к плотности сетки скважин.
 *
 * c_t — полная сжимаемость системы (порода + флюид) для матбаланса.
 *   Типично: c_t ≈ 1e-4 атм⁻¹ (порода ~5e-5 + нефть ~1e-4 + вода ~4e-5
 *   при начальной S_w).
 *
 * effectiveKMethod — способ расчёта k_eff для радиальной задачи:
 *   'mean-in-radius' (default) — среднее k в круге R_e,
 *   'max-in-radius' — максимум k в круге (для трещиноватых коллекторов),
 *   'constant' — фиксированное значение (отключает гетерогенность).
 */
export const DEFAULT_PRESSURE_MODEL = {
  radiusMode: 'dynamic' as 'dynamic' | 'fixed',
  fixedRadiusM: 200,
  effectiveKMethod: 'mean-in-radius' as 'mean-in-radius' | 'max-in-radius' | 'constant',
  constantKEffMD: 100,
  /** Полная сжимаемость (rock + fluid), атм⁻¹. */
  totalCompressibilityAtmInv: 1e-4,
} as const;

/** Размеры UI (Phase 2+). */
export const DEFAULT_UI = {
  cellSizePx: 10,
  mapPaddingPx: 8,
  chartPanelWidthPx: 360,
} as const;

/** Объединённый объект дефолтов — для удобного импорта. */
export const DEFAULTS = {
  grid: DEFAULT_GRID,
  fluid: DEFAULT_FLUID,
  rock: DEFAULT_ROCK,
  relperm: DEFAULT_RELPERM,
  wellControls: DEFAULT_WELL_CONTROLS,
  solver: DEFAULT_SOLVER,
  pressureModel: DEFAULT_PRESSURE_MODEL,
  economics: DEFAULT_ECONOMICS,
  time: DEFAULT_TIME,
  ui: DEFAULT_UI,
} as const;
