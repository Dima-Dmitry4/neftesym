// CrossSectionView — вертикальный разрез через месторождение.
//
// В 2D-задаче «разрез» = срез по фиксированной строке (j = const).
// Каждая ячейка строки рисуется как вертикальный столбик, высота
// которого пропорциональна толщине пласта h(i,j), а цвет —
// выбранной величине (P или S_w). Скважины в этой строке
// показываются как маркеры поверх.
//
// Подписывается на `stateUpdated` и `wellsChanged` из EventBus.

import type { EventBus } from '../../app/EventBus.ts';
import type { SimulationEngine } from '../../app/SimulationEngine.ts';
import type { FieldState } from '../../core/state/FieldState.ts';
import type { Reservoir } from '../../core/grid/Reservoir.ts';
import type { Well } from '../../core/wells/Well.ts';
import { viridis, brownBlue, normalize } from './ColorScales.ts';
import { DEFAULTS } from '../../data/defaultParameters.ts';
import { getDevicePixelRatio } from '../../core/units.ts';

export type CrossSectionMode = 'pressure' | 'saturation';

export interface CrossSectionOptions {
  initialMode?: CrossSectionMode;
  padding?: number;
  /** Стартовая строка. По умолчанию — середина поля. */
  initialRow?: number;
}

interface CellColumn {
  /** Центр столбика по x (CSS px). */
  cx: number;
  /** Ширина столбика (CSS px). */
  width: number;
  /** Высота столбика (CSS px). */
  height: number;
  /** Y низа столбика (CSS px). */
  bottomY: number;
  /** Индекс ячейки в FieldState. */
  cellIndex: number;
}

export class CrossSectionView {
  private readonly canvas: HTMLCanvasElement;
  private readonly eventBus: EventBus;
  private readonly engine: SimulationEngine;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly padding: number;
  private mode: CrossSectionMode;
  private rowIndex: number;
  private state: FieldState | null = null;
  private reservoir: Reservoir | null = null;
  private wells: readonly Well[] = [];
  private readonly disposers: Array<() => void> = [];

  constructor(
    canvas: HTMLCanvasElement,
    eventBus: EventBus,
    engine: SimulationEngine,
    options: CrossSectionOptions = {},
  ) {
    this.canvas = canvas;
    this.eventBus = eventBus;
    this.engine = engine;
    this.padding = options.padding ?? 0;
    this.mode = options.initialMode ?? 'saturation';
    this.rowIndex = options.initialRow ?? 0;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.warn('[CrossSectionView] 2D context not available');
    }
    this.ctx = ctx;

    this.tryInitFromEngine();
    this.resize();
    this.attachListeners();
  }

  private tryInitFromEngine(): void {
    // Engine держит текущий резервуар и состояние; пробуем
    // дотянуться через публичный API.
    const eng = this.engine as unknown as {
      getReservoir?: () => Reservoir;
      getState?: () => FieldState;
      getWells?: () => readonly Well[];
    };
    if (typeof eng.getReservoir === 'function') {
      try {
        this.reservoir = eng.getReservoir();
      } catch {
        this.reservoir = null;
      }
    }
    if (typeof eng.getState === 'function') {
      try {
        this.state = eng.getState();
      } catch {
        this.state = null;
      }
    }
    if (typeof eng.getWells === 'function') {
      try {
        this.wells = eng.getWells();
      } catch {
        this.wells = [];
      }
    }
    if (this.rowIndex === 0 && this.reservoir) {
      this.rowIndex = Math.floor(this.reservoir.grid.ny / 2);
    }
  }

  setMode(mode: CrossSectionMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.render();
  }

  setRow(j: number): void {
    if (!this.reservoir) return;
    const ny = this.reservoir.grid.ny;
    const clamped = Math.max(0, Math.min(ny - 1, j | 0));
    if (clamped === this.rowIndex) return;
    this.rowIndex = clamped;
    this.render();
  }

  getMode(): CrossSectionMode {
    return this.mode;
  }

  getRow(): number {
    return this.rowIndex;
  }

  resize(): void {
    const dpr = getDevicePixelRatio();
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(rect.width - this.padding * 2));
    const cssH = Math.max(1, Math.floor(rect.height - this.padding * 2));
    // Только размер буфера; CSS управляет display size.
    this.canvas.width = cssW * dpr;
    this.canvas.height = cssH * dpr;
    if (this.ctx) {
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.render();
  }

  private attachListeners(): void {
    const offState = this.eventBus.on('stateUpdated', (state) => {
      this.state = state;
      this.render();
    });
    const offWells = this.eventBus.on('wellsChanged', (wells) => {
      this.wells = wells;
      this.render();
    });
    const offScenario = this.eventBus.on('scenarioLoaded', (s) => {
      this.reservoir = s.reservoir;
      this.wells = s.wells;
      this.state = this.engine.getState();
      this.rowIndex = Math.floor(s.reservoir.grid.ny / 2);
      this.render();
    });
    this.disposers.push(offState, offWells, offScenario);

    if (typeof ResizeObserver !== 'undefined') {
      const resizeObs = new ResizeObserver(() => this.resize());
      resizeObs.observe(this.canvas);
      this.disposers.push(() => resizeObs.disconnect());
    }
  }

  private render(): void {
    if (!this.ctx) return;
    if (!this.reservoir || !this.state) return;
    const { grid } = this.reservoir;
    const cssW = this.canvas.width / getDevicePixelRatio();
    const cssH = this.canvas.height / getDevicePixelRatio();
    const ctx = this.ctx;

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = 'rgba(15, 20, 25, 0.9)';
    ctx.fillRect(0, 0, cssW, cssH);

    // Слой 1: ось (базовая линия)
    const baseY = cssH * 0.85;
    const margin = 8;
    const usableW = cssW - margin * 2;
    const usableH = baseY - margin;

    // Слой 2: столбики ячеек
    const cols: CellColumn[] = [];
    const j = this.rowIndex;
    let maxH = 0;
    for (let i = 0; i < grid.nx; i++) {
      const idx = j * grid.nx + i;
      const h = this.reservoir.thickness[idx] ?? 0;
      if (h > maxH) maxH = h;
    }
    if (maxH <= 0) maxH = 1;

    for (let i = 0; i < grid.nx; i++) {
      const idx = j * grid.nx + i;
      const active = !!this.reservoir.active[idx];
      if (!active) continue;
      const h = this.reservoir.thickness[idx] ?? 0;
      const width = usableW / grid.nx;
      const cx = margin + (i + 0.5) * width;
      const columnH = (h / maxH) * usableH;
      const bottomY = baseY;
      cols.push({ cx, width, height: columnH, bottomY, cellIndex: idx });

      // цвет по S_w или P
      let value: number;
      let range: [number, number];
      if (this.mode === 'saturation') {
        value = this.state.sw[idx] ?? 0;
        range = [DEFAULTS.relperm.swc, 1 - DEFAULTS.relperm.sor];
      } else {
        value = this.state.pressure[idx] ?? 0;
        range = [DEFAULTS.wellControls.producerBHPMinAtm, DEFAULTS.wellControls.injectorBHPAtm];
      }
      const t = normalize(value, range[0], range[1]);
      const color = this.mode === 'saturation' ? brownBlue(t) : viridis(t);

      ctx.fillStyle = color;
      ctx.fillRect(cx - width / 2 + 1, bottomY - columnH, width - 2, columnH);
    }

    // базовая линия
    ctx.strokeStyle = 'rgba(154, 163, 176, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin, baseY);
    ctx.lineTo(cssW - margin, baseY);
    ctx.stroke();

    // Слой 3: скважины в этой строке
    const wellsInRow = this.wells.filter((w) => w.j === j);
    for (const w of wellsInRow) {
      const col = cols.find((c) => {
        const i = c.cellIndex % grid.nx;
        return i === w.i;
      });
      if (!col) continue;
      const isProducer = w.type === 'producer';
      ctx.fillStyle = isProducer ? '#d4a04a' : '#3b6ea5';
      ctx.beginPath();
      // треугольник-маркер сверху столбика
      ctx.moveTo(col.cx, col.bottomY - col.height - 14);
      ctx.lineTo(col.cx - 7, col.bottomY - col.height - 2);
      ctx.lineTo(col.cx + 7, col.bottomY - col.height - 2);
      ctx.closePath();
      ctx.fill();
      // подпись ID
      ctx.fillStyle = 'rgba(230,230,230,0.85)';
      ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(w.id, col.cx, col.bottomY - col.height - 18);
    }

    // Подпись строки (сверху-слева)
    ctx.fillStyle = 'rgba(154, 163, 176, 0.85)';
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(
      `j = ${j} / ${grid.ny - 1}  ·  ${this.mode === 'saturation' ? 'S_w' : 'P'}`,
      margin,
      14,
    );

    // Легенда диапазона (справа сверху)
    const legendText =
      this.mode === 'saturation'
        ? `S_w: ${DEFAULTS.relperm.swc.toFixed(2)}..${(1 - DEFAULTS.relperm.sor).toFixed(2)}`
        : `P: ${DEFAULTS.wellControls.producerBHPMinAtm}..${DEFAULTS.wellControls.injectorBHPAtm} атм`;
    ctx.textAlign = 'right';
    ctx.fillText(legendText, cssW - margin, 14);
    ctx.textAlign = 'left';
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }
}
