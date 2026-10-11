// Heatmap: рисует 2D-карту значений на Canvas2D.
//
// Использует ImageData — это самый быстрый способ заполнить
// прямоугольную сетку: один putImageData вместо N вызовов
// fillRect. Для 50×50 = 2500 px это незаметно, но ImageData
// масштабируется до 200×200 без потерь производительности.

import { rgbToCss } from './ColorScales.ts';

export type ColorFn = (t: number) => string;

/** Размеры канваса в CSS-пикселях (после учёта dpr). */
export interface HeatmapDims {
  width: number;
  height: number;
}

/**
 * Нарисовать heatmap.
 *
 * @param ctx          2D-контекст. Канвас уже отскалирован через ctx.scale(dpr, dpr).
 * @param values       Поле значений длины nCells (row-major: i + j*nx).
 * @param nx           Число ячеек по x.
 * @param ny           Число ячеек по y.
 * @param dims         Размеры области рисования в CSS-пикселях.
 * @param valueRange   [min, max] для нормализации.
 * @param colorFn      Функция цвета: t∈[0,1] → CSS.
 * @param active       Опц. Uint8Array масок активности. Неактивные ячейки
 *                     заливаются цветом `inactiveColor`.
 * @param inactiveColor CSS-цвет для неактивных ячеек.
 */
export function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  values: Float64Array,
  nx: number,
  ny: number,
  dims: HeatmapDims,
  valueRange: readonly [number, number],
  colorFn: ColorFn,
  active?: Uint8Array,
  inactiveColor: string = '#0b0f14',
): void {
  const { width, height } = dims;
  const cellW = width / nx;
  const cellH = height / ny;
  const [min, max] = valueRange;
  const range = max - min > 1e-12 ? max - min : 1;

  // ImageData в пикселях канваса. ctx.getImageData/Style уже
  // работают в пикселях, без dpr (потому что мы их не применяли
  // к канвасу — dpr учитывается отдельно, см. MapView).
  const dpr = window.devicePixelRatio || 1;
  const pxW = Math.max(1, Math.round(width * dpr));
  const pxH = Math.max(1, Math.round(height * dpr));
  const img = ctx.createImageData(pxW, pxH);
  const data = img.data;

  // Сначала зальём фон (inactive).
  const bg = parseColor(inactiveColor);
  for (let p = 0; p < pxW * pxH; p++) {
    data[p * 4 + 0] = bg[0];
    data[p * 4 + 1] = bg[1];
    data[p * 4 + 2] = bg[2];
    data[p * 4 + 3] = 255;
  }

  // Растеризуем ячейки. По каждой ячейке — прямоугольник пикселей.
  for (let j = 0; j < ny; j++) {
    const y0 = Math.floor((j * height / ny) * dpr);
    const y1 = Math.floor(((j + 1) * height / ny) * dpr);
    for (let i = 0; i < nx; i++) {
      const idx = i + j * nx;
      const isActive = active ? active[idx] === 1 : true;
      if (!isActive) continue;
      const v = values[idx] ?? 0;
      let t = (v - min) / range;
      if (!Number.isFinite(t)) t = 0;
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      const c = parseColor(colorFn(t));
      const x0 = Math.floor((i * width / nx) * dpr);
      const x1 = Math.floor(((i + 1) * width / nx) * dpr);
      for (let y = y0; y < y1; y++) {
        const row = y * pxW;
        for (let x = x0; x < x1; x++) {
          const o = (row + x) * 4;
          data[o + 0] = c[0];
          data[o + 1] = c[1];
          data[o + 2] = c[2];
          data[o + 3] = 255;
        }
      }
    }
  }

  ctx.putImageData(img, 0, 0);

  // Лёгкая сетка поверх — помогает глазомеру.
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < nx; i++) {
    const x = Math.round(i * cellW) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let j = 1; j < ny; j++) {
    const y = Math.round(j * cellH) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  ctx.restore();
}

/** Простой парсер CSS-цвета формата rgb(...) / #rrggbb. */
export function parseColor(css: string): Rgb {
  // rgb(r, g, b)
  const m = css.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (m) {
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  // #rrggbb
  const h = css.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (h) {
    return [parseInt(h[1] ?? '0', 16), parseInt(h[2] ?? '0', 16), parseInt(h[3] ?? '0', 16)];
  }
  // #rgb
  const hs = css.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (hs) {
    return [
      parseInt((hs[1] ?? '0') + (hs[1] ?? '0'), 16),
      parseInt((hs[2] ?? '0') + (hs[2] ?? '0'), 16),
      parseInt((hs[3] ?? '0') + (hs[3] ?? '0'), 16),
    ];
  }
  // fallback — серый
  void rgbToCss; // удовлетворяем lint unused-import
  return [128, 128, 128];
}

type Rgb = [number, number, number];
