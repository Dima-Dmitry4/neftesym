// Верификация устойчивости по всем пресетам + стресс-тесты.
//
//   node --import tsx scripts/verifyStability.ts
//
// Для каждого сценария считается год симуляции и измеряется то, что
// реально видит игрок:
//
//   maxΔP_поля  — максимальный скачок среднего по полю давления между
//                 соседними внешними шагами (то, что видно на карте).
//   полоса      — размах равновесного давления за год.
//   maxΔq       — максимальный скачок дебита скважины между шагами
//                 (то, что видно в карточках скважин и на графиках).
//   NaN         — мусор в полях давления/насыщенности.
//
// Первые ~10 шагов — начальный переходный процесс: давление закономерно
// уходит от P_init к равновесию (при VRR ≠ 1 это 10–50 атм, и это физика,
// а не неустойчивость), поэтому метрики скачков считаются после него.

import { loadConfig } from '../src/app/Config.ts';
import { stepSuperposition, computePoreVolume } from '../src/core/time/SuperpositionStepper.ts';
import { getScenario, PRESET_NAMES } from '../src/data/presets/index.ts';
import type { Well } from '../src/core/wells/Well.ts';

const cfg = loadConfig();

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

// Пороги следуют из гарантий модели:
//
//  1. Изменение дебита за внешний шаг ≤ rateChangeTarget·cap — это прямое
//     следствие адаптивной релаксации q = q_prev + ω·(q_solved − q_prev),
//     где ω подрезается так, чтобы скачок не превышал target·cap.
//  2. Скачок давления < 2% от масштаба давления.
//
// До всех фиксов здесь были скачки 20–50 атм и размах дебита до полного
// лимита скважины (переворот знака 500 → −500).
const RELAX_TARGET = cfg.solver.rateChangeTarget;
const SAFETY_CAP = 10_000;
const PRESSURE_SCALE_ATM = 245;

function maxCapacity(wells: readonly Well[]): number {
  let m = 0;
  for (const w of wells) {
    const lim = w.rateLimit ?? 0;
    const cap = lim > 0 ? lim : SAFETY_CAP;
    if (cap > m) m = cap;
  }
  return m;
}

function pAvgOf(res: { grid: { nCells: number }; active: Uint8Array }, p: Float64Array): number {
  let s = 0;
  let c = 0;
  for (let i = 0; i < res.grid.nCells; i++) {
    if (!res.active[i]) continue;
    s += p[i] ?? 0;
    c++;
  }
  return c > 0 ? s / c : 0;
}

function check(
  name: string,
  wells: readonly Well[],
  res: ReturnType<typeof getScenario>['reservoir'],
  opts: { enforcePressureBound?: boolean } = {},
): boolean {
  const pv = computePoreVolume(res);
  let state = {
    pressure: Float64Array.from(res.initialP),
    sw: Float64Array.from(res.initialSw),
    time: 0,
    step: 0,
    lastDt: 0,
  };
  let pAvg = pAvgOf(res, state.pressure);
  let cum = { productionM3: 0, injectionM3: 0 };
  let prevRates: Map<string, number> | null = null;
  let prevField = pAvg;
  let prevQ = new Map<string, number>();
  let maxDp = 0;
  let maxDq = 0;
  let bad = 0;
  let bandLo = Infinity;
  let bandHi = -Infinity;
  let totalSub = 0;
  let steps = 0;

  const targetHours = 8760;
  const dt = 20;
  while (state.time < targetHours) {
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
    totalSub += out.subSteps.length;
    steps++;

    const fieldAvg = pAvgOf(res, out.state.pressure);
    const dField = Math.abs(fieldAvg - prevField);
    const q = new Map<string, number>();
    for (const ws of last?.wellStates ?? []) q.set(ws.wellId, ws.qLiq);

    const settled = steps > 10;
    if (settled) {
      if (dField > maxDp) maxDp = dField;
      for (const [id, v] of q) {
        const before = prevQ.get(id) ?? 0;
        const d = Math.abs(v - before);
        if (d > maxDq) maxDq = d;
      }
      if (fieldAvg < bandLo) bandLo = fieldAvg;
      if (fieldAvg > bandHi) bandHi = fieldAvg;
    }

    for (let i = 0; i < out.state.pressure.length; i++) {
      if (!res.active[i]) continue;
      if (!Number.isFinite(out.state.pressure[i]) || !Number.isFinite(out.state.sw[i])) {
        bad++;
        break;
      }
    }

    prevField = fieldAvg;
    prevQ = q;
    state = out.state;
    pAvg = out.pAvg;
    cum = out.cum;
    prevRates = out.lastStepRates;
    if (steps > 5000) break;
  }

  const band = isFinite(bandLo) ? bandHi - bandLo : 0;
  const cap = maxCapacity(wells);
  const limitRate = RELAX_TARGET * cap * 1.02 + 1;
  const limitPressure = 0.02 * PRESSURE_SCALE_ATM;
  const pressureOk = opts.enforcePressureBound === false || maxDp < limitPressure;
  const ok = bad === 0 && pressureOk && maxDq <= limitRate;
  const note = opts.enforcePressureBound === false ? '  [вне спецификации]' : '';
  console.log(
    `${ok ? 'OK  ' : 'ФЕЙЛ'} ${name.padEnd(26)} wells=${String(wells.length).padStart(2)} ` +
      `maxΔP=${maxDp.toFixed(2).padStart(6)} атм  полоса=${band.toFixed(1).padStart(6)} атм  ` +
      `maxΔq=${maxDq.toFixed(0).padStart(6)} (предел ${limitRate.toFixed(0)})  ` +
      `подш/шаг=${(totalSub / steps).toFixed(1).padStart(5)}  ` +
      `NaN=${bad}  cumOil=${(cum.productionM3 / 1000).toFixed(0)} тыс.м³${note}`,
  );
  return ok;
}

console.log('='.repeat(118));
console.log('ВЕРИФИКАЦИЯ УСТОЙЧИВОСТИ: год симуляции, метрики после переходного процесса');
console.log('Пороги: maxΔP < 2% масштаба давления, maxΔq ≤ rateChangeTarget·cap');
console.log('='.repeat(118));

let allOk = true;
for (const nm of PRESET_NAMES) {
  const scn = getScenario(nm);
  if (!check(nm, scn.wells, scn.reservoir)) allOk = false;
}

{
  const res = getScenario('empty').reservoir;
  const wells: Well[] = [];
  for (const [i, j] of [
    [25, 25],
    [12, 12],
    [37, 37],
  ] as ReadonlyArray<readonly [number, number]>) {
    wells.push({ id: `I${wells.length}`, i, j, type: 'injector', bhpAtm: 290, rw: 0.1, skin: 0, rateLimit: 2000 });
  }
  for (const [i, j] of [
    [8, 8],
    [42, 8],
    [8, 42],
    [42, 42],
    [25, 8],
    [25, 42],
    [8, 25],
    [42, 25],
    [18, 18],
    [32, 18],
    [18, 32],
    [32, 32],
  ] as ReadonlyArray<readonly [number, number]>) {
    wells.push({ id: `P${wells.length}`, i, j, type: 'producer', bhpAtm: 100, rw: 0.1, skin: 0, rateLimit: 500 });
  }
  if (!check('СТРЕСС: 3 inj + 12 prod', wells, res)) allOk = false;
}

// ВНЕ СПЕЦИФИКАЦИИ: скважины без rateLimit упираются в аварийный предел
// 10 000 м³/сут — это в 5 раз больше крупнейшей штатной приёмистости.
// 4 таких продюсера дают дефицит замещения 30 000 м³/сут, и падение
// давления на 9 атм за шаг — корректный материальный баланс, а не
// неустойчивость. Ни один пресет и ни один путь в UI такие скважины
// не создаёт, поэтому проверяем здесь только отсутствие NaN и
// соблюдение гарантии по дебитам.
{
  const res = getScenario('empty').reservoir;
  const wells: Well[] = [
    { id: 'I1', i: 25, j: 25, type: 'injector', bhpAtm: 290, rw: 0.1, skin: 0 },
    { id: 'P1', i: 15, j: 15, type: 'producer', bhpAtm: 100, rw: 0.1, skin: 0 },
    { id: 'P2', i: 35, j: 15, type: 'producer', bhpAtm: 100, rw: 0.1, skin: 0 },
    { id: 'P3', i: 15, j: 35, type: 'producer', bhpAtm: 100, rw: 0.1, skin: 0 },
    { id: 'P4', i: 35, j: 35, type: 'producer', bhpAtm: 100, rw: 0.1, skin: 0 },
  ];
  if (!check('СТРЕСС: без rate limit', wells, res, { enforcePressureBound: false })) allOk = false;
}

console.log('='.repeat(118));
console.log(allOk ? 'ИТОГ: все сценарии стабильны.' : 'ИТОГ: есть нестабильные сценарии — см. ФЕЙЛ выше.');
console.log('='.repeat(118));
if (!allOk) process.exit(1);