// EventBus: подписка/отписка/эмит, отписка через возвращённую функцию.

import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/app/EventBus.ts';
import type { FieldState } from '../../src/core/state/FieldState.ts';
import type { HistoryEntry } from '../../src/core/state/History.ts';

describe('EventBus', () => {
  it('on() регистрирует обработчик, emit() вызывает его', () => {
    const bus = new EventBus();
    const cb = vi.fn();
    bus.on('timeSpeedChanged', cb);
    bus.emit('timeSpeedChanged', 5);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(5);
  });

  it('возвращённая функция отписывает', () => {
    const bus = new EventBus();
    const cb = vi.fn();
    const off = bus.on('timeSpeedChanged', cb);
    off();
    bus.emit('timeSpeedChanged', 10);
    expect(cb).not.toHaveBeenCalled();
    expect(bus.listenerCount('timeSpeedChanged')).toBe(0);
  });

  it('off() отписывает конкретный callback', () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('timeSpeedChanged', a);
    bus.on('timeSpeedChanged', b);
    bus.off('timeSpeedChanged', a);
    bus.emit('timeSpeedChanged', 1);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
    expect(bus.listenerCount('timeSpeedChanged')).toBe(1);
  });

  it('listenerCount считает только активных подписчиков', () => {
    const bus = new EventBus();
    expect(bus.listenerCount('stateUpdated')).toBe(0);
    const off1 = bus.on('stateUpdated', () => {});
    bus.on('stateUpdated', () => {});
    expect(bus.listenerCount('stateUpdated')).toBe(2);
    off1();
    expect(bus.listenerCount('stateUpdated')).toBe(1);
  });

  it('emit с payload, содержащим сложный объект', () => {
    const bus = new EventBus();
    const cb = vi.fn();
    bus.on('stateUpdated', cb);
    const state = {
      pressure: new Float64Array([1, 2, 3]),
      sw: new Float64Array([0.3, 0.3, 0.3]),
      time: 10,
      step: 5,
      lastDt: 1,
    } as FieldState;
    bus.emit('stateUpdated', state);
    expect(cb).toHaveBeenCalledWith(state);
  });

  it('несколько подписчиков вызываются в порядке подписки', () => {
    const bus = new EventBus();
    const order: string[] = [];
    bus.on('historyAppended', () => order.push('first'));
    bus.on('historyAppended', () => order.push('second'));
    bus.on('historyAppended', () => order.push('third'));
    const entry = {} as HistoryEntry;
    bus.emit('historyAppended', entry);
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('ошибка в одном обработчике не ломает остальных', () => {
    const bus = new EventBus();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = vi.fn(() => {
      throw new Error('boom');
    });
    const b = vi.fn();
    bus.on('timeSpeedChanged', a);
    bus.on('timeSpeedChanged', b);
    bus.emit('timeSpeedChanged', 1);
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    errSpy.mockRestore();
  });

  it('подписчик может отписаться во время emit', () => {
    const bus = new EventBus();
    const calls: string[] = [];
    const cb = (): void => {
      calls.push('a');
      off();
    };
    const off = bus.on('timeSpeedChanged', cb);
    bus.on('timeSpeedChanged', () => calls.push('b'));
    bus.emit('timeSpeedChanged', 1);
    // cb отписался, но второй обработчик остался
    bus.emit('timeSpeedChanged', 2);
    expect(calls).toEqual(['a', 'b', 'b']);
  });

  it('clear() сбрасывает все подписки', () => {
    const bus = new EventBus();
    bus.on('timeSpeedChanged', () => {});
    bus.on('stateUpdated', () => {});
    expect(bus.listenerCount('timeSpeedChanged')).toBe(1);
    bus.clear();
    expect(bus.listenerCount('timeSpeedChanged')).toBe(0);
    expect(bus.listenerCount('stateUpdated')).toBe(0);
  });
});
