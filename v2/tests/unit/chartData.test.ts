// Тесты для ChartData — извлечение серий из History.

import { describe, it, expect } from 'vitest';
import type { HistoryEntry } from '../../src/core/state/History.ts';
import {
  ratesSeries,
  cumulativeSeries,
  fieldMetricsSeries,
  wellRatesSeries,
  waterCutSeries,
  pressureAvgSeries,
  perWellOilRatesSeries,
  perWellWaterRatesSeries,
} from '../../src/ui/charts/ChartData.ts';

const OPTS = { bo: 1.25, rhoSurface: 850, ooipTons: 1_000_000 };

function makeEntry(t: number, oilTons = 100, cumWater = 10, cumInj = 5, cumOil = 200): {
  t: number;
  pAvg: number;
  swAvg: number;
  oilProdInterval: number;
  waterProdInterval: number;
  waterInjInterval: number;
  cumOil: number;
  cumWater: number;
  cumInj: number;
  cumOilTons: number;
  perWell: Array<{
    id: string;
    qOil: number;
    qWater: number;
    qLiq: number;
    waterCut: number;
    bhp: number;
  }>;
} {
  return {
    t,
    pAvg: 200,
    swAvg: 0.3,
    oilProdInterval: 0,
    waterProdInterval: 0,
    waterInjInterval: 0,
    cumOil,
    cumWater,
    cumInj,
    cumOilTons: oilTons,
    perWell: [
      { id: 'P1', qOil: 50, qWater: 5, qLiq: 55, waterCut: 0.1, bhp: 100 },
      { id: 'I1', qOil: 0, qWater: -100, qLiq: -100, waterCut: 0, bhp: 290 },
    ],
  };
}

describe('ChartData.ratesSeries', () => {
  it('возвращает 2 серии (Q нефти, Q воды) с правильными точками', () => {
    const entries = [makeEntry(0), makeEntry(100)];
    const [oil, water] = ratesSeries(entries, OPTS);
    expect(oil).toBeDefined();
    expect(water).toBeDefined();
    if (!oil || !water) return;
    expect(oil.name).toContain('нефти');
    expect(water.name).toContain('воды');
    // 50 м³/сут reservoir / 1.25 * 850/1000 = 34 т/сут
    expect(oil.points[0]?.y).toBeCloseTo(34, 1);
    expect(oil.points[0]?.x).toBe(0);
    expect(water.points[0]?.y).toBe(5);
  });
});

describe('ChartData.cumulativeSeries', () => {
  it('возвращает 3 серии с накопленными значениями', () => {
    const entries = [makeEntry(0, 100, 10, 5, 200), makeEntry(100, 200, 25, 12, 400)];
    const [oilT, waterT, injT] = cumulativeSeries(entries);
    expect(oilT).toBeDefined();
    expect(waterT).toBeDefined();
    expect(injT).toBeDefined();
    if (!oilT || !waterT || !injT) return;
    expect(oilT.points[0]?.y).toBe(100);
    expect(oilT.points[1]?.y).toBe(200);
    expect(waterT.points[0]?.y).toBe(10);
    expect(waterT.points[1]?.y).toBe(25);
    expect(injT.points[1]?.y).toBe(12);
  });
});

describe('ChartData.fieldMetricsSeries', () => {
  it('КИН = cumOilTons / ooipTons * 100', () => {
    const entries = [makeEntry(0, 50_000, 10, 5)];
    const [kin] = fieldMetricsSeries(entries, OPTS);
    expect(kin).toBeDefined();
    if (!kin) return;
    // 50000 / 1_000_000 * 100 = 5%
    expect(kin.points[0]?.y).toBeCloseTo(5, 6);
  });
  it('VRR = cumInj / cumWater (при наличии production)', () => {
    const entries = [makeEntry(0, 100, 50, 100)];
    const [, vrr] = fieldMetricsSeries(entries, OPTS);
    expect(vrr).toBeDefined();
    if (!vrr) return;
    expect(vrr.points[0]?.y).toBeCloseTo(2, 6);
  });
  it('VRR = 0 при отсутствии production', () => {
    const entries = [makeEntry(0, 0, 0, 100)];
    const [, vrr] = fieldMetricsSeries(entries, OPTS);
    expect(vrr).toBeDefined();
    if (!vrr) return;
    expect(vrr.points[0]?.y).toBe(0);
  });
});

describe('ChartData.wellRatesSeries', () => {
  it('возвращает q_oil, q_water для выбранной скважины', () => {
    const entries = [makeEntry(0)];
    const [oil, water] = wellRatesSeries(entries, 'P1', OPTS);
    expect(oil).toBeDefined();
    expect(water).toBeDefined();
    if (!oil || !water) return;
    // 50 м³/сут / 1.25 * 850/1000 = 34 т/сут
    expect(oil.points[0]?.y).toBeCloseTo(34, 1);
    expect(water.points[0]?.y).toBe(5);
  });
  it('возвращает 0 для несуществующей скважины', () => {
    const entries = [makeEntry(0)];
    const [oil] = wellRatesSeries(entries, 'NOPE', OPTS);
    expect(oil).toBeDefined();
    if (!oil) return;
    expect(oil.points[0]?.y).toBe(0);
  });
});

describe('ChartData.waterCutSeries', () => {
  it('WC = qWater / qLiq * 100, в процентах', () => {
    // qOil=50, qWater=5, qLiq=55 → WC = 5/55*100 ≈ 9.09%
    const entries = [makeEntry(0)];
    const [wc] = waterCutSeries(entries);
    expect(wc).toBeDefined();
    if (!wc) return;
    expect(wc.points[0]?.y).toBeCloseTo(5 / 55 * 100, 1);
  });
  it('WC = 0 при отсутствии production', () => {
    // Только injector, без producer → qLiq = 0
    const noProd: HistoryEntry = {
      t: 0,
      pAvg: 200,
      swAvg: 0.3,
      oilProdInterval: 0,
      waterProdInterval: 0,
      waterInjInterval: 0,
      cumOil: 0,
      cumWater: 0,
      cumInj: 100,
      cumOilTons: 0,
      perWell: [
        { id: 'I1', qOil: 0, qWater: -100, qLiq: -100, waterCut: 0, bhp: 290 },
      ],
    };
    const [wc] = waterCutSeries([noProd]);
    expect(wc).toBeDefined();
    if (!wc) return;
    expect(wc.points[0]?.y).toBe(0);
  });
});

describe('ChartData.pressureAvgSeries', () => {
  it('возвращает P_avg из history', () => {
    const entries = [makeEntry(0)];
    entries[0]!.pAvg = 195.5;
    const [p] = pressureAvgSeries(entries);
    expect(p).toBeDefined();
    if (!p) return;
    expect(p.points[0]?.y).toBe(195.5);
    expect(p.points[0]?.x).toBe(0);
  });
});

describe('ChartData.perWellOilRatesSeries', () => {
  it('создаёт по серии на каждую скважину', () => {
    const entries = [makeEntry(0)];
    const series = perWellOilRatesSeries(entries, ['P1', 'I1'], OPTS);
    expect(series).toHaveLength(2);
    expect(series[0]?.name).toBe('P1');
    expect(series[1]?.name).toBe('I1');
    // P1: 50 м³/сут → 34 т/сут
    expect(series[0]?.points[0]?.y).toBeCloseTo(34, 1);
    // I1: qOil = 0
    expect(series[1]?.points[0]?.y).toBe(0);
  });
  it('каждая серия получает свой цвет', () => {
    const entries = [makeEntry(0)];
    const series = perWellOilRatesSeries(entries, ['A', 'B', 'C'], OPTS);
    const colors = series.map((s) => s.color);
    expect(new Set(colors).size).toBe(3);
  });
  it('пустой список скважин → пустой массив серий', () => {
    const entries = [makeEntry(0)];
    expect(perWellOilRatesSeries(entries, [], OPTS)).toHaveLength(0);
  });
});

describe('ChartData.perWellWaterRatesSeries', () => {
  it('возвращает модуль qWater для producer и injector', () => {
    const entries = [makeEntry(0)];
    // P1.qWater = 5 (producer, добыча), I1.qWater = -100 (injector, закачка)
    const series = perWellWaterRatesSeries(entries, ['P1', 'I1']);
    expect(series[0]?.points[0]?.y).toBe(5);
    expect(series[1]?.points[0]?.y).toBe(100); // abs
  });
});
