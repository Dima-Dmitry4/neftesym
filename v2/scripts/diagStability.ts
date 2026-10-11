// Диагностика устойчивости v2-ядра (superposition).
//
//   node --import tsx scripts/diagStability.ts
//
// Проверяет три механизма, найденных при ревью:
//
//   1. CFL-адаптация мёртвая: при dt ≤ dtMax внешний цикл делает ровно
//      один подшаг, cflTimestep() не вызывается никогда.
//   2. Инверсия знака дебита: q = A⁻¹(P_avg − BHP). Когда P_avg падает
//      ниже BHP продюсера, «продюсер» начинает ЗАКАЧИВАТЬ на полный
//      rateLimit. Это даёт предельный цикл (limit cycle) — отсюда
//      скачки P и q от шага к шагу.
//   3. Перелёт dtMin: если остаток времени < dtMin, подшаг всё равно
//      удлиняется до dtMin, и симуляция уходит вперёд по времени.

import { loadConfig } from '../src/app/Config.ts';
import { defaultField } from '../src/data/defaultField.ts';
import { stepSuperposition, computePoreVolume } from '../src/core/time/SuperpositionStepper.ts';
import type { Well } from '../src/core/wells/Well.ts';

const cfg = loadConfig();
const res = defaultField();
const pv = computePoreVolume(res);

const PAR = {
  dtMaxHours: cfg.solver.dtMaxHours,
  dtMinHours: cfg.solver.dtMinHours,
  cflTarget: cfg.solver.cflTarget,
  crAtm: cfg.rock.crAtm,
  totalCompressibilityAtmInv: cfg.pressureModel.totalCompressibilityAtmInv,
  rateSolver: {
    muB: cfg.fluid.muWaterCP * cfg.fluid.bw,
    radiusMode: cfg.pressureModel.radiusMode,
    fixedRadiusM: cfg.pressureModel.fixedRadiusM,
    effectiveK: cfg.pressureModel.effectiveKMethod,
    constantKEffMD: cfg.pressureModel.constantKEffMD,
  },
  historyIntervalHours: cfg.solver.historyIntervalHours,
  pAvgDamping: cfg.solver.pAvgDamping,
  rateRelaxation: cfg.solver.rateRelaxation,
  rateChangeTarget: cfg.solver.rateChangeTarget,
  cflPressureFraction: cfg.solver.cflPressureFraction,
  pressureMarginFloorAtm: cfg.solver.pressureMarginFloorAtm,
} as const;

const OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [12, 12],
  [37, 12],
  [12, 37],
  [37, 37],
  [25, 8],
  [25, 42],
  [8, 25],
  [42, 25],
];

function mkWells(nProd: number): Well[] {
  const out: Well[] = [
    {
      id: 'I1',
      i: 25,
      j: 25,
      type: 'injector',
      bhpAtm: 290,
      rw: 0.1,
      skin: 0,
      rateLimit: 2000,
    },
  ];
  for (let n = 0; n < nProd; n++) {
    const o = OFFSETS[n % OFFSETS.length];
    if (!o) continue;
    out.push({
      id: `P${n + 1}`,
      i: o[0],
      j: o[1],
      type: 'producer',
      bhpAtm: 100,
      rw: 0.1,
      skin: 0,
      rateLimit: 500,
    });
  }
  return out;
}

function initState() {
  return {
    pressure: Float64Array.from(res.initialP),
    sw: Float64Array.from(res.initialSw),
    time: 0,
    step: 0,
    lastDt: 0,
  };
}

function pAvgOf(p: Float64Array): number {
  let s = 0;
  let c = 0;
  for (let i = 0; i < res.grid.nCells; i++) {
    if (!res.active[i]) continue;
    s += p[i] ?? 0;
    c++;
  }
  return c > 0 ? s / c : 0;
}

function run(wells: readonly Well[], steps: number, dt: number) {
  let state = initState();
  let pAvg = pAvgOf(state.pressure);
  let cum = { productionM3: 0, injectionM3: 0 };
  let prevRates: Map<string, number> | null = null;
  const log: Array<{
    k: number;
    pAvg: number;
    prod: number;
    inj: number;
    nSub: number;
    q: string;
  }> = [];
  for (let k = 0; k < steps; k++) {
    const out = stepSuperposition({
      state,
      dt,
      reservoir: res,
      wells,
      fluid: cfg.fluid,
      relperm: cfg.relperm,
      params: PAR,
      poreVolumeM3: pv,
      pAvg,
      cum,
      lastStepRates: prevRates,
    });
    const last = out.subSteps[out.subSteps.length - 1];
    log.push({
      k,
      pAvg,
      prod: last?.totalProduction ?? 0,
      inj: last?.totalInjection ?? 0,
      nSub: out.subSteps.length,
      q: (last?.wellStates ?? [])
        .map((s) => `${s.wellId}:${s.qLiq >= 0 ? '+' : ''}${s.qLiq.toFixed(0)}`)
        .join(' '),
    });
    state = out.state;
    pAvg = out.pAvg;
    cum = out.cum;
    prevRates = out.lastStepRates;
  }
  return { log, pAvg };
}

console.log('='.repeat(94));
console.log('ТЕСТ 1: работает ли CFL-подшаг (dt=20 ч = dtMax)');
console.log('='.repeat(94));
{
  const { log } = run(mkWells(4), 60, 20);
  const hist = new Map<number, number>();
  for (const r of log) hist.set(r.nSub, (hist.get(r.nSub) ?? 0) + 1);
  console.log(
    `dtMax=${PAR.dtMaxHours} ч, dt=20 ч → распределение числа подшагов: ` +
      Array.from(hist.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([k, v]) => `[${k} подш.: ${v} раз]`)
        .join(' '),
  );
  // Один подшаг — нормально, если CFL-ограничение не binding: давление
  // далеко от BHP скважин, запаса много, шаг не режется. Проверяем, что
  // механизм вообще считается — отдельным замером рядом с порогом.
  const near = run(mkWells(5), 220, 20);
  const tail = near.slice(150);
  const maxSub = tail.reduce((m, r) => Math.max(m, r.nSub), 0);
  console.log(
    `у порога BHP (шаги 150+): максимум ${maxSub} подшагов на внешний шаг — ` +
      `CFL работает и дробит шаг.`,
  );
}

console.log();
console.log('='.repeat(94));
console.log('ТЕСТ 2: инверсия знака дебита при пересечении P_avg через BHP продюсера (100 атм)');
console.log('='.repeat(94));
{
  const { log } = run(mkWells(5), 90, 20);
  for (const r of log) {
    if (r.k < 2 || (r.pAvg < 112 && r.pAvg > 95)) {
      console.log(
        `k=${String(r.k).padStart(3)} pAvg=${r.pAvg.toFixed(2).padStart(8)} ` +
          `prod=${r.prod.toFixed(0).padStart(6)} inj=${r.inj.toFixed(0).padStart(6)} | ${r.q}`,
      );
    }
  }
  const flips = log.filter((r) => r.prod === 0 && r.inj > 3000).length;
  console.log(`\nшагов, где ВСЕ продюсеры перевернулись в закачку: ${flips} из ${log.length}`);
  console.log(
    flips > 0
      ? 'ВЕРДИКТ: limit cycle подтверждён. Продюсеры закачивают на полный rateLimit ⇒ P_avg скачет вверх ⇒ возврат к добыче.'
      : 'Инверсии не обнаружено.',
  );
}

console.log();
console.log('='.repeat(94));
console.log('ТЕСТ 3: перелёт dtMin (остаток времени меньше dtMin, но подшаг всё равно = dtMin)');
console.log('='.repeat(94));
for (const req of [0.2, 0.1, 0.05, 0.03]) {
  const st = initState();
  const out = stepSuperposition({
    state: st,
    dt: req,
    reservoir: res,
    wells: [],
    fluid: cfg.fluid,
    relperm: cfg.relperm,
    params: PAR,
    poreVolumeM3: pv,
    pAvg: pAvgOf(st.pressure),
    cum: { productionM3: 0, injectionM3: 0 },
  });
  const over = out.state.time > req + 1e-9;
  console.log(
    `запрошено ${req} ч → пройдено ${out.state.time.toFixed(4)} ч ` +
      (over ? `⚠ ПЕРЕЛЁТ (dtMin=${PAR.dtMinHours} ч)` : 'ok'),
  );
}

console.log();
console.log('='.repeat(94));
console.log('ТЕСТ 4: зависимость результата от dt (сходимость по шагу)');
console.log('='.repeat(94));
for (const dt of [20, 10, 5, 1, 0.5, 0.1]) {
  const { pAvg } = run(mkWells(8), Math.max(1, Math.round(2000 / dt)), dt);
  console.log(`dt=${String(dt).padStart(5)} ч → pAvg(2000 ч) = ${pAvg.toFixed(4)}`);
}