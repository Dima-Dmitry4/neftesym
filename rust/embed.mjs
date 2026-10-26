// Встраивает собранное Rust-ядро (pkg/, wasm-pack build --target web --release) в index.html:
// JS-обвязка wasm-bindgen + .wasm в base64 → <script type="module" id="wasm-accel"> между маркерами.
// Игра остаётся одним файлом; без WebAssembly (или при ошибке загрузки) расчёт идёт на JS-ядре.
//   cd rust && wasm-pack build --target web --release --no-pack && node embed.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = path.join(here, "..", "index.html");
const glue = fs.readFileSync(path.join(here, "pkg", "oilcore.js"), "utf8");
const wasm = fs.readFileSync(path.join(here, "pkg", "oilcore_bg.wasm"));
const b64 = wasm.toString("base64");

const body = `<!-- wasm:start – сгенерировано rust/embed.mjs из rust (не править вручную) -->
<script type="module" id="wasm-accel">
${glue.replace(/\/\/# sourceMappingURL=.*$/m, "")}
// ---- загрузка: .wasm из base64, асинхронно; ошибки и паники Rust – в консоль, расчёт остаётся на JS ----
const OILCORE_WASM_B64 = "${b64}";
(async () => {
  try {
    const bytes = Uint8Array.from(atob(OILCORE_WASM_B64), (c) => c.charCodeAt(0));
    await __wbg_init({ module_or_path: bytes });
    globalThis.__oilAccel = { Grid, version };
    if (globalThis.__accelReady) globalThis.__accelReady(); else globalThis.OILCORE.setAccel(globalThis.__oilAccel); // игра решает, включать ли ускорение (настройка расчёта)
    globalThis.OILWASM = version();
    console.info("Ускоритель WebAssembly подключён:", version());
  } catch (e) {
    console.warn("WebAssembly недоступен – расчёт на JS-ядре", e);
  }
})();
</script>
<!-- wasm:end -->`;

let h = fs.readFileSync(html, "utf8");
const a = h.indexOf("<!-- wasm:start"), b = h.indexOf("<!-- wasm:end -->");
if (a >= 0 && b > a) h = h.slice(0, a) + body + h.slice(b + "<!-- wasm:end -->".length);
else {
  // первый раз – сразу после ядра (#sim-core), до скрипта интерфейса
  const k = h.indexOf("</script>", h.indexOf('<script id="sim-core">')) + "</script>".length;
  h = h.slice(0, k) + "\n" + body + h.slice(k);
}
fs.writeFileSync(html, h);
console.log(`встроено: wasm ${wasm.length} байт → base64 ${b64.length} символов`);
