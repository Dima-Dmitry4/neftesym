// TopBar — верхняя панель: часы, скорость, play/pause,
// сценарий, режим размещения, view-переключатель.
//
// Самодостаточный компонент: получает `container` и пишет туда
// свою разметку, подписывается на EventBus/SimulationEngine.

import type { EventBus } from '../../app/EventBus.ts';
import type { SimulationEngine } from '../../app/SimulationEngine.ts';
import type { MapViewMode } from '../canvas/MapView.ts';

export interface TopBarOptions {
  /** Функция форматирования текущего симуляционного времени. */
  formatSimTime?: (hours: number) => string;
}

const DEFAULT_FORMAT = (h: number): string => {
  const days = h / 24;
  return `${days.toFixed(1)} сут`;
};

export class TopBar {
  private readonly root: HTMLElement;
  private readonly eventBus: EventBus;
  private readonly engine: SimulationEngine;
  private readonly format: (h: number) => string;
  private readonly disposers: Array<() => void> = [];
  private clockEl!: HTMLElement;
  private playPauseBtn!: HTMLButtonElement;
  private speedSelect!: HTMLSelectElement;
  private scenarioSelect!: HTMLSelectElement;
  private modeProducerBtn!: HTMLButtonElement;
  private modeInjectorBtn!: HTMLButtonElement;
  private viewPressureBtn!: HTMLButtonElement;
  private viewSaturationBtn!: HTMLButtonElement;
  private currentMode: 'producer' | 'injector' | 'remove' = 'producer';
  private currentView: MapViewMode = 'pressure';

  constructor(
    container: HTMLElement,
    eventBus: EventBus,
    engine: SimulationEngine,
    options: TopBarOptions = {},
  ) {
    this.root = container;
    this.eventBus = eventBus;
    this.engine = engine;
    this.format = options.formatSimTime ?? DEFAULT_FORMAT;
    this.render();
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.root.innerHTML = '';
  }

  private render(): void {
    this.root.innerHTML = `
      <h1>Oilgame</h1>
      <span class="time-display" data-clock>—</span>
      <span class="speed-pill" data-speed-pill>1×</span>

      <div class="tb-group">
        <button class="primary" data-play-pause title="Space">⏸ Пауза</button>
        <select class="speed-select" data-speed-select title="Скорость"></select>
      </div>

      <div class="tb-group">
        <label class="tb-label">Сценарий</label>
        <select class="scenario-select" data-scenario-select></select>
      </div>

      <div class="tb-group mode-buttons">
        <button data-mode-producer title="P" class="active">Продюсер</button>
        <button data-mode-injector title="I">Инжектор</button>
      </div>

      <div class="tb-group view-buttons">
        <button data-view-pressure title="1" class="active">P</button>
        <button data-view-saturation title="2">S_w</button>
      </div>
    `;

    this.clockEl = this.requireEl('[data-clock]');
    this.playPauseBtn = this.requireEl<HTMLButtonElement>('[data-play-pause]');
    this.speedSelect = this.requireEl<HTMLSelectElement>('[data-speed-select]');
    this.scenarioSelect = this.requireEl<HTMLSelectElement>('[data-scenario-select]');
    this.modeProducerBtn = this.requireEl<HTMLButtonElement>('[data-mode-producer]');
    this.modeInjectorBtn = this.requireEl<HTMLButtonElement>('[data-mode-injector]');
    this.viewPressureBtn = this.requireEl<HTMLButtonElement>('[data-view-pressure]');
    this.viewSaturationBtn = this.requireEl<HTMLButtonElement>('[data-view-saturation]');

    this.populateSpeed();
    this.populateScenarios();
    this.wireEvents();
    this.syncUi();
  }

  private populateSpeed(): void {
    const opts = this.engine.getConfig().time.speedOptions;
    for (const s of opts) {
      const opt = document.createElement('option');
      opt.value = String(s);
      opt.textContent = `${s}×`;
      this.speedSelect.appendChild(opt);
    }
    this.speedSelect.value = String(this.engine.getSpeed());
  }

  private populateScenarios(): void {
    const names = this.engine.getAvailableScenarios();
    for (const n of names) {
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = this.formatScenarioName(n);
      this.scenarioSelect.appendChild(opt);
    }
    this.scenarioSelect.value = this.engine.getCurrentScenarioName();
  }

  private formatScenarioName(n: string): string {
    const map: Record<string, string> = {
      'five-spot': '5-точечный',
      'inverted-five-spot': 'Инвертированный 5-spot',
      'line-drive': 'Линейное заводнение',
      'channel': 'Канал',
      'fault-block': 'Разлом',
      'empty': 'Пустое поле',
    };
    return map[n] ?? n;
  }

  private wireEvents(): void {
    this.playPauseBtn.addEventListener('click', () => this.engine.togglePause());
    this.speedSelect.addEventListener('change', () => {
      const v = Number(this.speedSelect.value);
      if (Number.isFinite(v)) this.engine.setSpeed(v);
    });
    this.scenarioSelect.addEventListener('change', () => {
      this.engine.loadScenario(this.scenarioSelect.value as 'five-spot');
    });
    this.modeProducerBtn.addEventListener('click', () => {
      this.currentMode = 'producer';
      this.eventBus.emit('placementModeChanged', 'producer');
      this.syncModeButtons();
    });
    this.modeInjectorBtn.addEventListener('click', () => {
      this.currentMode = 'injector';
      this.eventBus.emit('placementModeChanged', 'injector');
      this.syncModeButtons();
    });
    this.viewPressureBtn.addEventListener('click', () => {
      this.currentView = 'pressure';
      this.eventBus.emit('viewModeChanged', 'pressure');
      this.syncViewButtons();
    });
    this.viewSaturationBtn.addEventListener('click', () => {
      this.currentView = 'saturation';
      this.eventBus.emit('viewModeChanged', 'saturation');
      this.syncViewButtons();
    });

    // Реактивные подписки
    this.disposers.push(
      this.eventBus.on('stateUpdated', () => this.updateClock()),
      this.eventBus.on('timeSpeedChanged', () => this.syncUi()),
      this.eventBus.on('placementModeChanged', (m) => {
        this.currentMode = m;
        this.syncModeButtons();
      }),
      this.eventBus.on('viewModeChanged', (m) => {
        this.currentView = m;
        this.syncViewButtons();
      }),
    );
  }

  private updateClock(): void {
    const h = this.engine.getState().time;
    this.clockEl.textContent = this.format(h);
  }

  private syncUi(): void {
    this.updateClock();
    const paused = this.engine.isPaused();
    this.playPauseBtn.textContent = paused ? '▶ Запуск' : '⏸ Пауза';
    this.playPauseBtn.classList.toggle('primary', paused);
    this.speedSelect.value = String(this.engine.getSpeed());
    const pill = this.root.querySelector<HTMLElement>('[data-speed-pill]');
    if (pill) pill.textContent = `${this.engine.getSpeed()}×`;
  }

  private syncModeButtons(): void {
    this.modeProducerBtn.classList.toggle('active', this.currentMode === 'producer');
    this.modeInjectorBtn.classList.toggle('active', this.currentMode === 'injector');
  }

  private syncViewButtons(): void {
    this.viewPressureBtn.classList.toggle('active', this.currentView === 'pressure');
    this.viewSaturationBtn.classList.toggle('active', this.currentView === 'saturation');
  }

  private requireEl<T extends HTMLElement = HTMLElement>(sel: string): T {
    const el = this.root.querySelector<T>(sel);
    if (!el) throw new Error(`TopBar: selector "${sel}" not found`);
    return el;
  }
}
