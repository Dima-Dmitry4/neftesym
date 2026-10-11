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
