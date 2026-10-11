// ColorScales: проверка, что colormap-функции возвращают валидные CSS-цвета
// и что монотонные colormap'ы действительно монотонны.

import { describe, it, expect } from 'vitest';
import { viridis, brownBlue, interpolateColor, rgbToCss, normalize } from '../../src/ui/canvas/ColorScales.ts';

describe('ColorScales', () => {
  it('viridis(0) и viridis(1) — разные цвета, оба rgb(...)', () => {
    const a = viridis(0);
    const b = viridis(1);
    expect(a).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    expect(b).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    expect(a).not.toBe(b);
  });

  it('brownBlue(0) — коричневый, brownBlue(1) — синий', () => {
    const a = brownBlue(0);
    const b = brownBlue(1);
    expect(a).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    expect(b).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    // Коричневый доминирует красным каналом, синий — синим.
    const rgb = (s: string): { r: number; b: number } => {
      const m = s.match(/rgb\((\d+), (\d+), (\d+)\)/);
      if (!m) throw new Error(`bad color: ${s}`);
      return { r: Number(m[1]), b: Number(m[3]) };
    };
    const a1 = rgb(a);
    const b1 = rgb(b);
    expect(a1.r).toBeGreaterThan(a1.b); // коричневый — больше R, чем B
    expect(b1.r).toBeLessThan(b1.b);     // синий — больше B, чем R
  });

  it('интерполяция t=0 возвращает c1, t=1 — c2', () => {
    expect(interpolateColor([10, 20, 30], [200, 150, 100], 0)).toEqual([10, 20, 30]);
    expect(interpolateColor([10, 20, 30], [200, 150, 100], 1)).toEqual([200, 150, 100]);
  });

  it('интерполяция t=0.5 — середина', () => {
    expect(interpolateColor([0, 0, 0], [100, 200, 50], 0.5)).toEqual([50, 100, 25]);
  });

  it('t клампится в [0, 1]', () => {
    expect(interpolateColor([10, 20, 30], [200, 150, 100], -1)).toEqual([10, 20, 30]);
    expect(interpolateColor([10, 20, 30], [200, 150, 100], 2)).toEqual([200, 150, 100]);
  });

  it('rgbToCss выдаёт корректный формат', () => {
    expect(rgbToCss([0, 128, 255])).toBe('rgb(0, 128, 255)');
  });

  it('viridis монотонно ярче с ростом t (luminance)', () => {
    const lum = (s: string): number => {
      const m = s.match(/rgb\((\d+), (\d+), (\d+)\)/);
      if (!m) throw new Error(s);
      const r = Number(m[1]);
      const g = Number(m[2]);
      const b = Number(m[3]);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const a = lum(viridis(0.0));
    const b = lum(viridis(0.5));
    const c = lum(viridis(1.0));
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('normalize: простая линейная нормализация', () => {
    expect(normalize(0, 0, 10)).toBe(0);
    expect(normalize(10, 0, 10)).toBe(1);
    expect(normalize(5, 0, 10)).toBe(0.5);
    expect(normalize(15, 0, 10)).toBe(1.5); // за пределами
    expect(normalize(-5, 0, 10)).toBe(-0.5);
  });

  it('normalize: защита от max <= min', () => {
    expect(normalize(5, 10, 10)).toBe(0);
    expect(normalize(5, 10, 5)).toBe(0);
  });
});
