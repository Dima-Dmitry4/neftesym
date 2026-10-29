// neft.js – мостик методички к ядру игры «Нефтяша».
// Ядро (assets/js/oilcore.js) – это ровно тот же #sim-core, что в index.html игры: здесь мы его не меняем,
// а только даём короткие функции, чтобы в примерах и «живых» ячейках не повторять обвязку интерфейса игры:
//   const f = neft.field({ scenario: "base" });           // объект разработки (группа пласта + сид + сетка)
//   f.drill({ x: 900, y: 1100, type: "prod" });          // скважина по координатам, м (x – на восток, y – на север)
//   for await (const s of f.run(2)) {}                   // расчёт 2 лет шагами по 30 сут
//   neft.map(f, { layer: "P" })                          // карта давления (Plot), с разломами и скважинами
// Координаты: участок 2000×2000 м, начало – юго-западный угол. Единицы – как в игре: атм, мД, сП, м³/сут, сут, руб.
import * as Plot from "https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6.16/+esm";
export { Plot };

export const L = 2000; // сторона участка, м
export const core = () => globalThis.OILCORE;

// ядро грузится обычным <script>, ускоритель WebAssembly – модулем; ждём ядро и (недолго) ускоритель
export async function ready(waitWasm = 2500) {
  const t0 = performance.now();
  while (!globalThis.OILCORE) await sleep(20);
  while (!globalThis.OILWASM && performance.now() - t0 < waitWasm) await sleep(50);
  return globalThis.OILCORE;
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
// отдать управление браузеру между шагами расчёта (MessageChannel не притормаживается в фоновой вкладке, в отличие от setTimeout)
const chan = typeof MessageChannel !== "undefined" ? new MessageChannel() : null, waiting = [];
if (chan) chan.port1.onmessage = () => { const f = waiting.shift(); if (f) f(); };
export const tick = () => new Promise((res) => { if (chan) { waiting.push(res); chan.port2.postMessage(0); } else setTimeout(res, 0); });
export const engineInfo = () => `ядро ${core().VERSION}, ${globalThis.OILWASM ? "WebAssembly " + globalThis.OILWASM : "JavaScript"}`;

// ---------- палитра (light/dark – по классу темы Quarto) ----------
const dark = () => typeof document !== "undefined" && document.body.classList.contains("quarto-dark");
export function colors() {
  return dark()
    ? { s: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300"], ink: "#f0efec", muted: "#c3c2b7", fault: "#e66767", frac: "#e66767", grid: "#3a3a38" }
    : { s: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"], ink: "#0b0b0b", muted: "#52514e", fault: "#e34948", frac: "#e34948", grid: "#e4e3df" };
}

// ---------- объект разработки ----------
// scenario: base | bv8 | av12 | yuv1 | yuk1011 | ach | bb; seed: 0 – канонический объект; grid: 25/40/50/80/100
// faultTrans: { "F-1": 1 } – подменить проводимость разломов (0 – запечатан, 1 – проницаем), для опытов
// patch: { price_oil: 15000, ... } – свои экономические параметры
// strictGaps: true – грани с разломом пересекать строгой проверкой, как в ядре до исправления (см. главу 4: строгая проверка
// пропускает грани, через концы которых ломаная проходит точно, и «запечатанный» разлом получает щели)
// mu_o: подменить вязкость нефти объекта, сП (для опытов: «а если бы нефть была маловязкой?»)
export function field({ scenario = "base", seed = 0, grid = 50, faultTrans = null, strictGaps = false, mu_o = null, patch = {}, pKNS = 130, pGather = 12 } = {}) {
  const C = core();
  const params = { ...C.DEFAULT_PARAMS, ...C.DEFAULT_COSTS, ...C.scenarioParams(scenario, seed), grid, ...patch };
  const r = C.buildReservoir2(params);
  if (faultTrans || strictGaps) overrideFaults(r, faultTrans || {}, strictGaps);
  if (mu_o) r.mu_o = mu_o;
  const sim = C.createSim(r, params);
  sim.field.pKNS = pKNS; sim.field.pGather = pGather;
  return new Field(C, params, r, sim);
}

class Field {
  constructor(C, params, r, sim) {
    Object.assign(this, { C, params, r, sim, rows: [], snaps: [], nProd: 0, nInj: 0 });
    this.dx = r.dx; this.nx = r.nx;
    this.snap(); this.record();
  }
  // ячейка по координатам, м
  cell(x, y) {
    const i = Math.max(0, Math.min(this.nx - 1, Math.floor(x / this.dx))), j = Math.max(0, Math.min(this.nx - 1, Math.floor((L - y) / this.dx)));
    return j * this.nx + i;
  }
  xy(c) { return [((c % this.nx) + 0.5) * this.dx, L - (Math.floor(c / this.nx) + 0.5) * this.dx]; }
  // пробурить скважину. kind: v (вертикальная) | frac (ВС + ГРП) | hs (ГС) | mgrp (ГС + МГРП)
  // L – длина ГС, м; az – азимут ствола/трещины, ° от севера; xf – полудлина трещины 40/80/120 м; n – стадий МГРП
  // режим добывающей: esp (ЭЦН, pump – типоразмер, freq – Гц) | flow (фонтан, choke – мм) | bhp (забойное pwf, атм)
  // нагнетательной: choke (КНС через штуцер choke, мм) | bhp (pwf, атм)
  drill({ x, y, cell, type = "prod", kind = "v", L: len = 600, az = 90, xf = 80, n = 5, mode, pump = "250", freq = 50, choke, pwf, name } = {}) {
    const { C, sim } = this, c = cell ?? this.cell(x, y);
    sim.addWell(c, type, pwf ?? (type === "prod" ? 100 : 300));
    const w = sim.wells.at(-1);
    let units = C.CAPEX.vert();
    if (kind === "frac") { sim.setCompletion(w, "frac", { xf, az }); units = { ...units, ...C.CAPEX.frac(xf) }; }
    if (kind === "hs" || kind === "mgrp") { sim.setCompletion(w, "hs", { L: len, az }); units = C.CAPEX.hs(len); }
    if (kind === "mgrp") { sim.setCompletion(w, "mgrp", { n, xf }); units = { ...units, ...C.CAPEX.mgrp(w.mgrp.n, xf) }; }
    sim.economy.charge(sim.t, units, true);
    w.name = name || (type === "prod" ? `Д-${++this.nProd}` : `Н-${++this.nInj}`);
    this.setMode(w, { mode, pump, freq, choke, pwf });
    return w;
  }
  setMode(w, { mode, pump = "250", freq = 50, choke, pwf } = {}) {
    const { C, sim } = this;
    if (w.type === "prod") {
      w.mode = mode || "esp";
      if (w.mode === "esp") {
        if (!w.hasESP || w.pump !== pump) sim.economy.charge(sim.t, { esp_cost: C.PUMPS[pump].cost });
        w.hasESP = true; w.pump = pump; w.freq = freq;
      }
      if (choke) w.choke = choke;
    } else { w.mode = mode || "choke"; w.choke = choke ?? 12; }
    if (pwf != null) w.pwf = pwf;
    sim._fluxValid = false;
  }
  // перевод добывающей под закачку (ППД) и обратно – платно, как в игре
  convert(w, { choke = 12 } = {}) {
    this.sim.convertWell(w); this.sim.economy.charge(this.sim.t, { conv_cost: 1 });
    if (w.type === "inj") { w.choke = choke; w.name = `Н-${++this.nInj} (был ${w.name})`; }
    else { w.name = `Д-${++this.nProd}`; this.setMode(w, {}); }
  }
  stop(w) { w.on = false; this.sim._fluxValid = false; }
  start(w) { w.on = true; this.sim._fluxValid = false; }
  well(name) { return this.sim.wells.find((w) => w.name === name); }

  // расчёт: асинхронный генератор, шаг step сут; после каждого шага – строка показателей, в конце года – снимок карт
  async *run(years, { step = 30, onStep } = {}) {
    const { C, sim } = this, end = sim.t + years * 365;
    while (sim.t < end - 1e-6) {
      const d = Math.min(step, end - sim.t), y0 = Math.floor(sim.t / 365 + 1e-9);
      C.advance(sim, d);
      if (Math.floor(sim.t / 365 + 1e-9) > y0) this.snap();
      const row = this.record();
      if (onStep) onStep(row, this);
      yield row;
      await tick();
    }
  }
  // то же без генератора: await f.runAll(3)
  async runAll(years, opt) { for await (const _ of this.run(years, opt)); return this.stats(); }

  record() {
    const { sim, r } = this;
    let qo = 0, ql = 0, qw = 0, qi = 0;
    for (const w of sim.wells) if (w.on !== false) { if (w.type === "prod") { qo += w.qo; qw += w.qw; ql += w.q; } else qi += w.q; }
    const cumOil = sim.wells.reduce((s, w) => s + w.cum.oil, 0);
    const row = { t: sim.t, year: sim.t / 365, avgP: sim.avgPressure(), oil_td: qo * C_RHO, liq: ql, water: qw, inj: qi, wc: ql > 0 ? qw / ql : 0,
                  cumOil_t: cumOil * C_RHO, kin: cumOil / r.ooipM3, money: sim.economy.balance / 1e6,
                  cumInj: sim.wells.reduce((s, w) => s + w.cum.inj, 0), cumWater: sim.wells.reduce((s, w) => s + w.cum.water, 0) };
    this.rows.push(row);
    return row;
  }
  snap() { this.snaps.push({ year: Math.round(this.sim.t / 365), P: Float64Array.from(this.sim.P), Sw: Float64Array.from(this.sim.Sw) }); }
  // сводка: нефть, КИН, обводнённость, баланс, ЧДД (10 %) по полным годам
  stats(rate = 0.1) {
    const last = this.rows.at(-1), y = this.C.yearlyFromSim(this.sim, this.params);
    return { ...last, ooip_t: this.r.ooipM3 * C_RHO, npv: this.C.npvOf(y.cf, rate) / 1e6, yearly: y, wells: this.sim.wells.length };
  }
  // показатели по скважинам
  wellTable() {
    return this.sim.wells.map((w) => ({ name: w.name, type: w.type === "prod" ? "добывающая" : "нагнетательная", kind: KIND[w.kind] + (w.mgrp ? ` + МГРП ${w.mgrp.n}×${w.mgrp.xf} м` : w.frac ? ` + ГРП ${w.frac.xf} м` : ""),
      q: +w.q.toFixed(1), oil_td: +(w.qo * C_RHO).toFixed(1), wc: +(100 * (w.fw || 0)).toFixed(0), pwf: +w.pwf.toFixed(0),
      cumOil_t: Math.round(w.cum.oil * C_RHO), cumInj: Math.round(w.cum.inj), on: w.on !== false }));
  }
}
const C_RHO = 0.86;
const KIND = { v: "ВС", hs: "ГС", zbs: "ЗБС", frac: "ВС" };

// подмена проводимости разломов: грани сетки, пересечённые разломом, получают множитель trans
function overrideFaults(r, map, strictGaps = false) {
  const nx = r.nx, ny = r.ny;
  for (const F of r.faults) if (map[F.name] != null) F.trans = map[F.name];
  r.tmE.fill(1); r.tmN.fill(1);
  const o = (p, q, s) => (q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]);
  // segCross ядра (касание – к левой стороне, щелей нет) либо строгая проверка, как в ядре до исправления
  const cross = strictGaps ? (a, b, c, d) => o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0 : core().segCross;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      for (const F of r.faults)
        for (let n = 0; n + 1 < F.pts.length; n++) {
          if (i + 1 < nx && cross([i, j], [i + 1, j], F.pts[n], F.pts[n + 1])) r.tmE[c] = Math.min(r.tmE[c], F.trans);
          if (j + 1 < ny && cross([i, j], [i, j + 1], F.pts[n], F.pts[n + 1])) r.tmN[c] = Math.min(r.tmN[c], F.trans);
        }
    }
}

// ---------- карты ----------
const LAYERS = {
  P: { label: "Давление, атм", scheme: "Oranges", get: (f, s) => (s ? s.P : f.sim.P) },
  Sw: { label: "Водонасыщенность Sw", scheme: "Blues", get: (f, s) => (s ? s.Sw : f.sim.Sw), domain: (f) => [f.r.Swc, 1] },
  k: { label: "Проницаемость, мД (лог. шкала)", scheme: "Greens", type: "log", get: (f) => f.r.kTrue || f.r.k },
  hOil: { label: "Нефтенасыщенная толщина, м", scheme: "YlOrBr", get: (f) => f.r.hOil },
  zTop: { label: "Кровля, абс. отметка, м (глубже – темнее)", scheme: "Purples", get: (f) => f.r.zTop },
};
// map(f, {layer, year, width, wells, faults, domain, title}) – карта слоя; year – снимок на конец года (для P и Sw)
export function map(f, { layer = "P", year = null, data = null, width = 420, wells = true, faults = true, explore = false, domain, title, legend = true, labels = true } = {}) {
  const Ly = LAYERS[layer], col = colors(), dx = f.dx, nx = f.nx;
  const snap = year == null ? null : f.snaps.find((s) => s.year === year) || f.snaps.at(-1);
  const vals = Array.from(data || Ly.get(f, snap));
  const marks = [Plot.raster(vals, { width: nx, height: nx, x1: 0, x2: L, y1: L, y2: 0, imageRendering: "pixelated", tip: { format: { fill: (v) => fmtVal(layer, v), x: false, y: false } } })];
  const toM = ([i, j]) => [(i + 0.5) * dx, L - (j + 0.5) * dx];
  if (faults && f.r.faults) for (const F of f.r.faults) {
    const pts = F.pts.map(toM);
    marks.push(Plot.line(pts, { stroke: col.fault, strokeWidth: 2.5, strokeDasharray: "7,4" }));
    const mid = pts[Math.floor(pts.length / 2)];
    if (labels) marks.push(Plot.text([mid], { text: () => `${F.name}${F.trans === 0 ? " (герм.)" : ` (×${F.trans})`}`, fill: col.fault, stroke: dark() ? "#1a1a19" : "white", strokeWidth: 3, dx: 6, textAnchor: "start", fontWeight: 600 }));
  }
  if (explore && f.r.explore) {
    const ex = f.r.explore.map((e) => ({ name: e.name, xy: f.xy(e.cell) }));
    marks.push(Plot.dot(ex, { x: (e) => e.xy[0], y: (e) => e.xy[1], r: 6, symbol: "diamond", fill: col.ink, stroke: "white" }));
    marks.push(Plot.text(ex, { x: (e) => e.xy[0], y: (e) => e.xy[1], text: "name", dy: -11, fill: col.ink, stroke: dark() ? "#1a1a19" : "white", strokeWidth: 3, fontSize: 11 }));
  }
  if (wells) {
    const W = f.sim.wells, tr = [], fr = [];
    for (const w of W) {
      if (w.traj && (w.kind === "hs" || w.kind === "zbs")) tr.push(w.traj.map(([i, j]) => [i * dx, L - j * dx]));
      if (w.kind === "frac" && w.traj) fr.push(w.traj.map(([i, j]) => [i * dx, L - j * dx]));
      if (w.mgrp) for (const s of w.mgrp.stages) fr.push([[s[0] * dx, L - s[1] * dx], [s[2] * dx, L - s[3] * dx]]);
    }
    for (const t of fr) marks.push(Plot.line(t, { stroke: col.frac, strokeWidth: 3 }));
    for (const t of tr) marks.push(Plot.line(t, { stroke: col.ink, strokeWidth: 2.5 }));
    const pts = W.map((w) => ({ w, xy: f.xy(w.cell) }));
    marks.push(Plot.dot(pts.filter((p) => p.w.type === "prod"), { x: (p) => p.xy[0], y: (p) => p.xy[1], r: 5.5, fill: "white", stroke: col.ink, strokeWidth: 2, symbol: "circle" }));
    marks.push(Plot.dot(pts.filter((p) => p.w.type !== "prod"), { x: (p) => p.xy[0], y: (p) => p.xy[1], r: 7, fill: col.s[0], stroke: "white", strokeWidth: 1.5, symbol: "triangle" }));
    if (labels) marks.push(Plot.text(pts, { x: (p) => p.xy[0], y: (p) => p.xy[1], text: (p) => p.w.name, dy: -12, fill: col.ink, stroke: dark() ? "#1a1a19" : "white", strokeWidth: 3, fontSize: 11, fontWeight: 600 }));
  }
  return Plot.plot({
    width, height: width, marginLeft: 44, marginBottom: 34, marginTop: title ? 26 : 10, marginRight: 22,
    title, x: { domain: [0, L], label: "x, м (восток →)" }, y: { domain: [0, L], label: "y, м (север ↑)" },
    color: { type: Ly.type || "linear", scheme: Ly.scheme, legend, label: Ly.label, domain: domain || (Ly.domain && Ly.domain(f)), width: Math.min(width, 340) },
    style: { fontSize: "11px" }, marks,
  });
}
const fmtVal = (layer, v) => (layer === "Sw" ? v.toFixed(2) : layer === "k" ? v.toFixed(v < 1 ? 3 : 0) + " мД" : layer === "P" ? v.toFixed(1) + " атм" : v.toFixed(1) + " м");

// ---------- графики по времени ----------
// lines([{name, rows}], {y: "oil_td", label}) – несколько вариантов на одном графике (одна ось y)
export function lines(variants, { y = "oil_td", label = "", width = 640, height = 240, x = "year", xLabel = "годы", yDomain, percent = false } = {}) {
  const col = colors(), data = [];
  variants.forEach((v, k) => v.rows.forEach((r) => data.push({ v: v.name, x: r[x], y: percent ? 100 * r[y] : r[y], k })));
  const names = variants.map((v) => v.name);
  return Plot.plot({
    width, height, marginLeft: 56, x: { label: xLabel }, y: { label, grid: true, domain: yDomain },
    color: { domain: names, range: col.s.slice(0, names.length), legend: names.length > 1 },
    marks: [Plot.ruleY([0], { stroke: col.muted }),
            Plot.line(data, { x: "x", y: "y", stroke: "v", strokeWidth: 2 }),
            Plot.tip(data, Plot.pointer({ x: "x", y: "y", stroke: "v", title: (d) => `${d.v}\n${xLabel}: ${d.x.toFixed(2)}\n${label}: ${fmtNum(d.y)}` }))],
  });
}
const fmtNum = (v) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString("ru-RU") : v.toFixed(Math.abs(v) >= 10 ? 1 : 2));

// таблица сравнения вариантов (HTML)
export function summary(variants) {
  const s = variants.map((v) => ({ name: v.name, ...v.f.stats() }));
  const h = (t) => `<th>${t}</th>`, d = (t) => `<td>${t}</td>`;
  const rows = s.map((r) => `<tr>${d(`<b>${r.name}</b>`)}${d(r.wells)}${d(fmtNum(r.cumOil_t / 1000))}${d((100 * r.kin).toFixed(1))}${d((100 * r.wc).toFixed(0))}${d(r.avgP.toFixed(0))}${d(fmtNum(r.money))}${d(fmtNum(r.npv))}</tr>`).join("");
  const el = document.createElement("div");
  el.className = "neft-table";
  el.innerHTML = `<table class="table table-sm"><thead><tr>${h("Вариант")}${h("Скважин")}${h("Нефть, тыс. т")}${h("КИН, %")}${h("Обводн., %")}${h("P ср., атм")}${h("Баланс, млн руб")}${h("ЧДД 10 %, млн руб")}</tr></thead><tbody>${rows}</tbody></table>`;
  return el;
}

// любой массив объектов (например, f.wellTable()) – HTML-таблицей; столбцы – ключи первой строки
export function table(rows) {
  const cols = Object.keys(rows[0] || {});
  const cell = (v) => (typeof v === "number" ? fmtNum(v) : typeof v === "boolean" ? (v ? "да" : "нет") : v ?? "");
  const el = document.createElement("div");
  el.className = "neft-table";
  el.innerHTML = `<table class="table table-sm"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${
    rows.map((r) => `<tr>${cols.map((c) => `<td>${cell(r[c])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  return el;
}

// ---------- прогресс расчёта ----------
export function progress(text, frac) {
  const el = document.createElement("div");
  el.className = "neft-progress";
  el.innerHTML = `<div class="bar"><span style="width:${(100 * Math.min(1, frac || 0)).toFixed(0)}%"></span></div><div class="txt">${text}</div>`;
  return el;
}
// несколько вариантов подряд: build(name) → Field с пробуренными скважинами; yields {done, text, frac, variants}
export async function* compare(builds, years, { step = 30 } = {}) {
  const variants = builds.map(([name, build]) => ({ name, build }));
  const total = variants.length * years * 365;
  let doneDays = 0, last = 0;
  for (const v of variants) {
    v.f = v.build(); v.rows = v.f.rows;
    for await (const row of v.f.run(years, { step })) {
      doneDays += step;
      // прогресс – не чаще 4 раз в секунду: Observable забирает значение генератора раз в кадр, и частые yield тормозят расчёт
      if (performance.now() - last > 250) {
        last = performance.now();
        yield { done: false, frac: Math.min(1, doneDays / total), text: `«${v.name}»: год ${row.year.toFixed(1)} из ${years} · ${engineInfo()}`, variants };
      }
    }
  }
  yield { done: true, frac: 1, text: "готово", variants };
}

// отчёт по сравнению вариантов (для разборов): прогресс, таблица, графики по времени, карты на конец расчёта
// st – значение из compare() или null (ещё не запускали)
export const CHARTS = { oil_td: ["Добыча нефти, т/сут"], wc: ["Обводнённость, %", true], avgP: ["Среднее давление, атм"], money: ["Баланс, млн руб"], kin: ["КИН, %", true], liq: ["Добыча жидкости, м³/сут"], inj: ["Закачка, м³/сут"] };
export function report(st, { layer = "Sw", charts = ["oil_td", "wc", "avgP", "money"], mapWidth = 300, hint = "Нажмите «▶ Рассчитать варианты» – расчёт идёт на ядре игры, несколько секунд." } = {}) {
  const el = document.createElement("div");
  if (!st) { el.innerHTML = `<p class="neft-hint" style="color:var(--neft-muted)">${hint}</p>`; return el; }
  if (!st.done) { el.append(progress(st.text, st.frac)); return el; }
  const V = st.variants;
  el.append(summary(V));
  const row = document.createElement("div"); row.className = "neft-row";
  for (const k of charts) { const [label, pct] = CHARTS[k]; const d = document.createElement("div"); d.append(lines(V, { y: k, label, percent: !!pct, width: 420, height: 220 })); row.append(d); }
  el.append(row);
  if (layer) {
    const maps = document.createElement("div"); maps.className = "neft-row";
    const all = layer === "P" ? V.flatMap((v) => Array.from(v.f.sim.P)) : null;
    const dom = all ? [Math.min(...all), Math.max(...all)] : undefined;
    for (const v of V) { const d = document.createElement("div"); d.append(map(v.f, { layer, width: mapWidth, title: v.name, domain: dom, legend: v === V[0] })); maps.append(d); }
    el.append(maps);
  }
  return el;
}

// ---------- каротаж (планшет как в игре, упрощённо) ----------
export function logPlot(f, cell, { width = 320, height = 360 } = {}) {
  const lg = f.C.wellLog(f.r, cell), col = colors();
  const owcAbs = -f.r.owc, s = lg.samples.map((p) => ({ ...p, abs: -p.z }));
  const track = (key, label, opts = {}) => Plot.plot({
    width: width / 3, height, marginLeft: key === "gr" ? 48 : 8, marginRight: 6, marginTop: 24,
    x: { label, ...opts.x }, y: { label: key === "gr" ? "абс. отметка, м" : null, axis: key === "gr" ? "left" : null, domain: [Math.min(...s.map((p) => p.abs)), Math.max(...s.map((p) => p.abs))] },
    marks: [
      Plot.rect(lg.rigis, { x1: opts.x.domain[0], x2: opts.x.domain[1], y1: "absBase", y2: "absTop", fill: (q) => (q.kind === "oil" ? "#eb6834" : q.kind === "water" ? col.s[0] : "#9a9893"), fillOpacity: 0.22 }),
      Plot.ruleY([owcAbs], { stroke: col.s[0], strokeDasharray: "4,3" }),
      Plot.lineX(s, { x: key, y: "abs", stroke: col.ink, strokeWidth: 1.5, curve: "linear" }),
    ],
  });
  const wrap = document.createElement("div");
  wrap.style.display = "flex"; wrap.style.gap = "4px";
  wrap.append(track("gr", "ГК, мкР/ч", { x: { domain: [0, 18] } }), track("rt", "Rt, Ом·м", { x: { type: "log", domain: [0.5, 100] } }), track("kp", "Кп", { x: { domain: [0, 0.3] } }));
  return { el: wrap, log: lg };
}

// карта по массиву значений (для своих расчётов в живых ячейках): grid(values, nx, {label, scheme})
export function grid(values, nx, { label = "", scheme = "Oranges", width = 380, type = "linear", marks = [] } = {}) {
  return Plot.plot({ width, height: width, marginLeft: 40, x: { label: "i" }, y: { label: "j", reverse: true }, color: { scheme, legend: true, label, type },
    marks: [Plot.raster(Array.from(values), { width: nx, height: values.length / nx, x1: 0, x2: nx, y1: 0, y2: values.length / nx, imageRendering: "pixelated", tip: true }), ...marks] });
}
