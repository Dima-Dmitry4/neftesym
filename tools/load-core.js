// Загружает ядро расчёта (#sim-core) из ../index.html как модуль Node.js (как делает tests/selftest.js).
// WASM=1 – дополнительно подключает Rust-ускоритель из ../rust/pkg (нужна сборка: см. docs/MODEL.md).
"use strict";
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/<script id="sim-core">([\s\S]*?)<\/script>/);
const tmp = path.join(os.tmpdir(), `neftyasha-core-${process.pid}-${Date.now()}.js`);
fs.writeFileSync(tmp, m[1] + "\nmodule.exports = globalThis.OILCORE;\n");
const core = require(tmp);
fs.unlinkSync(tmp);
if (process.env.WASM) {
  const pkg = path.join(__dirname, "..", "rust", "pkg");
  // ES-модуль wasm-bindgen: подключаем синхронно через временную копию в CommonJS-совместимом виде нельзя,
  // поэтому используем динамический импорт; вызывающий код ждёт core.ready
  core.ready = import(require("node:url").pathToFileURL(path.join(pkg, "oilcore.js")).href).then((g) => {
    g.initSync({ module: fs.readFileSync(path.join(pkg, "oilcore_bg.wasm")) });
    core.setAccel(g);
  });
} else core.ready = Promise.resolve();
module.exports = core;
