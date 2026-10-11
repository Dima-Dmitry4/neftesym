// Тип скважины (discriminated union): producer или injector.

export interface WellBase {
  /** Уникальный ID скважины (строка, например «P1», «I1»). */
  id: string;
  /** Индекс ячейки по x. */
  i: number;
  /** Индекс ячейки по y. */
  j: number;
  /** Радиус скважины, м. */
  rw: number;
  /** Скин-фактор, безразмерный. */
  skin: number;
}

export interface Producer extends WellBase {
  type: 'producer';
  /** Забойное давление (атм). */
  bhpAtm: number;
  /** Лимит по дебиту жидкости (м³/сут), 0 = без лимита. */
  rateLimit?: number;
}

export interface Injector extends WellBase {
  type: 'injector';
  /** Забойное давление (атм). */
  bhpAtm: number;
  /** Лимит по приёмистости (м³/сут), 0 = без лимита. */
  rateLimit?: number;
}

export type Well = Producer | Injector;

export function isProducer(w: Well): w is Producer {
  return w.type === 'producer';
}

export function isInjector(w: Well): w is Injector {
  return w.type === 'injector';
}
