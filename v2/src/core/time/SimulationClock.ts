// Симуляционные часы. Хранят текущее модельное время (в часах)
// и стартовую дату для UI.

export interface SimulationClockState {
  /** Симуляционное время с начала, ч. */
  time: number;
  /** Стартовая дата, мс от эпохи (для UI). */
  startDateMs: number;
}

export class SimulationClock {
  private state: SimulationClockState;

  constructor(startDateMs: number = Date.UTC(2026, 0, 1, 0, 0, 0), initialTime = 0) {
    this.state = { time: initialTime, startDateMs };
  }

  now(): number {
    return this.state.time;
  }

  startDateMs(): number {
    return this.state.startDateMs;
  }

  advance(dt: number): void {
    this.state.time += dt;
  }

  reset(): void {
    this.state.time = 0;
  }

  state_(): SimulationClockState {
    return { ...this.state };
  }
}
