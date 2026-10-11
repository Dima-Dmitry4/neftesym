// Состояние месторождения на текущий момент: P, S_w, время.
//
// `FieldState` иммутабельный: любое обновление возвращает новый
// объект. Float64Array копируется через `slice()`.

export interface FieldState {
  /** Давление, атм. Float64Array длины nCells. */
  pressure: Float64Array;
  /** Водонасыщенность, доли (0..1). */
  sw: Float64Array;
  /** Симуляционное время, ч. */
  time: number;
  /** Номер шага. */
  step: number;
  /** Шаг, которым был получен этот state, ч (для отчёта). */
  lastDt: number;
}

/** Создать начальное состояние из резервуара. */
export function makeInitialState(
  pressure: Float64Array,
  sw: Float64Array,
): FieldState {
  return {
    pressure: pressure.slice(),
    sw: sw.slice(),
    time: 0,
    step: 0,
    lastDt: 0,
  };
}

/** Клонировать состояние, обновив поля. */
export function cloneState(state: FieldState, updates: Partial<FieldState>): FieldState {
  return {
    pressure: updates.pressure ? updates.pressure.slice() : state.pressure.slice(),
    sw: updates.sw ? updates.sw.slice() : state.sw.slice(),
    time: updates.time ?? state.time,
    step: updates.step ?? state.step,
    lastDt: updates.lastDt ?? state.lastDt,
  };
}
