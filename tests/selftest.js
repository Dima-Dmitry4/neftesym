// Харнесс самотеста: извлекает #sim-core из index.html, исполняет как
// обычный модуль (быстрый путь V8 — vm-песочница показывает код в ~30 раз
// медленнее из-за realm-эффектов) и запускает OILCORE.runSelfTests().
// Единый источник истины остаётся index.html.
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const htmlPath = path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const m = html.match(/<script id="sim-core">([\s\S]*?)<\/script>/);
if (!m) { console.error("НЕ НАЙДЕН <script id=sim-core> в index.html"); process.exit(1); }

// синтаксическая проверка без выполнения
new vm.Script(m[1], { filename: "sim-core.js" });

// экспортируем ядро через временный модуль
const tmp = path.join(os.tmpdir(), `oilgame-core-${Date.now()}.js`);
fs.writeFileSync(tmp, m[1] + "\nmodule.exports = globalThis.OILCORE;\n");
let core;
try {
  core = require(tmp);
} finally {
  fs.unlinkSync(tmp);
}

if (!core || typeof core.runSelfTests !== "function") {
  console.error("OILCORE.runSelfTests не определён"); process.exit(1);
}
(async () => {
// --wasm: подключить Rust-ядро (rust/pkg, собирается wasm-pack) — те же проверки через WebAssembly
if (process.argv.includes("--wasm")) {
  const { pathToFileURL } = require("node:url");
  const pkg = path.join(__dirname, "..", "rust", "pkg");
  const glue = await import(pathToFileURL(path.join(pkg, "oilcore.js")).href);
  glue.initSync({ module: fs.readFileSync(path.join(pkg, "oilcore_bg.wasm")) });
  // сверка: один сценарий (БВ8, 12 скважин на ЭЦН и под закачкой, 2 года) на JS и на WebAssembly
  const run = (accel) => {
    core.setAccel(accel ? glue : null);
    const P = { ...core.DEFAULT_PARAMS, ...core.DEFAULT_COSTS, ...core.scenarioParams("bv8") }, r = core.buildReservoir2(P), sim = core.createSim(r, P);
    const oil = r.cells.filter((c) => r.hOil[c] >= r.h - 1e-6);
    for (let q = 0; q < 12; q++) { const ty = q % 3 === 2 ? "inj" : "prod"; sim.addWell(oil[Math.floor(((q + 0.5) / 12) * oil.length)], ty, ty === "prod" ? 100 : 250); const w = sim.wells.at(-1); if (ty === "prod") { w.mode = "esp"; w.hasESP = true; w.pump = "250"; } else { w.mode = "choke"; w.choke = 12; } }
    const t = Date.now(); core.advance(sim, 730);
    return { ms: Date.now() - t, oil: sim.wells.reduce((a, w) => a + w.cum.oil, 0), P: sim.P, Sw: sim.Sw };
  };
  const js = run(false), wa = run(true);
  let dP = 0, dS = 0; for (let c = 0; c < js.P.length; c++) { dP = Math.max(dP, Math.abs(js.P[c] - wa.P[c])); dS = Math.max(dS, Math.abs(js.Sw[c] - wa.Sw[c])); }
  const relOil = Math.abs(wa.oil / js.oil - 1), okPar = relOil < 1e-4 && dP < 0.05 && dS < 1e-3;
  console.log(`${okPar ? "PASS" : "FAIL"}  WebAssembly = JS: 2 года БВ8 — нефть ${(relOil * 100).toExponential(1)} %, max|ΔP| ${dP.toExponential(1)} атм, max|ΔSw| ${dS.toExponential(1)}; время JS ${js.ms} мс, WASM ${wa.ms} мс (×${(js.ms / wa.ms).toFixed(1)})`);
  if (!okPar) process.exitCode = 1;
  core.setAccel(glue);
  console.log(`Ускоритель WebAssembly: ${glue.version()}`);
}
const t0 = Date.now();
const results = core.runSelfTests();
const ms = Date.now() - t0;
let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.details ? "  — " + r.details : ""}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} проверок пройдено за ${ms} мс`);
if (failed) process.exitCode = 1;
})();
