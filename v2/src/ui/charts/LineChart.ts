// LineChart — простой линейный график для истории симуляции.
//
// Не использует внешних библиотек. Рисует одну или несколько
// серий в одной шкале. Поддерживает HiDPI.
//
// Использование:
//   const chart = new LineChart(canvas);
//   chart.setData([
//     { name: 'Q oil', color: '#d4a04a', points: [{x: 0, y: 100}, ...] },
//     { name: 'Q water', color: '#3b6ea5', points: [...] },
//   ]);
//   chart.setTitle('Дебиты');
//   chart.setYUnit('м³/сут');

import { getDevicePixelRatio } from '../../core/units.ts';

export interface ChartPoint {
  /** X — обычно симуляционное время в часах. */
  x: number;
  /** Y — значение. */
  y: number;
}

export interface ChartSeries {
  name: string;
  color: string;
  points: readonly ChartPoint[];
}

export interface LineChartOptions {
  padding?: number;
  /** Минимум по Y, если не задан — авто. */
  yMin?: number;
  /** Максимум по Y. */
  yMax?: number;
  /** Лог-шкала по Y. */
  yLog?: boolean;
  /** Показывать ли сетку. */
  showGrid?: boolean;
}

export class LineChart {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private title = '';
  // Единицы Y и X, используются в render() для аннотации осей.
  private yUnit = '';
  private xUnit = 'ч';
  private series: readonly ChartSeries[] = [];
  private opts: Required<Omit<LineChartOptions, 'yMin' | 'yMax'>> & {
    yMin?: number;
    yMax?: number;
  } = {
    padding: 4,
    yLog: false,
    showGrid: true,
  };
  private readonly disposers: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.warn('[LineChart] 2D context not available');
    }
    this.ctx = ctx;
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.resize());
      ro.observe(canvas);
      this.disposers.push(() => ro.disconnect());
    }
    // Перерисовка после первого layout — на случай если при конструкторе
    // канвас ещё не имел размеров (parent-grid не отложился).
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => this.resize());
      requestAnimationFrame(() => this.resize());
    } else if (typeof setTimeout === 'function') {
      setTimeout(() => this.resize(), 0);
    }
  }

  setData(series: readonly ChartSeries[]): void {
    this.series = series;
    this.render();
  }

  setTitle(title: string): void {
    this.title = title;
    this.render();
  }

  setYUnit(unit: string): void {
    this.yUnit = unit;
    this.render();
  }

  setXUnit(unit: string): void {
    this.xUnit = unit;
    this.render();
  }

  setOptions(opts: LineChartOptions): void {
    this.opts = { ...this.opts, ...opts };
    this.render();
  }

  resize(): void {
    const dpr = getDevicePixelRatio();
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(rect.width - this.opts.padding * 2));
    const cssH = Math.max(1, Math.floor(rect.height - this.opts.padding * 2));
    // Размер буфера (canvas.width/height как HTML-атрибуты) для чёткого рендера.
    // НЕ ставим canvas.style.width/height — иначе inline-style затрёт CSS `100%`,
    // и при первом layout (когда getBoundingClientRect ещё 0) канвас залипнет на 1×1.
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
    ctx.fillStyle = 'rgba(15, 20, 25, 0.95)';
    ctx.fillRect(0, 0, cssW, cssH);

      // Заголовок
    if (this.title) {
      ctx.fillStyle = 'rgba(230, 230, 230, 0.95)';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'left';
      const titleText = this.yUnit ? `${this.title}  (${this.yUnit})` : this.title;
      ctx.fillText(titleText, 6, 14);
    }

    // Область графика (под заголовком)
    const headerH = this.title ? 22 : 6;
    const legendH = this.series.length > 0 ? 16 : 0;
    const left = 36;
    const right = cssW - 4;
    const top = headerH;
    const bottom = cssH - legendH - 4;
    const plotW = Math.max(10, right - left);
    const plotH = Math.max(10, bottom - top);

    // Подпись оси X (по центру под осью)
    if (this.xUnit) {
      ctx.fillStyle = 'rgba(154, 163, 176, 0.7)';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(this.xUnit, left + plotW / 2, bottom + 12);
    }

    if (this.series.length === 0 || this.series.every((s) => s.points.length === 0)) {
      ctx.fillStyle = 'rgba(154, 163, 176, 0.6)';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Нет данных', left + plotW / 2, top + plotH / 2);
      return;
    }

    // Диапазоны
    let xMin = Infinity,
      xMax = -Infinity;
    let yMin = this.opts.yMin ?? Infinity,
      yMax = this.opts.yMax ?? -Infinity;
    for (const s of this.series) {
      for (const p of s.points) {
        if (p.x < xMin) xMin = p.x;
        if (p.x > xMax) xMax = p.x;
        if (this.opts.yMin === undefined && p.y < yMin) yMin = p.y;
        if (this.opts.yMax === undefined && p.y > yMax) yMax = p.y;
      }
    }
    if (!isFinite(xMin) || !isFinite(xMax) || xMax === xMin) {
      xMin = 0;
      xMax = 1;
    }
    if (!isFinite(yMin) || !isFinite(yMax) || yMax === yMin) {
      yMin = 0;
      yMax = 1;
    }
    if (this.opts.yLog) {
      yMin = Math.max(1e-3, yMin || 1e-3);
      yMax = Math.max(yMin * 10, yMax);
    } else {
      // добавим 5% паддинга сверху/снизу
      const pad = (yMax - yMin) * 0.05;
      yMin -= pad;
      yMax += pad;
    }

    const xToPx = (x: number): number =>
      left + ((x - xMin) / (xMax - xMin)) * plotW;
    const yToPx = (y: number): number => {
      let t: number;
      if (this.opts.yLog) {
        t = (Math.log10(Math.max(1e-3, y)) - Math.log10(yMin)) /
            (Math.log10(yMax) - Math.log10(yMin));
      } else {
        t = (y - yMin) / (yMax - yMin);
      }
      return bottom - t * plotH;
    };

    // Сетка
    if (this.opts.showGrid) {
      ctx.strokeStyle = 'rgba(154, 163, 176, 0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const gridLines = 4;
      for (let i = 1; i < gridLines; i++) {
        const y = top + (plotH * i) / gridLines;
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
      }
      ctx.stroke();
    }

    // Оси и подписи
    ctx.fillStyle = 'rgba(154, 163, 176, 0.85)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(this.formatNum(yMax), left - 4, top + 8);
    ctx.fillText(this.formatNum(yMin), left - 4, bottom);
    ctx.textAlign = 'left';
    ctx.fillText(this.formatNum(xMin), left, bottom + 12);
    ctx.textAlign = 'right';
    ctx.fillText(this.formatNum(xMax), right, bottom + 12);

    // Линии серий
    for (const s of this.series) {
      if (s.points.length === 0) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let first = true;
      for (const p of s.points) {
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
    }

    // Легенда
    if (this.series.length > 0) {
      const legendY = cssH - legendH + 2;
      let lx = 6;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'left';
      for (const s of this.series) {
        ctx.fillStyle = s.color;
        ctx.fillRect(lx, legendY + 4, 8, 2);
        ctx.fillStyle = 'rgba(230, 230, 230, 0.85)';
        ctx.fillText(s.name, lx + 12, legendY + 9);
        lx += ctx.measureText(s.name).width + 28;
        if (lx > cssW - 60) break;
      }
    }
  }

  private formatNum(n: number): string {
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    if (Math.abs(n) >= 10) return n.toFixed(0);
    if (Math.abs(n) >= 1) return n.toFixed(1);
    if (Math.abs(n) >= 0.01) return n.toFixed(2);
    return n.toExponential(1);
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }
}
