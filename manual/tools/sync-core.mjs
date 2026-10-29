// Синхронизация методички с игрой (запускается перед каждым рендером, см. pre-render в _quarto.yml):
//   - вырезает ядро расчёта #sim-core из ../index.html → assets/js/oilcore.js (тот же код, что в игре);
//   - вырезает встроенный WebAssembly #wasm-accel → assets/js/oilcore-wasm.js (ES-модуль, сам подключает ускоритель);
//   - копирует снимки экрана игры docs/img → images/game.
// Так методичка всегда считает тем же ядром, что и игра; вручную эти файлы не правим.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const manual = path.join(here, "..");
const root = path.join(manual, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

const pick = (re, what) => {
  const m = html.match(re);
  if (!m) throw new Error(`в index.html не найден ${what}`);
  return m[1];
};
const core = pick(/<script id="sim-core">([\s\S]*?)<\/script>/, "<script id=\"sim-core\">");
const wasm = pick(/<script type="module" id="wasm-accel">([\s\S]*?)<\/script>/, "<script id=\"wasm-accel\">");

const js = path.join(manual, "assets", "js");
fs.mkdirSync(js, { recursive: true });
const head = "// СГЕНЕРИРОВАНО manual/tools/sync-core.mjs из ../index.html – не править вручную\n";
const write = (f, s) => {
  const p = path.join(js, f);
  if (!fs.existsSync(p) || fs.readFileSync(p, "utf8") !== s) fs.writeFileSync(p, s);
};
write("oilcore.js", head + core);
write("oilcore-wasm.js", head + wasm);

const imgSrc = path.join(root, "docs", "img"), imgDst = path.join(manual, "images", "game");
fs.mkdirSync(imgDst, { recursive: true });
for (const f of fs.readdirSync(imgSrc)) {
  const a = path.join(imgSrc, f), b = path.join(imgDst, f);
  if (!fs.existsSync(b) || fs.statSync(a).mtimeMs > fs.statSync(b).mtimeMs) fs.copyFileSync(a, b);
}
console.log(`sync-core: ядро ${(core.length / 1024).toFixed(0)} КБ, WebAssembly ${(wasm.length / 1024).toFixed(0)} КБ, снимков ${fs.readdirSync(imgDst).length}`);
