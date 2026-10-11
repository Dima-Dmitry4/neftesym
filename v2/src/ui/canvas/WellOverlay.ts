// Оверлей скважин поверх heatmap.
//
// Рисует маркеры скважин: producer (оранжевый) и injector (синий).
// При наличии hover — кольцо и подпись.

import type { Well } from '../../core/wells/Well.ts';
import type { Grid2D } from '../../core/grid/Grid2D.ts';

export interface WellOverlayOptions {
  /** Цвет producer (CSS). По умолчанию — var(--accent). */
  producerColor?: string;
  /** Цвет injector (CSS). По умолчанию — var(--accent-2). */
  injectorColor?: string;
  /** Радиус маркера, CSS-px. */
  markerRadius?: number;
  /** Индекс скважины под курсором (для hover-кольца). */
  hoveredId?: string | null;
  /** Выделенная скважина (для кольца выделения). */
  selectedId?: string | null;
}

const PRODUCER_DEFAULT = '#d4a04a';
const INJECTOR_DEFAULT = '#3b6ea5';

/** Нарисовать скважины поверх heatmap. */
export function drawWells(
  ctx: CanvasRenderingContext2D,
  wells: readonly Well[],
  grid: Grid2D,
  width: number,
  height: number,
  options: WellOverlayOptions = {},
): void {
  const producerColor = options.producerColor ?? PRODUCER_DEFAULT;
  const injectorColor = options.injectorColor ?? INJECTOR_DEFAULT;
  const r = options.markerRadius ?? Math.max(4, Math.min(width, height) / 80);

  const cellW = width / grid.nx;
  const cellH = height / grid.ny;

  ctx.save();
  for (const w of wells) {
    if (!grid.isInside(w.i, w.j)) continue;
    const x = (w.i + 0.5) * cellW;
    const y = (w.j + 0.5) * cellH;
    const color = w.type === 'producer' ? producerColor : injectorColor;

    // Затемнение/свечение для неактивной ячейки (за границей контура)
    const isHovered = options.hoveredId === w.id;
    const isSelected = options.selectedId === w.id;

    // Внешнее кольцо
    if (isHovered || isSelected) {
      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = isSelected ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.55)';
      ctx.stroke();
    }

    // Маркер: круг с белой обводкой
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.stroke();

    // Стрелка направления для producer (вниз — добыча) и injector (вверх — закачка)
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.lineWidth = 1.5;
    if (w.type === 'producer') {
      const yTop = y - r * 0.4;
      const yBot = y + r * 0.4;
      ctx.moveTo(x, yTop);
      ctx.lineTo(x, yBot);
      ctx.moveTo(x - r * 0.3, yBot - r * 0.3);
      ctx.lineTo(x, yBot);
      ctx.lineTo(x + r * 0.3, yBot - r * 0.3);
    } else {
      const yTop = y - r * 0.4;
      const yBot = y + r * 0.4;
      ctx.moveTo(x, yBot);
      ctx.lineTo(x, yTop);
      ctx.moveTo(x - r * 0.3, yTop + r * 0.3);
      ctx.lineTo(x, yTop);
      ctx.lineTo(x + r * 0.3, yTop + r * 0.3);
    }
    ctx.stroke();

    // Подпись ID
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(w.id, x + r + 3, y - r - 2);
  }
  ctx.restore();
}
