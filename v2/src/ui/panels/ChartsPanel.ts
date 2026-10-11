// ChartsPanel — основная панель динамических показателей.
//
// Содержит 6 графиков в сетке 2×3 (или 3×2 на широком экране):
//   1) Дебиты (Q нефти т/сут, Q воды м³/сут)
//   2) Обводнённость (WC %)
//   3) P среднее (атм)
//   4) Накопленная добыча / закачка
//   5) КИН + VRR
//   6) Per-well дебиты нефти
//
// Подписывается на `stateUpdated`, `wellsChanged`, `scenarioLoaded`
// из EventBus. На каждое обновление пересчитывает серии из
// `engine.getHistory()` и обновляет LineChart'ы.

import type { EventBus } from '../../app/EventBus.ts';
import type { SimulationEngine } from '../../app/SimulationEngine.ts';
import { LineChart } from '../charts/LineChart.ts';
import {
  ratesSeries,
  cumulativeSeries,
  fieldMetricsSeries,
  waterCutSeries,
  pressureAvgSeries,
  perWellOilRatesSeries,
  type ChartDataOptions,
} from '../charts/ChartData.ts';
import { DEFAULTS } from '../../data/defaultParameters.ts';
import type { Reservoir } from '../../core/grid/Reservoir.ts';
import type { FluidProperties } from '../../core/properties/FluidProperties.ts';
import type { HistoryEntry } from '../../core/state/History.ts';

export class ChartsPanel {
  private readonly eventBus: EventBus;
  private readonly engine: SimulationEngine;
  private readonly charts: Record<string, LineChart> = {};
  private readonly disposers: Array<() => void> = [];
  private wellIds: readonly string[] = [];

  constructor(root: HTMLElement, eventBus: EventBus, engine: SimulationEngine) {
    this.eventBus = eventBus;
    this.engine = engine;

    root.innerHTML = `
      <div class="charts-grid">
        <div class="chart-block"><canvas data-chart="rates" class="chart-canvas"></canvas></div>
        <div class="chart-block"><canvas data-chart="watercut" class="chart-canvas"></canvas></div>
        <div class="chart-block"><canvas data-chart="pressure" class="chart-canvas"></canvas></div>
        <div class="chart-block"><canvas data-chart="cumul" class="chart-canvas"></canvas></div>
        <div class="chart-block"><canvas data-chart="metrics" class="chart-canvas"></canvas></div>
        <div class="chart-block"><canvas data-chart="perwell" class="chart-canvas"></canvas></div>
      </div>
    `;

    const selectors: Record<string, { title: string; yUnit: string }> = {
      rates: { title: 'Дебиты (суммарно по месторождению)', yUnit: 'т/сут, м³/сут' },
      watercut: { title: 'Обводнённость (Water Cut)', yUnit: '%' },
      pressure: { title: 'Среднее пластовое давление', yUnit: 'атм' },
      cumul: { title: 'Накопленная добыча / закачка', yUnit: 'т, м³' },
      metrics: { title: 'КИН и VRR', yUnit: '%, -' },
      perwell: { title: 'Дебит нефти по скважинам', yUnit: 'т/сут' },
    };

    for (const [key, sel] of Object.entries(selectors)) {
      const canvas = root.querySelector<HTMLCanvasElement>(`[data-chart="${key}"]`);
      if (!canvas) throw new Error(`[ChartsPanel] canvas for "${key}" not found`);
      const chart = new LineChart(canvas);
      chart.setTitle(sel.title);
      chart.setYUnit(sel.yUnit);
      this.charts[key] = chart;
    }

    this.attachListeners();
    this.refresh();
  }

  private attachListeners(): void {
    const offState = this.eventBus.on('stateUpdated', () => this.refresh());
    const offWells = this.eventBus.on('wellsChanged', (wells) => {
      this.wellIds = wells.map((w) => w.id);
      this.refresh();
    });
    const offScenario = this.eventBus.on('scenarioLoaded', (s) => {
      this.wellIds = s.wells.map((w) => w.id);
      this.refresh();
    });
    this.disposers.push(offState, offWells, offScenario);
  }

  private getChartOpts(): { entries: readonly HistoryEntry[]; opts: ChartDataOptions } {
    const eng = this.engine as unknown as {
      getReservoir?: () => Reservoir;
      getHistory?: () => { all: () => readonly HistoryEntry[] };
    };
    let reservoir: Reservoir | null = null;
    if (typeof eng.getReservoir === 'function') {
      try {
        reservoir = eng.getReservoir();
      } catch {
        reservoir = null;
      }
    }
    let entries: readonly HistoryEntry[] = [];
    if (typeof eng.getHistory === 'function') {
      try {
        entries = eng.getHistory().all();
      } catch {
        entries = [];
      }
    }
    if (!reservoir) {
      return {
        entries,
        opts: {
          bo: DEFAULTS.fluid.bo,
          rhoSurface: DEFAULTS.fluid.rhoOilSurface,
          ooipTons: 0,
        },
      };
    }
    const phi = reservoir.porosity;
    const sw0 = reservoir.initialSw;
    const h = reservoir.thickness;
    const grid = reservoir.grid;
    let ooip = 0;
    for (let i = 0; i < phi.length; i++) {
      if (!reservoir.active[i]) continue;
      const v = (phi[i] ?? 0) * (h[i] ?? 0) * grid.dx * grid.dy;
      ooip += v * (1 - (sw0[i] ?? 0));
    }
    const fluid: FluidProperties = DEFAULTS.fluid;
    const ooipTons = (ooip / fluid.bo) * fluid.rhoOilSurface / 1000;
    return {
      entries,
      opts: { bo: fluid.bo, rhoSurface: fluid.rhoOilSurface, ooipTons },
    };
  }

  refresh(): void {
    const data = this.getChartOpts();
    const { entries, opts } = data;

    this.charts['rates']?.setData(ratesSeries(entries, opts));
    this.charts['watercut']?.setData(waterCutSeries(entries));
    this.charts['pressure']?.setData(pressureAvgSeries(entries));
    this.charts['cumul']?.setData(cumulativeSeries(entries));
    this.charts['metrics']?.setData(fieldMetricsSeries(entries, opts));
    this.charts['perwell']?.setData(perWellOilRatesSeries(entries, this.wellIds, opts));
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    for (const chart of Object.values(this.charts)) {
      chart.dispose();
    }
  }
}
