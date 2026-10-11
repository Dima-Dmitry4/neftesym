// ClickHandler: чистая функция mouseToCell — координаты мыши в индекс ячейки.
// Тестируем математику без DOM.

import { describe, it, expect } from 'vitest';
import {
  mouseToCell,
  clientToCanvasCss,
} from '../../src/ui/controls/ClickHandler.ts';

describe('ClickHandler.mouseToCell', () => {
  it('центр канваса → центральная ячейка', () => {
    const cell = mouseToCell(50, 50, 100, 100, 10, 10);
    expect(cell).toEqual({ i: 5, j: 5 });
  });

  it('верхний левый угол (0.5px) → (0, 0)', () => {
    const cell = mouseToCell(0.5, 0.5, 100, 100, 10, 10);
    expect(cell).toEqual({ i: 0, j: 0 });
  });

  it('нижний правый угол → (nx-1, ny-1)', () => {
    const cell = mouseToCell(99.9, 99.9, 100, 100, 10, 10);
    expect(cell).toEqual({ i: 9, j: 9 });
  });

  it('вне границ (за пределами) → null', () => {
    expect(mouseToCell(-1, 5, 100, 100, 10, 10)).toBeNull();
    expect(mouseToCell(5, -1, 100, 100, 10, 10)).toBeNull();
    expect(mouseToCell(100, 5, 100, 100, 10, 10)).toBeNull();
    expect(mouseToCell(5, 100, 100, 100, 10, 10)).toBeNull();
  });

  it('учитывает padding', () => {
    // Канвас 100x100, padding 10 → рабочая область 80x80, начиная с (10, 10)
    // Клик в (50, 50) → в рабочей области (40, 40) → i = floor(40/80 * 10) = 5
    const cell = mouseToCell(50, 50, 100, 100, 10, 10, 10);
    expect(cell).toEqual({ i: 5, j: 5 });

    // Клик в padding (5, 5) → null
    expect(mouseToCell(5, 5, 100, 100, 10, 10, 10)).toBeNull();

    // Клик у дальней границы padding
    expect(mouseToCell(95, 95, 100, 100, 10, 10, 10)).toBeNull();
  });

  it('не равномерная сетка (50x100 ячеек в 100x100 px) — корректное i и j', () => {
    // 50 ячеек по x → 2 px/ячейка. Клик в (5, 80) → i=2, j=39
    const cell = mouseToCell(5, 80, 100, 100, 50, 50);
    expect(cell).toEqual({ i: 2, j: 40 });
  });

  it('невалидные размеры → null', () => {
    expect(mouseToCell(5, 5, 0, 0, 10, 10)).toBeNull();
    expect(mouseToCell(5, 5, 100, 100, 0, 0)).toBeNull();
  });
});

describe('ClickHandler.clientToCanvasCss', () => {
  it('вычитает rect.left и rect.top', () => {
    expect(clientToCanvasCss(150, 200, { left: 100, top: 150 })).toEqual({
      x: 50,
      y: 50,
    });
  });

  it('нулевой rect → координаты совпадают с client', () => {
    expect(clientToCanvasCss(10, 20, { left: 0, top: 0 })).toEqual({ x: 10, y: 20 });
  });

  it('отрицательный результат — клик выше/левее rect', () => {
    expect(clientToCanvasCss(5, 5, { left: 10, top: 10 })).toEqual({ x: -5, y: -5 });
  });
});
