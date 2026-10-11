// Тесты CrossSectionView — в основном API и инициализация.
// Реальный рендер не тестируем (нужен canvas-контекст).

import { describe, it, expect } from 'vitest';

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
        width: 300,
        height: 200,
        toJSON: () => ({}),
      }) as DOMRect,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  } as unknown as HTMLCanvasElement;
}

describe('CrossSectionView API', () => {
  const fakeEventBus = {
    on: (_key: string, cb: (s: never) => void) => {
      void cb;
      return () => undefined;
    },
    emit: () => undefined,
  };
  const fakeEngine = {
    getReservoir: () => null,
    getState: () => null,
    getWells: () => [],
  };

  it('импортируется и инстанцируется без ошибок без reservoir', async () => {
    const { CrossSectionView } = await import('../../src/ui/canvas/CrossSectionView.ts');
    const canvas = mockCanvas();
    const view = new CrossSectionView(canvas, fakeEventBus as never, fakeEngine as never);
    expect(view.getMode()).toBe('saturation');
    expect(view.getRow()).toBe(0);
    view.dispose();
  });

  it('setMode переключает режим, getMode возвращает', async () => {
    const { CrossSectionView } = await import('../../src/ui/canvas/CrossSectionView.ts');
    const canvas = mockCanvas();
    const view = new CrossSectionView(canvas, fakeEventBus as never, fakeEngine as never);
    view.setMode('pressure');
    expect(view.getMode()).toBe('pressure');
    view.setMode('saturation');
    expect(view.getMode()).toBe('saturation');
    view.dispose();
  });

  it('setRow без reservoir не падает и не меняет значение', async () => {
    const { CrossSectionView } = await import('../../src/ui/canvas/CrossSectionView.ts');
    const canvas = mockCanvas();
    const view = new CrossSectionView(canvas, fakeEventBus as never, fakeEngine as never);
    expect(view.getRow()).toBe(0);
    view.setRow(10);
    expect(view.getRow()).toBe(0);
    view.dispose();
  });

  it('setRow клампит значение в допустимый диапазон при наличии reservoir', async () => {
    const { CrossSectionView } = await import('../../src/ui/canvas/CrossSectionView.ts');
    const canvas = mockCanvas();
    const reservoir = {
      grid: { nx: 50, ny: 50, dx: 20, dy: 20, depthTop: 2800 },
      thickness: new Float64Array(2500).fill(15),
      porosity: new Float64Array(2500).fill(0.2),
      permX: new Float64Array(2500).fill(100),
      permY: new Float64Array(2500).fill(100),
      permZ: new Float64Array(2500).fill(10),
      initialP: new Float64Array(2500).fill(245),
      initialSw: new Float64Array(2500).fill(0.25),
      active: new Uint8Array(2500).fill(1),
    };
    const engine = {
      getReservoir: () => reservoir,
      getState: () => null,
      getWells: () => [],
    };
    const view = new CrossSectionView(canvas, fakeEventBus as never, engine as never);
    expect(view.getRow()).toBe(25);
    view.setRow(100);
    expect(view.getRow()).toBe(49);
    view.setRow(-5);
    expect(view.getRow()).toBe(0);
    view.dispose();
  });
});
