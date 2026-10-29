// live.js – «живые» ячейки кода методички: код можно править и запускать прямо на странице.
//   ::: {.live-py}   – Python (Pyodide: CPython в браузере; numpy, matplotlib и учебный модуль minisim)
//   ::: {.live-js}   – JavaScript с настоящим ядром игры (neft, core, Plot)
// Внутри div – обычный блок кода. Скрипт заменяет его редактором с кнопками «Запустить» и «Сбросить».
// Ctrl+Enter (Shift+Enter) – запустить, Tab – отступ. Python грузится один раз на страницу (первый запуск 10–30 с).
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const base = () => document.baseURI;

let pyReady = null;
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("не загрузился " + src)); document.head.append(s); });
}
async function pyodide(status) {
  if (!pyReady) pyReady = (async () => {
    status("загружаю Python (Pyodide) – только в первый раз, 10–30 с…");
    await loadScript(PYODIDE + "pyodide.js");
    const py = await globalThis.loadPyodide({ indexURL: PYODIDE });
    status("загружаю numpy и matplotlib…");
    await py.loadPackage(["numpy", "matplotlib"]);
    const src = await (await fetch(new URL("assets/py/minisim.py", base()))).text();
    py.FS.writeFile("/home/pyodide/minisim.py", src);
    await py.runPythonAsync(`
import sys, io, base64
sys.path.insert(0, "/home/pyodide")
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
plt.rcParams.update({"figure.dpi": 100, "figure.figsize": (6, 4), "axes.grid": True, "grid.alpha": 0.3, "font.size": 10})
def _live_figs():
    out = []
    for n in plt.get_fignums():
        buf = io.BytesIO()
        plt.figure(n).savefig(buf, format="png", dpi=110, bbox_inches="tight")
        out.append(base64.b64encode(buf.getvalue()).decode())
    plt.close("all")
    return out
def _live_repr(x):
    # как в Jupyter: объекты matplotlib (оси, линии, списки линий) не печатаем – их показывает рисунок
    import matplotlib.artist
    items = x if isinstance(x, (list, tuple)) else [x]
    if items and all(isinstance(i, matplotlib.artist.Artist) for i in items):
        return None
    return repr(x)
`);
    return py;
  })().catch((e) => { pyReady = null; throw e; });
  return pyReady;
}

// Python на странице один (общие stdout и фигуры matplotlib), поэтому ячейки выполняются строго по очереди
let pyQueue = Promise.resolve();
function pyExclusive(fn) { const run = pyQueue.then(fn, fn); pyQueue = run.catch(() => {}); return run; }

let neftMod = null;
const neft = () => (neftMod ||= import(new URL("assets/js/neft.js", base()).href));

function build(div, lang) {
  const codeEl = div.querySelector("pre code") || div.querySelector("pre");
  if (!codeEl) return;
  const original = codeEl.textContent.replace(/\n$/, "");
  const wrap = document.createElement("div");
  wrap.className = "live-cell";
  wrap.innerHTML = `<div class="live-bar"><span class="live-lang">${lang === "py" ? "Python" : "JavaScript · ядро игры"}</span>
    <button class="live-run btn btn-sm btn-primary" title="Ctrl+Enter">▶ Запустить</button>
    <button class="live-reset btn btn-sm btn-outline-secondary" title="Вернуть исходный код">↺ Сбросить</button>
    <span class="live-status"></span></div>
    <textarea class="live-code" spellcheck="false" autocomplete="off" autocapitalize="off"></textarea>
    <div class="live-out" hidden></div>`;
  const ta = wrap.querySelector("textarea"), out = wrap.querySelector(".live-out"), st = wrap.querySelector(".live-status"), btn = wrap.querySelector(".live-run");
  ta.value = original;
  const fit = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + 4 + "px"; };
  ta.addEventListener("input", fit);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Tab") { e.preventDefault(); const a = ta.selectionStart; ta.setRangeText("    ", a, ta.selectionEnd, "end"); fit(); }
    if (e.key === "Enter" && (e.ctrlKey || e.shiftKey || e.metaKey)) { e.preventDefault(); run(); }
  });
  wrap.querySelector(".live-reset").onclick = () => { ta.value = original; fit(); out.hidden = true; out.innerHTML = ""; st.textContent = ""; };
  const status = (t) => (st.textContent = t);
  const print = (text, cls = "") => { const p = document.createElement("pre"); p.className = "live-text " + cls; p.textContent = text; out.append(p); out.hidden = false; };
  const show = (el) => { if (el instanceof Node) { out.append(el); out.hidden = false; } else print(String(el)); return el; };
  async function run() {
    btn.disabled = true; out.innerHTML = ""; out.hidden = true;
    const t0 = performance.now();
    try {
      if (lang === "py") await pyExclusive(async () => {
        const py = await pyodide(status);
        status("выполняется…");
        let buf = "";
        py.setStdout({ batched: (s) => (buf += s + "\n") });
        py.setStderr({ batched: (s) => (buf += s + "\n") });
        let res;
        try { res = await py.runPythonAsync(ta.value); }
        finally { if (buf) print(buf.replace(/\n$/, "")); }
        if (res !== undefined && res !== null) {
          const txt = res.destroy ? py.globals.get("_live_repr")(res) : String(res);
          if (txt != null) print(txt);
          if (res.destroy) res.destroy();
        }
        const figs = py.globals.get("_live_figs")().toJs();
        for (const b64 of figs) { const img = new Image(); img.src = "data:image/png;base64," + b64; img.className = "live-fig"; show(img); }
      });
      else {
        status("выполняется…");
        const N = await neft(), core = await N.ready();
        const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
        const fn = new AsyncFn("neft", "Plot", "core", "show", "print", "status", ta.value);
        const res = await fn(N, N.Plot, core, show, (...a) => print(a.map((x) => (typeof x === "object" ? JSON.stringify(x, null, 1) : String(x))).join(" ")), status);
        const rows = Array.isArray(res) && res.length && res.every((r) => r && typeof r === "object" && !Array.isArray(r) && !(r instanceof Node));
        if (rows) show(N.table(res)); // массив объектов (f.wellTable() и т. п.) – таблицей
        else if (res !== undefined) show(res instanceof Node ? res : typeof res === "object" ? JSON.stringify(res, null, 1) : String(res));
      }
      status(`готово за ${((performance.now() - t0) / 1000).toFixed(1)} с`);
    } catch (e) {
      print(String(e && e.message ? e.message : e), "live-err");
      status("ошибка – исправьте код и запустите снова");
    } finally { btn.disabled = false; }
  }
  btn.onclick = run;
  div.replaceChildren(wrap);
  requestAnimationFrame(fit);
}

function init() {
  document.querySelectorAll("div.live-py").forEach((d) => build(d, "py"));
  document.querySelectorAll("div.live-js").forEach((d) => build(d, "js"));
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
