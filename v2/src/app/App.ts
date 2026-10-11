// App.ts — корневой UI-контроллер (Phase 2 + 4).
//
// Layout: TopBar + 2 колонки (Map | LiveMetrics) + BottomBar + StatusBar.
// Cross-section удалён, второй столбец занимает ChartsPanel с 6 графиками.
//
// Создаёт:
//   1) EventBus
//   2) SimulationEngine (preset fiveSpot по умолчанию)
//   3) Layout: TopBar, MapView, ChartsPanel, WellsList
//   4) Клавиатурные сокращения
//   5) Click→place/remove wiring на канвас

import { EventBus } from './EventBus.ts';
import { SimulationEngine, type EngineScenario } from './SimulationEngine.ts';
import { MapView } from '../ui/canvas/MapView.ts';
import { TopBar } from '../ui/panels/TopBar.ts';
import { WellsList } from '../ui/panels/WellsList.ts';
import { ChartsPanel } from '../ui/panels/ChartsPanel.ts';
import { attachKeyboardShortcuts } from '../ui/controls/KeyboardShortcuts.ts';

export interface MountOptions {
  /** Стартовый сценарий. По умолчанию 'five-spot'. */
  scenario?: EngineScenario;
  /** Стартовать в режиме паузы. По умолчанию false. */
  startPaused?: boolean;
}

export function mountApp(root: HTMLElement, options: MountOptions = {}): void {
  // 1) Базовый layout: 2 колонки (Map | LiveMetrics)
  root.innerHTML = `
    <header class="topbar" data-topbar></header>
    <main class="main">
      <section class="view view-map" id="view-map">
        <span class="view-title">Карта (2D сверху)</span>
        <canvas id="map-canvas" data-map-canvas></canvas>
      </section>
      <section class="view view-charts" id="view-charts">
        <span class="view-title">Динамика показателей</span>
        <div data-charts-root class="charts-root"></div>
      </section>
    </main>
    <footer class="bottombar" data-bottombar></footer>
    <div class="statusbar" data-statusbar>
      <span data-fps>FPS: —</span>
      <span data-steps>Steps: —</span>
      <span data-cum>Cum oil: —</span>
    </div>
  `;

  // 2) EventBus + Engine
  const eventBus = new EventBus();
  const engine = new SimulationEngine(eventBus, {
    scenario: options.scenario ?? 'five-spot',
    paused: options.startPaused ?? false,
  });

  // 3) TopBar
  const topbarEl = root.querySelector<HTMLElement>('[data-topbar]');
  if (!topbarEl) throw new Error('TopBar container not found');
  const topbar = new TopBar(topbarEl, eventBus, engine);

  // 4) MapView
  const canvasEl = root.querySelector<HTMLCanvasElement>('[data-map-canvas]');
  if (!canvasEl) throw new Error('Map canvas not found');
  const mapView = new MapView(canvasEl, eventBus, engine);

  // 5) ChartsPanel (теперь во втором столбце)
  const chartsRoot = root.querySelector<HTMLElement>('[data-charts-root]');
  if (!chartsRoot) throw new Error('Charts root not found');
  const chartsPanel = new ChartsPanel(chartsRoot, eventBus, engine);

  // 6) WellsList
  const bottombarEl = root.querySelector<HTMLElement>('[data-bottombar]');
  if (!bottombarEl) throw new Error('Bottom bar container not found');
  const wellsList = new WellsList(bottombarEl, eventBus, engine);

  // 7) Click → place/remove
  let placementMode: 'producer' | 'injector' | 'remove' = 'producer';
  eventBus.on('placementModeChanged', (m) => {
    placementMode = m;
  });

  canvasEl.addEventListener('map:cellclick', (e) => {
    const detail = (e as CustomEvent<{ i: number; j: number; shiftKey: boolean }>).detail;
    handleCellClick(detail.i, detail.j);
  });
  canvasEl.addEventListener('map:cellshiftclick', (e) => {
    const detail = (e as CustomEvent<{ i: number; j: number }>).detail;
    const existing = engine.getWells().find((w) => w.i === detail.i && w.j === detail.j);
    if (existing) engine.removeWell(existing.id);
  });

  function handleCellClick(i: number, j: number): void {
    const existing = engine.getWells().find((w) => w.i === i && w.j === j);
    if (existing) return;
    if (placementMode === 'remove') return;
    const type: 'producer' | 'injector' = placementMode === 'injector' ? 'injector' : 'producer';
    try {
      engine.createWellAt(i, j, type);
    } catch (err) {
      eventBus.emit('error', {
        message: `Не удалось создать скважину: ${(err as Error).message}`,
        cause: err,
      });
    }
  }

  // 8) Клавиатура
  attachKeyboardShortcuts(engine, eventBus);

  // 9) Status bar
  const fpsEl = root.querySelector<HTMLElement>('[data-fps]');
  const stepsEl = root.querySelector<HTMLElement>('[data-steps]');
  const cumEl = root.querySelector<HTMLElement>('[data-cum]');

  let lastFpsTick = 0;
  eventBus.on('stateUpdated', () => {
    const now = performance.now();
    if (now - lastFpsTick < 250) return;
    lastFpsTick = now;
    const m = engine.getMetrics();
    if (fpsEl) fpsEl.textContent = `FPS: ${m.fps.toFixed(0)}`;
    if (stepsEl) stepsEl.textContent = `Steps: ${m.steps}`;
    const last = engine.getHistory().last();
    if (cumEl) {
      if (last) {
        const tons = last.cumOilTons;
        cumEl.textContent = `Cum oil: ${tons.toFixed(1)} т`;
      } else {
        cumEl.textContent = 'Cum oil: —';
      }
    }
  });

  // 10) Запуск
  engine.start();

  window.addEventListener('beforeunload', () => {
    engine.stop();
  });
  const observer = new MutationObserver(() => {
    if (!root.isConnected) {
      engine.stop();
      topbar.dispose();
      mapView.dispose();
      chartsPanel.dispose();
      wellsList.dispose();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
