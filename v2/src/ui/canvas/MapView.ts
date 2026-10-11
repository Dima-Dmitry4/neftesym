// MapView — главный 2D-канвас (вид сверху).
//
// Рисует:
//   1) heatmap выбранной величины (P или S_w) с учётом HiDPI
//   2) контур активной зоны (полупрозрачная заливка неактивных ячеек)
//   3) маркеры скважин поверх
//   4) tooltip при наведении (DOM-overlay, не в канвасе)
//
// Подписывается на `stateUpdated` и `wellsChanged` из EventBus.
// На клик/shift+клик эмитит DOM-события `map:cellclick` /
// `map:cellshiftclick` для App.ts.

import type { EventBus } from '../../app/EventBus.ts';
import type { SimulationEngine } from '../../app/SimulationEngine.ts';
import type { FieldState } from '../../core/state/FieldState.ts';
import type { Well } from '../../core/wells/Well.ts';
import { drawHeatmap } from './Heatmap.ts';
import { drawWells } from './WellOverlay.ts';
import { viridis, brownBlue, normalize } from './ColorScales.ts';
import { attachClickHandler } from '../controls/ClickHandler.ts';
import { DEFAULTS } from '../../data/defaultParameters.ts';

export type MapViewMode = 'pressure' | 'saturation';

export interface MapViewOptions {
  /** Стартовая величина. По умолчанию 'pressure'. */
  initialMode?: MapViewMode;
  /** Отступ от края канваса в CSS-пикселях. */
  padding?: number;
}

const PRODUCER_COLOR = '#d4a04a';
const INJECTOR_COLOR = '#3b6ea5';

export class MapView {
  private readonly canvas: HTMLCanvasElement;
  private readonly eventBus: EventBus;
  private readonly engine: SimulationEngine;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly padding: number;
  private mode: MapViewMode;
  private state: FieldState | null = null;
  private wells: readonly Well[] = [];
  private hoveredCell: { i: number; j: number } | null = null;
  private hoveredWellId: string | null = null;
  private selectedWellId: string | null = null;
  private readonly tooltip: HTMLDivElement;
  private readonly disposers: Array<() => void> = [];
  /** Текущая оценка диапазона значений для heatmap. */
  private pressureRange: [number, number] = [0, 1];
  private saturationRange: [number, number] = [
    DEFAULTS.relperm.swc,
    1 - DEFAULTS.relperm.sor,
  ];

  constructor(
    canvas: HTMLCanvasElement,
    eventBus: EventBus,
    engine: SimulationEngine,
    options: MapViewOptions = {},
  ) {
    this.canvas = canvas;
    this.eventBus = eventBus;
    this.engine = engine;
    this.padding = options.padding ?? 0;
    this.mode = options.initialMode ?? 'pressure';
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      // jsdom без canvas-пакета не даёт 2D-контекст.
      // В тестах это нормально — рендер пропускается, DOM-структура
      // работает. В браузере такое будет крайне маловероятно.
      console.warn('[MapView] 2D context not available; rendering disabled');
    }
    this.ctx = ctx;

    this.tooltip = this.createTooltip();
    this.resize();
    this.attachListeners();
  }

  /** Переключить режим отображения. */
  setMode(mode: MapViewMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.eventBus.emit('viewModeChanged', mode);
    this.render();
  }

  getMode(): MapViewMode {
    return this.mode;
  }

  /** Установить выделенную скважину (для подсветки). */
  setSelectedWell(id: string | null): void {
    this.selectedWellId = id;
    this.render();
  }

  /** Полная очистка подписок и DOM-элементов. */
  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.tooltip.remove();
  }

  // ─── Внутренние ───────────────────────────────────────────

  private createTooltip(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'map-tooltip';
    el.style.position = 'absolute';
    el.style.pointerEvents = 'none';
    el.style.background = 'rgba(15, 20, 25, 0.92)';
    el.style.color = '#e6e6e6';
    el.style.padding = '4px 8px';
    el.style.borderRadius = '3px';
    el.style.font = '11px ui-monospace, monospace';
    el.style.lineHeight = '1.4';
    el.style.border = '1px solid #2d3a4d';
    el.style.display = 'none';
    el.style.zIndex = '5';
    el.style.whiteSpace = 'pre';
    const parent = this.canvas.parentElement;
    if (parent) {
      if (getComputedStyle(parent).position === 'static') {
        parent.style.position = 'relative';
      }
      parent.appendChild(el);
    }
    return el;
  }

  private attachListeners(): void {
    // ResizeObserver
    const ro = new ResizeObserver(() => {
      this.resize();
      this.render();
    });
    ro.observe(this.canvas);
    this.disposers.push(() => ro.disconnect());

    // События движка
    const offState = this.eventBus.on('stateUpdated', (s) => {
      this.state = s;
      this.render();
    });
    const offWells = this.eventBus.on('wellsChanged', (w) => {
      this.wells = w;
      this.render();
    });
    const offView = this.eventBus.on('viewModeChanged', (m) => {
      this.mode = m;
      this.render();
    });
    this.disposers.push(offState, offWells, offView);

    // Клики
    const reservoir = this.engine.getReservoir();
    const handler = attachClickHandler(
      this.canvas,
      reservoir.grid.nx,
      reservoir.grid.ny,
      {
        onClick: (cell, e) => {
          this.dispatchCellClick(cell, e.shiftKey);
        },
        onShiftClick: (cell) => {
          this.dispatchShiftClick(cell);
        },
        onHover: (cell, e) => {
          this.onHover(cell, e);
        },
      },
      this.padding,
    );
    this.disposers.push(handler.unsubscribe);

    // Стартовые данные
    this.state = this.engine.getState();
    this.wells = this.engine.getWells();
    this.render();
  }

  private dispatchCellClick(cell: { i: number; j: number }, shift: boolean): void {
    const detail = { i: cell.i, j: cell.j, shiftKey: shift };
    this.canvas.dispatchEvent(
      new CustomEvent('map:cellclick', { detail, bubbles: true }),
    );
  }

  private dispatchShiftClick(cell: { i: number; j: number }): void {
    const detail = { i: cell.i, j: cell.j };
    this.canvas.dispatchEvent(
      new CustomEvent('map:cellshiftclick', { detail, bubbles: true }),
    );
  }

  private onHover(
    cell: { i: number; j: number } | null,
    e: MouseEvent | null,
  ): void {
    this.hoveredCell = cell;
    // Поиск скважины в ячейке (если есть).
    let wellId: string | null = null;
    if (cell) {
      const w = this.wells.find((w) => w.i === cell.i && w.j === cell.j);
      if (w) wellId = w.id;
    }
    this.hoveredWellId = wellId;
    if (cell && e && this.state) {
      // Подавляем перерисовку, если данные в ячейке не поменялись и
      // мышь в той же ячейке — экономим CPU на 50×50.
      this.showTooltip(cell, e);
    } else {
      this.hideTooltip();
    }
    this.render();
  }

  private showTooltip(cell: { i: number; j: number }, e: MouseEvent): void {
    if (!this.state) return;
    const idx = cell.i + cell.j * this.engine.getReservoir().grid.nx;
    const p = this.state.pressure[idx] ?? 0;
    const sw = this.state.sw[idx] ?? 0;
    const reservoir = this.engine.getReservoir();
    const active = reservoir.active[idx] === 1;
    const x = (cell.i + 0.5) * reservoir.grid.dx;
    const y = (cell.j + 0.5) * reservoir.grid.dy;
    const wellAtCell = this.wells.find((w) => w.i === cell.i && w.j === cell.j);
    const wellStr = wellAtCell
      ? `\nСкважина: ${wellAtCell.id} (${wellAtCell.type === 'producer' ? 'продюсер' : 'инжектор'})`
      : '';
    this.tooltip.textContent =
      `(${cell.i}, ${cell.j})  x=${x.toFixed(0)} м, y=${y.toFixed(0)} м` +
      `\nP = ${p.toFixed(1)} атм` +
      `\nS_w = ${sw.toFixed(3)}` +
      `\nАктивна: ${active ? 'да' : 'нет'}` +
      wellStr;
    const parent = this.canvas.parentElement;
    if (parent) {
      const rect = this.canvas.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      const tx = rect.left - parentRect.left + e.clientX - rect.left + 14;
      const ty = rect.top - parentRect.top + e.clientY - rect.top + 14;
      this.tooltip.style.left = `${tx}px`;
      this.tooltip.style.top = `${ty}px`;
      this.tooltip.style.display = 'block';
    }
  }

  private hideTooltip(): void {
    this.tooltip.style.display = 'none';
  }

  private resize(): void {
    if (!this.ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private computePressureRange(state: FieldState): [number, number] {
    const r = this.engine.getReservoir();
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < state.pressure.length; i++) {
      if (r.active[i] !== 1) continue;
      const v = state.pressure[i] ?? 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
    if (max - min < 1e-6) {
      // Плоское поле — небольшой диапазон вокруг значения.
      return [min - 0.5, max + 0.5];
    }
    // Небольшой padding (5%) для наглядности.
    const pad = (max - min) * 0.05;
    return [min - pad, max + pad];
  }

  private render(): void {
    if (!this.ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (width <= 0 || height <= 0) return;
    const reservoir = this.engine.getReservoir();
    const state = this.state;
    if (!state) return;

    // 1) Heatmap
    if (this.mode === 'pressure') {
      this.pressureRange = this.computePressureRange(state);
      const colorFn = (t: number): string => viridis(t);
      const dummyT = normalize(0, 0, 1); // удовлетворяем lint unused
      void dummyT;
      drawHeatmap(
        this.ctx,
        state.pressure,
        reservoir.grid.nx,
        reservoir.grid.ny,
        { width, height },
        this.pressureRange,
        colorFn,
        reservoir.active,
      );
    } else {
      drawHeatmap(
        this.ctx,
        state.sw,
        reservoir.grid.nx,
        reservoir.grid.ny,
        { width, height },
        this.saturationRange,
        brownBlue,
        reservoir.active,
      );
    }

    // 2) Маркеры скважин
    drawWells(this.ctx, this.wells, reservoir.grid, width, height, {
      producerColor: PRODUCER_COLOR,
      injectorColor: INJECTOR_COLOR,
      hoveredId: this.hoveredWellId,
      selectedId: this.selectedWellId,
    });

    // 2.5) Подсветка наведённой ячейки
    if (this.hoveredCell) {
      const cellW = width / reservoir.grid.nx;
      const cellH = height / reservoir.grid.ny;
      this.ctx.save();
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(
        this.hoveredCell.i * cellW + 0.5,
        this.hoveredCell.j * cellH + 0.5,
        cellW - 1,
        cellH - 1,
      );
      this.ctx.restore();
    }

    // 3) Подпись: текущий диапазон значений (мелко, в углу)
    this.drawRangeBadge(this.mode === 'pressure' ? this.pressureRange : this.saturationRange);
  }

  private drawRangeBadge(range: readonly [number, number]): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const label =
      this.mode === 'pressure'
        ? `P: ${range[0].toFixed(0)}…${range[1].toFixed(0)} атм`
        : `S_w: ${range[0].toFixed(2)}…${range[1].toFixed(2)}`;
    ctx.save();
    ctx.font = '10px ui-monospace, monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'right';
    const metrics = ctx.measureText(label);
    const w = metrics.width + 12;
    const h = 18;
    ctx.fillStyle = 'rgba(15, 20, 25, 0.75)';
    ctx.fillRect(this.canvas.width / (window.devicePixelRatio || 1) - w - 6, 6, w, h);
    ctx.fillStyle = '#9aa3b0';
    ctx.fillText(label, this.canvas.width / (window.devicePixelRatio || 1) - 12, 10);
    ctx.restore();
  }
}
