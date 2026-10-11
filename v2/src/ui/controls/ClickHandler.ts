// Конвертация мышиных координат в индекс ячейки (i, j) на heatmap.
//
// Используется из MapView. Логика координат изолирована от DOM,
// чтобы её можно было юнит-тестировать без браузера.

export interface CellHit {
  i: number;
  j: number;
}

/**
 * Перевести клиентские CSS-координаты в индекс ячейки.
 *
 * @param cssX  X в CSS-пикселях относительно canvas (например, e.clientX - rect.left).
 * @param cssY  Y в CSS-пикселях относительно canvas.
 * @param cssWidth   Ширина canvas в CSS-пикселях.
 * @param cssHeight  Высота canvas в CSS-пикселях.
 * @param nx   Число ячеек по x.
 * @param ny   Число ячеек по y.
 * @param padding  Отступ от края в CSS-пикселях (клики в отступе — null).
 *
 * Возвращает null, если клик вне рабочей области.
 */
export function mouseToCell(
  cssX: number,
  cssY: number,
  cssWidth: number,
  cssHeight: number,
  nx: number,
  ny: number,
  padding: number = 0,
): CellHit | null {
  if (cssX < padding || cssY < padding) return null;
  const w = cssWidth - 2 * padding;
  const h = cssHeight - 2 * padding;
  if (cssX > cssWidth - padding || cssY > cssHeight - padding) return null;
  if (w <= 0 || h <= 0 || nx <= 0 || ny <= 0) return null;
  const lx = cssX - padding;
  const ly = cssY - padding;
  const i = Math.floor((lx / w) * nx);
  const j = Math.floor((ly / h) * ny);
  if (i < 0 || i >= nx || j < 0 || j >= ny) return null;
  return { i, j };
}

/**
 * Перевести клиентские (viewport) координаты события в координаты
 * относительно canvas с учётом HiDPI.
 *
 * @param clientX  e.clientX из MouseEvent.
 * @param clientY  e.clientY.
 * @param rect     canvas.getBoundingClientRect().
 */
export function clientToCanvasCss(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number },
): { x: number; y: number } {
  return { x: clientX - rect.left, y: clientY - rect.top };
}

/** DOM-обёртка: подписывается на mousedown/mousemove/mouseleave. */
export interface ClickHandlerCallbacks {
  onClick: (cell: CellHit, e: MouseEvent) => void;
  onShiftClick?: (cell: CellHit, e: MouseEvent) => void;
  onHover?: (cell: CellHit | null, e: MouseEvent | null) => void;
}

export interface AttachedClickHandler {
  unsubscribe: () => void;
}

export function attachClickHandler(
  canvas: HTMLCanvasElement,
  nx: number,
  ny: number,
  callbacks: ClickHandlerCallbacks,
  padding: number = 0,
): AttachedClickHandler {
  const onMouseDown = (e: MouseEvent): void => {
    const rect = canvas.getBoundingClientRect();
    const { x, y } = clientToCanvasCss(e.clientX, e.clientY, rect);
    const cell = mouseToCell(x, y, rect.width, rect.height, nx, ny, padding);
    if (!cell) return;
    if (e.shiftKey) {
      callbacks.onShiftClick?.(cell, e);
    } else {
      callbacks.onClick(cell, e);
    }
  };
  const onMouseMove = (e: MouseEvent): void => {
    if (!callbacks.onHover) return;
    const rect = canvas.getBoundingClientRect();
    const { x, y } = clientToCanvasCss(e.clientX, e.clientY, rect);
    const cell = mouseToCell(x, y, rect.width, rect.height, nx, ny, padding);
    callbacks.onHover(cell, e);
  };
  const onMouseLeave = (e: MouseEvent): void => {
    if (!callbacks.onHover) return;
    callbacks.onHover(null, e);
  };
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseleave', onMouseLeave);
  return {
    unsubscribe: (): void => {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
    },
  };
}
