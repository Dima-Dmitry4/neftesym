// Repro: добавление новой скважины ломает процесс.

import { describe, it, expect } from 'vitest';
import { EventBus } from '../../src/app/EventBus.ts';
import { SimulationEngine, type EngineClock } from '../../src/app/SimulationEngine.ts';

const noopClock: EngineClock = {
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
};

describe('Repro: addWell во время симуляции', () => {
  it('старт → 5 шагов → addWell → ещё 5 шагов не падает и не даёт NaN', () => {
    const bus = new EventBus();
    const engine = new SimulationEngine(
      bus,
      { scenario: 'empty', paused: true },
      noopClock,
    );
    // 1) Стартуем с пустым полем, делаем 5 шагов.
    for (let i = 0; i < 5; i++) engine.stepN(1, 24);
    let s = engine.getState();
    expect(Number.isFinite(s.pressure[0] ?? 0)).toBe(true);
    // 2) Добавляем скважину.
    engine.addWell({
      type: 'producer',
      id: 'P1',
      i: 10,
      j: 10,
      bhpAtm: 100,
      rw: 0.1,
      skin: 0,
    });
    expect(engine.getWells()).toHaveLength(1);
    // 3) Делаем ещё 5 шагов.
    for (let i = 0; i < 5; i++) engine.stepN(1, 24);
    s = engine.getState();
    expect(Number.isFinite(s.pressure[0] ?? 0)).toBe(true);
    // 4) Добавляем ещё одну.
    engine.addWell({
      type: 'injector',
      id: 'I1',
      i: 30,
      j: 30,
      bhpAtm: 290,
      rw: 0.1,
      skin: 0,
    });
    for (let i = 0; i < 5; i++) engine.stepN(1, 24);
    s = engine.getState();
    expect(Number.isFinite(s.pressure[0] ?? 0)).toBe(true);
    // Все P в разумных пределах.
    let pMin = Infinity;
    let pMax = -Infinity;
    for (let i = 0; i < s.pressure.length; i++) {
      const p = s.pressure[i] ?? 0;
      if (p < pMin) pMin = p;
      if (p > pMax) pMax = p;
    }
    expect(pMin).toBeGreaterThan(-1000);
    expect(pMax).toBeLessThan(10_000);
  });

  it('addWell с rate limit + 1 год симуляции не падает', () => {
    const bus = new EventBus();
    const engine = new SimulationEngine(
      bus,
      { scenario: 'five-spot', paused: true },
      noopClock,
    );
    // 1) Старт с 5-spot, шагаем 1 год.
    for (let i = 0; i < 365; i++) engine.stepN(1, 24);
    let s = engine.getState();
    expect(Number.isFinite(s.pressure[0] ?? 0)).toBe(true);
    // 2) Добавляем ещё одну скважину посередине.
    engine.addWell({
      type: 'injector',
      id: 'I2',
      i: 5,
      j: 25,
      bhpAtm: 290,
      rw: 0.1,
      skin: 0,
      rateLimit: 1500,
    });
    // 3) Ещё 1 год.
    for (let i = 0; i < 365; i++) engine.stepN(1, 24);
    s = engine.getState();
    expect(Number.isFinite(s.pressure[0] ?? 0)).toBe(true);
    // 4) Удаляем скважину.
    engine.removeWell('I2');
    for (let i = 0; i < 30; i++) engine.stepN(1, 24);
    s = engine.getState();
    expect(Number.isFinite(s.pressure[0] ?? 0)).toBe(true);
  });
});
