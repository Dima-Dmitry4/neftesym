// История метрик по месторождению. Записывается с шагом
// `historyIntervalHours` (по умолчанию 24 ч). Используется
// для графиков и NPV.

import type { WellState } from '../wells/BHPControl.ts';

export interface PerWellSnapshot {
  id: string;
  qOil: number; // м³/сут (reservoir)
  qWater: number; // м³/сут (reservoir, + добыча, − закачка)
  qLiq: number; // м³/сут
  waterCut: number; // доля (0..1)
  bhp: number; // атм
}

export interface HistoryEntry {
  /** Симуляционное время, ч. */
  t: number;
  /** Среднее давление, атм. */
  pAvg: number;
  /** Средняя водонасыщенность, доли. */
  swAvg: number;
  /** Добыча нефти за интервал, м³ (reservoir). */
  oilProdInterval: number;
  /** Добыча воды за интервал, м³ (reservoir). */
  waterProdInterval: number;
  /** Закачка воды за интервал, м³ (reservoir). */
  waterInjInterval: number;
  /** Накопленная добыча нефти, м³ (reservoir). */
  cumOil: number;
  /** Накопленная добыча воды, м³ (reservoir). */
  cumWater: number;
  /** Накопленная закачка воды, м³ (reservoir). */
  cumInj: number;
  /** Накопленная добыча нефти, т (для КИН и экономики). */
  cumOilTons: number;
  /** Состояние скважин на момент записи. */
  perWell: PerWellSnapshot[];
}

export class History {
  private entries: HistoryEntry[] = [];
  /** Накопленные величины, обновляются при `append`. */
  private cum = { oil: 0, water: 0, inj: 0, oilTons: 0 };

  constructor(public readonly dtRecord: number = 24) {}

  size(): number {
    return this.entries.length;
  }

  all(): readonly HistoryEntry[] {
    return this.entries;
  }

  last(): HistoryEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  append(
    t: number,
    pAvg: number,
    swAvg: number,
    dt: number,
    wellStates: readonly WellState[],
    wellBhps: ReadonlyMap<string, number>,
    rhoSurface: number,
    bo: number,
  ): HistoryEntry {
    let oilInt = 0;
    let waterInt = 0;
    let injInt = 0;
    const perWell: PerWellSnapshot[] = [];
    for (const ws of wellStates) {
      if (ws.qLiq > 0) {
        // producer
        oilInt += ws.qOil;
        waterInt += ws.qWater;
      } else if (ws.qLiq < 0) {
        injInt += -ws.qWater;
      }
      perWell.push({
        id: ws.wellId,
        qOil: ws.qOil,
        qWater: ws.qWater,
        qLiq: ws.qLiq,
        waterCut: ws.waterCut,
        bhp: wellBhps.get(ws.wellId) ?? 0,
      });
    }
    // dt в часах, q* в м³/сут → q* * dt / 24
    const factor = dt / 24;
    oilInt *= factor;
    waterInt *= factor;
    injInt *= factor;
    this.cum.oil += oilInt;
    this.cum.water += waterInt;
    this.cum.inj += injInt;
    // т: reservoir m3 / Bo * rho_surface / 1000
    const oilTonsInt = (oilInt / bo) * rhoSurface / 1000;
    this.cum.oilTons += oilTonsInt;
    const entry: HistoryEntry = {
      t,
      pAvg,
      swAvg,
      oilProdInterval: oilInt,
      waterProdInterval: waterInt,
      waterInjInterval: injInt,
      cumOil: this.cum.oil,
      cumWater: this.cum.water,
      cumInj: this.cum.inj,
      cumOilTons: this.cum.oilTons,
      perWell,
    };
    this.entries.push(entry);
    return entry;
  }

  toJSON(): unknown {
    return {
      dtRecord: this.dtRecord,
      entries: this.entries,
    };
  }
}
