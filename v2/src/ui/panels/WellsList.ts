// WellsList — нижняя панель с карточками скважин.
//
// Каждая карточка: ID, тип, BHP-слайдер, sparkline BHP-истории,
// текущие q и water cut, кнопка удаления.
// Реактивно перерисовывается при wellsChanged.

import type { EventBus } from '../../app/EventBus.ts';
import type { SimulationEngine } from '../../app/SimulationEngine.ts';
import type { Well, Producer, Injector } from '../../core/wells/Well.ts';
import { applyWells } from '../../core/wells/BHPControl.ts';
import type { WellState } from '../../core/wells/BHPControl.ts';
import { Sparkline } from '../charts/Sparkline.ts';
import { bhpSeries } from '../charts/ChartData.ts';

export class WellsList {
  private readonly root: HTMLElement;
  private readonly eventBus: EventBus;
  private readonly engine: SimulationEngine;
  private readonly disposers: Array<() => void> = [];
  private wells: readonly Well[] = [];
  /** Последние вычисленные wellStates (на каждый кадр). */
  private lastWellStates: ReadonlyMap<string, WellState> = new Map();
  /** Sparkline'ы BHP по скважинам. */
  private readonly sparklines: Map<string, Sparkline> = new Map();
  /** Throttle для перерисовки sparkline'ов — 4 раза в секунду. */
  private lastSparklineTick = 0;
  /** Throttle для rates — 4 раза в секунду. */
  private lastRatesTick = 0;

  constructor(container: HTMLElement, eventBus: EventBus, engine: SimulationEngine) {
    this.root = container;
    this.eventBus = eventBus;
    this.engine = engine;
    this.wells = engine.getWells();
    this.wire();
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    for (const sl of this.sparklines.values()) sl.dispose();
    this.sparklines.clear();
    this.root.innerHTML = '';
  }

  private wire(): void {
    this.disposers.push(
      this.eventBus.on('wellsChanged', (w) => {
        this.wells = w;
        this.render();
      }),
      this.eventBus.on('stateUpdated', () => {
        this.recomputeWellStates();
        this.throttledRefresh();
      }),
      this.eventBus.on('scenarioLoaded', () => {
        this.render();
      }),
    );
    this.recomputeWellStates();
    this.render();
  }

  private recomputeWellStates(): void {
    const reservoir = this.engine.getReservoir();
    const state = this.engine.getState();
    const res = applyWells(
      reservoir,
      state.pressure,
      state.sw,
      this.wells,
      this.engine.getConfig().relperm,
      this.engine.getConfig().fluid,
    );
    this.lastWellStates = new Map(res.states.map((s) => [s.wellId, s] as const));
  }

  private throttledRefresh(): void {
    const now = performance.now();
    // rates: 4 Hz
    if (now - this.lastRatesTick >= 250) {
      this.lastRatesTick = now;
      this.refreshRates();
    }
    // sparklines: 4 Hz
    if (now - this.lastSparklineTick >= 250) {
      this.lastSparklineTick = now;
      this.refreshSparklines();
    }
  }

  private render(): void {
    // dispose old sparklines
    for (const sl of this.sparklines.values()) sl.dispose();
    this.sparklines.clear();

    this.root.innerHTML = '';
    if (this.wells.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'wells-empty';
      empty.textContent = 'Скважин нет — кликните по карте для добавления (P — продюсер, I — инжектор).';
      this.root.appendChild(empty);
      return;
    }
    for (const w of this.wells) {
      this.root.appendChild(this.createCard(w));
    }
  }

  private createCard(w: Well): HTMLElement {
    const cfg = this.engine.getConfig().wellControls;
    const isProducer = w.type === 'producer';
    const bhp = (w as Producer | Injector).bhpAtm;
    const min = isProducer ? cfg.producerBHPMinAtm : 50;
    const max = isProducer ? Math.min(cfg.injectorBHPMaxAtm, 350) : cfg.injectorBHPMaxAtm;
    const step = 1;

    const card = document.createElement('div');
    card.className = `well-card ${w.type}`;
    card.dataset['wellId'] = w.id;
    card.innerHTML = `
      <div class="well-head">
        <span class="well-name">${w.id}</span>
        <span class="well-type">${isProducer ? 'продюсер' : 'инжектор'}</span>
        <button class="well-remove" title="Удалить (Delete)">×</button>
      </div>
      <label class="bhp-row">
        <span class="bhp-label">БЗД: <span class="bhp-value">${bhp.toFixed(0)} атм</span></span>
        <input class="bhp-slider" type="range" min="${min}" max="${max}" step="${step}" value="${bhp}" />
      </label>
      <div class="bhp-history">
        <span class="bhp-history-label">БЗД(t):</span>
        <canvas class="bhp-sparkline" data-bhp-sparkline></canvas>
      </div>
      <div class="well-stats">
        <span data-rate>q: —</span>
        <span data-wc>WC: —</span>
      </div>
    `;

    const slider = card.querySelector<HTMLInputElement>('.bhp-slider');
    const bhpValueEl = card.querySelector<HTMLElement>('.bhp-value');
    if (slider) {
      slider.addEventListener('input', () => {
        const v = Number(slider.value);
        this.engine.updateBhp(w.id, v);
        if (bhpValueEl) bhpValueEl.textContent = `${v.toFixed(0)} атм`;
      });
    }
    const removeBtn = card.querySelector<HTMLButtonElement>('.well-remove');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        this.engine.removeWell(w.id);
      });
    }

    // Sparkline BHP-истории
    const sparkCanvas = card.querySelector<HTMLCanvasElement>('[data-bhp-sparkline]');
    if (sparkCanvas) {
      const color = isProducer ? '#d4a04a' : '#3b6ea5';
      const sl = new Sparkline(sparkCanvas, {
        color,
        fillColor: isProducer ? 'rgba(212, 160, 74, 0.12)' : 'rgba(59, 110, 165, 0.12)',
        lineWidth: 1.5,
        showLastLabel: true,
        labelPadding: 32,
        yMinSpan: 5, // атм
      });
      this.sparklines.set(w.id, sl);
      this.updateSparkline(w.id, sl);
    }
    return card;
  }

  private updateSparkline(wellId: string, sl: Sparkline): void {
    const entries = this.engine.getHistory().all();
    if (entries.length === 0) return;
    sl.setData(bhpSeries(entries, wellId));
  }

  private refreshSparklines(): void {
    if (this.sparklines.size === 0) return;
    for (const [id, sl] of this.sparklines) {
      this.updateSparkline(id, sl);
    }
  }

  private refreshRates(): void {
    for (const w of this.wells) {
      const card = this.root.querySelector<HTMLElement>(`.well-card[data-well-id="${w.id}"]`);
      if (!card) continue;
      const ws = this.lastWellStates.get(w.id);
      const rateEl = card.querySelector<HTMLElement>('[data-rate]');
      const wcEl = card.querySelector<HTMLElement>('[data-wc]');
      if (!rateEl || !wcEl) continue;
      if (!ws || ws.jBase <= 0) {
        rateEl.textContent = 'q: вне контура';
        wcEl.textContent = '';
        continue;
      }
      if (w.type === 'producer') {
        const qOil = Math.max(0, ws.qOil);
        const qWat = Math.max(0, ws.qWater);
        const qOilSurf = qOil / this.engine.getConfig().fluid.bo;
        const qOilTons = qOilSurf * (this.engine.getConfig().fluid.rhoOilSurface / 1000);
        rateEl.textContent = `q_н = ${qOilTons.toFixed(1)} т/сут, q_в = ${qWat.toFixed(0)} м³/сут`;
        const wc = qOil + qWat > 0 ? (qWat / (qOil + qWat)) * 100 : 0;
        wcEl.textContent = `WC: ${wc.toFixed(1)}%`;
      } else {
        const qInj = Math.max(0, -ws.qWater);
        rateEl.textContent = `q_зак = ${qInj.toFixed(0)} м³/сут`;
        wcEl.textContent = '';
      }
    }
  }
}
