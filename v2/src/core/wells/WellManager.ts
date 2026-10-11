// Коллекция скважин с добавлением/удалением/обновлением.
// Иммутабельный API: каждая операция возвращает новый WellManager.

import type { Well, Producer, Injector } from './Well.ts';
import { isInjector, isProducer } from './Well.ts';

export class WellManager {
  private readonly wells: ReadonlyArray<Well>;

  constructor(wells: readonly Well[] = []) {
    this.wells = [...wells];
  }

  list(): readonly Well[] {
    return this.wells;
  }

  count(): number {
    return this.wells.length;
  }

  byId(id: string): Well | undefined {
    return this.wells.find((w) => w.id === id);
  }

  add(well: Well): WellManager {
    if (this.wells.some((w) => w.id === well.id)) {
      throw new Error(`Well with id "${well.id}" already exists`);
    }
    return new WellManager([...this.wells, well]);
  }

  remove(id: string): WellManager {
    return new WellManager(this.wells.filter((w) => w.id !== id));
  }

  update(id: string, patch: Partial<Omit<Well, 'type' | 'id' | 'i' | 'j'>>): WellManager {
    return new WellManager(
      this.wells.map((w) => {
        if (w.id !== id) return w;
        if (isProducer(w)) {
          const p: Partial<Producer> = { ...patch };
          if ('bhpAtm' in p) p.bhpAtm = patch.bhpAtm ?? w.bhpAtm;
          return { ...w, ...p };
        } else if (isInjector(w)) {
          const p: Partial<Injector> = { ...patch };
          if ('bhpAtm' in p) p.bhpAtm = patch.bhpAtm ?? w.bhpAtm;
          return { ...w, ...p };
        }
        return w;
      }),
    );
  }

  setBhp(id: string, bhpAtm: number): WellManager {
    return this.update(id, { bhpAtm });
  }

  toJSON(): unknown {
    return { wells: this.wells };
  }

  static fromJSON(data: unknown): WellManager {
    if (typeof data !== 'object' || data === null) {
      throw new Error('WellManager.fromJSON: data is not an object');
    }
    const obj = data as { wells?: unknown };
    if (!Array.isArray(obj.wells)) {
      throw new Error('WellManager.fromJSON: wells is not an array');
    }
    const wells: Well[] = [];
    for (const w of obj.wells) {
      if (typeof w !== 'object' || w === null) {
        throw new Error('WellManager.fromJSON: well is not an object');
      }
      const ww = w as Partial<Well>;
      if (typeof ww.id !== 'string') {
        throw new Error('WellManager.fromJSON: well.id is not a string');
      }
      if (typeof ww.i !== 'number' || typeof ww.j !== 'number') {
        throw new Error('WellManager.fromJSON: well.i/j is not a number');
      }
      if (ww.type === 'producer') {
        wells.push({
          type: 'producer',
          id: ww.id,
          i: ww.i,
          j: ww.j,
          bhpAtm: typeof ww.bhpAtm === 'number' ? ww.bhpAtm : 100,
          rw: typeof ww.rw === 'number' ? ww.rw : 0.1,
          skin: typeof ww.skin === 'number' ? ww.skin : 0,
          rateLimit: typeof ww.rateLimit === 'number' ? ww.rateLimit : undefined,
        });
      } else if (ww.type === 'injector') {
        wells.push({
          type: 'injector',
          id: ww.id,
          i: ww.i,
          j: ww.j,
          bhpAtm: typeof ww.bhpAtm === 'number' ? ww.bhpAtm : 290,
          rw: typeof ww.rw === 'number' ? ww.rw : 0.1,
          skin: typeof ww.skin === 'number' ? ww.skin : 0,
          rateLimit: typeof ww.rateLimit === 'number' ? ww.rateLimit : undefined,
        });
      } else {
        throw new Error(`WellManager.fromJSON: unknown well type ${String(ww.type)}`);
      }
    }
    return new WellManager(wells);
  }
}
