// Глобальные горячие клавиши.
//
// Подписывается на window.keydown. Эмитит события в EventBus
// и мутирует engine (pause/resume, скорость, режим).
//
// Дизайн: KeyboardShortcuts «знает» про engine и eventBus — это
// допустимо, потому что слой UI уже знает про app. Слой core
// остаётся изолированным.

import type { EventBus } from '../../app/EventBus.ts';
import type { SimulationEngine } from '../../app/SimulationEngine.ts';

export interface KeyboardShortcutsOptions {
  /** Включить клавиши режима размещения. По умолчанию true. */
  placementKeys?: boolean;
  /** Включить клавиши переключения view (1/2/3). По умолчанию true. */
  viewKeys?: boolean;
  /** Включить клавиши скорости. По умолчанию true. */
  speedKeys?: boolean;
}

export function attachKeyboardShortcuts(
  engine: SimulationEngine,
  eventBus: EventBus,
  options: KeyboardShortcutsOptions = {},
): { unsubscribe: () => void } {
  const enablePlacement = options.placementKeys ?? true;
  const enableView = options.viewKeys ?? true;
  const enableSpeed = options.speedKeys ?? true;

  const onKeyDown = (e: KeyboardEvent): void => {
    // Не реагируем, если фокус в input/textarea (слайдеры BHP, поля ввода)
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      // Разрешаем Space для input не переключать паузу — но Esc, etc. можно.
      return;
    }

    // Space — пауза/возобновить
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      engine.togglePause();
      return;
    }

    // Удаление — снять выделение через DOM event (TopBar слушает)
    if (e.key === 'Escape') {
      eventBus.emit('placementModeChanged', 'remove');
      return;
    }

    if (enableSpeed) {
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        engine.cycleSpeed(1);
        return;
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        engine.cycleSpeed(-1);
        return;
      }
      if (e.key === '0') {
        e.preventDefault();
        engine.setSpeed(1);
        return;
      }
    }

    if (enablePlacement) {
      if (e.key === 'p' || e.key === 'P' || e.key === 'з' || e.key === 'З') {
        eventBus.emit('placementModeChanged', 'producer');
        return;
      }
      if (e.key === 'i' || e.key === 'I' || e.key === 'ш' || e.key === 'Ш') {
        eventBus.emit('placementModeChanged', 'injector');
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        eventBus.emit('placementModeChanged', 'remove');
        return;
      }
    }

    if (enableView) {
      if (e.key === '1') {
        eventBus.emit('viewModeChanged', 'pressure');
        return;
      }
      if (e.key === '2') {
        eventBus.emit('viewModeChanged', 'saturation');
        return;
      }
    }
  };

  window.addEventListener('keydown', onKeyDown);
  return {
    unsubscribe: (): void => {
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}
