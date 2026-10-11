// Тесты Sparkline — минимальный API.

import { describe, it, expect } from 'vitest';
import { Sparkline } from '../../src/ui/charts/Sparkline.ts';

function mockCanvas(): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    style: {},
    getContext: () => null,
    getBoundingClientRect: () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        width: 200,
        height: 30,
        toJSON: () => ({}),
      }) as DOMRect,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  } as unknown as HTMLCanvasElement;
}

describe('Sparkline', () => {
  it('создаётся и принимает данные', () => {
    const c = mockCanvas();
    const sl = new Sparkline(c, { color: '#fff' });
    expect(() =>
      sl.setData([
        { x: 0, y: 100 },
        { x: 1, y: 110 },
        { x: 2, y: 90 },
      ]),
    ).not.toThrow();
    sl.dispose();
  });

  it('setOptions не падает', () => {
    const c = mockCanvas();
    const sl = new Sparkline(c, { color: '#fff' });
    expect(() =>
      sl.setOptions({ fillColor: 'rgba(0,0,0,0.1)', showLastLabel: true }),
    ).not.toThrow();
    sl.dispose();
  });

  it('принимает пустые данные и одну точку', () => {
    const c = mockCanvas();
    const sl = new Sparkline(c, { color: '#fff' });
    expect(() => sl.setData([])).not.toThrow();
    expect(() => sl.setData([{ x: 0, y: 1 }])).not.toThrow();
    sl.dispose();
  });

  it('dispose идемпотентен', () => {
    const c = mockCanvas();
    const sl = new Sparkline(c);
    sl.dispose();
    expect(() => sl.dispose()).not.toThrow();
  });

  it('работает с yMinSpan для плоской линии', () => {
    const c = mockCanvas();
    const sl = new Sparkline(c, { yMinSpan: 10 });
    expect(() =>
      sl.setData([
        { x: 0, y: 100 },
        { x: 1, y: 100 },
        { x: 2, y: 100 },
      ]),
    ).not.toThrow();
    sl.dispose();
  });
});
