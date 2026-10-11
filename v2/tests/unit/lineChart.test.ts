// Тесты LineChart — unit-уровень, не требует DOM.

import { describe, it, expect } from 'vitest';
import { LineChart, type ChartSeries } from '../../src/ui/charts/LineChart.ts';

// jsdom не даёт настоящий CanvasRenderingContext2D, поэтому
// тестируем только API (setData, setTitle, setYUnit) без рендера.

function mockCanvas(): HTMLCanvasElement {
  const c = {
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
        width: 300,
        height: 100,
        toJSON: () => ({}),
      }) as DOMRect,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  } as unknown as HTMLCanvasElement;
  return c;
}

describe('LineChart API', () => {
  it('setData / setTitle / setYUnit / setXUnit / setOptions не падают', () => {
    const canvas = mockCanvas();
    const chart = new LineChart(canvas);
    const series: ChartSeries[] = [
      { name: 'A', color: '#fff', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      { name: 'B', color: '#000', points: [{ x: 0, y: 1 }, { x: 1, y: 2 }] },
    ];
    expect(() => chart.setData(series)).not.toThrow();
    expect(() => chart.setTitle('Test')).not.toThrow();
    expect(() => chart.setYUnit('м³/сут')).not.toThrow();
    expect(() => chart.setXUnit('ч')).not.toThrow();
    expect(() => chart.setOptions({ showGrid: false, yLog: true })).not.toThrow();
    chart.dispose();
  });

  it('setData принимает пустой массив', () => {
    const canvas = mockCanvas();
    const chart = new LineChart(canvas);
    expect(() => chart.setData([])).not.toThrow();
    chart.dispose();
  });

  it('setData принимает серию с пустыми точками', () => {
    const canvas = mockCanvas();
    const chart = new LineChart(canvas);
    expect(() =>
      chart.setData([{ name: 'empty', color: '#fff', points: [] }]),
    ).not.toThrow();
    chart.dispose();
  });

  it('disposable: dispose() можно вызвать несколько раз', () => {
    const canvas = mockCanvas();
    const chart = new LineChart(canvas);
    expect(() => chart.dispose()).not.toThrow();
    expect(() => chart.dispose()).not.toThrow();
  });

  it('formatNum не падает на экстремальных значениях', () => {
    // покрываем приватный метод через render с экстремальными данными
    const canvas = mockCanvas();
    const chart = new LineChart(canvas);
    chart.setData([
      {
        name: 'X',
        color: '#fff',
        points: [
          { x: 0, y: 1e9 },
          { x: 1, y: -1e9 },
          { x: 2, y: 0 },
        ],
      },
    ]);
    chart.dispose();
  });
});
