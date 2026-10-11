// Sparkline — минималистичный линейный график для карточек.
//
// Рисует одну серию без осей, легенды, сетки — только линия.
// Используется для BHP-истории в карточках скважин.

import { getDevicePixelRatio } from '../../core/units.ts';

export interface SparklinePoint {
  x: number;
  y: number;
}

export interface SparklineOptions {
  /** Цвет линии. */
  color?: string;
  /** Цвет заливки под линией (если задан). */
  fillColor?: string;
  /** Толщина линии (CSS px). */
  lineWidth?: number;
  /** Показывать последнее значение справа. */
  showLastLabel?: boolean;
  /** Доп. отступ справа для label. */
  labelPadding?: number;
  /** Минимальный диапазон по Y (для стабильного отображения). */
  yMinSpan?: number;
}

export class Sparkline {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private points: readonly SparklinePoint[] = [];
  private options: Required<SparklineOptions> = {
    color: '#d4a04a',
    fillColor: '',
    lineWidth: 1.5,
    showLastLabel: false,
    labelPadding: 30,
    yMinSpan: 1,
  };
  private readonly disposers: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement, options: SparklineOptions = {}) {
    this.canvas = canvas;
    this.options = { ...this.options, ...options };
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.warn('[Sparkline] 2D context not available');
    }
    this.ctx = ctx;
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.resize());
      ro.observe(canvas);
      this.disposers.push(() => ro.disconnect());
    }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => this.resize());
    }
  }

  setData(points: readonly SparklinePoint[]): void {
    this.points = points;
    this.render();
  }

  setOptions(options: SparklineOptions): void {
    this.options = { ...this.options, ...options };
    this.render();
  }

  resize(): void {
    const dpr = getDevicePixelRatio();
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(rect.height));
    // Только размер буфера; CSS управляет display size.
    this.canvas.width = cssW * dpr;
    this.canvas.height = cssH * dpr;
    if (this.ctx) {
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.render();
  }

  private render(): void {
    if (!this.ctx) return;
    const dpr = getDevicePixelRatio();
    const cssW = this.canvas.width / dpr;
    const cssH = this.canvas.height / dpr;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = 'rgba(15, 20, 25, 0.6)';
    ctx.fillRect(0, 0, cssW, cssH);

    if (this.points.length < 2) {
      // нет данных
      ctx.fillStyle = 'rgba(154, 163, 176, 0.5)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('—', cssW / 2, cssH / 2);
      return;
    }

    let xMin = Infinity,
      xMax = -Infinity,
      yMin = Infinity,
      yMax = -Infinity;
    for (const p of this.points) {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
    if (xMax === xMin) xMax = xMin + 1;
    // минимальный span чтобы плоская линия не «прыгала»
    if (yMax - yMin < this.options.yMinSpan) {
      const mid = (yMax + yMin) / 2;
      yMin = mid - this.options.yMinSpan / 2;
      yMax = mid + this.options.yMinSpan / 2;
    }
    // паддинг для label справа (если нужен)
    const rightPad = this.options.showLastLabel ? this.options.labelPadding : 2;
    const topPad = 2;
    const bottomPad = 2;
    const plotW = Math.max(10, cssW - rightPad - 2);
    const plotH = Math.max(10, cssH - topPad - bottomPad);
    const xToPx = (x: number): number =>
      2 + ((x - xMin) / (xMax - xMin)) * plotW;
    const yToPx = (y: number): number =>
      topPad + (1 - (y - yMin) / (yMax - yMin)) * plotH;

    // Заливка под линией (если задана)
    if (this.options.fillColor) {
      ctx.fillStyle = this.options.fillColor;
      ctx.beginPath();
      ctx.moveTo(xToPx(this.points[0]!.x), cssH - bottomPad);
      for (const p of this.points) {
        ctx.lineTo(xToPx(p.x), yToPx(p.y));
      }
      ctx.lineTo(xToPx(this.points[this.points.length - 1]!.x), cssH - bottomPad);
      ctx.closePath();
      ctx.fill();
    }

    // Линия
    ctx.strokeStyle = this.options.color;
    ctx.lineWidth = this.options.lineWidth;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let first = true;
    for (const p of this.points) {
      const x = xToPx(p.x);
      const y = yToPx(p.y);
      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Последняя точка — кружок + label
    const last = this.points[this.points.length - 1]!;
    const lastX = xToPx(last.x);
    const lastY = yToPx(last.y);
    ctx.fillStyle = this.options.color;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 2, 0, Math.PI * 2);
    ctx.fill();

    if (this.options.showLastLabel) {
      ctx.fillStyle = 'rgba(230, 230, 230, 0.9)';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(this.formatNum(last.y), lastX + 6, lastY + 3);
    }
  }

  private formatNum(n: number): string {
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    if (Math.abs(n) >= 10) return n.toFixed(0);
    return n.toFixed(1);
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }
}
