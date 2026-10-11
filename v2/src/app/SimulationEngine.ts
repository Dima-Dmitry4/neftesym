// SimulationEngine — связка pure-симулятора с UI.
//
// Хранит состояние: резервуар, скважины, FieldState, часы,
// history. На каждом кадре (requestAnimationFrame) переводит
// реальное время в модельное с учётом множителя `speed`,
// делает один или несколько `step()` и эмитит события.
//
// Иммутабельность: каждый step() возвращает новый FieldState,
// а операции со скважинами (add/remove/updateBHP) возвращают
// новый WellManager. Сам engine пересоздаёт wellManager/list.

import type { FieldState } from '../core/state/FieldState.ts';
import { makeInitialState } from '../core/state/FieldState.ts';
import { History } from '../core/state/History.ts';
import type { HistoryEntry } from '../core/state/History.ts';
import type { FluxResult } from '../core/physics/DarcyFlux.ts';
import type { Well, Producer, Injector } from '../core/wells/Well.ts';
import { WellManager } from '../core/wells/WellManager.ts';
import type { Reservoir } from '../core/grid/Reservoir.ts';
import type { ScenarioConfig } from '../data/presets/ScenarioConfig.ts';
import { getScenario, PRESET_NAMES, type ScenarioName } from '../data/presets/index.ts';
import { defaultField } from '../data/defaultField.ts';
import {
  stepSuperposition,
  computePoreVolume,
  type SuperpositionStepperParams,
  type SuperpositionSubStepInfo,
} from '../core/time/SuperpositionStepper.ts';
import { loadConfig, type AppConfig } from './Config.ts';
import type { EventBus } from './EventBus.ts';

/** Стартовый сценарий: один из пресетов или "default" (пустое поле). */
export type EngineScenario = ScenarioName | 'default';

/** Опции конструктора. */
export interface EngineOptions {
  /** Стартовый сценарий. По умолчанию 'five-spot'. */
  scenario?: EngineScenario;
  /** Множитель скорости. По умолчанию 1. */
  speed?: number;
  /** Запустить сразу в режиме паузы. По умолчанию false. */
  paused?: boolean;
  /** Кастомный конфиг (для тестов). По умолчанию loadConfig(). */
  config?: AppConfig;
  /** Переопределение reservoir (для тестов). */
  reservoir?: Reservoir;
  /** Переопределение стартовых wells (для тестов). */
  initialWells?: readonly Well[];
}

/** Поведение rAF-цикла. Можно подменить для тестов. */
export interface EngineClock {
  requestAnimationFrame(cb: (now: number) => void): number;
  cancelAnimationFrame(id: number): void;
}

const defaultClock: EngineClock = {
  requestAnimationFrame: (cb): number => {
    if (typeof globalThis.requestAnimationFrame === 'function') {
      return globalThis.requestAnimationFrame(cb);
    }
    return setTimeout(() => cb(Date.now()), 16) as unknown as number;
  },
  cancelAnimationFrame: (id): void => {
    if (typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(id);
    } else {
      clearTimeout(id);
    }
  },
};

/** Снимок метрик — то, что UI запрашивает для дашборда. */
export interface EngineMetrics {
  /** Число шагов симулятора. */
  steps: number;
  /** Текущее модельное время, ч. */
  time: number;
  /** Сколько секунд прошло с запуска движка (wall clock). */
  wallTimeSeconds: number;
  /** Число записей в history. */
  historySize: number;
  /** FPS, оценка по последним кадрам. */
  fps: number;
}

export class SimulationEngine {
  private cfg: AppConfig;
  private reservoir: Reservoir;
  private wellManager: WellManager;
  private state: FieldState;
  private history: History;
  private xFault: Uint8Array | undefined;
  private yFault: Uint8Array | undefined;
  private speed: number;
  private paused: boolean;
  private rafId: number | null = null;
  private lastFrameMs: number | null = null;
  private lastRecordT: number;
  private startWallMs: number;
  private frameTimes: number[] = [];
  private readonly fpsWindow: number = 30;
  private readonly clock: EngineClock;
  private readonly eventBus: EventBus;
  private currentScenarioName: string;
  /** Текущее среднее давление (для superposition pipeline). */
  private pAvg: number;
  /** Накопленные объёмы для матбаланса. */
  private cum: { productionM3: number; injectionM3: number };
  /** Дебиты последнего шага — вход релаксации дебитов. */
  private prevRates: Map<string, number> | null = null;
  /** Поток последнего шага — вход первичной CFL-оценки. */
  private prevFlux: FluxResult | null = null;
  /** Поровый объём (кешируется). */
  private poreVolumeM3: number;
  /** Колбэк, замещающий step() (для тестов: можно не делать тяжёлых вычислений). */
  private readonly stepFn: (dt: number) => void;

  constructor(eventBus: EventBus, options: EngineOptions = {}, clock: EngineClock = defaultClock) {
    this.eventBus = eventBus;
    this.cfg = options.config ?? loadConfig();
    this.clock = clock;
    this.speed = options.speed ?? 1;
    this.paused = options.paused ?? false;
    this.startWallMs = Date.now();

    const scenarioName = options.scenario ?? 'five-spot';
    let scenario: ScenarioConfig;
    if (scenarioName === 'default') {
      scenario = {
        name: 'default',
        description: '',
        reservoir: options.reservoir ?? defaultField(),
        wells: options.initialWells ? [...options.initialWells] : [],
        defaultDurationDays: 365,
      };
    } else {
      const sc = getScenario(scenarioName);
      scenario = {
        ...sc,
        reservoir: options.reservoir ?? sc.reservoir,
        wells: options.initialWells ? [...options.initialWells] : [...sc.wells],
      };
    }
    this.reservoir = scenario.reservoir;
    this.wellManager = new WellManager(scenario.wells);
    this.xFault = scenario.xFault;
    this.yFault = scenario.yFault;
    this.currentScenarioName = scenarioName;
    this.state = makeInitialState(this.reservoir.initialP, this.reservoir.initialSw);
    this.history = new History(this.cfg.solver.historyIntervalHours);
    this.lastRecordT = 0;
    // Среднее давление — из initialP по активной зоне.
    let pSum = 0;
    let pCount = 0;
    for (let i = 0; i < this.reservoir.initialP.length; i++) {
      if (!this.reservoir.active[i]) continue;
      pSum += this.reservoir.initialP[i] ?? 0;
      pCount++;
    }
    this.pAvg = pCount > 0 ? pSum / pCount : this.cfg.fluid.bo * 0;
    this.cum = { productionM3: 0, injectionM3: 0 };
    this.poreVolumeM3 = computePoreVolume(this.reservoir);

    // По умолчанию — реальный step из core. Тесты могут подменить.
    this.stepFn = (dt: number): void => {
      this.realStep(dt);
    };
  }

  // ─── Управление циклом ────────────────────────────────────

  start(): void {
    if (this.rafId !== null) return;
    this.lastFrameMs = null;
    this.frameTimes = [];
    this.rafId = this.clock.requestAnimationFrame((now) => this.onFrame(now));
  }

  stop(): void {
    if (this.rafId !== null) {
      this.clock.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  isRunning(): boolean {
    return this.rafId !== null;
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.eventBus.emit('timeSpeedChanged', 0);
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.eventBus.emit('timeSpeedChanged', this.speed);
  }

  togglePause(): void {
    if (this.paused) this.resume();
    else this.pause();
  }

  isPaused(): boolean {
    return this.paused;
  }

  setSpeed(multiplier: number): void {
    const s = Math.max(0, multiplier);
    this.speed = s;
    this.eventBus.emit('timeSpeedChanged', s);
  }

  getSpeed(): number {
    return this.speed;
  }

  cycleSpeed(direction: 1 | -1): number {
    const opts = this.cfg.time.speedOptions;
    let idx = opts.findIndex((v) => Math.abs(v - this.speed) < 1e-9);
    if (idx < 0) {
      // Текущая скорость не из списка — выберем ближайшую.
      let bestI = 0;
      let bestD = Infinity;
      for (let i = 0; i < opts.length; i++) {
        const d = Math.abs((opts[i] ?? 0) - this.speed);
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
      idx = bestI;
    }
    let next = idx + direction;
    if (next < 0) next = 0;
    if (next >= opts.length) next = opts.length - 1;
    const s = opts[next] ?? 1;
    this.setSpeed(s);
    return s;
  }

  // ─── Скважины ────────────────────────────────────────────

  addWell(well: Well): Well {
    if (this.wellManager.byId(well.id)) {
      throw new Error(`Well with id "${well.id}" already exists`);
    }
    this.wellManager = this.wellManager.add(well);
    this.eventBus.emit('wellsChanged', this.wellManager.list());
    return well;
  }

  removeWell(id: string): void {
    if (!this.wellManager.byId(id)) return;
    this.wellManager = this.wellManager.remove(id);
    this.eventBus.emit('wellsChanged', this.wellManager.list());
  }

  updateBhp(id: string, bhpAtm: number): void {
    const w = this.wellManager.byId(id);
    if (!w) return;
    this.wellManager = this.wellManager.setBhp(id, bhpAtm);
    this.eventBus.emit('wellsChanged', this.wellManager.list());
  }

  /** Сгенерировать уникальный ID для скважины этого типа. */
  generateWellId(type: 'producer' | 'injector'): string {
    const prefix = type === 'producer' ? 'P' : 'I';
    let n = 1;
    const existing = this.wellManager.list();
    while (existing.some((w) => w.id === `${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  }

  /** Создать скважину из (i, j) с дефолтным BHP для типа.
   *
   *  ВАЖНО: выставляем `rateLimit` по умолчанию — без него ставки
   *  по BHP в superposition-модели получаются нереалистично большими
   *  (сотни тысяч м³/сут), что приводит к численной нестабильности:
   *  давление и насыщенность улетают в NaN. Лимит защищает и пресеты,
   *  и пользовательские скважины, расставленные из UI. */
  createWellAt(i: number, j: number, type: 'producer' | 'injector'): Well {
    const id = this.generateWellId(type);
    if (type === 'producer') {
      const w: Producer = {
        type: 'producer',
        id,
        i,
        j,
        bhpAtm: this.cfg.wellControls.producerBHPAtm,
        rw: 0.1,
        skin: 0,
        rateLimit: this.cfg.wellControls.producerRateLimit,
      };
      this.addWell(w);
      return w;
    } else {
      const w: Injector = {
        type: 'injector',
        id,
        i,
        j,
        bhpAtm: this.cfg.wellControls.injectorBHPAtm,
        rw: 0.1,
        skin: 0,
        rateLimit: this.cfg.wellControls.injectorRateLimit,
      };
      this.addWell(w);
      return w;
    }
  }

  // ─── Сценарии ────────────────────────────────────────────

  loadScenario(name: EngineScenario): void {
    let scenario: ScenarioConfig;
    if (name === 'default') {
      scenario = {
        name: 'default',
        description: '',
        reservoir: defaultField(),
        wells: [],
        defaultDurationDays: 365,
      };
    } else {
      scenario = getScenario(name);
    }
    this.reservoir = scenario.reservoir;
    this.wellManager = new WellManager(scenario.wells);
    this.xFault = scenario.xFault;
    this.yFault = scenario.yFault;
    this.currentScenarioName = name;
    this.state = makeInitialState(this.reservoir.initialP, this.reservoir.initialSw);
    this.history = new History(this.cfg.solver.historyIntervalHours);
    this.lastRecordT = 0;
    this.startWallMs = Date.now();
    // Сбросить superposition-state.
    let pSum = 0;
    let pCount = 0;
    for (let i = 0; i < this.reservoir.initialP.length; i++) {
      if (!this.reservoir.active[i]) continue;
      pSum += this.reservoir.initialP[i] ?? 0;
      pCount++;
    }
    this.pAvg = pCount > 0 ? pSum / pCount : 0;
    this.cum = { productionM3: 0, injectionM3: 0 };
    this.prevRates = null;
    this.prevFlux = null;
    this.poreVolumeM3 = computePoreVolume(this.reservoir);

    this.eventBus.emit('scenarioLoaded', {
      name: scenario.name,
      reservoir: this.reservoir,
      wells: this.wellManager.list(),
    });
    this.eventBus.emit('wellsChanged', this.wellManager.list());
    this.eventBus.emit('stateUpdated', this.state);
  }

  getAvailableScenarios(): readonly ScenarioName[] {
    return PRESET_NAMES;
  }

  getCurrentScenarioName(): string {
    return this.currentScenarioName;
  }

  // ─── Геттеры состояния ───────────────────────────────────

  getState(): FieldState {
    return this.state;
  }

  getReservoir(): Reservoir {
    return this.reservoir;
  }

  getWells(): readonly Well[] {
    return this.wellManager.list();
  }

  getHistory(): History {
    return this.history;
  }

  getHistoryEntries(): readonly HistoryEntry[] {
    return this.history.all();
  }

  getConfig(): AppConfig {
    return this.cfg;
  }

  getMetrics(): EngineMetrics {
    const wallTimeSeconds = (Date.now() - this.startWallMs) / 1000;
    let fps = 0;
    if (this.frameTimes.length > 1) {
      const first = this.frameTimes[0] ?? 0;
      const last = this.frameTimes[this.frameTimes.length - 1] ?? first;
      const span = (last - first) / 1000;
      if (span > 1e-6) fps = (this.frameTimes.length - 1) / span;
    }
    return {
      steps: this.state.step,
      time: this.state.time,
      wallTimeSeconds,
      historySize: this.history.size(),
      fps,
    };
  }

  // ─── Прямое продвижение (для тестов и CLI) ──────────────

  /** Сделать ровно `n` вызовов step() с шагом dt (часы). */
  stepN(n: number, dt: number): void {
    for (let k = 0; k < n; k++) {
      this.realStep(dt);
    }
  }

  // ─── Внутренний цикл ─────────────────────────────────────

  private onFrame(now: number): void {
    this.rafId = null;
    this.updateFps(now);
    if (!this.paused) {
      const realDt = this.lastFrameMs === null ? 0 : (now - this.lastFrameMs) / 1000; // sec
      // 1 секунда реального времени = realtimeSecondsPerSimDay симуляционных суток
      // => sim_dt (часы) = real_dt (sec) * speed * 24 / realtimeSecondsPerSimDay
      const r = this.cfg.time.realtimeSecondsPerSimDay;
      const simDtHours = r > 0 ? (realDt * this.speed * 24) / r : 0;
      if (simDtHours > 0) {
        // Делаем один «большой» шаг адаптивного размера через step(),
        // который сам разобьёт его на CFL-подшаги.
        this.stepFn(simDtHours);
        this.eventBus.emit('stateUpdated', this.state);
      }
    }
    this.lastFrameMs = now;
    this.rafId = this.clock.requestAnimationFrame((t) => this.onFrame(t));
  }

  private updateFps(now: number): void {
    this.frameTimes.push(now);
    if (this.frameTimes.length > this.fpsWindow) {
      this.frameTimes.shift();
    }
  }

  private realStep(dtHours: number): void {
    if (dtHours <= 0) return;
    const wells = this.wellManager.list();
    // === Superposition pipeline (v2) ===
    const superParams: SuperpositionStepperParams = {
      dtMaxHours: this.cfg.solver.dtMaxHours,
      dtMinHours: this.cfg.solver.dtMinHours,
      cflTarget: this.cfg.solver.cflTarget,
      crAtm: this.cfg.rock.crAtm,
      totalCompressibilityAtmInv: this.cfg.pressureModel.totalCompressibilityAtmInv,
      rateSolver: {
        muB: this.cfg.fluid.muWaterCP * this.cfg.fluid.bw,
        radiusMode: this.cfg.pressureModel.radiusMode,
        fixedRadiusM: this.cfg.pressureModel.fixedRadiusM,
        effectiveK: this.cfg.pressureModel.effectiveKMethod,
        constantKEffMD: this.cfg.pressureModel.constantKEffMD,
      },
      historyIntervalHours: this.cfg.solver.historyIntervalHours,
      pAvgDamping: this.cfg.solver.pAvgDamping,
      rateRelaxation: this.cfg.solver.rateRelaxation,
      rateChangeTarget: this.cfg.solver.rateChangeTarget,
      cflPressureFraction: this.cfg.solver.cflPressureFraction,
      pressureMarginFloorAtm: this.cfg.solver.pressureMarginFloorAtm,
    };
    let lastInfo: SuperpositionSubStepInfo | undefined;
    const out = stepSuperposition({
      state: this.state,
      dt: dtHours,
      reservoir: this.reservoir,
      wells,
      fluid: this.cfg.fluid,
      relperm: this.cfg.relperm,
      params: superParams,
      poreVolumeM3: this.poreVolumeM3,
      pAvg: this.pAvg,
      cum: this.cum,
      lastStepRates: this.prevRates,
      prevFlux: this.prevFlux,
      xFault: this.xFault,
      yFault: this.yFault,
      onSubStep: (info) => {
        lastInfo = info;
      },
    });
    this.state = out.state;
    this.pAvg = out.pAvg;
    this.cum = out.cum;
    this.prevRates = out.lastStepRates;
    this.prevFlux = out.lastFlux;
    if (lastInfo) {
      this.maybeRecordHistorySuperposition(lastInfo);
    }
  }

  private maybeRecordHistorySuperposition(info: SuperpositionSubStepInfo): void {
    const interval = this.cfg.solver.historyIntervalHours;
    if (this.state.time - this.lastRecordT + 1e-6 < interval) return;
    if (this.state.time <= 0) return;
    const wBhps = new Map<string, number>();
    for (const ws of info.wellStates) {
      wBhps.set(ws.wellId, this.state.pressure[ws.cellIndex] ?? ws.bhp);
    }
    const entry = this.history.append(
      this.state.time,
      info.pAvg,
      info.swAvg,
      info.dt,
      info.wellStates,
      wBhps,
      this.cfg.fluid.rhoOilSurface,
      this.cfg.fluid.bo,
    );
    this.lastRecordT = this.state.time;
    this.eventBus.emit('historyAppended', entry);
  }

  // Legacy (IMPES) history recording был удалён — superposition pipeline
  // использует только maybeRecordHistorySuperposition (см. выше).
  // Старый SubStepInfo больше не импортируется.
  // Если в будущем понадобится fallback на IMPES, импортируйте SubStepInfo
  // из '../core/time/TimeStepper.ts' и верните соответствующий метод.
}
