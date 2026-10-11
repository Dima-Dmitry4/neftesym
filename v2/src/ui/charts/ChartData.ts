// ChartData — извлечение временных рядов из History.
//
// Конвертирует `HistoryEntry[]` в `ChartSeries[]` для LineChart.
// Все значения — в полевых метрических единицах.

import type { HistoryEntry } from '../../core/state/History.ts';
import type { ChartSeries } from './LineChart.ts';
import { resOilRateToTons } from '../../core/units.ts';

const PRODUCER_COLOR = '#d4a04a';
const WATER_COLOR = '#3b6ea5';
const KIN_COLOR = '#5fb37a';
const VRR_COLOR = '#c2a050';
const OIL_TONS_COLOR = '#d4a04a';
const WATER_INJ_COLOR = '#3b6ea5';
const PRESSURE_COLOR = '#9aa3b0';

// Палитра для per-well линий (циклически).
const WELL_PALETTE = [
  '#d4a04a', // нефть (producer)
  '#3b6ea5', // вода (injector)
  '#5fb37a', // зелёный
  '#c87f5a', // терракот
  '#a87fd0', // сирень
  '#d0c45a', // горчичный
  '#5ab5c2', // бирюза
  '#c25a92', // розовый
];

export interface ChartDataOptions {
  /** Объёмный коэффициент нефти, для пересчёта м³ → т. */
  bo: number;
  /** Плотность нефти на поверхности, кг/м³. */
  rhoSurface: number;
  /** Начальные геологические запасы (OOIP), т. */
  ooipTons: number;
}

/** Суммарные по месторождению: дебиты нефти и воды (т/сут, м³/сут). */
export function ratesSeries(entries: readonly HistoryEntry[], opts: ChartDataOptions): ChartSeries[] {
  const oilTonsPts = entries.map((e) => {
    const totalQOil = e.perWell
      .filter((w) => w.qLiq > 0)
      .reduce((s, w) => s + w.qOil, 0);
    const tonsPerDay = resOilRateToTons(totalQOil, opts.bo, opts.rhoSurface);
    return { x: e.t, y: tonsPerDay };
  });
  const waterM3Pts = entries.map((e) => {
    const totalQWater = e.perWell
      .filter((w) => w.qLiq > 0)
      .reduce((s, w) => s + w.qWater, 0);
    return { x: e.t, y: totalQWater };
  });
  return [
    { name: 'Q нефти (т/сут)', color: PRODUCER_COLOR, points: oilTonsPts },
    { name: 'Q воды (м³/сут)', color: WATER_COLOR, points: waterM3Pts },
  ];
}

/** Обводнённость (water cut) — доля воды в добыче жидкости, %.
 *  Считается только по producer'ам (qLiq > 0). */
export function waterCutSeries(entries: readonly HistoryEntry[]): ChartSeries[] {
  const pts = entries.map((e) => {
    let totalLiq = 0;
    let totalW = 0;
    for (const w of e.perWell) {
      if (w.qLiq <= 0) continue; // только producer
      totalLiq += w.qLiq;
      totalW += w.qWater;
    }
    const wc = totalLiq > 0 ? (totalW / totalLiq) * 100 : 0;
    return { x: e.t, y: wc };
  });
  return [{ name: 'Обводнённость (%)', color: WATER_COLOR, points: pts }];
}

/** Среднее пластовое давление (атм). */
export function pressureAvgSeries(entries: readonly HistoryEntry[]): ChartSeries[] {
  return [
    {
      name: 'P среднее (атм)',
      color: PRESSURE_COLOR,
      points: entries.map((e) => ({ x: e.t, y: e.pAvg })),
    },
  ];
}

/** Накопленные: добыча нефти, добыча воды, закачка воды. */
export function cumulativeSeries(entries: readonly HistoryEntry[]): ChartSeries[] {
  return [
    {
      name: 'Добыча нефти (т)',
      color: OIL_TONS_COLOR,
      points: entries.map((e) => ({ x: e.t, y: e.cumOilTons })),
    },
    {
      name: 'Добыча воды (м³)',
      color: WATER_COLOR,
      points: entries.map((e) => ({ x: e.t, y: e.cumWater })),
    },
    {
      name: 'Закачка (м³)',
      color: WATER_INJ_COLOR,
      points: entries.map((e) => ({ x: e.t, y: e.cumInj })),
    },
  ];
}

/** КИН и VRR. */
export function fieldMetricsSeries(
  entries: readonly HistoryEntry[],
  opts: ChartDataOptions,
): ChartSeries[] {
  const kinPts = entries.map((e) => {
    const kin = opts.ooipTons > 0 ? e.cumOilTons / opts.ooipTons : 0;
    return { x: e.t, y: kin * 100 };
  });
  const vrrPts = entries.map((e) => {
    const produced = e.cumWater; // reservoir m³ produced
    const injected = e.cumInj;
    const vrr = produced > 0 ? injected / produced : 0;
    return { x: e.t, y: vrr };
  });
  return [
    { name: 'КИН (%)', color: KIN_COLOR, points: kinPts },
    { name: 'VRR', color: VRR_COLOR, points: vrrPts },
  ];
}

/** Per-well rates для выбранной скважины. */
export function wellRatesSeries(
  entries: readonly HistoryEntry[],
  wellId: string,
  opts: ChartDataOptions,
): ChartSeries[] {
  const oilTonsPts = entries.map((e) => {
    const w = e.perWell.find((x) => x.id === wellId);
    if (!w) return { x: e.t, y: 0 };
    return { x: e.t, y: resOilRateToTons(w.qOil, opts.bo, opts.rhoSurface) };
  });
  const waterM3Pts = entries.map((e) => {
    const w = e.perWell.find((x) => x.id === wellId);
    return { x: e.t, y: w ? w.qWater : 0 };
  });
  return [
    { name: 'Q нефти (т/сут)', color: PRODUCER_COLOR, points: oilTonsPts },
    { name: 'Q воды (м³/сут)', color: WATER_COLOR, points: waterM3Pts },
  ];
}

/** BHP (забойное давление) одной скважины по времени, атм. */
export function bhpSeries(
  entries: readonly HistoryEntry[],
  wellId: string,
): { x: number; y: number }[] {
  return entries.map((e) => {
    const w = e.perWell.find((x) => x.id === wellId);
    return { x: e.t, y: w ? w.bhp : 0 };
  });
}

/** Дебиты нефти по каждой скважине (одна серия на скважину, т/сут). */
export function perWellOilRatesSeries(
  entries: readonly HistoryEntry[],
  wellIds: readonly string[],
  opts: ChartDataOptions,
): ChartSeries[] {
  return wellIds.map((id, idx) => {
    const color = WELL_PALETTE[idx % WELL_PALETTE.length] ?? PRODUCER_COLOR;
    const pts = entries.map((e) => {
      const w = e.perWell.find((x) => x.id === id);
      return { x: e.t, y: w ? resOilRateToTons(w.qOil, opts.bo, opts.rhoSurface) : 0 };
    });
    return { name: id, color, points: pts };
  });
}

/** Дебиты воды по каждой скважине (м³/сут, producer + injector). */
export function perWellWaterRatesSeries(
  entries: readonly HistoryEntry[],
  wellIds: readonly string[],
): ChartSeries[] {
  return wellIds.map((id, idx) => {
    const color = WELL_PALETTE[idx % WELL_PALETTE.length] ?? WATER_COLOR;
    const pts = entries.map((e) => {
      const w = e.perWell.find((x) => x.id === id);
      // qWater > 0 для producer, < 0 для injector. Возьмём модуль.
      return { x: e.t, y: w ? Math.abs(w.qWater) : 0 };
    });
    return { name: id, color, points: pts };
  });
}
