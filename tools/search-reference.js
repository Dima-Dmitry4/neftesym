// Поиск эталона для группы пласта: случайное восхождение по параметрам политики разработки. Политика исполняется ядром игры
// (OILCORE.policyRun) – тем же кодом, что строит эталоны для сидов.
//   SCEN=ach REF0='{"npv":0.5e9,"kin":0.26}' [INIT=best.json] [WASM=1] node tools/search-reference.js <seed> <секунд> <файл-результат>
// SCEN – группа (bv8, av12, yuv1, yuk1011, ach, bb); REF0 – нормировка критерия; INIT – стартовая политика; результат – JSON с политикой и рядами.
// Найденную политику (th) переносят в POLICIES, ряды – в REF внутри index.html.
const C = require("./load-core.js");
const fs = require("fs");
const seed = +process.argv[2], budget = +process.argv[3] * 1000, outFile = process.argv[4], scen = process.env.SCEN;
const P = { ...C.DEFAULT_PARAMS, ...C.DEFAULT_COSTS, level: 2, init_money: 900e6, ...C.scenarioParams(scen, +(process.env.SEEDOBJ || 0)) };
const r = C.buildReservoir2(P);
const REF0 = JSON.parse(process.env.REF0 || '{"npv":1e9,"kin":0.15}');
let st = (seed * 2654435761) >>> 0;
const rnd = () => { st = (st + 0x6D2B79F5) | 0; let t = Math.imul(st ^ (st >>> 15), 1 | st); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const range = (a, b, d = 1) => { const o = []; for (let v = a; v <= b + 1e-9; v += d) o.push(+v.toFixed(3)); return o; };
const DOM = { s: range(7, 16), ox: range(2, 8), oy: range(2, 8), pat: [0, 1, 2], phase: [0, 1, 2], thrC: [0.8, 0.85, 0.9, 0.93, 0.96, 0.98, 1.01], convN: range(0, 4),
  prodMode: ["esp", "auto"], f0: range(40, 60, 5), chokeP: range(8, 20), dInj: range(6, 30, 2), kns: range(100, 200, 10), pg: range(5, 15), qMin: [10, 20, 40],
  compl: ["v", "vf", "hs", "hsf", "hsf"], xf: [40, 80, 120], fracK: [30, 60, 120, 1000], hsL: [1000, 1500, 2000], hsAz: [0, 45, 90, 135], mgN: [3, 5, 8, 12], shut: [0, 1],
  hMin: range(0.4, 0.9, 0.1), thrS: [1.5, 2, 3, 4, 99], stimYear: [2, 3], pre: [0, 0, 1, 2, 3], injCompl: [0, 1] };
const keys = Object.keys(DOM);
const rand = () => Object.fromEntries(keys.map((k) => [k, DOM[k][Math.floor(rnd() * DOM[k].length)]]));
const perturb = (th) => {
  const o = { ...th }, n = 1 + Math.floor(rnd() * 3);
  for (let q = 0; q < n; q++) {
    const k = keys[Math.floor(rnd() * keys.length)], d = DOM[k], i = d.indexOf(o[k]);
    o[k] = typeof d[0] === "number" && d.length > 4 && rnd() < 0.7 ? d[Math.max(0, Math.min(d.length - 1, i + (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * 2))))] : d[Math.floor(rnd() * d.length)];
  }
  return o;
};
function evaluate(th) {
  const x = C.runGen(C.policyRun(r, P, th));
  if (!x) return null;
  return { J: (0.5 * Math.max(x.npv, 0)) / REF0.npv + (0.5 * x.kin) / REF0.kin, npv: x.npv, kin: x.kin, s: x.s, c: x.c, wells: x.nWells };
}
module.exports = { evaluate, DOM, P, r };
if (require.main === module) C.ready.then(() => {
  let best = null, bestTh = null, t0 = Date.now(), evals = 0;
  for (const f of (process.env.INIT || "").split(",").filter(Boolean)) {
    const init = { ...rand(), pre: 0, injCompl: 0, ...JSON.parse(fs.readFileSync(f, "utf8")).th };
    for (const k of keys) if (!DOM[k].includes(init[k])) init[k] = DOM[k][0];
    const res0 = evaluate(init); if (res0 && (!best || res0.J > best.J)) { best = res0; bestTh = init; }
  }
  const save = () => fs.writeFileSync(outFile, JSON.stringify({ seed, evals, sec: (Date.now() - t0) / 1000, th: bestTh, res: best }));
  while (Date.now() - t0 < budget) {
    const th = best && rnd() < (process.env.INIT ? 0.95 : 0.85) ? perturb(bestTh) : rand();
    let res; try { res = evaluate(th); } catch (e) { res = null; }
    evals++;
    if (res && (!best || res.J > best.J)) { best = res; bestTh = th; save(); }
  }
  save();
});
