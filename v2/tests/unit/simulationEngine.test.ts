// SimulationEngine: тестируем state-методы (pause/resume/speed/stepN),
// add/remove wells, updateBHP, loadScenario. rAF-цикл не запускаем.

import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/app/EventBus.ts';
import { SimulationEngine, type EngineClock } from '../../src/app/SimulationEngine.ts';

/** Заглушка rAF, которая не вызывает callback — для чистых тестов. */
const noopClock: EngineClock = {
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
};

describe('SimulationEngine — управление циклом', () => {
  it('стартует не на паузе, скорость по умолчанию 1', () => {
    const bus = new EventBus();
    const engine = new SimulationEngine(bus, {}, noopClock);
    expect(engine.isPaused()).toBe(false);
    expect(engine.getSpeed()).toBe(1);
    expect(engine.isRunning()).toBe(false);
  });

  it('start() запускает rAF, stop() останавливает', () => {
    const bus = new EventBus();
    let rafId = 0;
    let cancelCalled = false;
    const clock: EngineClock = {
      requestAnimationFrame: () => {
        rafId = 42;
        return 42;
      },
      cancelAnimationFrame: (id) => {
        if (id === 42) cancelCalled = true;
      },
    };
    const engine = new SimulationEngine(bus, {}, clock);
    engine.start();
    expect(engine.isRunning()).toBe(true);
    expect(rafId).toBe(42);
    engine.stop();
    expect(engine.isRunning()).toBe(false);
    expect(cancelCalled).toBe(true);
  });

  it('pause()/resume()/togglePause()', () => {
    const bus = new EventBus();
    const speedListener = vi.fn();
    bus.on('timeSpeedChanged', speedListener);
    const engine = new SimulationEngine(bus, {}, noopClock);
    engine.pause();
    expect(engine.isPaused()).toBe(true);
    engine.resume();
    expect(engine.isPaused()).toBe(false);
    engine.togglePause();
    expect(engine.isPaused()).toBe(true);
    engine.togglePause();
    expect(engine.isPaused()).toBe(false);
    // speedListener вызывался 2 раза при resume
    expect(speedListener).toHaveBeenCalled();
  });

  it('setSpeed() устанавливает скорость и эмитит', () => {
    const bus = new EventBus();
    const cb = vi.fn();
    bus.on('timeSpeedChanged', cb);
    const engine = new SimulationEngine(bus, {}, noopClock);
    engine.setSpeed(5);
    expect(engine.getSpeed()).toBe(5);
    expect(cb).toHaveBeenCalledWith(5);
  });

  it('setSpeed(0) допустимо (стоп по времени)', () => {
    const bus = new EventBus();
    const engine = new SimulationEngine(bus, {}, noopClock);
    engine.setSpeed(0);
    expect(engine.getSpeed()).toBe(0);
  });

  it('cycleSpeed идёт по списку speedOptions', () => {
    const bus = new EventBus();
    const engine = new SimulationEngine(bus, {}, noopClock);
    engine.setSpeed(1);
    expect(engine.cycleSpeed(1)).toBeGreaterThan(1);
    expect(engine.cycleSpeed(-1)).toBe(1);
  });
});

describe('SimulationEngine — скважины', () => {
  it('addWell добавляет и эмитит wellsChanged', () => {
    const bus = new EventBus();
    const cb = vi.fn();
    bus.on('wellsChanged', cb);
    const engine = new SimulationEngine(bus, { scenario: 'empty' }, noopClock);
    engine.addWell({
      type: 'producer',
      id: 'P1',
      i: 5,
      j: 5,
      bhpAtm: 100,
      rw: 0.1,
      skin: 0,
    });
    expect(engine.getWells()).toHaveLength(1);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('addWell с дублирующимся id бросает', () => {
    const bus = new EventBus();
    const engine = new SimulationEngine(bus, { scenario: 'empty' }, noopClock);
    engine.addWell({
      type: 'producer',
      id: 'P1',
      i: 5,
      j: 5,
      bhpAtm: 100,
      rw: 0.1,
      skin: 0,
    });
    expect(() =>
      engine.addWell({
        type: 'producer',
        id: 'P1',
        i: 6,
        j: 6,
        bhpAtm: 100,
        rw: 0.1,
        skin: 0,
      }),
    ).toThrow();
  });

  it('removeWell удаляет', () => {
    const bus = new EventBus();
    const cb = vi.fn();
    bus.on('wellsChanged', cb);
    const engine = new SimulationEngine(bus, { scenario: 'empty' }, noopClock);
    engine.addWell({
      type: 'producer',
      id: 'P1',
      i: 5,
      j: 5,
      bhpAtm: 100,
      rw: 0.1,
      skin: 0,
    });
    cb.mockClear();
    engine.removeWell('P1');
    expect(engine.getWells()).toHaveLength(0);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('removeWell несуществующего id — no-op', () => {
    const bus = new EventBus();
    const engine = new SimulationEngine(bus, { scenario: 'empty' }, noopClock);
    expect(() => engine.removeWell('NOPE')).not.toThrow();
  });

  it('updateBHP обновляет BHP скважины', () => {
    const bus = new EventBus();
    const engine = new SimulationEngine(bus, { scenario: 'empty' }, noopClock);
    engine.addWell({
      type: 'producer',
      id: 'P1',
      i: 5,
      j: 5,
      bhpAtm: 100,
      rw: 0.1,
      skin: 0,
    });
    engine.updateBhp('P1', 80);
    expect((engine.getWells()[0] as { bhpAtm: number }).bhpAtm).toBe(80);
  });

  it('createWellAt генерирует уникальный id', () => {
    const bus = new EventBus();
    const engine = new SimulationEngine(bus, { scenario: 'empty' }, noopClock);
    const a = engine.createWellAt(10, 10, 'producer');
    const b = engine.createWellAt(15, 15, 'producer');
    const c = engine.createWellAt(20, 20, 'injector');
    expect(a.id).toBe('P1');
    expect(b.id).toBe('P2');
    expect(c.id).toBe('I1');
  });
});

describe('SimulationEngine — продвижение состояния', () => {
  it('stepN продвигает state.time', () => {
    const bus = new EventBus();
    const engine = new SimulationEngine(bus, { scenario: 'five-spot' }, noopClock);
    const t0 = engine.getState().time;
    engine.stepN(5, 1); // 5 шагов по 1 ч
    // time = n * dt ровно (внутри CFL subdivision суммируется до dt).
    expect(engine.getState().time).toBeCloseTo(t0 + 5, 6);
    // step ≥ n (≥ 1 substep на каждый вызов stepN).
    expect(engine.getState().step).toBeGreaterThanOrEqual(5);
  });

  it('после серии шагов pressure в пределах физического диапазона', () => {
    const bus = new EventBus();
    const engine = new SimulationEngine(bus, { scenario: 'five-spot' }, noopClock);
    engine.stepN(20, 1);
    const r = engine.getReservoir();
    const p = engine.getState().pressure;
    for (let i = 0; i < p.length; i++) {
      if (r.active[i] !== 1) continue;
      const v = p[i] ?? 0;
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(500);
    }
  });

  it('loadScenario сбрасывает state и wells', () => {
    const bus = new EventBus();
    const engine = new SimulationEngine(bus, { scenario: 'five-spot' }, noopClock);
    engine.stepN(10, 1);
    expect(engine.getState().time).toBeGreaterThan(0);
    expect(engine.getWells().length).toBeGreaterThan(0);
    engine.loadScenario('empty');
    expect(engine.getState().time).toBe(0);
    expect(engine.getWells().length).toBe(0);
  });

  it('getMetrics возвращает wall-time и steps', () => {
    const bus = new EventBus();
    const engine = new SimulationEngine(bus, { scenario: 'five-spot' }, noopClock);
    engine.stepN(3, 1);
    const m = engine.getMetrics();
    // steps ≥ n (CFL subdivision может увеличить).
    expect(m.steps).toBeGreaterThanOrEqual(3);
    expect(m.wallTimeSeconds).toBeGreaterThanOrEqual(0);
    expect(m.historySize).toBeGreaterThanOrEqual(0);
  });

  it('getAvailableScenarios содержит все пресеты', () => {
    const bus = new EventBus();
    const engine = new SimulationEngine(bus, { scenario: 'empty' }, noopClock);
    const names = engine.getAvailableScenarios();
    expect(names).toContain('five-spot');
    expect(names).toContain('empty');
    expect(names.length).toBeGreaterThanOrEqual(6);
  });
});
