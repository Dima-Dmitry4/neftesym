// UI smoke test: монтирует App, проверяет базовые элементы и
// работу EventBus в живом UI-контексте.
//
// Запускается в jsdom (см. pragma ниже), чтобы были window, document,
// getComputedStyle, ResizeObserver, requestAnimationFrame.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// @vitest-environment jsdom

import { mountApp } from '../../src/app/App.ts';

/** Заглушка 2D-контекста: jsdom не реализует canvas без npm-пакета canvas.
 *  MapView будет работать, но без реальной отрисовки — это нормально для smoke. */
function makeStub2dContext(): CanvasRenderingContext2D {
  const imageData = { data: new Uint8ClampedArray(4), width: 1, height: 1 } as ImageData;
  const handler: ProxyHandler<object> = {
    get(_t, prop): unknown {
      if (prop === 'canvas') return null;
      if (prop === 'createImageData') return (w: number, h: number): ImageData => ({
        data: new Uint8ClampedArray(Math.max(0, w * h * 4)),
        width: w,
        height: h,
        colorSpace: 'srgb',
      } as ImageData);
      if (prop === 'getImageData') return (): ImageData => imageData;
      if (prop === 'putImageData') return (): void => {};
      if (prop === 'measureText') return (): TextMetrics => ({ width: 10 } as TextMetrics);
      if (prop === 'save' || prop === 'restore' || prop === 'beginPath' || prop === 'closePath' ||
          prop === 'moveTo' || prop === 'lineTo' || prop === 'stroke' || prop === 'fill' ||
          prop === 'arc' || prop === 'fillRect' || prop === 'strokeRect' || prop === 'setTransform' ||
          prop === 'translate' || prop === 'scale' || prop === 'rotate' || prop === 'clearRect' ||
          prop === 'fillText' || prop === 'strokeText' || prop === 'drawImage' || prop === 'rect') {
        return (): void => {};
      }
      return undefined;
    },
    set(): boolean {
      return true;
    },
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
}

// rAF и ResizeObserver нужно замокать — jsdom их не реализует.
beforeEach(() => {
  let lastId = 0;
  globalThis.requestAnimationFrame = ((_cb: FrameRequestCallback): number => {
    lastId++;
    // Не вызываем cb — тесты и так контролируют engine через stepN.
    return lastId;
  }) as typeof globalThis.requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((_id: number): void => {
    /* noop */
  }) as typeof globalThis.cancelAnimationFrame;

  // ResizeObserver stub — MapView зовёт observe() в конструкторе.
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = ResizeObserverStub;

  // Стуб для getContext('2d').
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const origAny = origGetContext as any;
  // Подменяем на версию без перегрузок — нас устраивает любая строка.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (HTMLCanvasElement.prototype as any).getContext = function (id: string): unknown {
    if (id === '2d') return makeStub2dContext();
    return origAny?.call(this, id) ?? null;
  };

  // jsdom не возвращает размер у clientRect — дадим канвасу ненулевой.
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: function (): DOMRect {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        bottom: 400,
        right: 400,
        width: 400,
        height: 400,
        toJSON: () => ({}),
      } as DOMRect;
    },
  });

  // devicePixelRatio по умолчанию 1
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('UI smoke (jsdom)', () => {
  it('mountApp создаёт #app → canvas + .well-card + statusbar', () => {
    const root = document.createElement('div');
    root.id = 'app';
    document.body.appendChild(root);

    const app = mountApp(root, { scenario: 'five-spot', startPaused: true });
    void app;

    // Карта с канвасом
    const canvas = root.querySelector<HTMLCanvasElement>('#map-canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.tagName).toBe('CANVAS');

    // TopBar присутствует
    expect(root.querySelector('.topbar')).not.toBeNull();

    // Bottom bar присутствует
    expect(root.querySelector('.bottombar')).not.toBeNull();

    // Status bar
    expect(root.querySelector('.statusbar')).not.toBeNull();

    // View'ы на месте (теперь только 2: map + charts)
    expect(root.querySelector('#view-map')).not.toBeNull();
    expect(root.querySelector('#view-charts')).not.toBeNull();
  });

  it('mountApp рисует well-card для каждой скважины пресета five-spot', () => {
    const root = document.createElement('div');
    root.id = 'app';
    document.body.appendChild(root);

    mountApp(root, { scenario: 'five-spot', startPaused: true });

    const cards = root.querySelectorAll('.well-card');
    expect(cards.length).toBe(5);
    // 4 продюсера + 1 инжектор
    expect(root.querySelectorAll('.well-card.producer').length).toBe(4);
    expect(root.querySelectorAll('.well-card.injector').length).toBe(1);
  });

  it('mountApp сценарий empty — нет well-card, есть подсказка', () => {
    const root = document.createElement('div');
    root.id = 'app';
    document.body.appendChild(root);

    mountApp(root, { scenario: 'empty', startPaused: true });

    const cards = root.querySelectorAll('.well-card');
    expect(cards.length).toBe(0);
    expect(root.querySelector('.wells-empty')).not.toBeNull();
  });

  it('mode-buttons переключают placementMode через EventBus', async () => {
    const root = document.createElement('div');
    root.id = 'app';
    document.body.appendChild(root);

    // Шпионим за placementModeChanged через шину событий.
    // Но в mountApp EventBus — приватная переменная. Поэтому проверяем
    // косвенно: нажать кнопку «Инжектор» и убедиться, что она стала active.
    mountApp(root, { scenario: 'empty', startPaused: true });

    const producerBtn = root.querySelector<HTMLButtonElement>('[data-mode-producer]');
    const injectorBtn = root.querySelector<HTMLButtonElement>('[data-mode-injector]');
    expect(producerBtn).not.toBeNull();
    expect(injectorBtn).not.toBeNull();
    if (!producerBtn || !injectorBtn) return;
    expect(producerBtn.classList.contains('active')).toBe(true);
    expect(injectorBtn.classList.contains('active')).toBe(false);

    injectorBtn.click();
    expect(injectorBtn.classList.contains('active')).toBe(true);
    expect(producerBtn.classList.contains('active')).toBe(false);
  });

  it('сценарий переключается через селектор', () => {
    const root = document.createElement('div');
    root.id = 'app';
    document.body.appendChild(root);

    mountApp(root, { scenario: 'five-spot', startPaused: true });
    const select = root.querySelector<HTMLSelectElement>('[data-scenario-select]');
    expect(select).not.toBeNull();
    if (!select) return;
    expect(select.value).toBe('five-spot');
    // Меняем на empty.
    select.value = 'empty';
    select.dispatchEvent(new Event('change'));
    // Карточки должны исчезнуть после перерисовки.
    expect(root.querySelectorAll('.well-card').length).toBe(0);
  });

  it('speed select содержит все ожидаемые опции', () => {
    const root = document.createElement('div');
    root.id = 'app';
    document.body.appendChild(root);

    mountApp(root, { scenario: 'five-spot', startPaused: true });
    const select = root.querySelector<HTMLSelectElement>('[data-speed-select]');
    expect(select).not.toBeNull();
    if (!select) return;
    const values = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(values).toContain('0.25');
    expect(values).toContain('1');
    expect(values).toContain('100');
  });

  it('map:cellclick приходит на канвас (через ручной dispatch)', () => {
    const root = document.createElement('div');
    root.id = 'app';
    document.body.appendChild(root);

    mountApp(root, { scenario: 'empty', startPaused: true });
    const canvas = root.querySelector<HTMLCanvasElement>('#map-canvas');
    expect(canvas).not.toBeNull();
    if (!canvas) return;

    // После mount — пусто. Симулируем пользовательский клик.
    const before = root.querySelectorAll('.well-card').length;
    canvas.dispatchEvent(
      new CustomEvent('map:cellclick', {
        detail: { i: 10, j: 10, shiftKey: false },
        bubbles: true,
      }),
    );
    const after = root.querySelectorAll('.well-card').length;
    expect(after).toBe(before + 1);
  });
});
