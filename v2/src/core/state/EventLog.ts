// Append-only лог событий (water breakthrough, BHP-change,
// ошибки решателя). Используется UI для подсветки.
//
// Иммутабельный API: каждое добавление возвращает новый EventLog.

export type EventKind =
  | 'water_breakthrough'
  | 'bhp_changed'
  | 'well_added'
  | 'well_removed'
  | 'sim_warning'
  | 'sim_error'
  | 'step';

export interface SimEvent {
  /** Симуляционное время события, ч. */
  t: number;
  kind: EventKind;
  /** Текст сообщения. */
  message: string;
  /** Доп. данные. */
  data?: Record<string, unknown>;
}

export class EventLog {
  private readonly events: SimEvent[] = [];

  count(): number {
    return this.events.length;
  }

  all(): readonly SimEvent[] {
    return this.events;
  }

  append(event: SimEvent): void {
    this.events.push(event);
  }

  clear(): void {
    this.events.length = 0;
  }

  toJSON(): unknown {
    return this.events;
  }
}
