// freeze.mjs – «замораживает» интерактив методички для печатной (PDF) версии.
// Открывает собранные HTML-страницы (_book) в Chrome без окна, ждёт окончания расчётов OJS-виджетов,
// запускает все живые ячейки (Python и JS) и сохраняет их результаты картинками в images/frozen/<глава>/.
// Эти картинки подставляет фильтр tools/pdf-freeze.lua при сборке PDF.
//
//   quarto render --to html      # 1. собрать HTML
//   node tools/freeze.mjs        # 2. снимки (нужны Chrome или Edge и интернет: Plot и Pyodide идут с CDN)
//   quarto render                # 3. собрать всё: HTML и PDF
//
// node tools/freeze.mjs 04-numerics 11-bv8  – только указанные главы. Путь к браузеру можно задать в CHROME.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, rm, mkdtemp } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BOOK = join(ROOT, "_book");
const OUT = join(ROOT, "images", "frozen");
const PAGE_TIMEOUT = 8 * 60e3; // долгие разборы (ачимовка, 12 лет) считаются минуты
const CELL_TIMEOUT = 4 * 60e3;

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff": "font/woff",
  ".woff2": "font/woff2", ".py": "text/plain; charset=utf-8", ".wasm": "application/wasm" };

function chromePath() {
  const cands = [process.env.CHROME,
    "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const p = cands.find((c) => c && existsSync(c));
  if (!p) throw new Error("не найден Chrome/Edge – укажите путь в переменной CHROME");
  return p;
}

function serve() {
  const srv = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    try {
      const body = await readFile(join(BOOK, p));
      res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv)));
}

// минимальный клиент Chrome DevTools Protocol
async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const wait = new Map(), listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && wait.has(msg.id)) { const { r, j } = wait.get(msg.id); wait.delete(msg.id); msg.error ? j(new Error(msg.error.message)) : r(msg.result); }
    else if (msg.method) listeners.forEach((f) => f(msg));
  };
  const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; wait.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); });
  const once = (method) => new Promise((r) => { const f = (m) => { if (m.method === method) { listeners.splice(listeners.indexOf(f), 1); r(m.params); } }; listeners.push(f); });
  const evaluate = async (expression, timeout = 60e3) => {
    const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    return res.result.value;
  };
  return { send, once, evaluate, close: () => ws.close(), onEvent: (f) => listeners.push(f) };
}

// ждём, пока OJS досчитает: нет полос прогресса и «выполняющихся» ячеек, и страница 3 с не меняется
const SETTLE = (timeout) => `(async () => {
  const t0 = Date.now(); let last = Date.now();
  const mo = new MutationObserver(() => (last = Date.now()));
  mo.observe(document.body, { subtree: true, childList: true, characterData: true });
  try {
    while (Date.now() - t0 < ${timeout}) {
      await new Promise((r) => setTimeout(r, 500));
      const busy = document.querySelector(".neft-progress, .observablehq--running");
      if (!busy && Date.now() - last > 3000 && Date.now() - t0 > 4000) return true;
    }
    return false;
  } finally { mo.disconnect(); }
})()`;

// какие элементы снимать: выходы OJS-ячеек с содержимым (графики, карты, таблицы, плашки) – без голых ползунков
const TARGETS = `(() => {
  const out = [];
  for (const el of document.querySelectorAll("[id^='ojs-cell-']")) {
    if (!/^ojs-cell-\\d+(-\\d+)?$/.test(el.id)) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 12 || r.width < 12) continue;
    const media = el.querySelector("svg, canvas, img, table, .neft-kpi, .neft-row, pre");
    if (el.querySelector("form") && !el.querySelector("svg, canvas, img")) continue; // голые ползунки и переключатели
    if (!media && !el.innerText.trim()) continue;
    if (el.querySelector(".observablehq--error")) continue;
    out.push(el.id);
  }
  return out;
})()`;

// Высокий выход (отчёт разбора: таблица, графики, карты) не влезет на страницу PDF – режем его на полосы не выше
// MAX_BAND по границам визуальных рядов содержимого; длинный текст без рядов режем ровно.
const MAX_BAND = 900; // CSS px: при ширине колонки 760 px это ≈ 8 дюймов в PDF
const BANDS = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  el.scrollIntoView({ block: "start" });
  const top = (n) => n.getBoundingClientRect().top + scrollY, bottom = (n) => n.getBoundingClientRect().bottom + scrollY;
  const r = el.getBoundingClientRect();
  let right = r.right; // широкие таблицы выступают за блок – снимаем целиком
  for (const t of el.querySelectorAll("table")) right = Math.max(right, t.getBoundingClientRect().right);
  const cuts = [];
  const walk = (node) => {
    if (bottom(node) - top(node) <= ${MAX_BAND}) return;
    const kids = [...node.children].filter((k) => k.getBoundingClientRect().height > 0).sort((a, b) => top(a) - top(b));
    const rows = [];
    for (const k of kids) {
      const last = rows[rows.length - 1];
      if (last && top(k) < last.b - 2) { last.b = Math.max(last.b, bottom(k)); last.n.push(k); }
      else rows.push({ t: top(k), b: bottom(k), n: [k] });
    }
    for (let i = 1; i < rows.length; i++) cuts.push((rows[i - 1].b + rows[i].t) / 2);
    for (const row of rows) if (row.n.length === 1) walk(row.n[0]);
  };
  walk(el);
  const y0 = top(el), y1 = bottom(el), bands = [];
  let start = y0, last = y0;
  for (const c of [...cuts.filter((c) => c > y0 + 20 && c < y1 - 20).sort((a, b) => a - b), y1]) {
    if (c - start > ${MAX_BAND} && last > start) { bands.push([start, last]); start = last; }
    last = c;
  }
  bands.push([start, y1]);
  const out = [];
  for (const [a, b] of bands) for (let s = a; s < b - 1; s += ${MAX_BAND}) out.push([s, Math.min(b, s + ${MAX_BAND})]);
  return { x: r.left + scrollX, width: right - r.left, bands: out };
})()`;

// снимок элемента: name.png или, если он высокий, name.part1.png, name.part2.png, …
async function shot(page, sel, dir, name) {
  const r = await page.evaluate(BANDS(sel));
  await new Promise((res) => setTimeout(res, 150));
  const px = 10, py = 2; // по бокам – запас на подписи легенд, выступающие за блок
  for (let i = 0; i < r.bands.length; i++) {
    const [a, b] = r.bands[i];
    const { data } = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true,
      clip: { x: Math.max(0, r.x - px), y: Math.max(0, a - py), width: Math.ceil(r.width + 2 * px), height: Math.ceil(b - a + 2 * py), scale: 1 } });
    const file = r.bands.length === 1 ? `${name}.png` : `${name}.part${i + 1}.png`;
    await writeFile(join(dir, file), Buffer.from(data, "base64"));
  }
}

async function freezePage(page, base, stem) {
  const t0 = Date.now();
  const loaded = page.once("Page.loadEventFired");
  await page.send("Page.navigate", { url: `${base}/${stem}.html` });
  await loaded;
  // убираем то, что мешает снимкам: шапку, плавающие панели, всплывающие подсказки
  await page.evaluate(`document.head.insertAdjacentHTML("beforeend", "<style>.neft-table{overflow:visible!important}#quarto-margin-sidebar{visibility:hidden!important}#quarto-header,.headroom,#quarto-sidebar-toggle,.tippy-box,[aria-label='tip'],.code-copy-button{display:none!important}</style>")`);
  let settled = await page.evaluate(SETTLE(PAGE_TIMEOUT), PAGE_TIMEOUT + 10e3);
  // разборы считаются по кнопке «▶ Рассчитать варианты» (Inputs.button) – нажимаем все и ждём ещё раз
  const buttons = await page.evaluate(`(() => { const bs = [...document.querySelectorAll("[id^='ojs-cell-'] form button")]; bs.forEach((b) => b.click()); return bs.length; })()`);
  if (buttons) settled = await page.evaluate(SETTLE(PAGE_TIMEOUT), PAGE_TIMEOUT + 10e3);
  if (!settled) console.warn(`  ! ${stem}: расчёты не закончились за ${PAGE_TIMEOUT / 60e3} мин – снимаю как есть`);

  const dir = join(OUT, stem);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  // FREEZE_DUMP=папка – заодно сохранить текст таблиц результатов (сверка цифр в тексте глав)
  if (process.env.FREEZE_DUMP) {
    const txt = await page.evaluate(`[...document.querySelectorAll(".neft-table, [id^='ojs-cell-'] table")].map((t) => t.innerText).join("\\n\\n")`);
    if (txt) await writeFile(join(process.env.FREEZE_DUMP, `${stem}.txt`), txt);
  }
  const ids = await page.evaluate(TARGETS);
  for (const id of ids) await shot(page, `#${id}`, dir, id);

  // живые ячейки: запускаем по очереди и снимаем вывод
  const n = await page.evaluate(`document.querySelectorAll(".live-cell").length`);
  let live = 0;
  for (let k = 0; k < n; k++) {
    const status = await page.evaluate(`(async () => {
      const c = document.querySelectorAll(".live-cell")[${k}], b = c.querySelector(".live-run");
      b.click();
      await new Promise((r) => setTimeout(r, 200));
      const t0 = Date.now();
      while (b.disabled && Date.now() - t0 < ${CELL_TIMEOUT}) await new Promise((r) => setTimeout(r, 250));
      await new Promise((r) => setTimeout(r, 300));
      return c.querySelector(".live-status").textContent;
    })()`, CELL_TIMEOUT + 10e3);
    const ok = !/ошибка/.test(status);
    if (!ok) console.warn(`  ! ${stem}: живая ячейка ${k + 1} – ${status}`);
    const hasOut = await page.evaluate(`!document.querySelectorAll(".live-cell")[${k}].querySelector(".live-out").hidden`);
    if (ok && hasOut) {
      await page.evaluate(`document.querySelectorAll(".live-cell")[${k}].querySelector(".live-out").id = "freeze-live-${k + 1}"`);
      await shot(page, `#freeze-live-${k + 1}`, dir, `live-${k + 1}`);
      live++;
    }
  }
  console.log(`  ${stem}: OJS ${ids.length}, живых ${live}/${n}, ${((Date.now() - t0) / 1000).toFixed(0)} с`);
}

async function main() {
  if (!existsSync(join(BOOK, "index.html"))) throw new Error("нет _book/index.html – сначала quarto render --to html");
  const only = process.argv.slice(2);
  const html = readdirSync(BOOK).filter((f) => f.endsWith(".html")).map((f) => f.replace(/\.html$/, ""));
  const pages = (only.length ? only : html).filter((s) => html.includes(s)).sort();

  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const profile = await mkdtemp(join(tmpdir(), "neft-freeze-"));
  const port = 9300 + Math.floor(Math.random() * 500);
  const chrome = spawn(chromePath(), ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--force-color-profile=srgb", "about:blank"], { stdio: "ignore" });
  try {
    let target;
    for (let i = 0; i < 50 && !target; i++) {
      await new Promise((r) => setTimeout(r, 200));
      target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json()).catch(() => null);
    }
    if (!target) throw new Error("Chrome не запустился");
    const page = await cdp(target.webSocketDebuggerUrl);
    page.onEvent((m) => { if (m.method === "Runtime.exceptionThrown") console.warn("  ! JS:", m.params.exceptionDetails.exception?.description?.split("\n")[0]); });
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 2, mobile: false });
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
    console.log(`Снимки в ${OUT}`);
    for (const stem of pages) await freezePage(page, base, stem);
    page.close();
  } finally {
    chrome.kill();
    srv.close();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
