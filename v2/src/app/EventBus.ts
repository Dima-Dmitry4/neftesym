// Минимальный typed EventBus.
//
// `AppEvents` — словарь «имя события → тип полезной нагрузки».
// `on()` возвращает функцию-отписки; `emit()` синхронно вызывает
// всех подписчиков в порядке подписки.
//
// Дизайн: никаких сторонних библиотек, никакого DI-фреймворка.
// core/ не импортирует EventBus — он нужен только в app/ и ui/.

import type { FieldState } from '../core/state/FieldState.ts';
import type { HistoryEntry } from '../core/state/History.ts';
import type { Reservoir } from '../core/grid/Reservoir.ts';
import type { Well } from '../core/wells/Well.ts';

export interface AppEvents {
  /** Состояние поля обновилось (на каждом кадре). */
  stateUpdated: FieldState;
  /** Список скважин изменился. */
  wellsChanged: ReadonlyArray<Well>;
  /** В history добавлена новая запись. */
  historyAppended: HistoryEntry;
  /** Множитель скорости изменился. */
  timeSpeedChanged: number;
  /** Загружен новый сценарий. */
  scenarioLoaded: {
    name: string;
    reservoir: Reservoir;
    wells: ReadonlyArray<Well>;
  };
  /** Произошла ошибка (симуляция, рендер, валидация). */
  error: { message: string; cause?: unknown };
  /** Режим размещения скважин изменился. */
  placementModeChanged: 'producer' | 'injector' | 'remove';
  /** Текущая визуализируемая величина изменилась. */
  viewModeChanged: 'pressure' | 'saturation';
}

export type EventKey = keyof AppEvents;
export type Listener<K extends EventKey> = (payload: AppEvents[K]) => void;
export type Unsubscribe = () => void;

export class EventBus {
  // Внутреннее хранилище: используем `unknown` для типизации в runtime,
  // потому что mapped type с generic K не сводится в TS.
  private readonly listeners: Map<EventKey, Set<(payload: unknown) => void>> = new Map();

  /** Подписаться на событие. Возвращает функцию отписки. */
  on<K extends EventKey>(key: K, cb: Listener<K>): Unsubscribe {
    let set = this.listeners.get(key) as Set<Listener<K>> | undefined;
    if (!set) {
      set = new Set<Listener<K>>();
      this.listeners.set(key, set as unknown as Set<(payload: unknown) => void>);
    }
    set.add(cb);
    return () => {
      const s = this.listeners.get(key) as Set<Listener<K>> | undefined;
      if (s) s.delete(cb);
    };
  }

  /** Отписаться. Эквивалентно вызову функции, возвращённой из `on()`. */
  off<K extends EventKey>(key: K, cb: Listener<K>): void {
    const s = this.listeners.get(key) as Set<Listener<K>> | undefined;
    if (s) s.delete(cb);
  }

  /** Эмит события. Все подписчики вызываются синхронно. */
  emit<K extends EventKey>(key: K, payload: AppEvents[K]): void {
    const s = this.listeners.get(key) as Set<Listener<K>> | undefined;
    if (!s || s.size === 0) return;
    // Копия, чтобы подписчик мог отписаться во время обхода.
    for (const cb of [...s]) {
      try {
        cb(payload);
      } catch (err) {
        // Глотаем ошибки, но пишем в console.error для отладки.
        console.error(`[EventBus] listener for "${String(key)}" threw:`, err);
      }
    }
  }

  /** Удалить всех подписчиков. Полезно при teardown. */
  clear(): void {
    this.listeners.clear();
  }

  /** Число подписчиков на конкретное событие (для тестов). */
  listenerCount<K extends EventKey>(key: K): number {
    const s = this.listeners.get(key) as Set<Listener<K>> | undefined;
    return s ? s.size : 0;
  }
}
