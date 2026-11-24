// СГЕНЕРИРОВАНО manual/tools/sync-core.mjs из ../index.html – не править вручную

"use strict";
// =====================================================================
// sim-core: чистое ядро симуляции (без DOM). Тестируется node-харнессом
// tests/selftest.js: он вырезает этот скрипт и исполняет в vm-песочнице.
// В браузере ядро доступно как globalThis.OILCORE.
// Соглашения: давление атм; проницаемость мД; вязкость сП; время сут;
// дебиты и объёмы м³/сут и м³ (пластовые, FVF=1); нефть в тонны – только
// на выводе (rho=0.86 т/м³). Знак дебита скважины: q>0 – отбор из пласта
// (для нагнетательной храним закачку как w.q>0 и учитываем стоком).
// =====================================================================
function registerCore(api) { globalThis.OILCORE = api; }
// ---------- Константы и параметры ----------
const CONV_K = 0.00864; // м³/сут·сП /(мД·м·атм): q = CONV_K·k·(A/L)·ΔP/μ (выведено из СИ, сверено с Писманом)
const GRID = { nx: 50, ny: 50, dx: 40, h: 10, phi: 0.2 };
// Размер расчётной сетки выбирается игроком (params.grid = N, сетка N×N на участке 2000×2000 м, ячейка 2000/N м). Геометрия
// объектов (структура, разломы, русла, карты) задана в «базовых» координатах сетки 50×50; для другой сетки точки
// пересчитываются: центр ячейки i – в базовой точке (i + 0.5)/rf − 0.5, rf = N/50. Для N = 50 всё совпадает бит в бит.
const BASE_N = 50, REF_DX = 40;
const GRID_SIZES = [25, 40, 50, 80, 100]; // допустимые N (ячейка 80, 50, 40, 25, 20 м)
const toBase = (i, rf) => (i + 0.5) / rf - 0.5;
const toGrid = (b, rf) => (b + 0.5) * rf - 0.5;
// расчётные настройки модуля (можно менять на стартовом экране): макс. шаг переноса, число Куранта, точность решателя
const DEFAULT_CALC = { dtMax: 2, courant: 0.5, tol: 1e-6, maxit: 500, dtP: 1 };
// Ориентиры цен – Западная Сибирь, 2024–2025 гг., пласт на глубине ~2,5 км (см. README, раздел «Экономика»)
const DEFAULT_PARAMS = {
  mu_o: 5,            // сП
  price_oil: 12000,   // руб/т – netback: экспортная цена за вычетом НДПИ, пошлин и транспорта
  drill_cost: 80e6,   // руб – строительство вертикальной (наклонно-направленной) скважины «под ключ»
  lift_cost: 100,     // руб/м³ жидкости – сбор, подготовка нефти, утилизация воды (без электроэнергии насосов)
  inj_cost: 40,       // руб/м³ закачки – водозабор и водоподготовка (без электроэнергии КНС)
  well_opex: 4e6,     // руб/год на работающую добывающую скважину – обслуживание, ПРС, ремонт оборудования, персонал
  horizon_days: 3650, // 10 лет
  init_money: 0,      // стартовый капитал, руб (игра начинается с нуля и идёт в кредит до credit_limit)
  credit_limit: 1500e6, // максимальный долг, руб: покупки, уводящие баланс ниже -лимита, недоступны
  elec_cost: 5.5,     // руб/кВт·ч – ЭЦН и насосы КНС
  rigs0: 1,           // буровых станков на старте
  drill_days_v: 60,   // суток на скважину одним станком: вертикальная (в т.ч. с ГРП)
  drill_days_h: 90,   // то же для горизонтальной (в т.ч. с МГРП)
};
// постоянные затраты: нагнетательная – доля от добывающей, остановленная (консервация) – доля
const WELL_OPEX_INJ = 0.5, WELL_OPEX_IDLE = 0.25;
const KNS_EFF = 0.7; // КПД насосного агрегата КНС: энергия закачки = P_КНС·V/η
// Капитальные затраты задаются в «единицах» параметров: {drill_cost: 1.7, frac_cost: 2.4, ...}; цена = Σ единиц × параметр
// (lost_t – недобор нефти, т, по цене нефти). Так эталон пересчитывается по ценам игрока без повторного расчёта.
const FRAC_MULT = { 40: 1, 80: 1.6, 120: 2.4 }; // стоимость ГРП по полудлине (масса проппанта) в долях frac_cost
const CAPEX = {
  vert: () => ({ drill_cost: 1 }),
  hs: (L) => ({ drill_cost: 1.2 + (0.5 * L) / 1000 }),                 // ГС: +20 % за профиль + проходка горизонтального участка
  zbs: (L) => ({ drill_cost: 0.35 + (0.5 * L) / 1000 }),               // боковой ствол: вырезка окна, бурение и крепление хвостовика
  frac: (xf) => ({ frac_cost: FRAC_MULT[xf] }),
  mgrp: (n, xf) => ({ frac_cost: FRAC_MULT[xf] * (0.4 + 0.6 * n) }),   // МГРП: мобилизация флота + каждая стадия дешевле одиночного ГРП
};
function costOf(units, params) {
  let c = 0;
  for (const k in units) c += units[k] * (k === "lost_t" ? params.price_oil : params[k] ?? DEFAULT_COSTS[k] ?? 0);
  return c;
}
// сейсмика 3D стоит как 12 скважин (по умолчанию для объекта: 12 × стоимость его скважины); ГРП – 20 млн руб за трещину 40 м
const SEIS_WELLS = 12;
const DEFAULT_COSTS = { esp_cost: 6e6, conv_cost: 5e6, frac_cost: 20e6, stim_cost: 2e6, pta_cost: 1e6, seis_cost: SEIS_WELLS * 80e6, expl_cost: 320e6, rig_cost: 120e6 };
const addUnits = (acc, u, m = 1) => { for (const k in u) acc[k] = (acc[k] || 0) + u[k] * m; return acc; };

// ---------- ГПСЧ (детерминированный seed) ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0);
  };
}
function gauss(rng) { // Box–Muller
  const u = (rng() + 1) / 4294967297 || 1e-12, v = rng() / 4294967296;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------- Геология ----------
function buildReservoir(params) {
  const { nx, ny, dx, h, phi } = GRID;
  const rng = mulberry32(20260915);
  const cx = (nx - 1) / 2, cy = (ny - 1) / 2;
  const active = new Uint8Array(nx * ny), k = new Float64Array(nx * ny);
  // русло: синусоидальный канал через поле
  const river = (i) => cy + 6 * Math.sin((i / nx) * 2 * Math.PI) + 3 * Math.sin(i / 7.0);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      // контур нефтеносности: эллипс с гармоническими возмущениями
      const th = Math.atan2((j - cy) / 19, (i - cx) / 24);
      const wob = 1 + 0.10 * Math.sin(3 * th + 0.7) + 0.06 * Math.sin(5 * th - 1.3);
      const ri = Math.hypot((i - cx) / 24, (j - cy) / 19);
      if (ri / wob < 1) {
        active[c] = 1;
        const kbg = Math.min(150, Math.max(15, 20 * Math.exp(0.7 * gauss(rng)))); // фон 15–150 мД
        const inRiver = Math.abs(j - river(i)) < 2.6;
        const kch = 300 + 500 * (rng() / 4294967296); // канал 300–800 мД
        k[c] = inRiver ? Math.max(kch, kbg) : kbg;
      }
    }
  }
  const poreVol = new Float64Array(nx * ny);
  const cells = [];
  for (let c = 0; c < nx * ny; c++)
    if (active[c]) { poreVol[c] = dx * dx * h * phi; cells.push(c); }
  const ooipM3 = cells.reduce((s, c) => s + poreVol[c] * (1 - 0.2), 0);
  return { level: 1, nx, ny, dx, h, phi, ct: 1e-4, P0: 250, mu_o: params.mu_o, mu_w: 1, stressAz: 330,
           Swc: 0.2, Sor: 0.25, SwMax: 1 - 0.25, rho_oil: 0.86, active, k, poreVol, ooipM3, cells };
}

// ---------- Уровень 2: скрытая геология (структура, ВНК, каротаж) ----------
// Пласт – купол (антиклиналь) и небольшой купол-сателлит; ВНК горизонтален на
// абс. отметке L2.OWC. Глубины z – абсолютные, положительные вниз (м ниже уровня
// моря); на экран выводятся со знаком «−». Разрез в точке: кровля zTop, три
// песчаные пачки с эффективными толщинами L2.SANDS (сумма = GRID.h) и два
// глинистых прослоя между ними переменной толщины (местами выклиниваются).
// Нефть – в коллекторе выше ВНК, ниже – вода. Двумерная модель усредняет разрез:
// доля нефтенасыщенной толщины fo = hн/h задаёт начальную Sw ячейки (формула в Sw0).
const L2 = {
  OWC: 2420,              // абс. отметка ВНК, м (истина, игроку не показывается)
  SANDS: [3.5, 3.5, 3.0], // эффективные толщины пачек, м (сумма = GRID.h = 10 м)
  Rw: 0.05,               // сопротивление пластовой воды, Ом·м (Арчи: a = 1, m = n = 2)
  TRANS: 0.35,            // масштаб капиллярной переходной зоны над ВНК, м (только для кривой Rt)
  SEED: 20261015,
  // разломы: ломаные в координатах ячеек (центр ячейки (i, j) – в точке (i, j)), заданы от
  // севера к югу. shift – смещение кровли на стороне «слева по ходу» (на запад при ходе
  // с севера на юг): +глубже, −выше. trans – множитель проводимости граней, пересекающих
  // разлом (0 – полностью запечатан, 1 – проницаем). Игроку свойства разломов неизвестны.
  FAULTS: [
    { name: "F-1", pts: [[26.5, -2], [28.5, 14], [27.5, 30], [29.5, 52]], shift: -4, trans: 0 },
    { name: "F-2", pts: [[13.5, -2], [15.5, 20], [13.5, 36], [16, 52]], shift: 3, trans: 0.3 },
  ],
  // стартовые разведочные скважины [имя, i – столбец, j – строка сетки]:
  // свод (чистая нефть), западный блок за F-2 с ВНК в разрезе, восточный блок за F-1, ВНЗ, вода
  EXPLORE: [["Р-1", 22, 26], ["Р-2", 10, 30], ["Р-3", 33, 22], ["Р-4", 40, 25], ["Р-5", 34, 10]],
};
// Объекты разработки (сценарии уровня 2). Структура – тот же купол с сателлитом и двумя разломами, отражённая
// зеркально (flip: 0 – как есть, 1 – запад↔восток, 2 – север↔юг, 3 – оба), опущенная на глубину объекта; ФЕС, флюиды и
// давление – типичные для пласта-аналога (ориентиры, см. README). depth – абс. отметка свода, м; h – эффективная толщина
// (три пачки 35/35/30 %); shale – множитель толщины глинистых прослоев; k – медиана и разброс (σ ln k) фона, границы,
// русла (chan: k в руслах, число русел); pGrad – пластовое давление на глубине свода, атм/м; drill/expl – стоимость
// эксплуатационной / разведочной скважины по умолчанию, млн руб (растёт с глубиной); stress – азимут максимального
// горизонтального напряжения SHmax (°): трещины ГРП раскрываются вдоль него. Замеры по Западной Сибири дают 310–350°
// (медиана ≈ 330°), по скважинам Волго-Урала – 50°±10°.
const SCENARIOS = {
  base: { name: "Купол (учебный)", short: "Купол", depth: 2400, h: 10, phi: 0.2, shale: 1, Swc: 0.2, Sor: 0.25, mu_o: null, mu_w: 1, rho: 0.86, ct: 1e-4, P0: 250, stress: 330,
          k: { med: 20, sig: 0.7, min: 15, max: 150, chan: { lo: 300, hi: 800, n: 1 } }, flip: 0, drill: 80, expl: 320 },
  bv8: { owcRel: 22, name: "БВ8 – вартовская свита", short: "БВ8", region: "Западная Сибирь, Нижневартовский свод", age: "нижний мел, валанжин",
         rock: "песчаники дельтовых и прибрежно-морских фаций, хорошо отсортированные", depth: 2090, h: 12, phi: 0.23, shale: 0.8, Swc: 0.25, Sor: 0.28, stress: 330,
         mu_o: 1.4, mu_w: 0.45, rho: 0.84, ct: 1e-4, pGrad: 0.101, k: { med: 250, sig: 0.55, min: 60, max: 900, chan: { lo: 600, hi: 1200, n: 1 } }, flip: 0, drill: 70, expl: 280,
         note: "Высокопроницаемый «классический» объект: высокие дебиты, быстрый рост обводнённости – главная задача – система ППД и борьба с обводнением." },
  av12: { owcRel: 17, name: "АВ1¹⁻² – «рябчик»", short: "АВ1 «рябчик»", region: "Западная Сибирь, Нижневартовский свод", age: "нижний мел, апт",
          rock: "тонкое переслаивание песчаников, алевролитов и глин («рябчик»), низкая расчленённая эффективная толщина", depth: 1690, h: 8, phi: 0.21, shale: 2.2, Swc: 0.42, Sor: 0.30,
          mu_o: 2.2, mu_w: 0.5, rho: 0.86, ct: 1e-4, pGrad: 0.101, k: { med: 14, sig: 0.6, min: 3, max: 80 }, flip: 1, drill: 55, expl: 220, stress: 330,
          note: "Низкопроницаемый расчленённый коллектор с высокой связанной водой: вертикальные скважины дают мало – нужны ГРП, ГС и плотная сетка." },
  yuv1: { owcRel: 19, name: "ЮВ1 – васюганская свита", short: "ЮВ1", region: "Западная Сибирь, Нижневартовский и Сургутский своды", age: "верхняя юра, оксфорд",
          rock: "песчаники баровых тел и прибрежно-морских фаций, неоднородные по площади", depth: 2640, h: 8, phi: 0.16, shale: 1, Swc: 0.35, Sor: 0.30,
          mu_o: 1.1, mu_w: 0.4, rho: 0.83, ct: 1.1e-4, pGrad: 0.102, k: { med: 18, sig: 0.85, min: 0.5, max: 150 }, flip: 2, drill: 85, expl: 340, stress: 330,
          note: "Средне- и низкопроницаемый юрский пласт (k в среднем ≈ 20 мД, от долей до ~150 мД): ГРП – стандарт, зоны с хорошими ФЕС стоит искать разведкой и ГДИС." },
  yuk1011: { owcRel: 24, name: "ЮК10–11 – шеркалинская свита (Талинская площадь)", short: "ЮК10–11", region: "Западная Сибирь, Красноленинский свод", age: "нижняя юра",
             rock: "русловые песчаники и гравелиты в низкопроницаемой пойменной толще – резкая неоднородность", depth: 2540, h: 15, phi: 0.17, shale: 1.2, Swc: 0.30, Sor: 0.32,
             mu_o: 0.7, mu_w: 0.4, rho: 0.81, ct: 1.2e-4, pGrad: 0.102, k: { med: 6, sig: 0.7, min: 1, max: 40, chan: { lo: 300, hi: 1500, n: 2 } }, flip: 3, drill: 85, expl: 340, stress: 330,
             note: "Высокопроницаемые русла в плотной матрице: вода прорывается по руслам за месяцы, а запасы матрицы без ГРП не вовлекаются." },
  ach: { owcRel: 27, name: "Ач – ачимовская толща", short: "Ачимовка", region: "Западная Сибирь, Среднее Приобье", age: "нижний мел, берриас–валанжин",
         rock: "турбидитные песчаники и алевролиты конусов выноса, глинистые и карбонатизированные", depth: 2790, h: 14, phi: 0.17, shale: 1.4, Swc: 0.42, Sor: 0.30,
         mu_o: 1.0, mu_w: 0.4, rho: 0.82, ct: 1.3e-4, pGrad: 0.116, k: { med: 0.07, sig: 0.8, min: 0.01, max: 0.5, abs: [0.01, 0.5] }, flip: 1, drill: 95, expl: 380, stress: 330,
         area: 5, price: 28000, // ТРИЗ: участок ×5 по площади (залежь крупная) и льгота по НДПИ (Кнд = 0 при k ≤ 2 мД) – netback выше
         note: "Трудноизвлекаемые запасы (ТРИЗ): k ≈ 0,01–0,5 мД (медиана ≈ 0,07 мД), повышенное пластовое давление, крупная залежь (участок ×5). Льгота по НДПИ (Кнд = 0 при k ≤ 2 мД). Вертикальные скважины почти не дают нефти – нужны ГРП и ГС с МГРП." },
  bb: { owcRel: 15, name: "Бб – бобриковский горизонт", short: "Бобриковский", region: "Волго-Уральская провинция (Татарстан, Башкортостан)", age: "нижний карбон, визе",
        rock: "кварцевые песчаники врезанных долин и русел, высокопроницаемые", depth: 1240, h: 7, phi: 0.21, shale: 0.8, Swc: 0.18, Sor: 0.25,
        mu_o: 22, mu_w: 1.1, rho: 0.89, ct: 1e-4, pGrad: 0.103, k: { med: 420, sig: 0.6, min: 100, max: 1500, chan: { lo: 900, hi: 2000, n: 1 } }, flip: 2, drill: 40, expl: 160, stress: 50,
        note: "Неглубокий высокопроницаемый пласт с вязкой нефтью (≈ 20 сП): неблагоприятное соотношение подвижностей – вода прорывается рано, КИН ограничен." },
};
const SCENARIO_ORDER = ["bv8", "av12", "yuv1", "yuk1011", "ach", "bb"];
const scenOf = (id) => SCENARIOS[id] || SCENARIOS.base;
// ---------- Объект по сиду: группа (тип пласта) + номер ----------
// Сид 0 – канонический объект группы (как в SCENARIOS, с заранее найденным эталоном). Сид ≥ 1 – детерминированно
// сгенерированный объект в диапазонах группы: глубина, толщина и её карта, пористость, проницаемость (медиана, разброс,
// гладкий тренд, русла), вязкость, Swc/Sor, высота залежи, структура (купол с сателлитом), разломы, разведочные скважины.
// Одинаковые группа и сид у всех игроков дают один и тот же объект.
function hashSeed(...xs) { let h = 2166136261; for (const ch of xs.join("|")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const SEED_MAX = 999999;
function scenarioForSeed(id, seed) {
  const b = SCENARIOS[id]; seed = Math.max(0, Math.min(SEED_MAX, Math.floor(+seed || 0)));
  if (!b || !seed || id === "base") return b;
  const rng = mulberry32(hashSeed(id, seed)), u = () => rng() / 4294967296, U = (a, c) => a + (c - a) * u();
  const waves = (n, amp, Lmin, Lmax) => Array.from({ length: n }, () => { const L = U(Lmin, Lmax), d = U(0, 2 * Math.PI); return { a: amp * U(0.6, 1), kx: (Math.cos(d) * 2 * Math.PI) / L, ky: (Math.sin(d) * 2 * Math.PI) / L, ph: U(0, 2 * Math.PI) }; });
  const depth = Math.round(b.depth + U(-120, 120));
  const K = b.k, kMed = K.med * Math.exp(U(Math.log(0.6), Math.log(1.6))), kf = kMed / K.med;
  const k = { med: +kMed.toPrecision(3), sig: +(K.sig * U(0.85, 1.2)).toFixed(2), min: +(K.min * kf).toPrecision(2), max: +(K.max * kf).toPrecision(3) };
  if (K.abs) { k.abs = K.abs; k.min = Math.max(K.abs[0], k.min); k.max = Math.min(K.abs[1], k.max); k.med = Math.min(k.max, Math.max(k.min, k.med)); }
  if (K.chan) k.chan = { lo: Math.round(K.chan.lo * U(0.8, 1.2)), hi: Math.round(K.chan.hi * U(0.8, 1.2)), n: Math.max(1, K.chan.n + (u() < 0.35 ? (u() < 0.5 ? -1 : 1) : 0)) };
  // структура: главный купол (центр, полуоси, ориентация, амплитуда) и, чаще всего, сателлит
  const dome = { cx: U(19, 31), cy: U(19, 31), ax: U(17, 26), ay: U(11, 18), th: U(0, Math.PI), amp: U(17, 28), bumps: waves(2, 1.6, 8, 16) };
  let sat = null;
  if (u() < 0.7) for (let q = 0; q < 20 && !sat; q++) {
    const a = U(0, 2 * Math.PI), dd = U(15, 22), cx = dome.cx + dd * Math.cos(a), cy = dome.cy + dd * Math.sin(a);
    if (cx > 6 && cx < 43 && cy > 6 && cy < 43) sat = { cx, cy, dz: U(5, 14), r2: U(36, 70) };
  }
  // разломы: 0–3 ломаные через участок, амплитуда 2–6 м, проводимость от запечатанного до проницаемого
  const nF = [0, 1, 1, 2, 2, 2, 3][Math.floor(u() * 7)], faults = [];
  for (let f = 0; f < nF; f++) {
    const ang = U(0, Math.PI), px = U(13, 37), py = U(13, 37), dx = Math.cos(ang), dy = Math.sin(ang), nxp = -dy, nyp = dx, pts = [];
    for (const tq of [-40, -14, 14, 40]) { const jit = tq === -40 || tq === 40 ? 0 : U(-1.6, 1.6); pts.push([+(px + dx * tq + nxp * jit).toFixed(2), +(py + dy * tq + nyp * jit).toFixed(2)]); }
    faults.push({ name: `F-${f + 1}`, pts, shift: +((u() < 0.5 ? -1 : 1) * U(2, 6)).toFixed(1), trans: [0, 0, 0.1, 0.3, 0.6][Math.floor(u() * 5)] });
  }
  // русла: ориентация, извилистость, положение
  const chans = Array.from({ length: k.chan ? k.chan.n : 0 }, () => ({ th: U(0, Math.PI), off: U(-14, 14), a1: U(3, 7), L1: U(25, 50), p1: U(0, 2 * Math.PI), a2: U(1, 3), L2: U(8, 14), p2: U(0, 2 * Math.PI), w: U(1.8, 2.8) }));
  const geo = { seed, salt: hashSeed("salt", id, seed), dome, sat, faults, chans, kTrend: waves(3, 0.55, 14, 40), thick: waves(3, 0.2, 16, 45), shale: [U(0, 6), U(0, 6), U(4.5, 7.5), U(4.5, 7.5)] };
  const mu_o = b.mu_o * Math.exp(U(Math.log(0.7), Math.log(1.5)));
  return { ...b, id, seed, name: `${b.name}, сид ${seed}`, short: b.short, depth, h: +(b.h * U(0.8, 1.25)).toFixed(1), phi: +(b.phi + U(-0.02, 0.02)).toFixed(3),
           shale: +(b.shale * U(0.8, 1.25)).toFixed(2), Swc: +(b.Swc + U(-0.03, 0.03)).toFixed(3), Sor: +(b.Sor + U(-0.03, 0.03)).toFixed(3),
           mu_o: +mu_o.toFixed(mu_o >= 10 ? 1 : 2), owcRel: Math.round(Math.max(10, (b.owcRel || 20) + U(-6, 6))), pGrad: +(b.pGrad + U(-0.003, 0.003)).toFixed(4),
           k, flip: 0, drill: Math.round((b.drill * depth) / b.depth), expl: Math.round((b.expl * depth) / b.depth),
           // азимут SHmax (±15° от группы) – последний розыгрыш, чтобы не сдвигать ГПСЧ-последовательность геологии
           stress: ((Math.round((b.stress ?? 330) + U(-15, 15)) % 360) + 360) % 360, geo };
}
// объект по параметрам игры: группа params.scenario и сид params.seed
const scenOfParams = (params) => (params.seed ? scenarioForSeed(params.scenario, params.seed) : scenOf(params.scenario));
const waveSum = (ws, i, j) => ws.reduce((q, w) => q + w.a * Math.sin(w.kx * i + w.ky * j + w.ph), 0);
// множитель эффективной толщины ячейки (карта толщин объекта по сиду): 0.6…1.45
function thickMul(i, j, sc) { const g = sc && sc.geo; return g ? Math.max(0.6, Math.min(1.45, 1 + waveSum(g.thick, i, j))) : 1; }
// отражение координат ячейки (центр ячейки (i, j) – точка (i, j)) по сценарию
function l2Flip(i, j, sc) { const f = (sc && sc.flip) || 0; return [f & 1 ? BASE_N - 1 - i : i, f & 2 ? BASE_N - 1 - j : j]; }
// разломы сценария в координатах сетки
function l2Faults(sc) { return sc && sc.geo ? sc.geo.faults : L2.FAULTS.map((F) => ({ ...F, pts: F.pts.map(([x, y]) => l2Flip(x, y, sc)) })); }
// параметры по умолчанию для объекта: вязкость нефти и стоимости скважин
function scenarioParams(id, seed = 0) { const sc = seed ? scenarioForSeed(id, seed) : scenOf(id); return { scenario: id, seed: seed || 0, mu_o: sc.mu_o || DEFAULT_PARAMS.mu_o, drill_cost: sc.drill * 1e6, expl_cost: sc.expl * 1e6, seis_cost: SEIS_WELLS * sc.drill * 1e6, ...(sc.price ? { price_oil: sc.price } : {}) }; } // price – льгота НДПИ (ТРИЗ ачимовки): netback выше стандартного
// расстояние от точки до отрезка ab: {d – расстояние, side – знак стороны (+1 слева по ходу)}
function segDist(px, py, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy;
  const u = Math.max(0, Math.min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / L));
  const d = Math.hypot(px - (a[0] + u * vx), py - (a[1] + u * vy));
  return { d, side: vx * (py - a[1]) - vy * (px - a[0]) >= 0 ? 1 : -1 };
}
// ближайшая точка ломаной: {d, side}
function polyDist(px, py, pts) {
  let best = null;
  for (let n = 0; n + 1 < pts.length; n++) {
    const q = segDist(px, py, pts[n], pts[n + 1]);
    if (!best || q.d < best.d) best = q;
  }
  return best;
}
// отрезки ab и cd пересекаются. Точка на прямой другого отрезка относится к его левой стороне (o ≥ 0): если ломаная
// разлома проходит точно через центр ячейки или её вершина лежит на линии между центрами, закрывается ровно одна из
// соседних граней (строгая проверка не закрывала ни одной – щель в разломе, нестрогая закрывала все четыре грани
// ячейки на разломе). Коллинеарные отрезки не пересекаются.
function segCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]) >= 0;
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
// ступенька кровли от разломов в точке (i, j), м (гладкая на ширине ~1 ячейки)
function l2FaultShift(i, j, faults = L2.FAULTS) {
  let sum = 0;
  for (const F of faults) {
    const q = polyDist(i, j, F.pts);
    sum += F.shift * 0.5 * (1 + Math.tanh((q.side * q.d) / 0.8));
  }
  return sum;
}
// истинная абс. отметка кровли в точке (i, j) – координаты в ячейках, м
function l2Top(i, j, sc) {
  if (sc && sc.geo) return sc.depth + geoTop(i, j, sc.geo) + l2FaultShift(i, j, sc.geo.faults);
  const [a, b] = l2Flip(i, j, sc); return l2TopSmooth(a, b) + l2FaultShift(a, b) + ((sc && sc.depth) || 2400) - 2400;
}
// кровля объекта по сиду относительно свода: купол-эллипсоид с неровностями и сателлит (гладкий минимум)
function geoTop(i, j, g) {
  const d = g.dome, x = i - d.cx, y = j - d.cy, c = Math.cos(d.th), sn = Math.sin(d.th);
  const u = (x * c + y * sn) / d.ax, v = (-x * sn + y * c) / d.ay;
  const zMain = d.amp * (u * u + v * v) + waveSum(d.bumps, i, j);
  if (!g.sat) return zMain;
  const S = g.sat, zSat = S.dz + (22 * ((i - S.cx) ** 2 + (j - S.cy) ** 2)) / S.r2, m = Math.min(zMain, zSat), sm = 4;
  return m - sm * Math.log(Math.exp((m - zMain) / sm) + Math.exp((m - zSat) / sm));
}
function l2TopSmooth(i, j) {
  const th = 25 * Math.PI / 180, x = i - 22, y = j - 26;
  const u = (x * Math.cos(th) + y * Math.sin(th)) / 22, v = (-x * Math.sin(th) + y * Math.cos(th)) / 15;
  const zMain = 2400 + 22 * (u * u + v * v) + 2 * Math.sin(i / 4.3 + 0.8) * Math.cos(j / 5.1 - 0.4);
  const zSat = 2409 + 22 * ((i - 41) ** 2 + (j - 9) ** 2) / 49;   // сателлит, свод −2409 м
  const m = Math.min(zMain, zSat), s = 4;                          // гладкий минимум → седловина
  return m - s * Math.log(Math.exp((m - zMain) / s) + Math.exp((m - zSat) / s));
}
// толщины двух глинистых прослоев, м (0 – прослой выклинился)
function l2Shales(i, j, g) {
  const q = g ? g.shale : [1.1, -0.5, 6.1, 7.3];
  const t1 = 0.9 + 0.7 * Math.sin(i / q[2] + q[0]) * Math.cos(j / q[3] + q[1]);
  const t2 = 0.5 + 0.8 * Math.sin(i / 5.3 - 0.7 + (g ? q[1] : 0) + j / 9.1);
  return [t1 < 0.35 ? 0 : t1, t2 < 0.3 ? 0 : t2];
}
// альтитуда стола ротора, м: MD = z + альтитуда (скважины вертикальные)
function l2Altitude(i, j) { return 95 + 18 * Math.sin(i / 9 + 0.3) + 12 * Math.cos(j / 7 - 1.0); }
// разрез пласта сверху вниз: [{top, base, sand}], абс. отметки
function l2Column(gi, gj, sc, rf = 1) {
  const i = toBase(gi, rf), j = toBase(gj, rf);
  const sh = l2Shales(i, j, sc && sc.geo).map((t) => t * ((sc && sc.shale) || 1)), out = [], hh = ((sc && sc.h) || GRID.h) * thickMul(i, j, sc);
  let z = l2Top(i, j, sc);
  L2.SANDS.map((x) => (x * hh) / GRID.h).forEach((hs, n) => {
    out.push({ top: z, base: z + hs, sand: true }); z += hs;
    if (n < sh.length && sh[n] > 0) { out.push({ top: z, base: z + sh[n], sand: false }); z += sh[n]; }
  });
  return out;
}
// эффективная нефтенасыщенная толщина разреза при ВНК owc, м
function l2OilNet(col, owc) {
  let hOil = 0;
  for (const p of col) if (p.sand) hOil += Math.max(0, Math.min(p.base, owc) - p.top);
  return hOil;
}
// ошибка сейсмической карты: гладкое поле, |δ| ≲ 4 м (scale = 1)
function l2SeisError(seed = L2.SEED + 7, scale = 1) {
  const rng = mulberry32(seed), u = () => rng() / 4294967296;
  const waves = [1.8, 1.2, 0.8].map((a) => {
    const L = 12 + 14 * u(), dir = 2 * Math.PI * u();
    return { a: a * scale, kx: Math.cos(dir) * 2 * Math.PI / L, ky: Math.sin(dir) * 2 * Math.PI / L, ph: 2 * Math.PI * u() };
  });
  return (i, j) => waves.reduce((s, w) => s + w.a * Math.sin(w.kx * i + w.ky * j + w.ph), 0);
}
// Сейсморазведка 3D (покупается игроком): структурные карты кровли и подошвы, толщина
// и разломы. Ошибки – гладкие поля: кровля |δ| ≲ 4 м, подошва ≲ 3 м (толщина = подошва −
// кровля, относительная ошибка толщины велика); трассы разломов смещены на ≲ 1 ячейки,
// сбросы оценены с ошибкой ≈ 25 %. Герметичность разломов сейсмикой не определяется.
function buildSeismic(zTop, gross, nx, ny, faultsSc = L2.FAULTS, salt = L2.SEED) {
  const N = nx * ny, rf = nx / BASE_N, eTop = l2SeisError(salt + 7, 1), eBase = l2SeisError(salt + 19, 0.8);
  const top = new Float64Array(N), base = new Float64Array(N), thick = new Float64Array(N);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      top[c] = zTop[c] + eTop(toBase(i, rf), toBase(j, rf));
      base[c] = zTop[c] + gross[c] + eBase(toBase(i, rf), toBase(j, rf));
      thick[c] = base[c] - top[c];
    }
  const rng = mulberry32(salt + 31), u = () => rng() / 4294967296 - 0.5;
  const faults = faultsSc.map((F) => ({
    name: F.name,
    pts: F.pts.map(([x, y]) => [toGrid(x + 1.4 * u(), rf), toGrid(y + 0.6 * u(), rf)]),   // координаты вершин, ячейки сетки
    throwEst: Math.round(Math.abs(F.shift) * (1 + 0.5 * u()) * 10) / 10,
  }));
  return { top, base, thick, faults };
}
function buildReservoir2(params) {
  const sc = scenOfParams(params), base = sc === SCENARIOS.base, g = sc.geo, salt = g ? g.salt : L2.SEED;
  const plot = 2000 * Math.sqrt(sc.area || 1); // участок: у ТРИЗ (ачимовка) площадь ×5
  const nx = GRID_SIZES.includes(+params.grid) ? +params.grid : BASE_N, ny = nx, dx = plot / nx, rf = nx / BASE_N;
  const N = nx * ny, Swc = sc.Swc, h = sc.h, phi = sc.phi;
  const rng = mulberry32(salt);
  const cy = (BASE_N - 1) / 2;
  const active = new Uint8Array(N).fill(1), k = new Float64Array(N), kTrue = new Float64Array(N), tm = new Float64Array(N);
  const zTop = new Float64Array(N), gross = new Float64Array(N);
  const hOil = new Float64Array(N), Sw0 = new Float64Array(N);
  const river = (i) => cy + 6 * Math.sin((i / BASE_N) * 2 * Math.PI) + 3 * Math.sin(i / 7.0);
  const river2 = (i) => cy - 15 + 4 * Math.sin((i / BASE_N) * 3 * Math.PI + 1) + 2 * Math.sin(i / 5.0);
  const K = sc.k, faultsBase = l2Faults(sc), cols = new Array(N);
  const faults = faultsBase.map((F) => ({ ...F, pts: F.pts.map(([x, y]) => [toGrid(x, rf), toGrid(y, rf)]) })); // разломы в координатах сетки
  let owc = sc.depth + (sc.owcRel || 20); // ВНК: высота залежи owcRel над сводом
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i, bi = toBase(i, rf), bj = toBase(j, rf);
      const kbg = Math.min(K.max, Math.max(K.min, K.med * Math.exp(K.sig * gauss(rng) + (g ? waveSum(g.kTrend, bi, bj) : 0))));
      const kch = K.chan ? K.chan.lo + (K.chan.hi - K.chan.lo) * (rng() / 4294967296) : (rng(), 0);
      const inCh = K.chan && (g ? inGeoChannel(bi, bj, g) : Math.abs(bj - river(bi)) < 2.6 || (K.chan.n > 1 && Math.abs(bj - river2(bi)) < 2.0));
      kTrue[c] = inCh ? Math.max(kch, kbg) : kbg;
      tm[c] = thickMul(bi, bj, sc); k[c] = kTrue[c] * tm[c]; // в расчёте – k·h/h̄ (проводимость пропорциональна толщине)
      const col = (cols[c] = l2Column(i, j, sc, rf));
      zTop[c] = col[0].top;
      gross[c] = col[col.length - 1].base - col[0].top;
      hOil[c] = l2OilNet(col, owc);
      // вертикальное усреднение: нефтяная часть при Swc, водяная – Sw = 1
      const fo = Math.min(1, hOil[c] / (h * tm[c]));
      Sw0[c] = fo * Swc + (1 - fo);
    }
  }
  if (g) {
    // объект по сиду: ВНК – от фактического свода (с учётом разломов), высота залежи не меньше 1,4 толщины;
    // если площадь нефтеносности мала – ВНК ниже, пока нефтяных ячеек не станет ≥ 450
    let zMin = Infinity; for (let c = 0; c < N; c++) zMin = Math.min(zMin, zTop[c]);
    owc = zMin + Math.max(sc.owcRel, 1.4 * h + 4);
    const fill = () => { let n = 0; for (let c = 0; c < N; c++) { hOil[c] = l2OilNet(cols[c], owc); const fo = Math.min(1, hOil[c] / (h * tm[c])); Sw0[c] = fo * Swc + (1 - fo); if (hOil[c] > 0) n++; } return n; };
    for (let q = 0; fill() < 450 * rf * rf && q < 30; q++) owc += 2;
    owc = Math.round(owc * 10) / 10; fill();
  }
  const poreVol = new Float64Array(N).map((_, c) => dx * dx * h * phi * tm[c]);
  const cells = Array.from({ length: N }, (_, c) => c);
  const ooipM3 = cells.reduce((s, c) => s + poreVol[c] * (1 - Sw0[c]), 0);
  // проводимости граней: восток (c → c+1) и север (c → c+nx) режутся разломами
  const tmE = new Float64Array(N).fill(1), tmN = new Float64Array(N).fill(1);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      for (const F of faults)
        for (let n = 0; n + 1 < F.pts.length; n++) {
          if (i + 1 < nx && segCross([i, j], [i + 1, j], F.pts[n], F.pts[n + 1])) tmE[c] = Math.min(tmE[c], F.trans);
          if (j + 1 < ny && segCross([i, j], [i, j + 1], F.pts[n], F.pts[n + 1])) tmN[c] = Math.min(tmN[c], F.trans);
        }
    }
  const seis = buildSeismic(zTop, gross, nx, ny, faultsBase, salt);
  const P0 = base ? 250 : Math.round(sc.pGrad * sc.depth);
  return { level: 2, scenario: base ? null : params.scenario, seed: g ? sc.seed : 0, salt, scen: sc, kTrue, thick: tm, nx, ny, dx, plot, h, phi, ct: sc.ct, P0, mu_o: sc.mu_o || params.mu_o, mu_w: sc.mu_w, stressAz: ((sc.stress ?? 330) % 360 + 360) % 360,
           // предел забойного давления закачки (давление гидроразрыва с запасом): ≈ 0.14 атм/м глубины ВНК
           pMaxInj: base ? 340 : Math.round(0.14 * owc),
           // SwMax > 1: перенос насыщенности (как и на уровне 1) относит упругий запас
           // (Vp·ct·ΔP) к изменению Sw, и в водяной зоне (Sw = 1) при росте давления
           // Sw слегка превышает 1 (на ct·ΔP ≈ 1 %). Кламп 1.05 – только страховка,
           // иначе срезалась бы закачанная вода
           Swc, Sor: sc.Sor, SwMax: 1.05, rho_oil: sc.rho, active, k, poreVol, ooipM3, cells,
           Sw0, zTop, zSeis: seis.top, gross, hOil, owc, tmE, tmN, seis,
           faults: faults.map((F) => ({ name: F.name, pts: F.pts, shift: F.shift, trans: F.trans })),
           explore: g ? pickExplore(zTop, hOil, h, tm, salt, nx) : L2.EXPLORE.map(([name, i, j]) => { const [a2, b2] = l2Flip(i, j, sc), gi = Math.round(toGrid(a2, rf)), gj = Math.round(toGrid(b2, rf)); return { name, cell: gj * nx + gi }; }),
           grid: nx };
}

// русло объекта по сиду: извилистая полоса в повёрнутых координатах
function inGeoChannel(i, j, g) {
  for (const ch of g.chans) {
    const x = (i - 24.5) * Math.cos(ch.th) + (j - 24.5) * Math.sin(ch.th), y = -(i - 24.5) * Math.sin(ch.th) + (j - 24.5) * Math.cos(ch.th);
    const yc = ch.off + ch.a1 * Math.sin((2 * Math.PI * x) / ch.L1 + ch.p1) + ch.a2 * Math.sin((2 * Math.PI * x) / ch.L2 + ch.p2);
    if (Math.abs(y - yc) < ch.w) return true;
  }
  return false;
}
// стартовые разведочные скважины объекта по сиду: свод, два крыла в нефтяной зоне, водонефтяная зона, водяная зона
function pickExplore(zTop, hOil, h, tm, salt, nx = BASE_N) {
  const rf = nx / BASE_N, m0 = 4 * rf, rng = mulberry32(salt + 53), u = () => rng() / 4294967296, inner = (c) => { const i = c % nx, j = Math.floor(c / nx); return i > m0 && i < nx - 1 - m0 && j > m0 && j < nx - 1 - m0; };
  const cells = Array.from({ length: nx * nx }, (_, c) => c).filter(inner), out = [];
  const far = (c) => out.every((o) => Math.hypot((o % nx) - (c % nx), Math.floor(o / nx) - Math.floor(c / nx)) >= 7 * rf);
  const take = (list) => { const L = list.filter(far); if (!L.length) return; out.push(L[Math.floor(u() * L.length)]); };
  const full = cells.filter((c) => hOil[c] >= h * tm[c] - 1e-6), part = cells.filter((c) => hOil[c] > 0.5 && hOil[c] < h * tm[c] - 0.5), water = cells.filter((c) => hOil[c] <= 0);
  out.push(full.reduce((a, c) => (zTop[c] < zTop[a] ? c : a), full[0] ?? cells[0])); // свод
  take(full); take(full); take(part.length ? part : full); take(water);
  while (out.length < 5) take(cells);
  return out.slice(0, 5).map((cell, n) => ({ name: `Р-${n + 1}`, cell }));
}

// Синтетический каротаж и РИГИС в ячейке cell (уровень 2). Кривые: ГК (мкР/ч),
// сопротивление Rt (Ом·м, по Арчи: Rt = Rw/(Кп²·Sw²)), пористость Кп. РИГИС –
// интервалы пласта: коллектор нефть / коллектор вода / неколлектор (прослой).
// Шум детерминирован (seed от номера ячейки) – повторный вызов даёт тот же планшет.
function wellLog(r, cell) {
  const rf = r.nx / BASE_N, i = cell % r.nx, j = Math.floor(cell / r.nx);
  const col = l2Column(i, j, r.scen, rf), owc = r.owc;
  const rng = mulberry32(((r.salt || L2.SEED) ^ Math.imul(cell + 1, 2654435761)) >>> 0);
  const nz = () => gauss(rng);
  const r1 = (x) => Math.round(x * 10) / 10;
  const alt = r1(l2Altitude(toBase(i, rf), toBase(j, rf)));
  const top = col[0].top, base = col[col.length - 1].base;
  const z0 = Math.floor(top - 8), z1 = Math.ceil(base + 6), dz = 0.2;
  const sandAt = (z) => col.some((p) => p.sand && z >= p.top && z < p.base);
  const raw = [];
  for (let n = 0; z0 + n * dz <= z1 + 1e-9; n++) {
    const z = z0 + n * dz;
    let gr, kp, rt;
    if (sandAt(z)) {
      kp = r.phi + 0.008 * nz();
      const d = owc - z; // высота над ВНК, м
      const sw = d <= 0 ? 1 : r.Swc + (1 - r.Swc) * Math.exp(-d / L2.TRANS);
      gr = 5 + 0.6 * nz();
      rt = L2.Rw / (kp * kp * sw * sw);
    } else {
      kp = 0.05 + 0.01 * nz(); gr = 13 + 1.0 * nz(); rt = 3.5 * (1 + 0.08 * nz());
    }
    raw.push({ z, gr, kp, lrt: Math.log10(rt * (1 + 0.05 * nz())) });
  }
  // сглаживание по 3 точкам (разрешение прибора)
  const samples = raw.map((s, n) => {
    const a = raw[Math.max(0, n - 1)], b = raw[Math.min(raw.length - 1, n + 1)];
    return { z: s.z, md: s.z + alt, gr: (a.gr + s.gr + b.gr) / 3, kp: (a.kp + s.kp + b.kp) / 3,
             rt: Math.pow(10, (a.lrt + s.lrt + b.lrt) / 3) };
  });
  // РИГИС: границы в MD с точностью 0.1 м; абс. отметка = −(MD − альтитуда)
  const rigis = [];
  const push = (zt, zb, kind) => {
    const mdTop = r1(zt + alt), mdBase = r1(zb + alt);
    if (mdBase - mdTop < 0.05) return;
    const sand = kind !== "shale";
    rigis.push({ mdTop, mdBase, absTop: -r1(mdTop - alt), absBase: -r1(mdBase - alt),
                 h: r1(mdBase - mdTop), kind,
                 kp: sand ? r.phi + 0.006 * nz() : null,
                 kn: kind === "oil" ? 1 - r.Swc + 0.015 * nz() : kind === "water" ? 0 : null,
                 kpr: sand ? Math.max(1, Math.round(r.k[cell] * (1 + 0.12 * nz()))) : null });
  };
  for (const p of col) {
    if (!p.sand) { push(p.top, p.base, "shale"); continue; }
    const cut = Math.min(Math.max(owc, p.top), p.base);
    push(p.top, cut, "oil");
    push(cut, p.base, "water");
  }
  const sum = (kind) => r1(rigis.filter((x) => x.kind === kind).reduce((s, x) => s + x.h, 0));
  return { cell, i, j, alt, samples, rigis,
           mdTop: r1(top + alt), absTop: -r1(r1(top + alt) - alt),
           mdBase: r1(base + alt), absBase: -r1(r1(base + alt) - alt),
           hGross: r1(r1(base + alt) - r1(top + alt)), hOil: sum("oil"), hWater: sum("water") };
}

// связность активной области по 4-соседям
function isConnected(r) {
  const NB = (c) => [c % r.nx > 0 ? c - 1 : -1, c % r.nx < r.nx - 1 ? c + 1 : -1, c - r.nx, c + r.nx];
  const seen = new Uint8Array(r.nx * r.ny);
  const queue = [r.cells[0]]; seen[r.cells[0]] = 1;
  let cnt = 1;
  while (queue.length) {
    const c = queue.pop();
    for (const nb of NB(c)) if (nb >= 0 && r.active[nb] && !seen[nb]) { seen[nb] = 1; cnt++; queue.push(nb); }
  }
  return cnt === r.cells.length;
}

// ---------- Тесты ----------
function reservoirTests() {
  const out = [];
  const r = buildReservoir(DEFAULT_PARAMS);
  const nAct = r.cells.length;
  out.push({ name: "геология: сетка 50x50", pass: r.nx === 50 && r.ny === 50 });
  const frac = nAct / (50 * 50);
  out.push({ name: "геология: активная доля 0.5–0.7", pass: frac > 0.5 && frac < 0.7,
             details: `frac=${frac.toFixed(2)}` });
  let kmin = 1e9, kmax = 0, ksum = 0;
  for (const c of r.cells) { kmin = Math.min(kmin, r.k[c]); kmax = Math.max(kmax, r.k[c]); ksum += r.k[c]; }
  out.push({ name: "геология: k в [10, 900] мД", pass: kmin >= 10 && kmax <= 900,
             details: `k=[${kmin.toFixed(0)}, ${kmax.toFixed(0)}] мД, среднее ${(ksum / nAct).toFixed(0)}` });
  const r2 = buildReservoir(DEFAULT_PARAMS);
  let same = true;
  for (let c = 0; c < r.k.length; c++) if (r.k[c] !== r2.k[c]) { same = false; break; }
  out.push({ name: "геология: детерминизм (seed)", pass: same });
  const pvSum = r.cells.reduce((s, c) => s + r.poreVol[c], 0);
  const ooipErr = Math.abs(r.ooipM3 - pvSum * (1 - r.Swc)) / r.ooipM3;
  out.push({ name: "геология: OOIP = Vp·(1-Swc)", pass: ooipErr < 1e-9,
             details: `OOIP=${(r.ooipM3 / 1e6).toFixed(2)} млн м³` });
  out.push({ name: "геология: активная область связна", pass: isConnected(r) });
  return out;
}

// ---------- ОФП, дробное течение, индекс скважины ----------
// Линейные «поршневые» ОФП: krw от 0 при Swc до 1 при 1-Sor, kro зеркально.
function krw(Sw, r) { const s = (Sw - r.Swc) / (1 - r.Swc - r.Sor); return Math.max(0, Math.min(1, s)); }
function kro(Sw, r) { const s = (1 - r.Sor - Sw) / (1 - r.Swc - r.Sor); return Math.max(0, Math.min(1, s)); }
function fw(Sw, r) {
  const a = krw(Sw, r) / r.mu_w, b = kro(Sw, r) / r.mu_o;
  return (a + b) > 0 ? a / (a + b) : 0;
}
function lambdaT(Sw, r) { return krw(Sw, r) / r.mu_w + kro(Sw, r) / r.mu_o; }
// Писман: q = WI·λt·(P_яч − Pwf), re = 0.2·Δ = 8 м, rw = 0.1 м, skin = 0
function wellIndex(k, r, skin = 0) { return CONV_K * 2 * Math.PI * k * r.h / Math.max(0.5, Math.log((0.2 * (r.dx || REF_DX)) / 0.1) + skin); }
// поправка множителей f ячеек ствола и трещины на размер ячейки: калибровки ГС и ГРП сделаны на ячейке 40 м, длина
// участка внутри ячейки считается в метрах (f ~ ℓ/40 м), а ln(re/rw) Писмана меняется с размером ячейки
const wiNorm = (r) => Math.log(8 / 0.1) / Math.log((0.2 * r.dx) / 0.1);
// скин скважины уровня 2 (истина, игроку неизвестна): −1…7, большинство 0…3
function l2Skin(cell, salt = L2.SEED) {
  const u = mulberry32((salt ^ Math.imul(cell + 7, 40503)) >>> 0)() / 4294967296;
  return Math.round((-1 + 8 * u * u) * 10) / 10;
}

// ---------- Симуляция: давление ----------
const NB = (c, r) => [c % r.nx > 0 ? c - 1 : -1, c % r.nx < r.nx - 1 ? c + 1 : -1,
                      c - r.nx, c + r.nx]; // [запад, восток, юг, север]; -1 = вне сетки

function createSim(reservoir, params) {
  const r = reservoir, N = r.cells.length;
  const sim = {
    r, params, cfg: { ...DEFAULT_CALC, ...((params && params.calc) || {}) },
    P: new Float64Array(r.nx * r.ny).fill(r.P0),
    Sw: r.Sw0 ? Float64Array.from(r.Sw0) : new Float64Array(r.nx * r.ny).fill(r.Swc),
    wells: [],
    t: 0, cumProdM3: 0,
    history: { days: [] },          // посуточные снимки (заполняется в advance)
    lastCG: { iters: 0, resid: 0, rhs0: 1 },
    _rowOf: new Int32Array(r.nx * r.ny).fill(-1), // ячейка → строка матрицы
    _Te: new Float64Array(r.nx * r.ny),           // проводимость восточной грани ячейки
    _Tn: new Float64Array(r.nx * r.ny),           // проводимость северной грани ячейки
    _uE: new Float64Array(r.nx * r.ny),           // поток на восток (м³/сут, >0 из ячейки)
    _uN: new Float64Array(r.nx * r.ny),           // поток на север
    _lastSolveT: null, _solveEnd: null, _fluxValid: false,
    _x: new Float64Array(N), _Ap: new Float64Array(N),
    _res: new Float64Array(N), _z: new Float64Array(N), _pk: null,
    _diag: new Float64Array(N), _b: new Float64Array(N),
  };
  r.cells.forEach((c, idx) => (sim._rowOf[c] = idx));
  sim.drill = { rigs: (params && params.rigs0) ?? DEFAULT_PARAMS.rigs0, queue: [], active: [], on: null }; // станки и очередь бурения (см. orderWell)
  sim.addWell = (c, type, pwf) => {
    if (!r.active[c]) throw new Error("ячейка вне контура");
    if (sim.wells.some((w) => w.perf.some((p) => p.cell === c))) throw new Error("ячейка занята");
    sim.wells.push({ cell: c, type, pwf, q: 0, qo: 0, qw: 0,
                     perf: [{ cell: c, f: 1 }], kind: "v", L: 0, dir: null, frac: null, // заканчивание: v – вертикальная, hs – ГС, zbs – боковой ствол, frac – ГРП
                     skin: r.level === 2 ? l2Skin(c, r.salt) : 0, wasProd: type === "prod",
                     on: true,             // работает / остановлена
                     mode: "bhp",          // bhp | flow (фонтан, штуцер) | esp (ЭЦН) | choke (КНС, штуцер)
                     choke: type === "prod" ? 12 : 8, // диаметр штуцера, мм
                     freq: 50, hasESP: false, pump: PUMP_DEFAULT, duty: 1, kW: 0, eq: null,
                     depth: r.level === 2 ? r.zTop[c] + 5 + l2Altitude(toBase(c % r.nx, r.nx / BASE_N), toBase(Math.floor(c / r.nx), r.nx / BASE_N)) : 2450,
                     cum: { oil: 0, water: 0, inj: 0 } });
  };
  sim.field = { pGather: 12, pKNS: 130 }; // давление сбора и давление КНС, атм
  // Заканчивание: горизонтальный ствол (hs), боковой ствол из вертикальной (zbs), трещина ГРП (frac).
  // Скважина – набор перфорированных ячеек {cell, f}: f – множитель индекса Писмана ячейки
  // (f = HS_EFF у горизонтального участка: часть притока теряется на вертикальную фильтрацию; у трещины ГРП f подбирается
  // по конечной проводимости трещины – см. fracCellFactor). Трещина останавливается на разломах, ствол ГС их пересекает.
  // opt: {L, dir ("E"|"W"|"N"|"S"), isolate} для hs/zbs; {xf, dir} для frac; blocked(cell) – занятые вне модели ячейки
  sim.setCompletion = (w, kind, opt, blocked) => {
    const nx = r.nx, taken = new Set();
    for (const o of sim.wells) if (o !== w) for (const p of o.perf) taken.add(p.cell);
    const ok = (c) => r.active[c] && !taken.has(c) && !(blocked && blocked(c));
    // грань между соседними по стороне ячейками a → b пересекает разлом (множитель проводимости < 1)
    const faultBetween = (a, b) => {
      if (!r.tmE) return false;
      if (b === a + 1) return r.tmE[a] < 1; if (b === a - 1) return r.tmE[b] < 1;
      if (b === a + nx) return r.tmN[a] < 1; return r.tmN[b] < 1;
    };
    // переход в соседнюю ячейку, в том числе через угол (тогда разлом – если перекрыты оба обходных пути)
    const crossesFault = (a, b) => {
      const ia = a % nx, ja = Math.floor(a / nx), ib = b % nx, jb = Math.floor(b / nx);
      if (ia === ib || ja === jb) return faultBetween(a, b);
      const m1 = ja * nx + ib, m2 = jb * nx + ia;
      return (faultBetween(a, m1) || faultBetween(m1, b)) && (faultBetween(a, m2) || faultBetween(m2, b));
    };
    // луч из центра ячейки скважины по азимуту az (° от севера по часовой) длиной len, м:
    // пройденные ячейки (кроме ячейки скважины) и длина участка ствола в каждой; останавливается на занятых
    // и неактивных ячейках, краю поля и (stopAtFault) разломах
    const x0 = (w.cell % nx) + 0.5, y0 = Math.floor(w.cell / nx) + 0.5;
    // org – начало луча {x, y, cell} (по умолчанию центр ячейки скважины); own – ячейки, не прерывающие луч и не входящие в него
    const ray = (azDeg, len, stopAtFault, org, own) => {
      const th = (azDeg * Math.PI) / 180, ux = Math.sin(th), uy = -Math.cos(th), st = 0.005, n = Math.ceil(len / r.dx / st);
      const cells = [], lens = [], c0 = org ? org.cell : w.cell, xs0 = org ? org.x : x0, ys0 = org ? org.y : y0;
      let prev = c0, reached = 0;
      for (let k = 0; k < n; k++) {
        const tm = Math.min((k + 0.5) * st, len / r.dx), x = xs0 + ux * tm, y = ys0 + uy * tm;
        const i = Math.floor(x), j = Math.floor(y);
        if (i < 0 || j < 0 || i >= nx || j >= r.ny) break;
        const c = j * nx + i, seg = Math.min(st, len / r.dx - k * st) * r.dx, mine = c === c0 || (own && own.has(c));
        if (c !== prev) {
          if (!mine && (!ok(c) || (stopAtFault && crossesFault(prev, c)))) break;
          if (mine && c !== c0 && stopAtFault && crossesFault(prev, c)) break;
          prev = c;
          if (!mine && cells[cells.length - 1] !== c) { cells.push(c); lens.push(0); }
        }
        if (!mine) lens[lens.length - 1] += seg;
        reached += seg;
      }
      return { cells, lens, reached, ux, uy };
    };
    // азимут: явный az/dir имеет приоритет; трещина ГРП без него строится по максимальному горизонтальному
    // напряжению пласта (r.stressAz), ствол ГС/ЗБС без него – на восток (для тестов)
    const saz = ((r.stressAz ?? 330) % 360 + 360) % 360;
    const az = ((opt.az ?? (opt.dir ? AZ_OF_DIR[opt.dir] : kind === "frac" ? saz : AZ_OF_DIR.E)) % 360 + 360) % 360;
    if (kind === "hs" || kind === "zbs") {
      // ствол длиной L от центра ячейки; луч на L + Δ/2, чтобы вдоль оси сетки ячейки вскрывались целиком (как при калибровке)
      const R1 = ray(az, opt.L + r.dx / 2, false);
      if (!R1.cells.length) return { ok: false, msg: "в этом направлении нет свободных ячеек" };
      const wn = wiNorm(r);
      w.perf = [{ cell: w.cell, f: kind === "zbs" ? (opt.isolate ? 0 : 1) : HS_EFF * wn * Math.min(2, r.dx / REF_DX) }, ...R1.cells.map((c, k) => ({ cell: c, f: (HS_EFF * wn * R1.lens[k]) / REF_DX }))];
      const Lr = Math.max(r.dx / 2, Math.min(opt.L, R1.reached - r.dx / 2));
      w.kind = kind; w.az = az; w.dir = opt.dir || null; w.L = Math.round(Lr / 10) * 10; w.isolated = kind === "zbs" && !!opt.isolate;
      w.traj = [[x0, y0], [x0 + (R1.ux * Lr) / r.dx, y0 + (R1.uy * Lr) / r.dx]];
    } else if (kind === "frac") {
      if (w.kind !== "v") return { ok: false, msg: "ГРП возможен на вертикальной скважине без ГРП" };
      const nside = Math.max(1, Math.round(opt.xf / REF_DX)), ext = opt.xf + r.dx / 2, wn = wiNorm(r);
      const A = ray(az, ext, true), B = ray(az + 180, ext, true);
      const cells = [w.cell, ...A.cells, ...B.cells], kMean = cells.reduce((x, c) => x + r.k[c], 0) / cells.length;
      const fc = fracCellFactor(kMean, opt.xf, nside);
      w.perf = [{ cell: w.cell, f: 1 }, ...A.cells.map((c, k) => ({ cell: c, f: (fc.f * wn * A.lens[k]) / REF_DX })), ...B.cells.map((c, k) => ({ cell: c, f: (fc.f * wn * B.lens[k]) / REF_DX }))];
      const la = Math.max(0, Math.min(opt.xf, A.reached - r.dx / 2)), lb = Math.max(0, Math.min(opt.xf, B.reached - r.dx / 2));
      w.kind = "frac"; w.az = az % 180; w.dir = opt.dir || null;
      w.frac = { xf: Math.round(Math.max(la, lb) / 10) * 10, az: az % 180, fcd: fc.fcd, sf: fc.sf, ratio: fc.ratio };
      w.traj = [[x0 - (A.ux * lb) / r.dx, y0 - (A.uy * lb) / r.dx], [x0 + (A.ux * la) / r.dx, y0 + (A.uy * la) / r.dx]];
      w.skin = Math.min(w.skin || 0, 0);
    } else if (kind === "mgrp") {
      // многостадийный ГРП на горизонтальном стволе: n трещин равномерно по стволу, каждая распространяется по
      // максимальному горизонтальному напряжению (r.stressAz; явный opt.az – для эталонов и тестов). Ствол вдоль
      // напряжения даёт продольные трещины, поперёк напряжения – поперечные, промежуточный азимут – косые.
      // Каждая трещина – как ГРП конечной проводимости (fracCellFactor) плюс скин стягивания к стволу; трещины не
      // пересекают разломы и чужие ячейки, через ячейки своего ствола проходят. Интерференция трещин – расчётом в сетке.
      if (!(w.kind === "hs" || w.kind === "zbs") || w.mgrp) return { ok: false, msg: "МГРП возможен на горизонтальном (боковом) стволе без ГРП" };
      const nMax = Math.max(1, Math.floor(w.L / 80)), n = Math.max(1, Math.min(nMax, Math.round(opt.n || 4)));
      const fa = ((opt.az ?? saz) % 360 + 360) % 360; // трещины по стрессу; явный az – эталоны и тесты
      const thf = (fa * Math.PI) / 180, vfx = Math.sin(thf), vfy = -Math.cos(thf);
      const th = (w.az * Math.PI) / 180, ux = Math.sin(th), uy = -Math.cos(th), own = new Set(w.perf.map((pf) => pf.cell));
      const nside = Math.max(1, Math.round(opt.xf / REF_DX)), ext = opt.xf + r.dx / 2, wn = wiNorm(r), add = new Map(), stages = [];
      let fcd = 0, sf = 0, sc = 0;
      for (let q = 0; q < n; q++) {
        const sAl = (w.L * (q + 0.5)) / n / r.dx, x = x0 + ux * sAl, y = y0 + uy * sAl, cell = Math.floor(y) * nx + Math.floor(x);
        const org = { x, y, cell }, A = ray(fa, ext, true, org, own), B = ray(fa + 180, ext, true, org, own);
        const cells = [cell, ...A.cells, ...B.cells], kMean = cells.reduce((s2, c) => s2 + r.k[c], 0) / cells.length;
        const chk = fracChokeSkin(kMean, r.h), fc = fracCellFactor(kMean, opt.xf, nside, chk);
        add.set(cell, (add.get(cell) || 0) + fc.f * wn * Math.min(2, r.dx / REF_DX));
        A.cells.forEach((c, k) => add.set(c, (add.get(c) || 0) + (fc.f * wn * A.lens[k]) / REF_DX));
        B.cells.forEach((c, k) => add.set(c, (add.get(c) || 0) + (fc.f * wn * B.lens[k]) / REF_DX));
        const la = Math.max(0, Math.min(opt.xf, A.reached - r.dx / 2)), lb = Math.max(0, Math.min(opt.xf, B.reached - r.dx / 2));
        stages.push([x - (vfx * lb) / r.dx, y - (vfy * lb) / r.dx, x + (vfx * la) / r.dx, y + (vfy * la) / r.dx]);
        fcd += fc.fcd / n; sf += fc.sf / n; sc += chk / n;
      }
      for (const pf of w.perf) if (add.has(pf.cell)) { pf.f += add.get(pf.cell); add.delete(pf.cell); }
      for (const [c, f] of add) w.perf.push({ cell: c, f });
      w.mgrp = { n, xf: opt.xf, az: fa % 180, fcd, sf, sc, stages };
      w.skin = Math.min(w.skin || 0, 0);
    }
    sim._fluxValid = false;
    return { ok: true, cells: w.perf.length };
  };
  // смена назначения скважины в обе стороны (добывающая ⇄ нагнетательная); история сохраняется
  sim.convertWell = (w) => {
    if (w.type === "prod") { w.type = "inj"; w.pwf = 325; w.mode = "choke"; w.choke = 8; }
    else { w.type = "prod"; w.wasProd = true; w.pwf = 150; w.mode = w.hasESP ? "esp" : "flow"; w.choke = 12; }
    w.converted = true; sim._fluxValid = false;
  };
  // перевод добывающей в нагнетательную (ППД): история добычи сохраняется
  sim.convertToInjector = (w) => {
    if (w.type !== "prod") throw new Error("только добывающую");
    sim.convertWell(w);
  };
  // обработка призабойной зоны: скин снижается до −1 (если он был выше)
  sim.stimulate = (w) => {
    const before = w.skin || 0;
    w.skin = Math.min(before, -1); w.stimulated = true; sim._fluxValid = false;
    return before - w.skin;
  };
  sim.economy = createEconomy(params);
  sim.avgPressure = () => {
    let s = 0, v = 0;
    for (const c of r.cells) { s += r.poreVol[c] * sim.P[c]; v += r.poreVol[c]; }
    return s / v;
  };
  return sim;
}

// Проводимости граней: λt – арифметическое среднее соседей (симметрия для CG;
// upstream-λ используется только в переносе насыщенности).
// ---------- Ускоритель WebAssembly (Rust-ядро rust/): проводимости граней, давление, потоки, перенос, CFL ----------
// Подключается снаружи (setAccel) после асинхронной загрузки модуля; без него работает тот же расчёт на JS.
// Статические свойства пласта передаются в Grid один раз (кэш на объекте пласта, не больше 8 живых сеток).
let ACCEL = null;
const accelGrids = [];
function setAccel(a) { ACCEL = a && a.Grid ? a : null; for (const r of accelGrids.splice(0)) { try { r._wg.free(); } catch (e) {} delete r._wg; } }
function accelGrid(r) {
  if (!ACCEL) return null;
  if (r._wg) return r._wg;
  const N = r.nx * r.ny, empty = new Float64Array(0);
  r._wg = new ACCEL.Grid(r.nx, r.ny, r.active, Float64Array.from(r.k), r.tmE || empty, r.tmN || empty, Float64Array.from(r.poreVol),
                         r.ct, r.h, r.Swc, r.Sor, r.SwMax, r.mu_w, r.mu_o, CONV_K);
  accelGrids.push(r);
  if (accelGrids.length > 8) { const old = accelGrids.shift(); try { old._wg.free(); } catch (e) {} delete old._wg; }
  return r._wg;
}
function buildFaceT(sim) {
  const r = sim.r, { _Te: Te, _Tn: Tn, Sw } = sim;
  Te.fill(0); Tn.fill(0);
  for (const c of r.cells) {
    const e = c + 1, n = c + r.nx;
    if (r.nx > 0 && c % r.nx < r.nx - 1 && r.active[e]) {
      const kH = (2 * r.k[c] * r.k[e]) / (r.k[c] + r.k[e]);
      Te[c] = CONV_K * kH * r.h * 0.5 * (lambdaT(Sw[c], r) + lambdaT(Sw[e], r)) * (r.tmE ? r.tmE[c] : 1);
    }
    if (n < r.nx * r.ny && r.active[n]) {
      const kH = (2 * r.k[c] * r.k[n]) / (r.k[c] + r.k[n]);
      Tn[c] = CONV_K * kH * r.h * 0.5 * (lambdaT(Sw[c], r) + lambdaT(Sw[n], r)) * (r.tmN ? r.tmN[c] : 1);
    }
  }
}

// Неявное давление: (acc+ΣT+G)·P_i − ΣT·P_nb = acc·P_old + G·Pwf.
// Матрично-свободный CG с Якоби-предобуславливателем и warm start.
// Перетоки через ствол не моделируются: интервал, где давление пласта ниже забойного (у добывающей) или выше
// (у нагнетательной), на этот шаг закрывается – как обратным клапаном – и давление пересчитывается. Тогда отбор,
// заложенный в уравнение давления, совпадает с дебитами скважин (иначе у длинных ГС и трещин пласт «отдавал» в ствол
// больше, чем видело уравнение давления, и разница уходила в «лишнюю» нефть).
function solvePressure(sim, dt) {
  const P0 = Float64Array.from(sim.P);
  for (const w of sim.wells) w._xm = null;
  for (let pass = 0; ; pass++) {
    solvePressureOnce(sim, dt);
    if (pass === 5) return; // маски не меняются после 5 пересчётов – последнее решение с ними согласовано
    let changed = false;
    for (const w of sim.wells) {
      if (w.on === false) continue;
      w.perf.forEach((pf, k) => {
        if (!(pf.f > 0) || (w._xm && w._xm[k])) return;
        const dp = w.type === "prod" ? sim.P[pf.cell] - w.pwf : w.pwf - sim.P[pf.cell];
        if (dp < 0) { if (!w._xm) w._xm = new Array(w.perf.length).fill(false); w._xm[k] = true; changed = true; }
      });
    }
    if (!changed) return;
    sim.P.set(P0);
  }
}
function solvePressureOnce(sim, dt) {
  const r = sim.r, N = r.cells.length, wg = accelGrid(r);
  if (wg) return solvePressureAccel(sim, dt, wg);
  const { _x: x, _Ap: Ap, _res: res, _z: z, _diag: diag, _b: b, _Te: Te, _Tn: Tn } = sim;
  const Pold = sim.P;
  buildFaceT(sim);
  for (let idx = 0; idx < N; idx++) {
    const c = r.cells[idx];
    const acc = r.poreVol[c] * r.ct / dt;
    let d = acc;
    if (Te[c] > 0) d += Te[c];
    if (Tn[c] > 0) d += Tn[c];
    if (c % r.nx > 0 && Te[c - 1] > 0) d += Te[c - 1];
    if (c - r.nx >= 0 && Tn[c - r.nx] > 0) d += Tn[c - r.nx];
    diag[idx] = d;
    b[idx] = acc * Pold[c];
  }
  for (const w of sim.wells) {
    if (w.on === false) continue;
    for (let k = 0; k < w.perf.length; k++) {
      const pf = w.perf[k];
      if (!(pf.f > 0) || (w._xm && w._xm[k])) continue;
      const idx = sim._rowOf[pf.cell], G = wellIndex(r.k[pf.cell], r, w.skin) * pf.f * lambdaT(sim.Sw[pf.cell], r) * dutyOf(w);
      diag[idx] += G;
      b[idx] += G * w.pwf;
    }
  }
  const applyA = (v, out) => {
    for (let idx = 0; idx < N; idx++) {
      const c = r.cells[idx];
      let s = diag[idx] * v[idx];
      if (Te[c] > 0) s -= Te[c] * v[sim._rowOf[c + 1]];
      if (Tn[c] > 0) s -= Tn[c] * v[sim._rowOf[c + r.nx]];
      if (c % r.nx > 0 && Te[c - 1] > 0) s -= Te[c - 1] * v[sim._rowOf[c - 1]];
      if (c - r.nx >= 0 && Tn[c - r.nx] > 0) s -= Tn[c - r.nx] * v[sim._rowOf[c - r.nx]];
      out[idx] = s;
    }
  };
  for (let idx = 0; idx < N; idx++) x[idx] = Pold[r.cells[idx]]; // warm start
  applyA(x, Ap);
  let rhs2 = 0;
  for (let idx = 0; idx < N; idx++) { res[idx] = b[idx] - Ap[idx]; rhs2 += b[idx] * b[idx]; }
  const rhs0 = Math.sqrt(rhs2) || 1;
  let rz = 0, r2 = 0;
  for (let idx = 0; idx < N; idx++) { z[idx] = res[idx] / diag[idx]; rz += res[idx] * z[idx]; r2 += res[idx] * res[idx]; }
  let pk = sim._pk && sim._pk.length === N ? sim._pk : (sim._pk = new Float64Array(N));
  for (let idx = 0; idx < N; idx++) pk[idx] = z[idx];
  let iters = 0, resid = Math.sqrt(r2);
  const tolCG = sim.cfg.tol, maxCG = sim.cfg.maxit;
  while (resid > tolCG * rhs0 && iters < maxCG) {
    applyA(pk, Ap);
    let pAp = 0;
    for (let idx = 0; idx < N; idx++) pAp += pk[idx] * Ap[idx];
    const ak = rz / pAp;
    for (let idx = 0; idx < N; idx++) { x[idx] += ak * pk[idx]; res[idx] -= ak * Ap[idx]; }
    let rzNew = 0;
    r2 = 0;
    for (let idx = 0; idx < N; idx++) { z[idx] = res[idx] / diag[idx]; rzNew += res[idx] * z[idx]; r2 += res[idx] * res[idx]; }
    const bk = rzNew / rz;
    for (let idx = 0; idx < N; idx++) pk[idx] = z[idx] + bk * pk[idx];
    rz = rzNew;
    resid = Math.sqrt(r2);
    iters++;
  }
  sim.lastCG = { iters, resid, rhs0 };
  for (let idx = 0; idx < N; idx++) sim.P[r.cells[idx]] = x[idx];
}

// ---------- Наземное и скважинное оборудование (узловой анализ) ----------
// Упрощённый перенос идей unfpy (esp/pump, choke, pipe): однофазная гидравлика без свободного газа.
// Режимы: bhp – заданное забойное давление (ползунок); flow – фонтан: давление на устье =
// давление сбора + перепад на штуцере; esp – ЭЦН с частотой f (законы подобия, напор H(q)=H0·k²·(1−(q/(Q0·k))²),
// k = f/50); choke – нагнетательная: давление КНС минус перепад на штуцере. Забойное давление находится из
// равенства притока по Писману (q = G·(P_яч − P_wf)) и пропускной способности подъёмника (бисекция по q).
// Перепад на штуцере: ΔP = ρ·v²/2, v = q/(Cd·A), Cd = 0.8. Столб – по плотности смеси.
const ATM_PA = 101325;
const AZ_OF_DIR = { N: 0, E: 90, S: 180, W: 270 }; // азимуты сторон света
const HS_EFF = 0.4; // горизонтальный участок: доля индекса вертикального вскрытия ячейки (согласовано с Джоши при kv/kh ≈ 0.1)
const FRAC_EFF = 0.9; // (не используется для ГРП с конечной проводимостью; оставлен для совместимости)
// ---------- ГРП: трещина конечной проводимости ----------
// Безразмерная проводимость FCD = kf·w / (k·xf), kf·w = FRAC_COND (мД·м, проппант средней проводимости).
// Скин трещины (Cinco-Ley, Samaniego; аппроксимация Meyer–Jacot): s_f = F(ln FCD) − ln(xf/rw),
// F(u) = (1.65 − 0.328u + 0.116u²) / (1 + 0.18u + 0.064u² + 0.005u³); при FCD → ∞ s_f → −ln(xf/(2rw)) (Пратс).
// В сетке 40 м трещина – ряд ячеек; их множитель f подбирается так, чтобы продуктивность скважины в ПУР
// (одна скважина в квадрате 2×2 км) совпала с аналитикой: J_ГРП/J_ВС = B/(B + s_f), B = ½ln(4A/(γ C_A rw²)) = 8.59.
// Таблица f → J_ГРП/J_ВС получена расчётом этим же симулятором (однородный пласт, однофазный приток).
const FRAC_COND = 1000;
const FRAC_TABLE = {
  1: [[0.05, 1.09], [0.1, 1.17], [0.2, 1.30], [0.4, 1.51], [0.9, 1.81], [2, 2.10], [5, 2.34], [20, 2.50], [100, 2.55]],
  2: [[0.05, 1.20], [0.1, 1.36], [0.2, 1.62], [0.4, 1.96], [0.9, 2.38], [2, 2.71], [5, 2.94], [20, 3.09], [100, 3.13]],
  3: [[0.05, 1.31], [0.1, 1.56], [0.2, 1.92], [0.4, 2.37], [0.9, 2.86], [2, 3.22], [5, 3.46], [20, 3.60], [100, 3.64]],
};
function fracSkin(fcd, xf, rw = 0.1) {
  const u = Math.log(Math.max(0.01, Math.min(1000, fcd)));
  const F = (1.65 - 0.328 * u + 0.116 * u * u) / (1 + 0.18 * u + 0.064 * u * u + 0.005 * u * u * u);
  return F - Math.log(xf / rw);
}
// chokeSkin – дополнительный скин поперечной трещины горизонтальной скважины: приток из трещины сходится к стволу
// радиально в её плоскости (Mukherjee, Economides): s_c = (k·h / kf·w)·(ln(h / 2rw) − π/2)
function fracChokeSkin(k, h, rw = 0.1) { return ((k * h) / FRAC_COND) * (Math.log(h / (2 * rw)) - Math.PI / 2); }
function fracCellFactor(k, xf, nCells, choke = 0) {
  const fcd = FRAC_COND / (k * xf), sf = fracSkin(fcd, xf) + choke, B = 8.59, ratio = B / (B + sf);
  const tab = FRAC_TABLE[Math.max(1, Math.min(3, nCells))];
  let f;
  if (ratio <= tab[0][1]) f = tab[0][0] * Math.max(0, (ratio - 1) / (tab[0][1] - 1));
  else if (ratio >= tab[tab.length - 1][1]) f = tab[tab.length - 1][0];
  else for (let i = 1; i < tab.length; i++) if (ratio <= tab[i][1]) {
    const [f0, r0] = tab[i - 1], [f1, r1] = tab[i], t = (ratio - r0) / (r1 - r0);
    f = Math.exp(Math.log(f0) + t * (Math.log(f1) - Math.log(f0))); break;
  }
  return { f, fcd, sf, ratio };
}
// типоразмеры ЭЦН (при 50 Гц): Q0 – подача при нулевом напоре, H0 – напор при нулевой подаче, QB – подача в оптимуме,
// ETA – максимальный КПД, cost – стоимость относительно базового (esp_cost)
// Ряд номинальных подач ЭЦН, м³/сут (QB – оптимальная подача при 50 Гц). Q0 = 1.65·QB – подача при нулевом напоре,
// H0 – напор при нулевой подаче (2800 м: секции набраны под глубину пласта ~2,5 км), КПД растёт с типоразмером, стоимость – в долях «Установки ЭЦН».
const PUMP_NOMINALS = [20, 30, 45, 60, 80, 125, 160, 200, 250, 320, 400, 500, 630, 800, 1000, 1250];
const PUMPS = Object.fromEntries(PUMP_NOMINALS.map((Qn) => [String(Qn), {
  name: `ЭЦН-${Qn}`, QB: Qn, Q0: 1.65 * Qn, H0: 2800, // число ступеней подобрано под подъём с ~2,5 км
  ETA: 0.33 + 0.16 * Math.log10(Qn / 20), cost: 0.45 + 0.6 * Math.pow(Qn / 290, 0.8),
}]));
const PUMP_DEFAULT = "250";
const P_MIN_INTAKE = 20, P_MAX_INJ = 340; // атм: минимальное давление на приёме; предел по давлению закачки
const Q_INJ_MAX = 500; // м³/сут: предел приёмистости одной нагнетательной скважины (оборудование и водоводы)
// суммарная продуктивность скважины G (м³/сут/атм) и среднее по перфорации пластовое давление
// ПКВ (периодическая кратковременная эксплуатация): ЭЦН включён долю времени duty < 1. Пока насос работает, скважина идёт на
// рабочей точке (дебит и забойное давление по оборудованию); пласт и деньги видят среднее: дебит и мощность умножаются на duty
const dutyOf = (w) => (w.type === "prod" && w.mode === "esp" && w.duty > 0 && w.duty < 1 ? w.duty : 1);
function wellG(sim, w) {
  const r = sim.r; let G = 0, GP = 0;
  for (const pf of w.perf) { const g = wellIndex(r.k[pf.cell], r, w.skin) * pf.f * lambdaT(sim.Sw[pf.cell], r); G += g; GP += g * sim.P[pf.cell]; }
  return { G, Pc: G > 0 ? GP / G : sim.P[w.cell] };
}
function chokeDpAtm(q, dmm, rho) {
  if (!(q > 0) || !(dmm > 0)) return 0;
  const A = Math.PI * (dmm / 1000) ** 2 / 4, v = q / 86400 / (0.8 * A);
  return (rho * v * v) / 2 / ATM_PA;
}
function espHeadM(q, f, pk = PUMP_DEFAULT) { const P = PUMPS[pk], k = f / 50; return P.H0 * k * k * (1 - (q / (P.Q0 * k)) ** 2); }
function espEff(q, f, pk = PUMP_DEFAULT) { const P = PUMPS[pk], k = f / 50, x = (q - P.QB * k) / (P.QB * k); return Math.max(0.15, P.ETA * (1 - x * x)); }
// загрузка насоса: подача / оптимальная подача при частоте f (норма 0.6–1.2)
function espLoad(q, f, pk = PUMP_DEFAULT) { return q / (PUMPS[pk].QB * (f / 50)); }
function espPowerKW(q, f, rho, pk = PUMP_DEFAULT) { return (rho * 9.81 * (q / 86400) * Math.max(0, espHeadM(q, f, pk))) / espEff(q, f, pk) / 1000; }
function gatherPressure(sim) {
  let sq = 0;
  for (const w of sim.wells) if (w.type === "prod" && w.on !== false) sq += w.q;
  return sim.field.pGather + 2e-5 * sq * sq; // потери в сборной сети растут с суммарным расходом
}
function bisectQ(f, qMax) {
  if (!(qMax > 0) || f(0) <= 0) return 0;
  if (f(qMax) >= 0) return qMax;
  let a = 0, b = qMax;
  for (let n = 0; n < 50; n++) { const m = 0.5 * (a + b); if (f(m) > 0) a = m; else b = m; }
  return 0.5 * (a + b);
}
// режим скважины по оборудованию без изменения состояния: {q, pwf, pwh, kW, dead, capped}
function solveEquipment(sim, w, noCap = false) {
  const r = sim.r, { G, Pc } = wellG(sim, w);
  const L = w.depth, out = { q: 0, pwf: Pc, pwh: 0, kW: 0, dead: false, capped: false };
  if (w.on === false) return out;
  if (w.type === "prod") {
    const rho = 860 * (1 - (w.fw || 0)) + 1000 * (w.fw || 0), hyd = (rho * 9.81 * L) / ATM_PA, pg = gatherPressure(sim);
    const pwhOf = (q) => pg + (w.mode === "flow" ? chokeDpAtm(q, w.choke, rho) : 0);
    const req = (q) => pwhOf(q) + hyd - (w.mode === "esp" ? (rho * 9.81 * espHeadM(q, w.freq, w.pump || PUMP_DEFAULT)) / ATM_PA : 0);
    const qMax = Math.max(0, G * (Pc - P_MIN_INTAKE)), f = (q) => Pc - q / G - req(q);
    out.q = bisectQ(f, qMax); out.dead = out.q === 0; out.capped = out.q >= qMax && qMax > 0;
    out.pwf = Pc - out.q / G; out.pwh = pwhOf(out.q);
    if (w.mode === "esp") { out.kW = espPowerKW(out.q, w.freq, rho, w.pump || PUMP_DEFAULT); out.load = espLoad(out.q, w.freq, w.pump || PUMP_DEFAULT); }
  } else {
    const hydW = (1000 * 9.81 * L) / ATM_PA, head = sim.field.pKNS;
    const f = (q) => head - chokeDpAtm(q, w.choke, 1000) + hydW - Pc - q / G;
    const qMax = Math.min(noCap ? Infinity : Q_INJ_MAX, Math.max(0, G * ((r.pMaxInj || P_MAX_INJ) - Pc)));
    out.q = bisectQ(f, qMax); out.dead = out.q === 0; out.capped = out.q >= qMax && qMax > 0;
    out.kW = (out.q / 86400) * head * ATM_PA / KNS_EFF / 1000; // доля мощности КНС на эту скважину
    out.pwf = Pc + out.q / G; out.pwh = head - chokeDpAtm(out.q, w.choke, 1000);
  }
  return out;
}
// перед каждым решением давления: режимы flow/esp/choke задают забойное давление скважин
function applyEquipment(sim) {
  for (const w of sim.wells) {
    if (w.on === false) { w.kW = 0; continue; }
    if (!w.mode || w.mode === "bhp") { w.kW = 0; continue; }
    const e = solveEquipment(sim, w);
    w.eq = e; w.kW = e.kW * dutyOf(w);
    // предел приёмистости: пока оборудование дало бы больше Q_INJ_MAX, скважина переходит на контроль по забойному давлению –
    // давление подстраивается по фактическому дебиту прошлого шага так, чтобы держать Q_INJ_MAX (не выше давления, которое даёт оборудование);
    // когда возможная приёмистость падает ниже предела, скважина возвращается на режим оборудования
    if (w.type === "inj" && !e.dead && e.q >= Q_INJ_MAX - 1e-6) {
      const g = wellG(sim, w), e0 = solveEquipment(sim, w, true);
      const base = w._rc ? w.pwf : Math.min(e0.pwf, g.Pc + Q_INJ_MAX / g.G);
      w.pwf = Math.min(e0.pwf, Math.max(g.Pc, base + (w._rc ? (0.7 * (Q_INJ_MAX - w.q)) / g.G : 0))); w._rc = true;
      continue;
    }
    w._rc = false;
    w.pwf = e.dead ? wellG(sim, w).Pc : 0.5 * w.pwf + 0.5 * e.pwf; // демпфирование от колебаний между сутками
  }
}

// ---------- Дебиты скважин (Писман, клампы направления) ----------
// Соглашение о знаках: для добывающей w.q>0 – отбор жидкости; для нагнетательной
// w.q>0 – закачка воды. Расщепление фаз – по подвижностям ячейки.
function updateWellRates(sim) {
  const r = sim.r;
  for (const w of sim.wells) {
    w.pq = new Array(w.perf.length).fill(0); w.pqw = new Array(w.perf.length).fill(0);
    if (w.on === false) { w.q = w.qo = w.qw = w.fw = 0; continue; }
    const prod = w.type === "prod";
    let q = 0, qo = 0, qw = 0;
    w.perf.forEach((pf, k) => {
      const c = pf.cell, G = w._xm && w._xm[k] ? 0 : wellIndex(r.k[c], r, w.skin) * pf.f * lambdaT(sim.Sw[c], r) * dutyOf(w);
      const dp = prod ? sim.P[c] - w.pwf : w.pwf - sim.P[c], qk = Math.max(0, G * dp);
      q += qk; w.pq[k] = qk;
      if (prod) {
        const lo = kro(sim.Sw[c], r) / r.mu_o, lw = krw(sim.Sw[c], r) / r.mu_w, sm = lo + lw;
        qo += sm > 0 ? (qk * lo) / sm : 0; const wk = sm > 0 ? (qk * lw) / sm : 0; qw += wk; w.pqw[k] = wk;
      } else { qw += qk; w.pqw[k] = qk; }
    });
    w.q = q; w.qo = prod ? qo : 0; w.qw = qw;
    w.fw = w.q > 0 ? w.qw / w.q : 0;
  }
}

// ---------- advance (давление; насыщенность подключается в Task 6) ----------
// Полный IMPES-цикл: давление неявно раз в сутки, насыщенность явно субшагами CFL.
// то же через WebAssembly: скважины дают добавки к диагонали (G) и правой части (G·Pwf) по ячейкам
function solvePressureAccel(sim, dt, wg) {
  const r = sim.r, n = r.nx * r.ny;
  const wd = sim._wd || (sim._wd = new Float64Array(n)), wr = sim._wr || (sim._wr = new Float64Array(n));
  wd.fill(0); wr.fill(0);
  wg.face_t(sim.Sw, sim._Te, sim._Tn);
  for (const w of sim.wells) {
    if (w.on === false) continue;
    for (let k = 0; k < w.perf.length; k++) {
      const pf = w.perf[k];
      if (!(pf.f > 0) || (w._xm && w._xm[k])) continue;
      const G = wellIndex(r.k[pf.cell], r, w.skin) * pf.f * lambdaT(sim.Sw[pf.cell], r) * dutyOf(w);
      wd[pf.cell] += G; wr[pf.cell] += G * w.pwf;
    }
  }
  const iters = wg.solve(sim._Te, sim._Tn, wd, wr, dt, sim.P, sim.cfg.tol, sim.cfg.maxit);
  sim.lastCG = { iters, resid: wg.last_resid, rhs0: wg.last_rhs0 };
}
function computeFaceFluxes(sim) {
  const r = sim.r, { _Te: Te, _Tn: Tn, _uE: uE, _uN: uN, P } = sim, wg = accelGrid(r);
  if (wg) return wg.fluxes(Te, Tn, P, uE, uN);
  for (const c of r.cells) {
    uE[c] = Te[c] > 0 ? Te[c] * (P[c] - P[c + 1]) : 0;          // >0: из c на восток
    uN[c] = Tn[c] > 0 ? Tn[c] * (P[c] - P[c + r.nx]) : 0;       // >0: из c на север
  }
}
function transportSubstep(sim, dt) {
  const r = sim.r, { _uE: uE, _uN: uN, Sw } = sim, wg = accelGrid(r);
  if (wg) {
    const src = sim._src || (sim._src = new Float64Array(r.nx * r.ny)); src.fill(0);
    for (const w of sim.wells) { if (!w.pq) continue; w.perf.forEach((pf, k) => { src[pf.cell] += w.type === "inj" ? w.pq[k] : -w.pqw[k]; }); }
    return wg.transport(uE, uN, src, dt, Sw);
  }
  const dSw = sim._dSw || (sim._dSw = new Float64Array(r.nx * r.ny));
  dSw.fill(0);
  for (const c of r.cells) {
    let netWat = 0;
    if (c % r.nx > 0 && r.active[c - 1]) {         // западная грань = восточная грань c-1
      const u = uE[c - 1];
      netWat += u > 0 ? u * fw(Sw[c - 1], r) : u * fw(Sw[c], r);
    }
    if (c % r.nx < r.nx - 1 && r.active[c + 1]) {  // восточная грань
      const u = uE[c];
      netWat += u > 0 ? -u * fw(Sw[c], r) : -u * fw(Sw[c + 1], r);
    }
    if (c - r.nx >= 0 && r.active[c - r.nx]) {     // южная грань = северная грань c-nx
      const u = uN[c - r.nx];
      netWat += u > 0 ? u * fw(Sw[c - r.nx], r) : u * fw(Sw[c], r);
    }
    if (c + r.nx < r.nx * r.ny && r.active[c + r.nx]) { // северная грань
      const u = uN[c];
      netWat += u > 0 ? -u * fw(Sw[c], r) : -u * fw(Sw[c + r.nx], r);
    }
    dSw[c] += netWat * dt / r.poreVol[c];
  }
  for (const w of sim.wells) {
    if (!w.pq) continue;
    w.perf.forEach((pf, k) => {
      if (w.type === "inj") dSw[pf.cell] += (w.pq[k] * dt) / r.poreVol[pf.cell];
      else dSw[pf.cell] -= (w.pqw[k] * dt) / r.poreVol[pf.cell];
    });
  }
  for (const c of r.cells)
    Sw[c] = Math.min(r.SwMax, Math.max(r.Swc, Sw[c] + dSw[c])); // кламп – страховка (ур. 2: водяная зона Sw = 1)
}
// Шаг переноса насыщенности (CFL для явной схемы против потока): за шаг через ячейку проходит не больше половины
// её порового объёма, делённой на максимальную крутизну fw'(S) (в долях подвижного интервала). Учитываются и приток,
// и отток – по граням и отбором скважин: без оттока мощная скважина за шаг «вычерпывала» из ячейки больше воды, чем в
// ней есть (особенно при вязкой нефти, где fw ≈ 1 уже у Swc), насыщенность проваливалась ниже Swc и кламп создавал воду.
function fwSlope(r) {
  if (r._fwSlope === undefined) {
    let m = 0; const d = 0.002, span = 1 - r.Swc - r.Sor;
    for (let x = r.Swc; x < 1 - r.Sor; x += d) m = Math.max(m, ((fw(x + d, r) - fw(x, r)) / d) * span);
    r._fwSlope = m;
  }
  return r._fwSlope;
}
function cflLimit(sim) {
  const r = sim.r, { _uE: uE, _uN: uN } = sim;
  let dt = sim.cfg.dtMax;
  const q = sim._injQ || (sim._injQ = new Float64Array(r.nx * r.ny)), pr = sim._prQ || (sim._prQ = new Float64Array(r.nx * r.ny));
  q.fill(0); pr.fill(0);
  for (const w of sim.wells) if (w.pq) w.perf.forEach((pf, k) => { if (w.type === "inj") q[pf.cell] += w.pq[k]; else pr[pf.cell] += w.pq[k]; });
  const fac = sim.cfg.courant / Math.max(1, fwSlope(r)), wg = accelGrid(r);
  if (wg) return wg.cfl(uE, uN, q, pr, fac, dt);
  for (const c of r.cells) {
    let inflow = q[c], out = pr[c];
    if (c % r.nx > 0 && r.active[c - 1]) { const u = uE[c - 1]; if (u > 0) inflow += u; else out -= u; }
    if (c % r.nx < r.nx - 1 && r.active[c + 1]) { const u = uE[c]; if (u < 0) inflow -= u; else out += u; }
    if (c - r.nx >= 0 && r.active[c - r.nx]) { const u = uN[c - r.nx]; if (u > 0) inflow += u; else out -= u; }
    if (c + r.nx < r.nx * r.ny && r.active[c + r.nx]) { const u = uN[c]; if (u < 0) inflow -= u; else out += u; }
    const thr = Math.max(inflow, out);
    if (thr > 0) dt = Math.min(dt, (fac * r.poreVol[c]) / thr);
  }
  return dt;
}
function recordHistory(sim) {
  const h = sim.history.days;
  while (h.length < Math.floor(sim.t + 1e-9)) {
    h.push({
      t: h.length + 1, avgP: sim.avgPressure(),
      cumOilM3: sim.wells.reduce((s, w) => s + w.cum.oil, 0),
      money: sim.economy ? sim.economy.balance : null, eco: sim.economy ? sim.economy.snap() : null,
      wells: sim.wells.map((w, i) => ({ qo: w.qo, qw: w.qw, q: w.q, fw: w.fw, pwf: w.pwf, prod: w.type === "prod", net: sim.economy ? sim.economy.wellNet(w, i) : 0 })),
    });
  }
}
function advanceRaw(sim, days) {
  let remaining = days;
  while (remaining > 1e-9) {
    // давление – неявно на интервал вперёд (≤ 1 сут): P в конце интервала, потоки и дебиты по нему применяются
    // ровно на этот интервал (субшагами CFL). Так объём, отобранный скважинами и перенесённый между ячейками,
    // совпадает с изменением давления (упругий запас) – без этого нефть «появлялась» при меняющемся шаге.
    if (!sim._fluxValid || sim.t >= sim._solveEnd - 1e-9) {
      const dtP = Math.min(sim.cfg.dtP, remaining);
      applyEquipment(sim);
      const rcOn = sim.wells.some((w) => w._rc && w.on !== false), P0rc = rcOn ? Float64Array.from(sim.P) : null;
      solvePressure(sim, Math.max(1e-9, dtP));
      // скважины в режиме контроля по забойному давлению (предел приёмистости): если после решения дебит выше предела, снижаем Pwf
      // на избыток/G и решаем давление заново (давление в ячейке при этом меняется, поэтому одной поправки по Pc недостаточно)
      for (let it = 0; rcOn && it < 16; it++) {
        updateWellRates(sim);
        let over = false;
        for (const w of sim.wells) if (w._rc && w.on !== false && w.q > Q_INJ_MAX * 1.002) {
          const g = wellG(sim, w), pr = w._sec; let sl = g.G; // наклон q(Pwf): по двум последним итерациям (секущая), иначе – G
          if (pr && Math.abs(w.pwf - pr.p) > 1e-9) { const k = (w.q - pr.q) / (w.pwf - pr.p); if (k > 0.05 * g.G && k <= 1.01 * g.G) sl = k; }
          w._sec = { p: w.pwf, q: w.q }; w.pwf = Math.max(g.Pc, w.pwf - (w.q - Q_INJ_MAX) / sl); over = true;
        }
        if (!over) { for (const w of sim.wells) w._sec = null; break; }
        sim.P.set(P0rc); solvePressure(sim, Math.max(1e-9, dtP));
      }
      sim._lastSolveT = sim.t; sim._solveEnd = sim.t + dtP;
      sim._fluxValid = true;
      computeFaceFluxes(sim);
      updateWellRates(sim);
    }
    let dtSub = Math.min(sim.cfg.dtMax, cflLimit(sim), remaining, sim._solveEnd - sim.t);
    if (sim._solveEnd - sim.t - dtSub < 1e-6) dtSub = Math.min(remaining, sim._solveEnd - sim.t);
    // кумулятивы – теми же дебитами, что использованы в transportSubstep (до пересчёта)
    for (const w of sim.wells) {
      if (w.type === "prod") {
        sim.cumProdM3 += w.q * dtSub;
        w.cum.oil += w.qo * dtSub; w.cum.water += w.qw * dtSub;
      } else { w.cum.inj += w.q * dtSub; }
    }
    transportSubstep(sim, dtSub);
    updateWellRates(sim); // расщепление фаз зависит от Sw
    if (sim.economy) sim.economy.update(dtSub, sim.wells); // подключается в Task 7
    sim.t += dtSub;
    remaining -= dtSub;
    recordHistory(sim);
  }
}
// ---------- Бурение: станки и очередь ----------
// Скважины можно расставить сразу (заказать), а бурятся они по очереди: один станок – одна скважина за drill_days_v суток
// (вертикальная, с ГРП) или drill_days_h (горизонтальная, с МГРП). Деньги списываются, когда станок берёт скважину в работу
// (не хватает средств – станок ждёт); готовая скважина попадает в sim.wells и сразу работает. Больше станков – очередь короче.
// Заказ – объект {well, units, kind, name}: well уже собрана (addWell + setCompletion) и убрана из sim.wells, units – капзатраты.
const drillDays = (kind, params) => (kind === "hs" || kind === "hsf" ? params.drill_days_h ?? DEFAULT_PARAMS.drill_days_h : params.drill_days_v ?? DEFAULT_PARAMS.drill_days_v);
function drillStart(sim) {
  const D = sim.drill, e = sim.economy;
  while (D.active.length < D.rigs && D.queue.length) {
    const j = D.queue[0], cost = costOf(j.units, sim.params);
    if (e && !e.canSpend(cost)) { if (!j.blocked) { j.blocked = true; if (D.on && D.on.blocked) D.on.blocked(j, cost); } return; }
    if (e) e.charge(sim.t, j.units, true);
    D.queue.shift(); j.blocked = false; j.started = sim.t; D.active.push(j);
    if (D.on && D.on.started) D.on.started(j, cost);
  }
}
function drillFinish(sim) {
  const D = sim.drill, done = D.active.filter((j) => j.remain <= 1e-9);
  for (const j of done) {
    D.active.splice(D.active.indexOf(j), 1); j.well.on = true; sim.wells.push(j.well); sim._fluxValid = false;
    if (D.on && D.on.finished) D.on.finished(j);
  }
}
function orderWell(sim, job) { job.days = drillDays(job.kind, sim.params); job.remain = job.days; sim.drill.queue.push(job); drillStart(sim); return job; }
function cancelOrder(sim, job) { const i = sim.drill.queue.indexOf(job); if (i < 0) return false; sim.drill.queue.splice(i, 1); return true; }
function buyRig(sim) {
  const e = sim.economy, cost = costOf({ rig_cost: 1 }, sim.params);
  if (e && !e.canSpend(cost)) return false;
  if (e) e.charge(sim.t, { rig_cost: 1 }, true);
  sim.drill.rigs++; drillStart(sim); return true;
}
// время идёт до ближайшего события бурения: окончания работ на станке (дальше станок берёт следующую скважину); пока очередь ждёт денег – проверка раз в 10 сут
function advance(sim, days) {
  const D = sim.drill;
  if (!D || (!D.queue.length && !D.active.length)) return advanceRaw(sim, days);
  let left = days;
  while (left > 1e-9) {
    drillStart(sim);
    if (!D.queue.length && !D.active.length) return advanceRaw(sim, left);
    const ev = D.active.length ? Math.min(...D.active.map((j) => j.remain)) : Infinity;
    const step = Math.max(1e-6, Math.min(left, ev, D.queue.length ? 10 : Infinity));
    advanceRaw(sim, step); left -= step;
    for (const j of D.active) j.remain -= step;
    drillFinish(sim);
  }
}
function simStats(sim) {
  const r = sim.r;
  const cumOilM3 = sim.wells.reduce((s, w) => s + w.cum.oil, 0);
  const cumWatM3 = sim.wells.reduce((s, w) => s + w.cum.water, 0);
  const cumInjM3 = sim.wells.reduce((s, w) => s + w.cum.inj, 0);
  let q = 0, qw = 0;
  for (const w of sim.wells) if (w.type === "prod") { q += w.q; qw += w.qw; }
  return { avgP: sim.avgPressure(), cumOilM3, cumWatM3, cumInjM3,
           waterCut: q > 0 ? qw / q : 0, ooipM3: r.ooipM3,
           recovery: cumOilM3 / r.ooipM3, day: sim.t };
}
// оценка порового объёма коридора между двумя скважинами (для теста времени прорыва)
function estimatePathPV(sim, c1, c2) {
  const r = sim.r;
  const p1 = { x: c1 % r.nx, y: Math.floor(c1 / r.nx) };
  const p2 = { x: c2 % r.nx, y: Math.floor(c2 / r.nx) };
  const vx = p2.x - p1.x, vy = p2.y - p1.y, len2 = vx * vx + vy * vy;
  let pv = 0;
  for (const c of r.cells) {
    const px = (c % r.nx) - p1.x, py = Math.floor(c / r.nx) - p1.y;
    const tt = len2 > 0 ? Math.max(0, Math.min(1, (px * vx + py * vy) / len2)) : 0;
    const dx = px - tt * vx, dy = py - tt * vy;
    if (Math.hypot(dx, dy) < 2.5) pv += r.poreVol[c];
  }
  return pv;
}

// ---------- Тесты ОФП ----------
function relPermTests() {
  const r = buildReservoir(DEFAULT_PARAMS);
  const t = [];
  const close = (a, b, eps) => Math.abs(a - b) < eps;
  t.push({ name: "ОФП: kro=1 при Sw=Swc", pass: close(kro(r.Swc, r), 1, 1e-12) });
  t.push({ name: "ОФП: krw=0 при Sw=Swc", pass: close(krw(r.Swc, r), 0, 1e-12) });
  t.push({ name: "ОФП: krw=1 при Sw=1-Sor", pass: close(krw(1 - r.Sor, r), 1, 1e-12) });
  t.push({ name: "ОФП: kro=0 при Sw=1-Sor", pass: close(kro(1 - r.Sor, r), 0, 1e-12) });
  // при Sw=0.5: krw=(0.5-0.2)/0.55=0.54545, kro=(0.75-0.5)/0.55=0.45455;
  // fw=(0.54545/1)/((0.54545/1)+(0.45455/5)) = 6/7
  t.push({ name: "fw: значение при Sw=0.5 (μo=5)", pass: close(fw(0.5, r), 6 / 7, 1e-9),
           details: `fw=${fw(0.5, r).toFixed(6)}` });
  const wi = wellIndex(100, r);
  t.push({ name: "WI: k=100 мД → ≈12.5 м³/сут/атм",
           pass: close(wi, CONV_K * 2 * Math.PI * 100 * r.h / Math.log(80), 1e-9),
           details: `WI=${wi.toFixed(3)} м³/сут/атм/(1/сП)` });
  return t;
}

// ---------- Тесты давления ----------
function materialBalance(sim) {
  let withdrawn = sim.cumProdM3 - sim.wells.reduce((s, w) => s + w.cum.inj, 0); // чистый отбор
  let expansion = 0; // упругое расширение: отбор = Σ Vp·ct·(P0 − P)
  for (const c of sim.r.cells) expansion += sim.r.poreVol[c] * sim.r.ct * (sim.r.P0 - sim.P[c]);
  return { withdrawn, expansion, err: (withdrawn - expansion) / Math.max(1, Math.abs(withdrawn)) };
}
function pressureTests() {
  const t = [];
  // 1) без скважин P не дрейфует
  let sim = createSim(buildReservoir(DEFAULT_PARAMS), DEFAULT_PARAMS);
  advance(sim, 30);
  let dP = 0;
  for (const c of sim.r.cells) dP = Math.max(dP, Math.abs(sim.P[c] - sim.r.P0));
  t.push({ name: "P: дрейф без скважин < 0.01 атм (30 сут)", pass: dP < 0.01, details: `dP=${dP.toExponential(1)}` });
  // 2) CG сходится, 1 добывающая Pwf=150
  sim = createSim(buildReservoir(DEFAULT_PARAMS), DEFAULT_PARAMS);
  sim.addWell(sim.r.cells[Math.floor(sim.r.cells.length * 0.4)], "prod", 150);
  advance(sim, 1);
  t.push({ name: "P: CG сошёлся за 1 сутки",
           pass: sim.lastCG.iters < 500 && sim.lastCG.resid < 1e-6 * sim.lastCG.rhs0,
           details: `iters=${sim.lastCG.iters}, rel=${(sim.lastCG.resid / sim.lastCG.rhs0).toExponential(1)}` });
  // 3) материальный баланс 365 сут (одна добывающая)
  sim = createSim(buildReservoir(DEFAULT_PARAMS), DEFAULT_PARAMS);
  sim.addWell(sim.r.cells[Math.floor(sim.r.cells.length * 0.4)], "prod", 150);
  advance(sim, 365);
  const mb = materialBalance(sim);
  t.push({ name: "P: материальный баланс < 1%", pass: Math.abs(mb.err) < 0.01,
           details: `отбор=${(mb.withdrawn / 1e4).toFixed(1)}e4 м³, упругий запас=${(mb.expansion / 1e4).toFixed(1)}e4 м³, err=${(mb.err * 100).toFixed(3)}%` });
  return t;
}

// ---------- Тесты скважин ----------
function wellTests() {
  const t = [];
  const sim = createSim(buildReservoir(DEFAULT_PARAMS), DEFAULT_PARAMS);
  const c = sim.r.cells.find((x) => sim.r.active[x]);
  const c2 = sim.r.cells.find((x) => x !== c && sim.r.active[x]);
  sim.addWell(c, "prod", 150);
  sim.addWell(c2, "inj", 325);
  solvePressure(sim, 1); // до updateWellRates Sw=Swc: kro=1, krw=0
  updateWellRates(sim);
  const wp = sim.wells[0], wi = sim.wells[1];
  // ожидание – та же формула с фактическим P ячейки после solvePressure (депрессия)
  const expect = wellIndex(sim.r.k[wp.cell], sim.r) * lambdaT(sim.r.Swc, sim.r) * (sim.P[wp.cell] - 150);
  t.push({ name: "скв: дебит чистой нефти = формула Писмана",
           pass: Math.abs(wp.q - expect) < 1e-9 * expect && wp.qw < 1e-9,
           details: `q=${wp.q.toFixed(1)} м³/сут (ож. ${expect.toFixed(1)})` });
  t.push({ name: "скв: закачка > 0, вся вода", pass: wi.q > 0 && wi.qw === wi.q && wi.qo === 0,
           details: `q=${wi.q.toFixed(1)} м³/сут` });
  const sim2 = createSim(buildReservoir(DEFAULT_PARAMS), DEFAULT_PARAMS);
  sim2.addWell(sim2.r.cells[0], "prod", 250); // Pwf = P0 → q≈0
  solvePressure(sim2, 1);
  updateWellRates(sim2);
  t.push({ name: "скв: кламп q≥0 для добывающей", pass: sim2.wells[0].q >= -1e-9,
           details: `q=${sim2.wells[0].q.toExponential(1)}` });
  return t;
}

// ---------- Тесты насыщенности ----------
function saturationTests() {
  const t = [];
  // пара скважин, 730 сут: сохранение массы воды, стабилизация давления, прорыв
  let sim = createSim(buildReservoir(DEFAULT_PARAMS), DEFAULT_PARAMS);
  const mid = sim.r.cells[Math.floor(sim.r.cells.length / 2)];
  const far = sim.r.cells[sim.r.cells.length - 10];
  sim.addWell(far, "prod", 100);
  sim.addWell(mid, "inj", 375);
  advance(sim, 730);
  let swVol0 = 0, swVol = 0;
  for (const c of sim.r.cells) { swVol0 += sim.r.poreVol[c] * sim.r.Swc; swVol += sim.r.poreVol[c] * sim.Sw[c]; }
  const inj = sim.wells[1].cum.inj, prodW = sim.wells[0].cum.water;
  const errW = (inj - (swVol - swVol0) - prodW) / Math.max(1, inj);
  t.push({ name: "Sw: баланс воды < 0.1%", pass: Math.abs(errW) < 1e-3,
           details: `закачано=${(inj / 1e3).toFixed(0)}e3, в пласте +${((swVol - swVol0) / 1e3).toFixed(0)}e3, добыто=${(prodW / 1e3).toFixed(0)}e3 м³, err=${(errW * 100).toFixed(3)}%` });
  const h = sim.history.days, y2 = h[h.length - 1], y1 = h[h.length - 182];
  const drift = Math.abs(y2.avgP - y1.avgP);
  t.push({ name: "P: стабилизация при закачке", pass: simStats(sim).avgP > sim.r.P0 - 60 && drift < 15,
           details: `avgP=${simStats(sim).avgP.toFixed(0)} атм, дрейф/полгода=${drift.toFixed(1)} атм` });
  return t;
}
// сценарий прорыва: пара скважин на русле (k>250 мД) в ~10 колонках друг от друга
function breakthroughScenario(sim) {
  const r = sim.r;
  const channelAt = (i) => {
    for (let j = 0; j < r.ny; j++) { const c = j * r.nx + i; if (r.active[c] && r.k[c] > 250) return c; }
    return -1;
  };
  for (let i = 5; i < r.nx - 12; i++) {
    const a = channelAt(i), b = channelAt(i + 10);
    if (a >= 0 && b >= 0 && Math.abs(a - b) <= 12 * r.nx) return [a, b];
  }
  return null;
}
function breakthroughTests() {
  const t = [];
  const sim = createSim(buildReservoir(DEFAULT_PARAMS), DEFAULT_PARAMS);
  const pair = breakthroughScenario(sim);
  t.push({ name: "Sw: сценарий прорыва найден", pass: pair !== null });
  if (!pair) return t;
  sim.addWell(pair[1], "prod", 80);
  sim.addWell(pair[0], "inj", 375);
  advance(sim, 730);
  const h = sim.history.days;
  // порог fw>0.5 ≈ прохождение фронта; оценка поршневого вытеснения:
  // фронт доходит, когда закачано ≈ мобильный объём коридора (1-Swc-Sor)·PV
  const btIdx = h.findIndex((d) => d.wells[0] && d.wells[0].fw > 0.5);
  const bt = btIdx >= 0 ? h[btIdx].t : -1;
  const pathPV = estimatePathPV(sim, pair[1], pair[0]);
  const rateEst = sim.wells[1].cum.inj / 730;
  const btEst = 0.55 * pathPV / rateEst;
  const ratio = bt < 0 ? Infinity : bt / btEst;
  t.push({ name: "Sw: фронт (fw=0.5) в [0.5, 2.5]×оценки", pass: ratio > 0.5 && ratio < 2.5,
           details: `фронт=${bt} сут, оценка=${btEst.toFixed(0)} сут, ratio=${ratio.toFixed(2)}, закачка ср.=${rateEst.toFixed(0)} м³/сут` });
  return t;
}

// ---------- Экономика (руб) ----------
const RHO_OIL = 0.86; // т/м³ – используется и в геологии, и в экономике
// Учёт ведётся в натуральных единицах (u: нефть, жидкость, закачка, кВт·ч, скважино-годы; cu: единицы капзатрат),
// деньги – через flowOf(u, cu, params); тот же расчёт применяется к годовым рядам эталона (refYearly)
function flowOf(u, cu, params) {
  const revenue = u.oil_t * params.price_oil, lift = u.liq * params.lift_cost, inj = u.inj * params.inj_cost;
  const elecESP = u.kwhE * (params.elec_cost || 0), elecKNS = u.kwhK * (params.elec_cost || 0), wells = u.wy * (params.well_opex ?? DEFAULT_PARAMS.well_opex);
  const opex = lift + inj + elecESP + elecKNS + wells, capex = costOf(cu, params);
  return { revenue, lift, inj, elecESP, elecKNS, wells, opex, capex, cf: revenue - opex - capex };
}
const zeroUnits = () => ({ oil_t: 0, liq: 0, inj: 0, kwhE: 0, kwhK: 0, wy: 0 });
function createEconomy(params) {
  const eco = {
    balance: params.init_money,
    revenue: 0, opex: 0, kwh: 0, drillSpent: 0, otherSpent: 0, drills: [], // drills – сутки решений (для графика)
    u: zeroUnits(), byWell: {}, cu: {}, cuDrill: {}, parts: null,
    credit: params.credit_limit ?? Infinity,
    // накопленные статьи на сейчас, руб: [выручка, подготовка жидкости, водоподготовка, энергия ЭЦН, энергия КНС, обслуживание,
    // бурение, ГРП, ЭЦН, перевод в ППД, ОПЗ, ГДИС, недобор нефти при ГДИС, сейсмика, разведка] – для графиков экономики
    snap() {
      const f = flowOf(eco.u, {}, params), c = (k) => costOf({ [k]: eco.cu[k] || 0 }, params);
      return [f.revenue, f.lift, f.inj, f.elecESP, f.elecKNS, f.wells, c("drill_cost"), c("frac_cost"), c("esp_cost"), c("conv_cost"), c("stim_cost"), c("pta_cost"), c("lost_t"), c("seis_cost"), c("expl_cost"), c("rig_cost")];
    },
    // можно ли потратить cost: баланс после траты не ниже -кредитного лимита
    canSpend(cost) { return eco.balance - cost >= -eco.credit - 1e-6; },
    refresh() {
      const f = flowOf(eco.u, {}, params);
      eco.revenue = f.revenue; eco.opex = f.opex; eco.parts = f; eco.kwh = eco.u.kwhE + eco.u.kwhK;
      eco.drillSpent = costOf(eco.cuDrill, params); eco.otherSpent = costOf(eco.cu, params) - eco.drillSpent;
      eco.balance = params.init_money + eco.revenue - eco.opex - eco.drillSpent - eco.otherSpent;
    },
    // учёт идёт и по месторождению (u), и по каждой скважине (byWell[имя]) – для графика экономики скважин
    update(dt, wells) {
      const u = eco.u;
      wells.forEach((w, i) => {
        const p = eco.byWell[w.name ?? i] || (eco.byWell[w.name ?? i] = zeroUnits());
        const add = (k, v) => { u[k] += v; p[k] += v; };
        if (w.on === false) { add("wy", (WELL_OPEX_IDLE * dt) / 365); return; }
        if (w.type === "prod") {
          add("wy", dt / 365);
          add("oil_t", w.qo * RHO_OIL * dt); add("liq", w.q * dt);     // нефть м³→т; подъём и подготовка всей жидкости
          if (w.kW) add("kwhE", w.kW * 24 * dt);                      // электроэнергия ЭЦН
        } else {
          add("wy", (WELL_OPEX_INJ * dt) / 365);
          add("inj", w.q * dt);
          if (w.kW) add("kwhK", w.kW * 24 * dt);                      // электроэнергия КНС на эту скважину
        }
      });
      eco.refresh();
    },
    // накопленный операционный результат скважины (выручка − подготовка − энергия − обслуживание), руб; может быть отрицательным
    wellNet(w, i) { const p = eco.byWell[w.name ?? i]; return p ? flowOf(p, {}, params).cf : 0; },
    // капитальные затраты и исследования: units – {параметр: количество}; drill – относить к бурению
    charge(day, units, drill = false) {
      addUnits(eco.cu, units); if (drill) addUnits(eco.cuDrill, units);
      eco.drills.push(day); eco.refresh();
      return costOf(units, params);
    },
  };
  return eco;
}

// ---------- Тесты экономики ----------
function economyTests() {
  const t = [];
  const P = DEFAULT_PARAMS, eco = createEconomy(P);
  eco.update(10, [{ type: "prod", q: 100, qo: 60, qw: 40, kW: 50 }, { type: "inj", q: 80, qo: 0, qw: 80, kW: 20 }, { type: "prod", on: false, q: 0, qo: 0 }]);
  const cx = eco.charge(0, { drill_cost: 1.7, frac_cost: 2 }, true);
  const rev = 60 * 10 * 0.86 * P.price_oil, lift = 100 * 10 * P.lift_cost, inj = 80 * 10 * P.inj_cost, el = (50 + 20) * 24 * 10 * P.elec_cost;
  const fix = P.well_opex * (10 / 365) * (1 + WELL_OPEX_INJ + WELL_OPEX_IDLE), cap = 1.7 * P.drill_cost + 2 * DEFAULT_COSTS.frac_cost;
  const expect = P.init_money + rev - lift - inj - el - fix - cap;
  t.push({ name: "экономика: арифметика суток (выручка, подъём, закачка, электроэнергия ЭЦН и КНС, обслуживание скважин, капзатраты)",
           pass: Math.abs(eco.balance - expect) < 1e-3 && Math.abs(cx - cap) < 1e-6 && Math.abs(eco.drillSpent - cap) < 1e-6,
           details: `balance=${eco.balance.toFixed(0)} (ож. ${expect.toFixed(0)})` });
  const sim = createSim(buildReservoir(DEFAULT_PARAMS), DEFAULT_PARAMS);
  sim.addWell(sim.r.cells[100], "prod", 150);
  advance(sim, 365);
  const e2 = sim.economy;
  t.push({ name: "экономика: за год баланс = капитал + поток, история посуточно",
           pass: sim.history.days.length >= 364 &&
                 Math.abs(e2.balance - (DEFAULT_PARAMS.init_money + e2.revenue - e2.opex)) < 1e-6 && Math.abs(e2.revenue - flowOf(e2.u, {}, DEFAULT_PARAMS).revenue) < 1e-6,
           details: `money=${(e2.balance / 1e6).toFixed(1)} млн руб, дней=${sim.history.days.length}` });
  return t;
}

// ---------- ГДИС: кривая восстановления давления (КВД), уровень 2 ----------
// Синтетическая КВД по добывающей скважине. Модель – однофазный радиальный приток с
// постоянным дебитом до остановки (q = текущий дебит жидкости): давление на забое
// p_ws(Δt) = p_wf0 + x(Δt), x = A·[E1(rw²/(4ηΔt)) + 2s (+ E1((2d)²/(4ηΔt)) – изображение
// запечатанного разлома на расстоянии d)], A = qμ/(4π·K_Д·k·h), η = K_Д·k/(φ·μ·ct).
// Подъём ограничен возможным p_wf0 + D (конечный пласт): rise = x/(1+(x/D)^6)^(1/6).
// Влияние ствола – запаздывание первого порядка с постоянной τ, добавляется шум датчика.
// Анализ – полулогарифмический (MDH): в радиальном режиме p_ws = a + m·lg Δt,
// k = 2.303·q·μ/(4π·K_Д·h·m), s = ½[(a − p_wf0)/A − ln(4η/rw²) + 0.5772] (Δt в сутках).
function E1(x) { // интегральная показательная функция −Ei(−x)
  if (x <= 0) return Infinity;
  if (x <= 1) {
    let sum = 0, term = 1;
    for (let n = 1; n <= 40; n++) { term *= -x / n; sum -= term / n; }
    return -0.5772156649 - Math.log(x) + sum;
  }
  let b = x + 1, c = 1e30, d = 1 / b, h = d; // цепная дробь (Ленц)
  for (let n = 1; n <= 100; n++) {
    const an = -n * n; b += 2; d = 1 / (an * d + b); c = b + an / c;
    const del = c * d; h *= del; if (Math.abs(del - 1) < 1e-12) break;
  }
  return h * Math.exp(-x);
}
// расстояние от скважины до ближайшего запечатанного разлома, м (null – нет рядом)
function nearestSealFaultM(r, cell) {
  if (!r.faults) return null;
  const i = cell % r.nx, j = Math.floor(cell / r.nx);
  let best = null;
  for (const F of r.faults) {
    if (F.trans > 0.5) continue;
    const d = polyDist(i, j, F.pts).d * r.dx;
    if (best === null || d < best) best = d;
  }
  return best;
}
function pressureBuildup(sim, w, days) {
  // Гибридная КВД: раннее время – аналитика радиального притока к вертикальной скважине (скин, влияние ствола,
  // k ячейки, эффективная вязкость по суммарной подвижности); позднее время – расчёт самим симулятором:
  // копия модели, скважина остановлена, соседи работают, давление в ячейке скважины по мере восстановления.
  // Сшивка – плавная, на масштабе времени прихода возмущения на размер ячейки. Так поздняя часть отражает
  // неоднородность, соседние скважины, разломы и выходит на пластовое давление зоны дренирования.
  const r = sim.r, k = r.k[w.cell], h = r.h, mu = 1 / lambdaT(sim.Sw[w.cell], r), rw = 0.1, s = w.skin || 0;
  const q = w.q, A = (q * mu) / (4 * Math.PI * CONV_K * k * h);
  const eta = (CONV_K * k) / (r.phi * mu * r.ct), pwf0 = w.pwf;
  const xAn = (t) => A * (E1((rw * rw) / (4 * eta * t)) + 2 * s);
  const ppd = 24, n = Math.round(ppd * Math.log10(days / 0.001)) + 1, tt = [];
  for (let m = 0; m < n; m++) tt.push(0.001 * Math.pow(10, m / ppd));
  // сеточная часть: закрытая скважина в копии модели
  const cs = cloneSim(sim), cw = cs.wells[sim.wells.indexOf(w)];
  cw.on = false;
  const pc = (z) => cw.perf.reduce((a, pf) => a + z.P[pf.cell], 0) / cw.perf.length, P0c = pc(cs);
  const grid = []; let tPrev = 0;
  for (const tm of tt) { solvePressure(cs, Math.max(1e-6, tm - tPrev)); tPrev = tm; grid.push(pc(cs) - pwf0); }
  const t1 = r.dx ** 2 / (4 * eta), t2 = (4 * r.dx) ** 2 / (4 * eta); // радиус исследования от 1 до 4 ячеек
  const blend = (t) => { if (t <= t1) return 0; if (t >= t2) return 1; const u = Math.log(t / t1) / Math.log(t2 / t1); return u * u * (3 - 2 * u); };
  const tau = Math.min(0.05, Math.max(0.003, 0.008 * Math.sqrt(100 / ((k * h) / mu))));
  const rng = mulberry32((L2.SEED ^ Math.imul(w.cell + 3, 2246822519)) >>> 0);
  const t = [], p = [];
  let pPrev = 0, tP = 0, rPrev = 0;
  tt.forEach((tm, m) => {
    const b = blend(tm), rm = (1 - b) * xAn(tm) + b * grid[m], a = Math.exp(-(tm - tP) / tau);
    pPrev = pPrev * a + (1 - a) * 0.5 * (rPrev + rm); tP = tm; rPrev = rm;
    t.push(tm); p.push(pwf0 + pPrev + 0.01 * gauss(rng)); // шум датчика 0.01 атм
  });
  // «истинное» пластовое давление зоны: продолжаем остановку в модели до стабилизации (до 120 сут)
  // «истинное» давление – максимум восстановления (дальше соседние скважины могут снова его снижать)
  let pMax = pc(cs);
  for (let k2 = 0; k2 < 40; k2++) { const before = pc(cs); solvePressure(cs, 3); pMax = Math.max(pMax, pc(cs)); if (pc(cs) - before < 0.005) break; }
  const deriv = bupDerivative(t, p);
  return { wellName: w.name, cell: w.cell, t, p, deriv, q, pwf0, days, mu, tau,
           truth: { k, s, A, eta, pRes: pMax, pCell0: P0c } };
}
// производная давления по ln Δt (Бурде, окно L = 0.2)
function bupDerivative(t, p) {
  const n = t.length, L = 0.2, out = new Array(n).fill(NaN), lt = t.map(Math.log);
  for (let i = 1; i < n - 1; i++) {
    let a = i - 1, b = i + 1;
    while (a > 0 && lt[i] - lt[a] < L) a--;
    while (b < n - 1 && lt[b] - lt[i] < L) b++;
    const x1 = lt[i] - lt[a], x2 = lt[b] - lt[i];
    out[i] = ((p[i] - p[a]) / x1 * x2 + (p[b] - p[i]) / x2 * x1) / (x1 + x2);
  }
  return out;
}
// интерпретация: линейная регрессия p по lg Δt в окне [t1, t2] (сутки)
function interpretBuildup(bu, r, t1, t2) {
  const idx = [];
  for (let i = 0; i < bu.t.length; i++) if (bu.t[i] >= t1 && bu.t[i] <= t2) idx.push(i);
  if (idx.length < 4) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const i of idx) { const x = Math.log10(bu.t[i]), y = bu.p[i]; sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const n = idx.length, m = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - m * sx) / n;
  if (!(m > 0)) return null;
  const mu = bu.mu || r.mu_o, rw = 0.1;
  const k = (2.303 * bu.q * mu) / (4 * Math.PI * CONV_K * r.h * m);
  const A = m / 2.303, eta = (CONV_K * k) / (r.phi * mu * r.ct);
  const s = 0.5 * ((a - bu.pwf0) / A - Math.log((4 * eta) / (rw * rw)) + 0.5772);
  return { m, a, k, s, n, ...buildupPres(bu) };
}
// Пластовое давление по КВД: если кривая вышла на полку (за последнюю половину записи прирост < 2 % общего подъёма) –
// это конечное давление; иначе экстраполяция к асимптоте по трём точкам, равноотстоящим по времени (Эйткен),
// при условии монотонного затухания; если и это невозможно – только оценка снизу (конец записи).
function buildupPres(bu) {
  const tE = bu.t[bu.t.length - 1], at = (tq) => { let i = 1; while (i < bu.t.length - 1 && bu.t[i] < tq) i++; const f = (tq - bu.t[i - 1]) / (bu.t[i] - bu.t[i - 1]); return bu.p[i - 1] + f * (bu.p[i] - bu.p[i - 1]); };
  const pE = at(tE * 0.999), pH = at(tE / 2), rise = pE - bu.pwf0;
  if (rise > 0 && pE - pH < 0.02 * rise) return { pRes: pE, pEnd: pE, stabilized: true, method: "полка" };
  const pa = at(tE / 3), pb = at((2 * tE) / 3), pc = pE, den = pa + pc - 2 * pb;
  if (pb > pa && pc > pb && den < 0 && (pc - pb) < 0.4 * (pb - pa)) { // при логарифмическом росте (радиальный приток) отношение ≈ 0.59 – не полка
    const pInf = (pa * pc - pb * pb) / den;
    if (pInf > pc && pInf - pc < 2 * (pc - pa)) return { pRes: pInf, pEnd: pE, stabilized: true, method: "экстраполяция" };
  }
  return { pRes: null, pEnd: pE, stabilized: false, method: "не вышла на полку" };
}
// подсказка: самый длинный участок, где производная постоянна (±12 % от среднего)
// Качество КВД: подъём давления за остановку против шума датчика (0,01 атм). Подъём < 2 атм – радиальный участок
// не выделить надёжно (низкий дебит или высокая проводимость kh): интерпретация k и скина ненадёжна.
function buildupQuality(bu) {
  const rise = bu.p[bu.p.length - 1] - bu.pwf0;
  return { rise, ok: rise >= 2, msg: rise >= 2 ? "" : rise <= 0.05
    ? "давление за остановку не растёт: зона скважины истощена соседними скважинами или проводимость очень высока (типично для длинной ГС). k и скин по такой КВД определить нельзя, пластовое давление - только как оценку снизу"
    : `подъём давления за остановку всего ${rise.toFixed(2)} атм, на уровне шума датчика; k и скин по такой КВД ненадёжны. Увеличьте дебит скважины (ЭЦН, частота) и повторите КВД` };
}
// подсказка: самый длинный участок с постоянной производной (±12 %) после эффекта ствола (t > 8τ) и выше шума
function suggestWindow(bu) {
  const d = bu.deriv, n = d.length, t0 = 8 * (bu.tau || 0);
  if (!buildupQuality(bu).ok) return null;
  let best = null;
  for (let i = 3; i < n - 1; i++) {
    if (bu.t[i] < t0) continue;
    let sum = 0, cnt = 0;
    for (let j = i; j < n - 1; j++) {
      if (!isFinite(d[j])) break;
      sum += d[j]; cnt++;
      const mean = sum / cnt;
      let ok = true;
      for (let q = i; q <= j; q++) if (Math.abs(d[q] / mean - 1) > 0.12) { ok = false; break; }
      if (!ok) break;
      if (cnt >= 8 && mean > 0.2 && (!best || cnt > best.cnt)) best = { i, j, cnt };
    }
  }
  return best ? { t1: bu.t[best.i], t2: bu.t[best.j] } : null;
}

// ---------- Тесты уровня 2 ----------
function level2Tests() {
  const t = [];
  const r = buildReservoir2(DEFAULT_PARAMS), N = r.nx * r.ny;
  const r2 = buildReservoir2(DEFAULT_PARAMS);
  let same = true;
  for (let c = 0; c < N; c++) if (r.k[c] !== r2.k[c] || r.zSeis[c] !== r2.zSeis[c]) { same = false; break; }
  t.push({ name: "ур.2: детерминизм, все ячейки активны", pass: same && r.cells.length === N });
  let oil = 0, full = 0, ooip = 0, maxErr = 0;
  for (const c of r.cells) {
    if (r.hOil[c] > 0) oil++;
    if (r.hOil[c] >= r.h - 1e-9) full++;
    ooip += r.poreVol[c] * (1 - r.Sw0[c]);
    maxErr = Math.max(maxErr, Math.abs(r.zSeis[c] - r.zTop[c]));
  }
  t.push({ name: "ур.2: нефтеносная площадь 30–55 %, чисто нефтяная зона > 8 %",
           pass: oil / N > 0.3 && oil / N < 0.55 && full / N > 0.08,
           details: `нефть ${(oil / N * 100).toFixed(0)} %, без воды ${(full / N * 100).toFixed(0)} %` });
  t.push({ name: "ур.2: OOIP = Σ Vp·(1−Sw0)", pass: Math.abs(ooip - r.ooipM3) < 1e-6 * ooip && ooip > 0,
           details: `OOIP=${(r.ooipM3 / 1e6).toFixed(2)} млн м³` });
  t.push({ name: "ур.2: сейсмика отличается от истины на 1–4.5 м", pass: maxErr > 1 && maxErr < 4.5,
           details: `max|δ|=${maxErr.toFixed(2)} м` });
  // РИГИС разведочных скважин
  const logs = r.explore.map((w) => wellLog(r, w.cell));
  let netOk = true, foOk = true, owcOk = true, kinds = { oil: 0, mixed: 0, water: 0 };
  for (const L of logs) {
    if (Math.abs(L.hOil + L.hWater - r.h) > 0.15) netOk = false;
    if (Math.abs(L.hOil - r.hOil[L.cell]) > 0.15) foOk = false;
    if (L.hWater === 0) kinds.oil++; else if (L.hOil === 0) kinds.water++; else kinds.mixed++;
    for (let n = 1; n < L.rigis.length; n++) // граница нефть→вода внутри пачки = ВНК
      if (L.rigis[n - 1].kind === "oil" && L.rigis[n].kind === "water" &&
          Math.abs(-L.rigis[n].absTop - r.owc) > 0.051) owcOk = false;
  }
  t.push({ name: "ур.2: РИГИС: hн + hв = h, hн совпадает с моделью", pass: netOk && foOk,
           details: logs.map((L, n) => `${r.explore[n].name}: ${L.hOil}+${L.hWater}`).join(", ") });
  t.push({ name: "ур.2: разведка: свод в нефти, ≥2 с ВНК в разрезе, есть водяная",
           pass: kinds.oil >= 1 && kinds.mixed >= 2 && kinds.water >= 1,
           details: `нефть ${kinds.oil}, нефть+вода ${kinds.mixed}, вода ${kinds.water}` });
  t.push({ name: "ур.2: ВНК по РИГИС = истинный во всех скважинах, где вскрыт", pass: owcOk });
  // кривая сопротивления: нефтенасыщенный коллектор ≫ водонасыщенный (Арчи)
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; };
  const Lmix = logs.slice().sort((a, b) => b.hOil * b.hWater - a.hOil * a.hWater)[0];
  const inK = (L, kind) => L.samples.filter((s) => L.rigis.some((x) => x.kind === kind &&
    s.md > x.mdTop + 0.4 && s.md < x.mdBase - 0.4)).map((s) => s.rt);
  const rtO = Lmix ? med(inK(Lmix, "oil")) : 0, rtW = Lmix ? med(inK(Lmix, "water")) : 1;
  t.push({ name: "каротаж: Rt(нефть) > 8·Rt(вода)", pass: rtO > 8 * rtW,
           details: `Rt нефть ≈ ${rtO.toFixed(1)}, вода ≈ ${rtW.toFixed(2)} Ом·м` });
  // динамика: добывающие в своде и в водяной зоне, нагнетательная на крыле
  const sim = createSim(buildReservoir2(DEFAULT_PARAMS), DEFAULT_PARAMS);
  const crest = r.explore[0].cell, wet = r.explore[4].cell;
  sim.addWell(crest, "prod", 150);
  sim.addWell(wet, "prod", 150);
  advance(sim, 30);
  const [wo, ww] = sim.wells;
  t.push({ name: "ур.2: в своде – нефть (fw<1%), в водяной зоне – вода (fw>99%)",
           pass: wo.fw < 0.01 && ww.fw > 0.99,
           details: `свод fw=${(wo.fw * 100).toFixed(1)} %, вода fw=${(ww.fw * 100).toFixed(1)} %` });
  const sim2 = createSim(buildReservoir2(DEFAULT_PARAMS), DEFAULT_PARAMS);
  sim2.addWell(r.explore[1].cell, "prod", 120);
  sim2.addWell(crest, "inj", 330);
  advance(sim2, 365);
  let dW = 0;
  for (const c of sim2.r.cells) dW += sim2.r.poreVol[c] * (sim2.Sw[c] - sim2.r.Sw0[c]);
  const inj = sim2.wells[1].cum.inj, prodW = sim2.wells[0].cum.water;
  const errW = (inj - dW - prodW) / Math.max(1, inj);
  const mb = materialBalance(sim2);
  t.push({ name: "ур.2: баланс воды < 0.1 %, давления < 1 %", pass: Math.abs(errW) < 1e-3 && Math.abs(mb.err) < 0.01,
           details: `вода err=${(errW * 100).toFixed(3)} %, P err=${(mb.err * 100).toFixed(3)} %` });
  return t;
}

// ---------- Тесты: разломы, сейсмика, скин, ГДИС, ППД ----------
function level2bTests() {
  const t = [];
  const r = buildReservoir2(DEFAULT_PARAMS), N = r.nx * r.ny;
  let sealE = 0, leakE = 0;
  for (let c = 0; c < N; c++) { if (r.tmE[c] === 0 || r.tmN[c] === 0) sealE++; if (r.tmE[c] === 0.3 || r.tmN[c] === 0.3) leakE++; }
  t.push({ name: "разломы: есть запечатанные и частично проницаемые грани", pass: sealE > 20 && leakE > 20,
           details: `запечатано ${sealE}, проницаемо на 30 % ${leakE} граней` });
  const sim = createSim(r, DEFAULT_PARAMS);
  sim.addWell(26 * r.nx + 20, "inj", 340); // горст между разломами
  sim.addWell(22 * r.nx + 33, "prod", 120); // восточный блок, за F-1
  advance(sim, 365);
  let flux = 0;
  for (let c = 0; c < N; c++) { if (r.tmE[c] === 0) flux = Math.max(flux, Math.abs(sim._uE[c])); if (r.tmN[c] === 0) flux = Math.max(flux, Math.abs(sim._uN[c])); }
  let dW = 0;
  for (const c of r.cells) dW += r.poreVol[c] * (sim.Sw[c] - r.Sw0[c]);
  const inj = sim.wells[0].cum.inj, errW = (inj - dW - sim.wells[1].cum.water) / Math.max(1, inj);
  t.push({ name: "разломы: поток через запечатанные грани = 0, баланс воды < 0.1 %",
           pass: flux === 0 && Math.abs(errW) < 1e-3, details: `max|поток|=${flux.toExponential(1)}, err=${(errW * 100).toFixed(3)} %` });
  // ячейки, связанные с c0 гранями с множителем проводимости > 0
  const linked = (rr, c0) => {
    const nx = rr.nx, ny = rr.ny, seen = new Uint8Array(nx * ny), st = [c0]; seen[c0] = 1;
    while (st.length) {
      const c = st.pop(), i = c % nx, j = Math.floor(c / nx);
      for (const [ok, d, tf] of [[i + 1 < nx, c + 1, rr.tmE[c]], [i > 0, c - 1, rr.tmE[c - 1]], [j + 1 < ny, c + nx, rr.tmN[c]], [j > 0, c - nx, rr.tmN[c - nx]]])
        if (ok && tf > 0 && !seen[d]) { seen[d] = 1; st.push(d); }
    }
    return seen;
  };
  // запечатанный разлом без щелей у каждого канонического объекта: в каждой строке сетки, через которую проходит разлом,
  // закрыта грань, и по открытым граням с одной его стороны на другую не пройти (ломаная через центр ячейки или вершина
  // на линии между центрами ячеек раньше оставляли щель)
  const gaps = [];
  for (const id of ["base", ...SCENARIO_ORDER]) {
    const rr = buildReservoir2(id === "base" ? DEFAULT_PARAMS : { ...DEFAULT_PARAMS, ...scenarioParams(id) }), nx = rr.nx;
    for (const F of rr.faults.filter((f) => f.trans === 0)) {
      const ys = F.pts.map((q) => q[1]), rows = [];
      for (let j = Math.max(0, Math.ceil(Math.min(...ys))); j <= Math.min(rr.ny - 1, Math.floor(Math.max(...ys))); j++)
        if (!rr.tmE.subarray(j * nx, j * nx + nx - 1).includes(0)) rows.push(j);
      const side = (c) => { const q = polyDist(c % nx, Math.floor(c / nx), F.pts); return q.d > 1.5 ? q.side : 0; };
      const seen = linked(rr, rr.cells.find((c) => side(c) === 1));
      const across = rr.cells.filter((c) => seen[c] && side(c) === -1).length;
      if (rows.length || across) gaps.push(`${SCENARIOS[id].short} ${F.name}: щели в строках ${rows.join(", ") || "–"}, ${across} ячеек за разломом`);
    }
  }
  // купол: добывающая за F-1 без закачки в своём блоке – отбор = упругий запас блока за F-1 (перетока через разлом нет)
  const east = linked(r, sim.wells[1].cell), prodV = sim.wells[1].cum.oil + sim.wells[1].cum.water;
  const expEast = r.cells.reduce((q, c) => q + (east[c] ? r.poreVol[c] * r.ct * (r.P0 - sim.P[c]) : 0), 0), errF = (prodV - expEast) / Math.max(1, prodV);
  t.push({ name: "разломы: запечатанный разлом без щелей у всех объектов; за F-1 купола отбор = упругий запас блока (±0.5 %)",
           pass: !gaps.length && !east[sim.wells[0].cell] && Math.abs(errF) < 0.005,
           details: `${gaps.join("; ") || "щелей нет"}; за F-1: отбор ${(prodV / 1e3).toFixed(1)} тыс. м³, переток ${(errF * 100).toFixed(2)} % отбора` });
  const sm = r.seis;
  let eT = 0, eTh = 0;
  for (let c = 0; c < N; c++) { eT = Math.max(eT, Math.abs(sm.top[c] - r.zTop[c])); eTh += Math.abs(sm.thick[c] - r.gross[c]); }
  const shiftOk = sm.faults.every((F, n) => F.pts.every((q, m) => Math.abs(q[0] - r.faults[n].pts[m][0]) < 1.5));
  t.push({ name: "сейсмика: кровля ±4 м, трассы разломов смещены < 1.5 ячейки, 2 разлома",
           pass: eT < 4.5 && shiftOk && sm.faults.length === 2, details: `max|δкровли|=${eT.toFixed(1)} м, ср.|δh|=${(eTh / N).toFixed(1)} м` });
  // скин: WI падает с ростом скина, ОПЗ снижает скин до −1 и повышает дебит
  const k100 = 100;
  t.push({ name: "скин: WI(s=5) < WI(0) < WI(−1)", pass: wellIndex(k100, r, 5) < wellIndex(k100, r, 0) && wellIndex(k100, r, 0) < wellIndex(k100, r, -1) });
  const w2 = createSim(buildReservoir2(DEFAULT_PARAMS), DEFAULT_PARAMS);
  const cell = w2.r.explore[2].cell;
  w2.addWell(cell, "prod", 150);
  const wp = w2.wells[0]; wp.skin = 5;
  advance(w2, 5); const q1 = wp.q;
  w2.stimulate(wp); advance(w2, 5);
  t.push({ name: "ОПЗ: скин 5 → −1, дебит растёт", pass: wp.skin === -1 && wp.q > 1.25 * q1, details: `q ${q1.toFixed(0)} → ${wp.q.toFixed(0)} м³/сут` });
  // перевод в ППД
  const w3 = createSim(buildReservoir2(DEFAULT_PARAMS), DEFAULT_PARAMS);
  w3.addWell(w3.r.explore[0].cell, "prod", 150);
  w3.addWell(w3.r.explore[1].cell, "prod", 150);
  advance(w3, 200);
  const oil0 = w3.wells[1].cum.oil;
  w3.convertToInjector(w3.wells[1]); advance(w3, 100);
  const cw = w3.wells[1];
  t.push({ name: "ППД: после перевода скважина закачивает воду, добыча не растёт, история сохранена",
           pass: cw.type === "inj" && cw.q > 0 && cw.cum.inj > 0 && cw.cum.oil === oil0 && cw.wasProd, details: `закачка ${cw.cum.inj.toFixed(0)} м³` });
  // E1: табличные значения
  const e = [[1, 0.2193839344], [0.1, 1.8229239584], [5, 0.0011482956], [0.01, 4.0379295766]];
  t.push({ name: "ГДИС: E1(x) по таблице", pass: e.every(([x, v]) => Math.abs(E1(x) - v) < 1e-6 * Math.max(1, v)) });
  // КВД: восстановление k и s в радиальном окне
  let okK = true, okS = true, det = [];
  for (const [kk, sk] of [[500, 0.5], [100, 4], [20, 8]]) {
    const ru = buildReservoir2(DEFAULT_PARAMS); ru.k.fill(kk); ru.Sw0.fill(ru.Swc); ru.tmE.fill(1); ru.tmN.fill(1);
    const sm2 = createSim(ru, DEFAULT_PARAMS);
    const ex = 25 * sm2.r.nx + 25;
    sm2.addWell(ex, "prod", 120); sm2.wells[0].skin = sk;
    advance(sm2, 60);
    const bu = pressureBuildup(sm2, sm2.wells[0], 14);
    const win = suggestWindow(bu), res = win && interpretBuildup(bu, sm2.r, win.t1, win.t2);
    const k0 = sm2.r.k[ex];
    if (!res || Math.abs(res.k / k0 - 1) > 0.1) okK = false;
    if (!res || Math.abs(res.s - sk) > 1.0) okS = false;
    det.push(res ? `k ${res.k.toFixed(0)}/${k0.toFixed(0)}, s ${res.s.toFixed(1)}/${sk}` : "нет окна");
  }
  t.push({ name: "ГДИС: k по КВД в пределах 10 %", pass: okK, details: det.join("; ") });
  // пластовое давление: длинная КВД выходит на полку и даёт P пл. зоны дренирования, короткая – только оценку снизу
  const sp2 = createSim(buildReservoir2(DEFAULT_PARAMS), DEFAULT_PARAMS);
  sp2.addWell(sp2.r.explore[2].cell, "prod", 120); sp2.addWell(sp2.r.explore[0].cell, "prod", 120); advance(sp2, 120);
  const bL = pressureBuildup(sp2, sp2.wells[0], 30), pL = buildupPres(bL), bS = pressureBuildup(sp2, sp2.wells[0], 0.3), pS = buildupPres(bS);
  {
    // низкий дебит в высокопроницаемом пласте: подъём давления – на уровне шума; подсказка не даёт ложного окна
    const sw = createSim(buildReservoir2({ ...DEFAULT_PARAMS, ...scenarioParams("bv8") }), { ...DEFAULT_PARAMS, ...scenarioParams("bv8") });
    const oilw = sw.r.cells.filter((c) => sw.r.hOil[c] >= sw.r.h - 1e-6); sw.addWell(oilw[Math.floor(oilw.length / 2)], "prod", sw.r.P0 - 3); advance(sw, 60);
    const bw = pressureBuildup(sw, sw.wells[0], 7), qw = buildupQuality(bw);
    t.push({ name: "ГДИС: слабый сигнал (малый дебит, высокая kh) распознаётся – подсказка не даёт ложного окна", pass: !qw.ok && suggestWindow(bw) === null,
             details: `дебит ${bw.q.toFixed(0)} м³/сут, подъём ${qw.rise.toFixed(2)} атм` });
  }
  t.push({ name: "ГДИС: P пл. по 30-суточной КВД ±2 % от давления, на которое выходит остановленная скважина в модели; 7-часовая КВД на полку не выходит",
           pass: pL.stabilized && Math.abs(pL.pRes / bL.truth.pRes - 1) < 0.02 && !pS.stabilized,
           details: `оценка ${pL.pRes ? pL.pRes.toFixed(1) : "–"} (${pL.method}), модель ${bL.truth.pRes.toFixed(1)} атм; короткая: ${pS.method}` });
  t.push({ name: "ГДИС: скин по КВД в пределах ±1", pass: okS });
  return t;
}

// ---------- Тесты: режимы работы скважин и оборудование ----------
function equipmentTests() {
  const t = [];
  const mk = () => { const sm = createSim(buildReservoir2(DEFAULT_PARAMS), DEFAULT_PARAMS); return sm; };
  const sm = mk(), cell = sm.r.explore[2].cell;
  sm.addWell(cell, "prod", 150);
  const w = sm.wells[0];
  w.mode = "flow"; w.choke = 12;
  const eF = solveEquipment(sm, w);
  t.push({ name: "оборудование: фонтан при начальном давлении работает (0 < q, P_wf < P_пл)", pass: eF.q > 1 && eF.pwf < sm.P[cell] && eF.pwf > 150,
           details: `q=${eF.q.toFixed(0)} м³/сут, P_wf=${eF.pwf.toFixed(0)}, P_уст=${eF.pwh.toFixed(0)} атм` });
  w.choke = 3; const eS = solveEquipment(sm, w); w.choke = 12;
  t.push({ name: "оборудование: уменьшение штуцера снижает дебит", pass: eS.q < eF.q, details: `3 мм: ${eS.q.toFixed(0)} < 12 мм: ${eF.q.toFixed(0)}` });
  const Psave = sm.P[cell]; sm.P[cell] = 200;
  const eD = solveEquipment(sm, w);
  w.mode = "esp"; w.freq = 50; const eE = solveEquipment(sm, w);
  w.freq = 40; const eE40 = solveEquipment(sm, w); w.freq = 55; const eE55 = solveEquipment(sm, w);
  sm.P[cell] = Psave;
  t.push({ name: "оборудование: при низком давлении фонтан глохнет, ЭЦН поднимает; дебит растёт с частотой",
           pass: eD.q === 0 && eE.q > 5 && eE40.q < eE.q && eE.q < eE55.q && eE.kW > 0,
           details: `фонтан 0, ЭЦН 40/50/55 Гц: ${eE40.q.toFixed(0)}/${eE.q.toFixed(0)}/${eE55.q.toFixed(0)} м³/сут, ${eE.kW.toFixed(0)} кВт` });
  // типоразмер насоса: на высокопродуктивной скважине больший ЭЦН даёт больше жидкости и меньшее забойное давление
  const sp = mk(); sp.addWell(sp.r.explore[0].cell, "prod", 150); const wp = sp.wells[0]; wp.mode = "esp"; wp.freq = 50;
  wp.pump = "250"; const pM = solveEquipment(sp, wp); wp.pump = "500"; const pL = solveEquipment(sp, wp); wp.pump = "125"; const pS = solveEquipment(sp, wp);
  t.push({ name: "ЭЦН: больший типоразмер – больше дебит и ниже забойное давление (ЭЦН-125 < 250 < 500)", pass: pS.q < pM.q && pM.q < pL.q && pL.pwf < pM.pwf && pM.pwf < pS.pwf,
           details: `S ${pS.q.toFixed(0)}/${pS.pwf.toFixed(0)}, M ${pM.q.toFixed(0)}/${pM.pwf.toFixed(0)}, L ${pL.q.toFixed(0)}/${pL.pwf.toFixed(0)} (м³/сут / атм)` });
  // нагнетательная: штуцер и КНС
  sm.addWell(sm.r.explore[0].cell, "inj", 325);
  const wi = sm.wells[1]; wi.mode = "choke";
  wi.choke = 4; const i4 = solveEquipment(sm, wi); wi.choke = 12; const i12 = solveEquipment(sm, wi);
  wi.choke = 6; const i6 = solveEquipment(sm, wi); sm.field.pKNS = 170; const i170 = solveEquipment(sm, wi); sm.field.pKNS = 130; wi.choke = 12;
  t.push({ name: "оборудование: нагнетательная – закачка растёт с диаметром штуцера и давлением КНС, но не выше предела 500 м³/сут", pass: i4.q < i6.q && i6.q < i170.q && i170.q > 0 && i12.q <= Q_INJ_MAX + 1e-6 && i170.q <= Q_INJ_MAX + 1e-6,
           details: `4 мм ${i4.q.toFixed(0)}, 6 мм ${i6.q.toFixed(0)}, 12 мм ${i12.q.toFixed(0)}, КНС 170: ${i170.q.toFixed(0)} м³/сут (предел ${Q_INJ_MAX})` });
  // год работы в смешанных режимах: балансы и остановка
  const s2 = mk(), r2 = s2.r;
  s2.addWell(r2.explore[2].cell, "prod", 150); s2.addWell(r2.explore[1].cell, "prod", 150); s2.addWell(r2.explore[0].cell, "prod", 150); s2.addWell(r2.explore[3].cell, "prod", 150);
  const [a, b, c, d] = s2.wells;
  a.mode = "esp"; b.mode = "flow"; s2.convertWell(c); c.mode = "choke"; d.on = false;
  advance(s2, 365);
  let dW = 0;
  for (const q of r2.cells) dW += r2.poreVol[q] * (s2.Sw[q] - r2.Sw0[q]);
  const inj = s2.wells.reduce((x, y) => x + y.cum.inj, 0), pw = s2.wells.reduce((x, y) => x + y.cum.water, 0), errW = (inj - dW - pw) / Math.max(1, inj);
  const mb = materialBalance(s2);
  t.push({ name: "режимы: год при ЭЦН + фонтан + нагнетательной со штуцером + остановленной – баланс воды < 0.1 %, давления < 1 %",
           pass: Math.abs(errW) < 1e-3 && Math.abs(mb.err) < 0.01, details: `вода ${(errW * 100).toFixed(3)} %, P ${(mb.err * 100).toFixed(3)} %` });
  t.push({ name: "режимы: остановленная скважина не работает; ЭЦН даёт расход, расходует электроэнергию",
           pass: d.cum.oil === 0 && d.cum.water === 0 && d.q === 0 && a.cum.oil > 0 && a.kW > 0, details: `ЭЦН ${a.kW.toFixed(0)} кВт, добыча ${(a.cum.oil * 0.86).toFixed(0)} т` });
  // смена назначения в обе стороны
  const s3 = mk(); s3.addWell(s3.r.explore[2].cell, "prod", 150); const x = s3.wells[0];
  s3.convertWell(x); const toInj = x.type === "inj"; s3.convertWell(x);
  t.push({ name: "скважина: смена назначения добывающая → нагнетательная → добывающая", pass: toInj && x.type === "prod" && x.wasProd && x.converted });
  // электроэнергия в экономике
  const s4 = mk(); s4.addWell(s4.r.explore[2].cell, "prod", 150); const y = s4.wells[0]; y.mode = "esp"; y.hasESP = true;
  advance(s4, 60);
  const p0 = s4.economy.opex;
  const s5 = createSim(buildReservoir2({ ...DEFAULT_PARAMS, elec_cost: 0 }), { ...DEFAULT_PARAMS, elec_cost: 0 });
  s5.addWell(s5.r.explore[2].cell, "prod", 150); s5.wells[0].mode = "esp"; advance(s5, 60);
  t.push({ name: "экономика: электроэнергия ЭЦН входит в затраты", pass: p0 > s5.economy.opex, details: `${((p0 - s5.economy.opex) / 1e3).toFixed(0)} тыс. руб за 60 сут` });
  // ПКВ: насос включён долю времени – средние дебит и мощность в долю duty, на пласт идёт среднее
  const mkD = (d) => { const sm = mk(); sm.addWell(sm.r.explore[2].cell, "prod", 150); const w = sm.wells[0]; w.mode = "esp"; w.hasESP = true; w.pump = "500"; w.freq = 50; w.duty = d; advance(sm, 90); return sm; };
  const dC = mkD(1), dP = mkD(0.5), eC = dC.wells[0], eP = dP.wells[0];
  const kwhC = dC.economy.u.kwhE / Math.max(1e-9, dC.economy.u.liq), kwhP = dP.economy.u.kwhE / Math.max(1e-9, dP.economy.u.liq);
  t.push({ name: "ПКВ: duty = 0,5 даёт средний дебит меньше непрерывного, но больше половины (давление у скважины выше), ≈ половину мощности и меньший удельный расход энергии",
           pass: eP.q > 0.5 * eC.q && eP.q < eC.q && eP.kW < 0.65 * eC.kW && eP.kW > 0.35 * eC.kW && kwhP < kwhC,
           details: `q ${eP.q.toFixed(0)} / ${eC.q.toFixed(0)} м³/сут, ${eP.kW.toFixed(0)} / ${eC.kW.toFixed(0)} кВт, ${kwhP.toFixed(2)} / ${kwhC.toFixed(2)} кВт·ч/м³` });
  // предел приёмистости: сильный сток (4 добывающие по 20 атм рядом) и широкие настройки (штуцер 30 мм, КНС 200 атм) дали бы тысячи м³/сут;
  // скважина переходит на контроль по забойному давлению и держит 500 м³/сут (после переходного периода первых суток – не выше 502)
  const sq = createSim(buildReservoir(DEFAULT_PARAMS), DEFAULT_PARAMS), nxq = sq.r.nx, atq = (i, j) => j * nxq + i;
  sq.addWell(atq(25, 25), "inj", 300); for (const [i, j] of [[22, 25], [28, 25], [25, 22], [25, 28]]) sq.addWell(atq(i, j), "prod", 20);
  const iq = sq.wells[0]; iq.mode = "choke"; iq.choke = 30; sq.field.pKNS = 200;
  const qUnc = solveEquipment(sq, iq, true).q; let qTail = 0, qEnd = 0;
  for (let d = 0; d < 40; d++) { advance(sq, 3); if (d >= 15) qTail = Math.max(qTail, iq.q); qEnd = iq.q; }
  t.push({ name: "закачка: при 500 м³/сут скважина переходит на контроль по забойному давлению и держит предел", pass: qUnc > 1.3 * Q_INJ_MAX && iq._rc === true && qTail <= Q_INJ_MAX * 1.004 && qEnd > Q_INJ_MAX * 0.99,
           details: `без предела ${qUnc.toFixed(0)}, держит ${qEnd.toFixed(1)} м³/сут (максимум после 45 сут ${qTail.toFixed(1)})` });
  // бурение: один станок – одна скважина за 60 сут (ВС), больше станков – быстрее; деньги списываются, когда станок берёт скважину
  const mkRig = (rigs) => { const sm = mk(); if (rigs > 1) for (let q = 1; q < rigs; q++) buyRig(sm); const ex = sm.r.explore;
    for (let q = 0; q < 4; q++) { sm.addWell(ex[q].cell, "prod", 150); orderWell(sm, { well: sm.wells.pop(), units: CAPEX.vert(), kind: "v", name: "T" + q }); } return sm; };
  const rg1 = mkRig(1), rg2 = mkRig(2), sp0 = rg1.economy.cuDrill.drill_cost || 0;
  const ng1 = [rg1.wells.length]; advance(rg1, 61); ng1.push(rg1.wells.length); advance(rg1, 60); ng1.push(rg1.wells.length); advance(rg1, 120); ng1.push(rg1.wells.length);
  const ng2 = [rg2.wells.length]; advance(rg2, 61); ng2.push(rg2.wells.length); advance(rg2, 60); ng2.push(rg2.wells.length);
  t.push({ name: "бурение: 1 станок – 1 скважина за 60 сут, 2 станка вдвое быстрее; очередь и списание денег по порядку",
           pass: JSON.stringify(ng1) === "[0,1,2,4]" && JSON.stringify(ng2) === "[0,2,4]" && sp0 === 1 && rg1.economy.cuDrill.drill_cost === 4 && rg1.drill.queue.length === 0,
           details: `1 станок: ${ng1.join("→")} скв., 2 станка: ${ng2.join("→")} скв.; при заказе списана 1 скв. из 4 (затем по мере бурения)` });
  // учёт по скважинам: сумма операционных результатов скважин = операционный результат месторождения
  const ecP = dP.economy, sumW = dP.wells.reduce((s, w, i) => s + ecP.wellNet(w, i), 0), fieldCf = flowOf(ecP.u, {}, dP.params).cf;
  t.push({ name: "экономика скважин: сумма по скважинам = результат месторождения", pass: Math.abs(sumW - fieldCf) < 1e-6 * Math.max(1, Math.abs(fieldCf)), details: `${(sumW / 1e6).toFixed(3)} / ${(fieldCf / 1e6).toFixed(3)} млн руб` });
  // согласованность IMPES: отбор жидкости − закачка = упругий запас (сетка скважин, ЭЦН-1250 на пределе по давлению на приёме;
  // до исправления шага давления невязка здесь была 15 % и вся уходила в «лишнюю» нефть); год одним вызовом = 365 суточным
  const mkV = () => { const sm = createSim(buildReservoir(DEFAULT_PARAMS), DEFAULT_PARAMS), R0 = sm.r;
    for (let j = 5, bb = 0; j < 47; j += 7, bb++) for (let i = 3, aa = 0; i < 47; i += 7, aa++) {
      const c = j * R0.nx + i; if (!R0.active[c]) continue; const ty = (aa + bb) % 3 === 0 ? "inj" : "prod";
      sm.addWell(c, ty, ty === "prod" ? 150 : 325); const w = sm.wells[sm.wells.length - 1];
      if (ty === "prod") { if (R0.k[c] < 60) sm.setCompletion(w, "frac", { xf: 80, az: 0 }); w.mode = "esp"; w.hasESP = true; w.pump = "1250"; } else { w.mode = "choke"; w.choke = 10; }
    }
    sm.field.pKNS = 180; sm.field.pGather = 8; return sm; };
  const vA = mkV(), vB = mkV(); advance(vA, 365); for (let d = 0; d < 365; d++) advance(vB, 1);
  const oA = vA.wells.reduce((q, w) => q + w.cum.oil, 0), oB = vB.wells.reduce((q, w) => q + w.cum.oil, 0);
  const liq = vA.wells.reduce((q, w) => q + w.cum.oil + w.cum.water, 0), injV = vA.wells.reduce((q, w) => q + w.cum.inj, 0);
  const ex = vA.r.cells.reduce((q, c) => q + vA.r.poreVol[c] * vA.r.ct * (vA.r.P0 - vA.P[c]), 0), errV = (liq - injV - ex) / Math.max(1, liq);
  // перетоки через ствол: длинные ГС (1000 м, аз. 45°) через неоднородный пласт – часть интервалов с давлением ниже забойного
  const sx = createSim(buildReservoir(DEFAULT_PARAMS), DEFAULT_PARAMS), Rx = sx.r;
  for (let j = 4, bb = 0; j < 47; j += 8, bb++) for (let i = 5, aa = 0; i < 47; i += 8, aa++) {
    const c = j * Rx.nx + i; if (!Rx.active[c] || sx.wells.some((o) => o.perf.some((pf) => pf.cell === c))) continue; const ty = (aa + bb) % 3 === 0 ? "inj" : "prod";
    sx.addWell(c, ty, ty === "prod" ? 150 : 325); const w = sx.wells[sx.wells.length - 1];
    if (ty === "prod") { sx.setCompletion(w, "hs", { L: 1000, az: 45 }); w.mode = "esp"; w.hasESP = true; w.pump = "400"; w.freq = 40; } else { w.mode = "choke"; w.choke = 26; }
  }
  sx.field.pKNS = 100; sx.field.pGather = 5; advance(sx, 365);
  const lx = sx.wells.reduce((q, w) => q + w.cum.oil + w.cum.water, 0), ix = sx.wells.reduce((q, w) => q + w.cum.inj, 0);
  const exx = Rx.cells.reduce((q, c) => q + Rx.poreVol[c] * Rx.ct * (Rx.P0 - sx.P[c]), 0), errX = (lx - ix - exx) / Math.max(1, lx);
  t.push({ name: "перетоки через ствол: у ГС 1000 м через неоднородный пласт отбор − закачка = упругий запас (±0.5 % отбора)",
           pass: Math.abs(errX) < 0.005, details: `невязка объёма ${(errX * 100).toFixed(3)} %, отбор ${(lx / 1e3).toFixed(0)} тыс. м³` });
  t.push({ name: "IMPES: отбор − закачка = упругий запас (±0.5 % отбора) при ЭЦН на пределе; год одним шагом = 365 суточным (±1 %)",
           pass: Math.abs(oA / oB - 1) < 0.01 && Math.abs(errV) < 0.005, details: `нефть ${(oA / 1e3).toFixed(0)} / ${(oB / 1e3).toFixed(0)} тыс. м³, невязка объёма ${(errV * 100).toFixed(3)} %` });
  return t;
}

// Эталонные варианты разработки (для оценки игрока): подобраны оптимизацией и рассчитаны этим же ядром в условиях объекта –
// его пласт и флюиды (вязкость нефти и воды, Swc/Sor, давление) и цены объекта по умолчанию; экономика пересчитывается по ценам игрока.
const REF = {
  1: { desc: "шахматная сетка через 320 м: 4 добывающие (4 ГС 690–1760 м) на ЭЦН и 12 нагнетательных со штуцером 8 мм; КНС 110 атм, давление сбора 13 атм; отключение 1 нерентабельной скважины; ежегодный подбор частоты и типоразмера ЭЦН", fund: "4 / 12", years: 20, npv: 11669.1,
    // по годам: нефть, т; вода, м³; закачка, м³; кВт·ч ЭЦН; кВт·ч КНС; скважино-годы (в долях обслуживания добывающей)
    s: [[498499,290804,837413,12246408,3631005,10],[339065,725606,1101937,22558461,4848040,10],[221686,884268,1141597,22961656,5051090,10],[162283,965641,1153921,23208526,5104667,10],[125643,1015398,1161150,23355984,5136261,10],[100749,1049031,1165901,23454282,5157080,10],[82788,1073209,1169252,23524288,5171788,10],[69287,1091338,1171727,23576423,5182667,10],[58822,1105366,1173621,23616554,5190993,10],[50522,1116474,1175111,23648209,5197548,10],[43815,1125439,1176307,23673679,5202812,10],[38306,1132798,1177283,23694527,5207110,10],[33036,1082993,1126287,18243341,5004279,10],[28807,1090435,1123899,18266152,4970879,10],[25286,1095034,1124420,18277737,4973230,10],[22426,1098748,1124826,18287231,4975059,10],[20154,1101712,1125153,18294814,4976515,10],[18297,1104154,1125444,18300978,4977791,10],[16422,1027310,1054957,12412761,4669759,10],[16713,1093584,1104852,18405589,4884665,9.25]],
    // капитальные затраты по годам — в единицах параметров (см. CAPEX; lost_t — недобор нефти при ГДИС, т)
    c: [{"drill_cost":19.11,"esp_cost":9.5236},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}] },
  // политика купола (в POLICIES не входит: у купола нет объектов по сиду): {"s":8,"ox":8,"oy":8,"pat":1,"phase":2,"thrC":1.01,"convN":3,"prodMode":"esp","f0":55,"chokeP":10,"dInj":12,"kns":130,"pg":6,"qMin":40,"compl":"vf","xf":40,"fracK":60,"hsL":1000,"hsAz":90,"mgN":12,"shut":1,"hMin":0.5,"thrS":4,"stimYear":2,"pre":0,"injCompl":1}
  2: { desc: "сейсмика + сетка «две добывающие на одну нагнетательную» через 320 м: 8 добывающих (8 ВС + ГРП 40 м) на ЭЦН и 4 нагнетательные со штуцером 12 мм; КНС 130 атм, давление сбора 6 атм; нагнетательные – с тем же заканчиванием, что и добывающие; отключение 8 нерентабельных скважин; ежегодный подбор частоты и типоразмера ЭЦН", fund: "8 / 4", years: 20, npv: 4104.5,
    // по годам: нефть, т; вода, м³; закачка, м³; кВт·ч ЭЦН; кВт·ч КНС; скважино-годы (в долях обслуживания добывающей)
    s: [[295815,375073,674679,24474939,3519610,10],[187575,728082,931422,32982332,4837267,10],[119523,882878,1019039,33622049,5317467,10],[81223,958980,1052347,33898008,5496351,10],[58255,1003547,1070339,34089059,5592394,10],[47473,956176,1011054,29244179,5303512,9.25],[36552,898115,946658,25570820,4964148,8.5],[27276,796558,838376,19269670,4402418,7.75],[17748,587550,620162,12754831,3257899,7],[17855,540364,579754,10434995,3031011,6.25],[10104,93083,134983,2579190,712294,4.75],[8195,96509,105002,2589953,548820,4.75],[6683,100072,107019,2601175,559369,4.75],[5447,102942,108614,2610072,567716,4.75],[4438,105248,109878,2617134,574326,4.75],[3617,107100,110880,2622751,579565,4.75],[2950,108587,111669,2627230,583692,4.75],[2410,109794,112282,2630837,586898,4.75],[0,0,53674,0,281920,4],[0,0,7542,0,39634,4]],
    // капитальные затраты по годам — в единицах параметров (см. CAPEX; lost_t — недобор нефти при ГДИС, т)
    c: [{"seis_cost":1,"drill_cost":12,"frac_cost":9,"esp_cost":16.1775},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}] },
  bv8: { desc: "сейсмика + шахматная сетка через 400 м: 4 добывающие (4 ВС) на ЭЦН и 4 нагнетательные со штуцером 14 мм; КНС 100 атм, давление сбора 5 атм; отключение 4 нерентабельных скважин; ежегодный подбор частоты и типоразмера ЭЦН", fund: "4 / 4", years: 20, npv: 8227.6,
    // по годам: нефть, т; вода, м³; закачка, м³; кВт·ч ЭЦН; кВт·ч КНС; скважино-годы (в долях обслуживания добывающей)
    s: [[506680,311527,726661,20937201,2935208,6],[221661,480294,730601,16605693,2935208,6],[138742,573381,730925,16908993,2935208,6],[93883,624059,731015,17077151,2935208,6],[66516,655015,730936,17181281,2935208,6],[48631,675144,730734,17249689,2935208,6],[36412,688951,730623,17296955,2935208,6],[27789,698648,730478,17330380,2935208,6],[21558,705635,730347,17354597,2935208,6],[16960,710804,730257,17372588,2935208,6],[12919,702493,722351,13454898,2935208,6],[6693,556237,658663,6906020,2935208,6],[4893,553964,622429,3788470,2935208,4.5],[2114,202830,245920,1204770,1296497,3.75],[1543,181193,182547,1190312,733802,3.75],[0,0,81787,0,467117,3],[0,0,1672,0,6724,3],[0,0,1672,0,6724,3],[0,0,1672,0,6724,3],[0,0,1672,0,6724,3]],
    // капитальные затраты по годам — в единицах параметров (см. CAPEX; lost_t — недобор нефти при ГДИС, т)
    c: [{"seis_cost":1,"drill_cost":8,"esp_cost":9.5236},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}] },
  av12: { desc: "сейсмика + рядная система через 600 м: 1 добывающая (1 ГС + МГРП 5×40 м) на ЭЦН и 1 нагнетательная со штуцером 12 мм; КНС 100 атм, давление сбора 5 атм; нагнетательные – с тем же заканчиванием, что и добывающие; отключение 1 нерентабельной скважины; ежегодный подбор частоты и типоразмера ЭЦН", fund: "1 / 1", years: 20, npv: 1120.6,
    // по годам: нефть, т; вода, м³; закачка, м³; кВт·ч ЭЦН; кВт·ч КНС; скважино-годы (в долях обслуживания добывающей)
    s: [[74495,106462,164682,2305413,684604,1.5],[52498,132596,182518,2360714,733802,1.5],[36143,148328,182569,2388201,733802,1.5],[26565,156385,182696,2402350,733802,1.5],[20361,162145,182819,2412828,733802,1.5],[15932,166407,182797,2420695,733802,1.5],[12617,169690,182819,2426804,733802,1.5],[10074,172265,182843,2431618,733802,1.5],[8083,174283,182807,2435406,733802,1.5],[6507,175830,182731,2438322,733802,1.5],[5261,177060,182673,2440644,733802,1.5],[4276,178040,182630,2442498,733802,1.5],[3499,178820,182598,2443975,733802,1.5],[2886,179440,182574,2445150,733802,1.5],[2246,174625,181607,1735179,733802,1.5],[1286,151198,177307,1128448,733802,1.5],[0,0,75321,0,333813,0.75],[0,0,3396,0,13764,0.75],[0,0,209,0,847,0.75],[0,0,67,0,269,0.75]],
    // капитальные затраты по годам — в единицах параметров (см. CAPEX; lost_t — недобор нефти при ГДИС, т)
    c: [{"seis_cost":1,"drill_cost":3.4,"frac_cost":6.8,"esp_cost":2.3809},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}] },
  yuv1: { desc: "сейсмика + шахматная сетка через 400 м: 4 добывающие (4 ВС + ГРП 40 м) на ЭЦН и 3 нагнетательные со штуцером 16 мм; КНС 100 атм, давление сбора 5 атм; 4 перевода обводнённых добывающих в ППД; ежегодный подбор частоты и типоразмера ЭЦН", fund: "4 / 3", years: 20, npv: 1316.0,
    // по годам: нефть, т; вода, м³; закачка, м³; кВт·ч ЭЦН; кВт·ч КНС; скважино-годы (в долях обслуживания добывающей)
    s: [[166468,162862,264513,10168160,1063089,5.5],[64809,268694,337810,12015949,1357950,5.5],[39059,306698,350254,12825361,1408226,5.5],[53162,327055,421061,9300830,1728131,5],[25008,283860,358405,8460041,1470765,4.5],[14417,266387,326324,3469533,1357014,4],[9644,337376,343642,6057148,1380833,4],[0,0,38307,0,198020,3.5],[0,0,75,0,276,3.5],[0,0,75,0,276,3.5],[0,0,75,0,276,3.5],[0,0,75,0,276,3.5],[0,0,75,0,276,3.5],[0,0,75,0,276,3.5],[0,0,75,0,276,3.5],[0,0,75,0,276,3.5],[0,0,75,0,276,3.5],[0,0,75,0,276,3.5],[0,0,75,0,276,3.5],[0,0,75,0,276,3.5]],
    // капитальные затраты по годам — в единицах параметров (см. CAPEX; lost_t — недобор нефти при ГДИС, т)
    c: [{"seis_cost":1,"drill_cost":7,"frac_cost":4,"esp_cost":9.5236},{},{},{"conv_cost":1},{"conv_cost":1},{"conv_cost":1},{},{"conv_cost":1},{},{},{},{},{},{},{},{},{},{},{},{}] },
  yuk1011: { desc: "сейсмика + шахматная сетка через 320 м: 6 добывающих (2 ВС, 4 ВС + ГРП 40 м) на ЭЦН и 5 нагнетательных со штуцером 28 мм; КНС 110 атм, давление сбора 5 атм; нагнетательные – с тем же заканчиванием, что и добывающие; отключение 6 нерентабельных скважин; ежегодный подбор частоты и типоразмера ЭЦН", fund: "6 / 5", years: 20, npv: 4975.6,
    // по годам: нефть, т; вода, м³; закачка, м³; кВт·ч ЭЦН; кВт·ч КНС; скважино-годы (в долях обслуживания добывающей)
    s: [[491206,478823,896856,30388897,4013692,8.5],[143518,782548,913503,29358539,4035911,8.5],[66572,847294,913566,28682585,4035911,8.5],[38247,812757,881499,22977475,4035911,7.75],[64545,612202,777354,16976420,3903997,6.25],[31483,509613,596392,9030438,2937269,5.5],[11043,598112,605557,10537712,2677692,5.5],[0,0,156890,0,852823,4],[0,0,5741,0,25611,4],[0,0,1947,0,8612,4],[0,0,1947,0,8612,4],[0,0,1947,0,8612,4],[0,0,1947,0,8612,4],[0,0,1947,0,8612,4],[0,0,1947,0,8612,4],[0,0,1947,0,8612,4],[0,0,1947,0,8612,4],[0,0,1947,0,8612,4],[0,0,1947,0,8612,4],[0,0,1947,0,8612,4]],
    // капитальные затраты по годам — в единицах параметров (см. CAPEX; lost_t — недобор нефти при ГДИС, т)
    c: [{"seis_cost":1,"drill_cost":11,"frac_cost":8,"esp_cost":14.2854},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}] },
  ach: { desc: "сейсмика + шахматная сетка через 280 м: 7 добывающих и 6 будущих нагнетательных (сначала 1 год работают на нефть) – все ГС 1000 м с МГРП 8×40 м на ЭЦН; штуцер 15 мм, КНС 120 атм, давление сбора 5 атм; ежегодный подбор частоты и типоразмера ЭЦН; политика группы, применённая к участку ×5 (ТРИЗ, льгота по НДПИ), лучший из вариантов расстановки", fund: "7 / 6", years: 20, npv: 6076.0,
    // по годам: нефть, т; вода, м³; закачка, м³; кВт·ч ЭЦН; кВт·ч КНС; скважино-годы (в долях обслуживания добывающей)
    s: [[232787,208286,0,17313604,0,13],[30346,36640,242870,3630564,2869592,9.5],[24916,18107,93311,2188510,955186,9],[24086,16100,49770,2044033,240395,9],[23658,14868,39187,1959593,189152,9],[23388,14052,35557,1904290,171592,9],[23216,13497,33972,1867324,163929,9],[23106,13125,33200,1842802,160196,9],[23031,12890,32827,1827008,158395,9],[22976,12759,32685,1817516,157704,9],[22922,12721,32688,1812852,157718,9],[22863,12761,32790,1811858,158210,9],[22793,12867,32962,1813708,159039,9],[22713,13027,33184,1817738,160110,9],[22622,13231,33443,1823478,161358,9],[22517,13477,33729,1830671,162737,9],[22398,13761,34035,1839024,164213,9],[22266,14075,34355,1848306,165759,9],[22122,14416,34686,1858313,167356,9],[21967,14780,35024,1868928,168988,9]],
    // капитальные затраты по годам — в единицах параметров (см. CAPEX; lost_t — недобор нефти при ГДИС, т)
    c: [{"seis_cost":1,"drill_cost":21.88,"frac_cost":67.6,"esp_cost":30.9518},{"conv_cost":7},{"conv_cost":1},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}] },
  bb: { desc: "сейсмика + сетка «две добывающие на одну нагнетательную» через 360 м: 4 добывающие (4 ВС) на ЭЦН и 3 нагнетательные со штуцером 24 мм; КНС 130 атм, давление сбора 8 атм; отключение 3 нерентабельных скважин; ежегодный подбор частоты и типоразмера ЭЦН", fund: "4 / 3", years: 20, npv: 1888.1,
    // по годам: нефть, т; вода, м³; закачка, м³; кВт·ч ЭЦН; кВт·ч КНС; скважино-годы (в долях обслуживания добывающей)
    s: [[116911,308465,425581,3784357,2209472,5.5],[71666,476941,543266,6965865,2836032,5.5],[47854,499423,548276,7427770,2861828,5.5],[36555,508328,548141,6073152,2861828,5.5],[29644,515198,547924,6081462,2861828,5.5],[24780,518855,547580,5847215,2861828,5.5],[21290,525334,547757,7748198,2861828,5.5],[18447,525507,547441,5853990,2861828,5.5],[16288,530638,547669,7754982,2861828,5.5],[14418,529908,547383,5858251,2861828,5.5],[10725,352967,399481,3469258,2116621,4.75],[11484,335107,362247,1972909,1907885,4],[10829,363311,365152,5947116,1907885,4],[9325,354709,365095,2801044,1907885,4],[8346,355754,365079,2804723,1907885,4],[8427,323005,356035,1551173,1885589,3.25],[8762,374081,365102,6073616,1907246,3.25],[7335,357085,365106,2617348,1907885,3.25],[6515,357926,365086,2618321,1907885,3.25],[5844,358621,365072,2619116,1907885,3.25]],
    // капитальные затраты по годам — в единицах параметров (см. CAPEX; lost_t — недобор нефти при ГДИС, т)
    c: [{"seis_cost":1,"drill_cost":7,"esp_cost":4.2441},{"esp_cost":4.7015},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{"esp_cost":2.3809},{},{},{}] }
};

// ---------- Оценка разработки: клон, годовые ряды, ЧДД, баллы ----------
// копия состояния (для прогноза на 10 лет вперёд без изменения игры)
function cloneSim(sim) {
  const c = createSim(sim.r, sim.params);
  c.P.set(sim.P); c.Sw.set(sim.Sw);
  const cw = (w) => ({ ...w, cum: { ...w.cum }, eq: null, perf: w.perf.map((pf) => ({ ...pf })), pq: w.pq && w.pq.slice(), pqw: w.pqw && w.pqw.slice(), frac: w.frac && { ...w.frac }, mgrp: w.mgrp && { ...w.mgrp, stages: w.mgrp.stages.map((q) => q.slice()) }, traj: w.traj && w.traj.map((q) => q.slice()) });
  c.wells = sim.wells.map(cw);
  c.drill = { rigs: sim.drill.rigs, on: null, queue: sim.drill.queue.map((j) => ({ ...j, well: cw(j.well) })), active: sim.drill.active.map((j) => ({ ...j, well: cw(j.well) })) };
  c.field = { ...sim.field }; c.t = sim.t; c.cumProdM3 = sim.cumProdM3;
  c.history = { days: sim.history.days.slice() };
  const e = sim.economy, d = c.economy;
  d.u = { ...e.u }; d.byWell = Object.fromEntries(Object.entries(e.byWell).map(([k, v]) => [k, { ...v }])); d.cu = { ...e.cu }; d.cuDrill = { ...e.cuDrill }; d.drills = e.drills.slice(); d.refresh();
  c._uE.set(sim._uE); c._uN.set(sim._uN); c._Te.set(sim._Te); c._Tn.set(sim._Tn);
  c._fluxValid = sim._fluxValid; c._lastSolveT = sim._lastSolveT; c._solveEnd = sim._solveEnd; // продолжение идентично оригиналу
  return c;
}
// годовые показатели по истории: нефть (т), вода (м³), закачка (м³), денежный поток (руб), накопленная нефть (т)
function yearlyFromSim(sim, params) {
  const h = sim.history.days, out = { oil_t: [], water_m3: [], inj_m3: [], cf: [], cumOil_t: [], liq_m3: [] };
  let cum = 0;
  for (let n = 1; n * 365 <= h.length; n++) {
    let oil = 0, wat = 0, inj = 0;
    for (let d = (n - 1) * 365; d < n * 365; d++) for (const w of h[d].wells) { if (w.prod) { oil += w.qo; wat += w.qw; } else inj += w.q; }
    const m0 = n === 1 ? params.init_money : h[(n - 1) * 365 - 1].money, m1 = h[n * 365 - 1].money;
    cum += oil * RHO_OIL;
    out.oil_t.push(oil * RHO_OIL); out.water_m3.push(wat); out.inj_m3.push(inj); out.liq_m3.push(oil + wat); out.cf.push(m1 - m0); out.cumOil_t.push(cum);
  }
  return out;
}
// годовые показатели эталона при экономических параметрах игрока
function refYearly(level, params) {
  const R_ = typeof level === "object" ? level : REF[level], out = { oil_t: [], water_m3: [], inj_m3: [], cf: [], cumOil_t: [], liq_m3: [], capex: [], parts: [] };
  let cum = 0;
  // по годам: нефть, т; вода, м³; закачка, м³; кВт·ч ЭЦН; кВт·ч КНС; скважино-годы (в долях обслуживания добывающей);
  // капзатраты – в единицах параметров (см. CAPEX)
  R_.s.forEach(([oil, wat, inj, kwhE, kwhK, wy], n) => {
    const liq = oil / RHO_OIL + wat, f = flowOf({ oil_t: oil, liq, inj, kwhE, kwhK, wy }, R_.c[n] || {}, params);
    cum += oil; out.capex.push(f.capex); out.parts.push(f);
    out.oil_t.push(oil); out.water_m3.push(wat); out.inj_m3.push(inj); out.cf.push(f.cf); out.cumOil_t.push(cum); out.liq_m3.push(liq);
  });
  return out;
}
// ---------- Политика эталона (найдена оптимизатором для канонического объекта группы) ----------
// Параметры: сетка s (ячеек), смещение ox/oy, схема pat (0 – шахматная, 1 – две добывающие на нагнетательную, 2 – рядная),
// фаза, мин. доля нефтенасыщенной толщины hMin; заканчивание compl (v, vf – ВС + ГРП при k < fracK, hs, hsf – ГС + МГРП)
// с xf, hsL, hsAz, mgN; ЭЦН сразу (prodMode esp) с частотой f0, штуцеры chokeP/dInj, КНС kns, сбор pg; ежегодно: перевод
// convN добывающих с обводнённостью > thrC в ППД, ЭЦН вместо заглохшего фонтана, замена перегруженного насоса и подбор
// частоты по чистому доходу, ОПЗ после ГДИС при скине > thrS на году stimYear, отключение нерентабельных (shut).
// pre – годы отработки будущих нагнетательных на нефть (0 – сразу под закачку): они бурятся добывающими и в начале года
// pre переводятся под закачку; injCompl – нагнетательные с тем же заканчиванием, что и добывающие (ГС/МГРП, ГРП).
const POLICIES = {
  bv8: {"s":10,"ox":3,"oy":5,"pat":0,"phase":1,"thrC":1.01,"convN":3,"prodMode":"esp","f0":60,"chokeP":10,"dInj":14,"kns":100,"pg":5,"qMin":10,"compl":"v","xf":120,"fracK":1000,"hsL":1000,"hsAz":90,"mgN":8,"shut":0,"hMin":0.5,"thrS":99,"stimYear":3,"pre":0,"injCompl":0},
  av12: {"s":15,"ox":2,"oy":5,"pat":2,"phase":1,"thrC":0.8,"convN":0,"prodMode":"esp","f0":45,"chokeP":11,"dInj":12,"kns":100,"pg":5,"qMin":40,"compl":"hsf","xf":40,"fracK":30,"hsL":1000,"hsAz":90,"mgN":5,"shut":0,"hMin":0.4,"thrS":4,"stimYear":2,"pre":0,"injCompl":1},
  yuv1: {"s":10,"ox":8,"oy":4,"pat":0,"phase":0,"thrC":0.96,"convN":1,"prodMode":"esp","f0":50,"chokeP":17,"dInj":16,"kns":100,"pg":5,"qMin":40,"compl":"vf","xf":40,"fracK":1000,"hsL":1500,"hsAz":135,"mgN":8,"shut":0,"hMin":0.7,"thrS":2,"stimYear":3,"pre":0,"injCompl":0},
  yuk1011: {"s":8,"ox":7,"oy":3,"pat":0,"phase":1,"thrC":0.8,"convN":0,"prodMode":"esp","f0":60,"chokeP":17,"dInj":28,"kns":110,"pg":5,"qMin":40,"compl":"vf","xf":40,"fracK":30,"hsL":1500,"hsAz":135,"mgN":8,"shut":1,"hMin":0.7,"thrS":4,"stimYear":3,"pre":0,"injCompl":1},
  ach: {"s":7,"ox":5,"oy":5,"pat":0,"phase":2,"thrC":0.93,"convN":1,"prodMode":"esp","f0":50,"chokeP":15,"dInj":30,"kns":120,"pg":5,"qMin":20,"compl":"hsf","xf":40,"fracK":30,"hsL":1000,"hsAz":135,"mgN":8,"shut":0,"hMin":0.6,"thrS":2,"stimYear":3,"pre":1,"injCompl":0},
  bb: {"s":9,"ox":3,"oy":2,"pat":1,"phase":0,"thrC":1.01,"convN":3,"prodMode":"esp","f0":50,"chokeP":10,"dInj":24,"kns":130,"pg":8,"qMin":10,"compl":"v","xf":80,"fracK":60,"hsL":1000,"hsAz":135,"mgN":12,"shut":1,"hMin":0.6,"thrS":4,"stimYear":3,"pre":0,"injCompl":0},
};
// Исполнение политики: генератор (кусками по ≈ 73 сут – для фонового расчёта без зависания интерфейса).
// Возвращает годовые ряды в натуральных единицах (как REF): s – [нефть т, вода м³, закачка м³, кВт·ч ЭЦН, кВт·ч КНС, скв.-лет], c – капзатраты.
function* policyRun(r, P, th, years = 20) {
  const PK = Object.keys(PUMPS), wellDay = (P.well_opex / 365) * (1 - WELL_OPEX_IDLE);
  const netOf = (w, e) => (1 - (w.fw || 0)) * e.q * RHO_OIL * P.price_oil - e.q * P.lift_cost - e.kW * 24 * P.elec_cost;
  const pickPump = (sim, w) => {
    let best = PUMP_DEFAULT, bn = -1e18;
    for (const k of PK) { w.pump = k; w.mode = "esp"; w.freq = 50; const e = solveEquipment(sim, w); const net = netOf(w, e) - (PUMPS[k].cost * P.esp_cost) / 1000; if (net > bn) { bn = net; best = k; } }
    w.pump = best; return best;
  };
  const wl = [];
  const rfP = r.nx / BASE_N, sP = Math.max(1, Math.round(th.s * rfP)), oxP = Math.round(th.ox * rfP), oyP = Math.round(th.oy * rfP), limP = r.nx - 3;
  for (let b = 0, j = oyP; j < limP; j += sP, b++) for (let a = 0, i = oxP; i < limP; i += sP, a++) {
    const c = j * r.nx + i;
    if (!(r.hOil[c] >= th.hMin * r.h - 1e-9) || r.explore.some((e) => e.cell === c)) continue;
    const role = th.pat === 0 ? ((a + b + th.phase) % 2 === 0 ? "prod" : "inj") : th.pat === 1 ? ((a + b + th.phase) % 3 === 0 ? "inj" : "prod") : ((b + th.phase) % 2 === 0 ? "prod" : "inj");
    wl.push({ c, role });
  }
  if (wl.length < 2 || !wl.some((w) => w.role === "prod") || !wl.some((w) => w.role === "inj")) return null;
  const sim = createSim(r, P), eco = sim.economy;
  eco.charge(0, { seis_cost: 1 });
  sim.field.pKNS = th.kns; sim.field.pGather = th.pg;
  const installEsp = (w) => { const k = pickPump(sim, w); w.hasESP = true; w.freq = th.f0; eco.charge(sim.t, { esp_cost: PUMPS[k].cost }); };
  for (const x of wl) {
    if (sim.wells.some((o) => o.perf.some((pf) => pf.cell === x.c))) continue;
    const pre = x.role === "inj" && th.pre > 0, asProd = x.role === "prod" || pre;
    sim.addWell(x.c, asProd ? "prod" : "inj", asProd ? 150 : 325);
    const w = sim.wells[sim.wells.length - 1]; w.name = "W" + sim.wells.length; w._futureInj = pre;
    let units = CAPEX.vert();
    if (asProd || th.injCompl) {
      if (th.compl === "hs" || th.compl === "hsf") {
        const rr = sim.setCompletion(w, "hs", { L: th.hsL, az: th.hsAz });
        if (rr.ok) { units = CAPEX.hs(w.L); if (th.compl === "hsf" && r.k[x.c] < th.fracK) { const rf = sim.setCompletion(w, "mgrp", { n: th.mgN, xf: th.xf, az: (th.hsAz + 90) % 180 }); if (rf.ok) Object.assign(units, CAPEX.mgrp(w.mgrp.n, th.xf)); } }
        // az (ствол + 90°) – эталонные ряды REF найдены оптимизатором при поперечных трещинах; повторяем ту же геометрию
      } else if (th.compl === "vf" && r.k[x.c] < th.fracK) { const rr = sim.setCompletion(w, "frac", { xf: th.xf, az: th.hsAz }); if (rr.ok) Object.assign(units, CAPEX.frac(th.xf)); }
      eco.charge(0, units, true);
      if (asProd) { w.mode = "flow"; w.choke = th.chokeP; if (th.prodMode === "esp") installEsp(w); } else { w.mode = "choke"; w.choke = th.dInj; }
    } else { eco.charge(0, units, true); w.mode = "choke"; w.choke = th.dInj; }
  }
  // состав фонда после бурения (для описания эталона)
  const w0 = sim.wells.map((w) => ({ inj: w.type === "inj" || w._futureInj, pre: !!w._futureInj, kind: w.kind, L: w.L, frac: w.frac ? w.frac.xf : 0, mgrp: w.mgrp ? w.mgrp.n : 0 }));
  const s = [], c = [], diffU = (a, b2) => Object.fromEntries(Object.keys(a).map((k) => [k, a[k] - (b2[k] || 0)]));
  let pcu = {}, pu = Object.fromEntries(Object.keys(eco.u).map((k) => [k, 0]));
  for (let y = 0; y < years; y++) {
    if (y >= 1) {
      if (y === th.pre) for (const w of sim.wells) if (w._futureInj && w.type === "prod") { sim.convertWell(w); eco.charge(sim.t, { conv_cost: 1 }); w.mode = "choke"; w.choke = th.dInj; w.on = true; }
      let conv = 0;
      const prods = sim.wells.filter((w) => w.type === "prod" && w.on !== false).sort((a, b2) => b2.fw - a.fw);
      for (const w of prods) if (conv < th.convN && w.fw > th.thrC) { sim.convertWell(w); conv++; eco.charge(sim.t, { conv_cost: 1 }); w.mode = "choke"; w.choke = th.dInj; }
      for (const w of sim.wells) {
        if (w.type !== "prod" || w.on === false) continue;
        if (w.mode === "flow") { const e = solveEquipment(sim, w); if (e.dead || e.q < th.qMin) { w.mode = "esp"; installEsp(w); } }
        if (w.mode === "esp") {
          const e = solveEquipment(sim, w);
          if (e.load > 1.2) { const old = w.pump, f0 = w.freq; const nk = pickPump(sim, w); w.freq = f0; if (+nk > +old) eco.charge(sim.t, { esp_cost: PUMPS[nk].cost }); else w.pump = old; }
          let bf = w.freq, bn = -1e18;
          for (const f of [35, 40, 45, 50, 55, 60]) { w.freq = f; const q = solveEquipment(sim, w); const net = netOf(w, q); if (net > bn) { bn = net; bf = f; } }
          w.freq = bf;
        }
        if (y === th.stimYear - 1 && w.skin > th.thrS && !w.stimulated) { eco.charge(sim.t, { pta_cost: 1, lost_t: w.qo * RHO_OIL * 14 }); sim.stimulate(w); eco.charge(sim.t, { stim_cost: 1 }); }
        if (th.shut) { const e = solveEquipment(sim, w); if (netOf(w, e) < wellDay) w.on = false; }
        else if ((1 - w.fw) * RHO_OIL * P.price_oil - P.lift_cost < 0) w.on = false;
      }
      sim._fluxValid = false;
    }
    for (let q = 0; q < 5; q++) { advance(sim, 73); yield (y + (q + 1) / 5) / years; }
    const du = diffU(eco.u, pu), dcu = diffU(eco.cu, pcu);
    for (const k in dcu) if (Math.abs(dcu[k]) < 1e-12) delete dcu[k];
    s.push([Math.round(du.oil_t), Math.round(du.liq - du.oil_t / RHO_OIL), Math.round(du.inj), Math.round(du.kwhE), Math.round(du.kwhK), +du.wy.toFixed(3)]);
    c.push(Object.fromEntries(Object.entries(dcu).map(([k, v]) => [k, +v.toFixed(4)])));
    pu = { ...eco.u }; pcu = { ...eco.cu };
  }
  let npv = 0, cum = 0;
  s.forEach(([oil, wat, inj, kwhE, kwhK, wy], n) => { npv += flowOf({ oil_t: oil, liq: oil / RHO_OIL + wat, inj, kwhE, kwhK, wy }, c[n], P).cf / Math.pow(1.1, n + 1); cum += oil; });
  return { s, c, npv, kin: cum / (r.ooipM3 * RHO_OIL), th, nWells: sim.wells.length, w0,
           conv: sim.wells.filter((w) => w.converted && !w._futureInj).length, off: sim.wells.filter((w) => w.on === false).length, stim: sim.wells.filter((w) => w.stimulated).length };
}
// Эталон объекта по сиду: политика группы в нескольких вариантах сетки (шаг исходный, ×0,75, ×0,55; два положения); выбирается вариант с наибольшей суммой 0,5·ЧДД/ЧДД_max + 0,5·КИН/КИН_max. Детерминирован:
// одинаковый сид у всех игроков даёт один и тот же эталон. Цены – по умолчанию для объекта; по ценам игрока ряды
// пересчитываются так же, как у заранее найденных эталонов (refYearly).
function* seedRefRun(r, P, group) {
  // шаги сетки: исходный, ×0,75 и ×0,55 (не реже 7 ячеек), каждый – в исходном положении и со сдвигом на полшага
  const th0 = POLICIES[group], steps = [...new Set([th0.s, Math.max(7, Math.round(th0.s * 0.75)), Math.max(7, Math.round(th0.s * 0.55))])], variants = [];
  for (const st of steps) for (const sh of [0, Math.floor(st / 2)]) variants.push({ ...th0, s: st, ox: (th0.ox + sh) % st, oy: (th0.oy + sh) % st });
  if (r.nx > 70) variants.splice(4); // на плотной сетке расчёт долгий – меньше вариантов расстановки
  const res = [];
  for (let v = 0; v < variants.length; v++) {
    const g = policyRun(r, P, variants[v]);
    let st = g.next();
    while (!st.done) { yield (v + st.value) / variants.length; st = g.next(); }
    if (st.value) res.push(st.value);
  }
  // запасной вариант: если ни одна расстановка не дала пары «добывающая + нагнетательная» – плотная сетка и низкий порог толщины
  if (!res.length) for (const sh of [0, 3]) {
    const g = policyRun(r, P, { ...th0, s: 7, ox: (2 + sh) % 7, oy: (2 + sh) % 7, hMin: 0.4, pat: 0 });
    let st = g.next(); while (!st.done) { yield 0.99; st = g.next(); } if (st.value) res.push(st.value);
  }
  if (!res.length) return null;
  const nMax = Math.max(1, ...res.map((x) => x.npv)), kMax = Math.max(1e-9, ...res.map((x) => x.kin));
  const J = (x) => 0.5 * Math.max(0, x.npv) / nMax + 0.5 * x.kin / kMax;
  const best = res.reduce((a, b2) => (J(b2) > J(a) ? b2 : a));
  return { ...best, npv: best.npv / 1e6, desc: `политика эталона группы (сетка через ${best.th.s * 40} м, схема ${["шахматная", "«две добывающие на нагнетательную»", "рядная"][best.th.pat]}), применённая к этому объекту; лучший из ${res.length} вариантов расстановки` };
}
// выполнить генератор до конца (без кусков)
function runGen(g) { let st = g.next(); while (!st.done) st = g.next(); return st.value; }
// ключ эталона: учебный полигон – 1, объект уровня 2 – его id (базовый купол – 2)
function refKey(level, scenario) { return level === 1 ? 1 : scenario && REF[scenario] ? scenario : 2; }
function npvOf(cf, rate) { return cf.reduce((s, v, n) => s + v / Math.pow(1 + rate, n + 1), 0); }
// Баллы по показателю: эталон = 100; ниже – пропорционально (100·v/v_эт); выше – 100 + 40·ln(v/v_эт): превзойти можно,
// но отдача быстро убывает (+10 % к эталону ≈ 104, +25 % ≈ 109, вдвое ≈ 128); отрицательный результат = 0.
// Итог – среднее баллов за КИН и ЧДД.
const SCORE_BONUS = 40;
function scoreComponent(v, ref) {
  if (!(v > 0)) return 0;
  if (!(ref > 0)) return 100;
  const r = v / ref;
  return r <= 1 ? 100 * r : 100 + SCORE_BONUS * Math.log(r);
}
function scoreDevelopment(kin, kinRef, npv, npvRef) {
  const sK = scoreComponent(kin, kinRef), sN = scoreComponent(npv, npvRef), total = 0.5 * sK + 0.5 * sN;
  return { kin: sK, npv: sN, total, grade: total >= 100 ? "выше эталона" : total >= 90 ? "отлично" : total >= 75 ? "хорошо" : total >= 55 ? "удовлетворительно" : "неудовлетворительно" };
}

// ---------- Тесты оценки ----------
// ---------- Зоны влияния скважин (разбиение Вороного) ----------
// каждая активная ячейка относится к ближайшей скважине (по евклидову расстоянию до ячеек перфорации);
// ничья – за первой скважиной в порядке sim.wells. Оценка зон, не строгий материальный баланс.
function wellZones(sim) {
  const r = sim.r, nx = r.nx, out = sim.wells.map((w) => ({ well: w, pv: 0, oil0: 0, oil1: 0 }));
  if (!sim.wells.length) return out;
  for (const c of r.cells) {
    const cx = c % nx, cy = Math.floor(c / nx);
    let bi = 0, bd = Infinity;
    for (let wi = 0; wi < sim.wells.length; wi++) for (const pf of sim.wells[wi].perf) {
      const d = (cx - (pf.cell % nx)) ** 2 + (cy - Math.floor(pf.cell / nx)) ** 2;
      if (d < bd) { bd = d; bi = wi; }
    }
    const z = out[bi], pv = r.poreVol[c];
    z.pv += pv; z.oil0 += pv * (1 - r.Sw0[c]); z.oil1 += pv * (1 - sim.Sw[c]);
  }
  return out;
}

function reportTests() {
  const t = [];
  // эталоны: полигон (1), базовый купол (2) и объекты; ЧДД по рядам при ценах объекта = найденному оптимизатором,
  // КИН не выше предела вытеснения (1 − Swc − Sor)/(1 − Swc) с запасом на упругое расширение
  const keys = Object.keys(REF);
  t.push({ name: `эталоны: 20 лет у всех (${keys.length}: полигон, купол и объекты)`, pass: keys.every((k) => REF[k].s.length === 20) && SCENARIO_ORDER.every((id) => REF[id]) });
  for (const key of keys) {
    const scn = key === "1" || key === "2" ? null : key, P = { ...DEFAULT_PARAMS, ...DEFAULT_COSTS, ...(scn ? scenarioParams(scn) : {}) };
    const rr = key === "1" ? buildReservoir(P) : buildReservoir2(P), lim = (1 - rr.Swc - rr.Sor) / (1 - rr.Swc);
    const npv = npvOf(refYearly(key, P).cf, 0.1) / 1e6, want = REF[key].npv, kin = REF[key].s.reduce((q, x) => q + x[0], 0) / (rr.ooipM3 * RHO_OIL);
    const name = key === "1" ? "полигон" : key === "2" ? "купол" : SCENARIOS[key].short;
    t.push({ name: `эталон «${name}»: ЧДД по рядам = найденному (±1 %), КИН физичен`, pass: Math.abs(npv - want) / Math.max(1, Math.abs(want)) < 0.01 && kin > 0.05 && kin <= lim + 0.04,
             details: `ЧДД ${npv.toFixed(1)} млн руб (ожид. ${want.toFixed(1)}), КИН ${kin.toFixed(3)} (предел ${lim.toFixed(3)})` });
  }
  const sm = createSim(buildReservoir2(DEFAULT_PARAMS), DEFAULT_PARAMS);
  sm.addWell(sm.r.explore[2].cell, "prod", 150); sm.addWell(sm.r.explore[0].cell, "inj", 330);
  advance(sm, 200);
  const cl = cloneSim(sm); advance(sm, 100); advance(cl, 100);
  let dP = 0; for (let c = 0; c < sm.P.length; c++) dP = Math.max(dP, Math.abs(sm.P[c] - cl.P[c]));
  t.push({ name: "клон состояния: продолжение даёт тот же результат", pass: dP < 1e-6 && Math.abs(sm.economy.balance - cl.economy.balance) < 1, details: `max|ΔP|=${dP.toExponential(1)}` });
  const wz = wellZones(sm), sumPv = wz.reduce((a, z) => a + z.pv, 0), totPv = sm.r.cells.reduce((a, c) => a + sm.r.poreVol[c], 0), sumO0 = wz.reduce((a, z) => a + z.oil0, 0);
  // физическая выработка зоны может быть слегка отрицательной: неоднородная начальная Sw, скважина вымывает связанную воду
  const deplOk = wz.every((z) => z.oil0 <= 1e-6 || ((z.oil0 - z.oil1) / z.oil0 >= -0.25 && (z.oil0 - z.oil1) / z.oil0 <= 1));
  t.push({ name: "зоны скважин (Вороной): поровые объёмы зон покрывают пласт, начальные запасы зон = OOIP, выработка зон физична (−25…100 %)",
           pass: Math.abs(sumPv - totPv) / totPv < 1e-9 && Math.abs(sumO0 - sm.r.ooipM3) / sm.r.ooipM3 < 1e-9 && deplOk && wz.length === sm.wells.length && wz.every((z) => z.pv > 0),
           details: `Σ пор. объёма ${(sumPv / 1e6).toFixed(2)} млн м³ (${wz.length} зон), Σ запасов = OOIP ${(sm.r.ooipM3 * 0.86 / 1e6).toFixed(2)} млн т` });
  const ya = yearlyFromSim(cl, DEFAULT_PARAMS);
  const s1 = scoreDevelopment(0.4, 0.4, 100, 100), s2 = scoreDevelopment(0.5, 0.4, 130, 100), s3 = scoreDevelopment(0.2, 0.4, -5, 100), s4 = scoreDevelopment(0.382, 0.375, 103, 100);
  t.push({ name: "оценка: эталон = 100, ниже – пропорционально, выше – с убывающей отдачей (+25 % ≈ 109), убыточный вариант = 0 по ЧДД",
           pass: Math.abs(s1.total - 100) < 1e-9 && s2.total > 105 && s2.total < 112 && s4.total > 100 && s4.total < 102 && s3.npv === 0 && Math.abs(s3.kin - 50) < 1e-9 && Math.abs(s3.total - 25) < 1e-9 && ya.cf.length === 0,
           details: `эталон ${s1.total.toFixed(0)}, +25 % и +30 %: ${s2.total.toFixed(1)}, чуть выше эталона: ${s4.total.toFixed(1)}, хуже и убыточный: ${s3.total.toFixed(0)}` });
  return t;
}

// ---------- Тесты: объекты разработки (сценарии уровня 2) ----------
function scenarioTests() {
  const t = [];
  for (const id of SCENARIO_ORDER) {
    const sc = SCENARIOS[id], P = { ...DEFAULT_PARAMS, ...scenarioParams(id) }, r = buildReservoir2(P), d = [];
    // ФЕС: медиана k фона, пористость, толщина, флюиды и давление – по паспорту объекта
    const ks = [...r.k].sort((x, y) => x - y), kMed = ks[Math.floor(ks.length / 2)];
    const okK = kMed > 0.75 * sc.k.med && kMed < 1.35 * sc.k.med && ks[0] >= sc.k.min - 1e-9;
    const okP = r.P0 === Math.round(sc.pGrad * sc.depth) && r.pMaxInj > r.P0 + 30 && r.mu_o === sc.mu_o && r.h === sc.h && r.phi === sc.phi;
    // разведка: среди стартовых скважин есть чисто нефтяная и водяная; РИГИС совпадает с моделью
    const hs = r.explore.map((e) => r.hOil[e.cell]);
    let logOk = true;
    for (const e of r.explore) { const L = wellLog(r, e.cell); if (Math.abs(L.hOil - r.hOil[e.cell]) > 0.15 || Math.abs(L.hOil + L.hWater - r.h) > 0.15) logOk = false; }
    const okE = hs.some((x) => x >= r.h - 1e-6) && hs.some((x) => x <= 0) && logOk && r.ooipM3 > 1e5;
    // год работы: одна добывающая и одна нагнетательная – баланс воды
    const sm = createSim(r, P), oil = r.cells.filter((c) => r.hOil[c] >= r.h - 1e-6);
    sm.addWell(oil[Math.floor(oil.length * 0.3)], "prod", Math.max(20, r.P0 - 80)); sm.addWell(oil[Math.floor(oil.length * 0.7)], "inj", r.P0 + 25);
    advance(sm, 365);
    let dW = 0; for (const c of r.cells) dW += r.poreVol[c] * (sm.Sw[c] - r.Sw0[c]);
    const inj = sm.wells[1].cum.inj, errW = (inj - dW - sm.wells[0].cum.water) / Math.max(1, inj);
    d.push(`k медиана ${kMed.toFixed(1)} мД (паспорт ${sc.k.med}), P₀ ${r.P0} атм, OOIP ${(r.ooipM3 * RHO_OIL / 1e6).toFixed(2)} млн т, вода ${(errW * 100).toFixed(3)} %`);
    t.push({ name: `объект ${sc.short}: ФЕС и давление по паспорту, разведка вскрывает нефть и воду, РИГИС = модель, баланс воды за год < 0.1 %`,
             pass: okK && okP && okE && Math.abs(errW) < 1e-3 && sm.wells[0].cum.oil > 0, details: d.join("; ") });
  }
  // вязкая нефть (Бб, 22 сП) и мощные ЭЦН: насыщенность не проваливается ниже Swc, баланс воды и объёма сохраняется
  {
    const P = { ...DEFAULT_PARAMS, ...scenarioParams("bb") }, r = buildReservoir2(P), sm = createSim(r, P);
    for (let j = 6, bb = 0; j < 47; j += 8, bb++) for (let i = 2; i < 47; i += 8) {
      const c = j * r.nx + i; if (!(r.hOil[c] >= 0.9 * r.h)) continue;
      const ty = (bb + 1) % 2 === 0 ? "prod" : "inj"; sm.addWell(c, ty, ty === "prod" ? 60 : 200); const w = sm.wells[sm.wells.length - 1];
      if (ty === "prod") { w.mode = "esp"; w.hasESP = true; w.pump = "1000"; w.freq = 60; } else { w.mode = "choke"; w.choke = 30; }
    }
    sm.field.pKNS = 130; sm.field.pGather = 7; advance(sm, 365);
    let dW = 0, mn = 9; for (const c of r.cells) { dW += r.poreVol[c] * (sm.Sw[c] - r.Sw0[c]); mn = Math.min(mn, sm.Sw[c]); }
    const inj = sm.wells.reduce((a, w) => a + w.cum.inj, 0), wat = sm.wells.reduce((a, w) => a + w.cum.water, 0), liq = sm.wells.reduce((a, w) => a + w.cum.oil + w.cum.water, 0);
    const ex = r.cells.reduce((a, c) => a + r.poreVol[c] * r.ct * (r.P0 - sm.P[c]), 0), errW = (inj - wat - dW) / Math.max(1, inj), errV = (liq - inj - ex) / Math.max(1, liq);
    // Sw не ниже Swc (блок за запечатанным F-1 без скважин остаётся ровно при Swc); воду, «созданную» ограничителем, ловит баланс воды
    t.push({ name: "перенос: вязкая нефть (Бб) и мощные ЭЦН – Sw не ниже Swc, баланс воды < 0.1 %, объёма < 0.5 %", pass: mn >= r.Swc - 1e-9 && Math.abs(errW) < 1e-3 && Math.abs(errV) < 0.005,
             details: `Sw min ${mn.toFixed(3)} (Swc ${r.Swc}), вода ${(errW * 100).toFixed(3)} %, объём ${(errV * 100).toFixed(3)} %, скважин ${sm.wells.length}` });
  }
  const priceRatios = ["base", ...SCENARIO_ORDER].map((id) => scenarioParams(id).expl_cost / scenarioParams(id).drill_cost);
  t.push({ name: "цены: разведочная скважина с керном, ГИС и испытаниями стоит 4 эксплуатационные во всех объектах",
           pass: priceRatios.every((x) => x === 4), details: `${Math.min(...priceRatios)}–${Math.max(...priceRatios)}×` });
  // разные объекты – разная карта: структура отражена, разведочные скважины в других ячейках
  const cellsOf = (id) => buildReservoir2({ ...DEFAULT_PARAMS, ...scenarioParams(id) }).explore.map((e) => e.cell).join(",");
  t.push({ name: "объекты: структура отражается – у БВ8, АВ1, ЮВ1 и ЮК разные положения разведочных скважин", pass: new Set(["bv8", "av12", "yuv1", "yuk1011"].map(cellsOf)).size === 4 });
  // ТРИЗ ачимовки: участок ×5 по площади (ячейка ≈ 89 м при сетке 50) и льгота НДПИ (цена netback 28 000)
  const ra = buildReservoir2({ ...DEFAULT_PARAMS, ...scenarioParams("ach") });
  t.push({ name: "ТРИЗ ачимовки: участок ×5 по площади, цена с льготой НДПИ (28 000 руб/т), запасы пропорциональны площади",
           pass: ra.plot > 4400 && ra.plot < 4550 && ra.dx > 85 && scenarioParams("ach").price_oil === 28000 &&
                 scenarioParams("bv8").price_oil === undefined && Math.abs(ra.ooipM3 / (2 * 1e6 / 0.86) / 5 - 1) < 0.25,
           details: `участок ${(ra.plot / 1000).toFixed(2)} км, ячейка ${ra.dx.toFixed(1)} м, OOIP ${(ra.ooipM3 * 0.86 / 1e6).toFixed(2)} млн т` });
  return t;
}

// ---------- Тесты: размер расчётной сетки ----------
function gridTests() {
  const t = [], P0 = { ...DEFAULT_PARAMS, ...DEFAULT_COSTS };
  // геометрия объекта не зависит от сетки: запасы, ВНК, площадь нефтеносности и разведка сохраняются (±15 %)
  const base = buildReservoir2({ ...P0, ...scenarioParams("av12", 5), grid: 50 }), gs = {};
  for (const N of [25, 40, 80, 100]) gs[N] = buildReservoir2({ ...P0, ...scenarioParams("av12", 5), grid: N });
  const oilA = (r) => r.cells.filter((c) => r.hOil[c] > 0).length * r.dx * r.dx;
  let geoOk = true; const gd = [];
  for (const N of [25, 40, 80, 100]) {
    const r = gs[N], dO = r.ooipM3 / base.ooipM3 - 1, dA = oilA(r) / oilA(base) - 1, hs = r.explore.map((e) => r.hOil[e.cell]);
    if (Math.abs(dO) > 0.15 || Math.abs(dA) > 0.15 || Math.abs(r.owc - base.owc) > 3 || !(hs[0] > 0) || !hs.some((x) => x <= 0) || r.nx !== N) geoOk = false;
    gd.push(`${N}: OOIP ${(dO * 100).toFixed(1)} %, площадь ${(dA * 100).toFixed(1)} %`);
  }
  t.push({ name: "сетка: объект по сиду на сетках 25, 40, 80, 100 – запасы, площадь нефти и ВНК как на 50×50 (±15 %), разведка вскрывает нефть и воду", pass: geoOk, details: gd.join("; ") });
  // продуктивность не зависит от сетки: ВС (Писман с re = 0.2·Δ), ГС (Джоши), ГРП (Cinco-Ley), МГРП растёт со стадиями
  const uni = (N, kk) => { const r = buildReservoir2({ ...P0, ...scenarioParams("bv8", 0), grid: N }); r.k.fill(kk); r.Sw0.fill(r.Swc); r.tmE.fill(1); r.tmN.fill(1); r.poreVol.fill(r.dx * r.dx * r.h * r.phi); r.explore = []; return r; };
  const pss = (N, kk, setup) => { const r = uni(N, kk), sm = createSim(r, { ...P0, ...scenarioParams("bv8", 0), grid: N }); sm.addWell(Math.floor(N / 2) * N + Math.floor(N / 2), "prod", 150); const w = sm.wells[0]; w.skin = 0; if (setup) setup(sm, w); w.skin = 0; advance(sm, 200); return w.q / (sm.avgPressure() - w.pwf); };
  const rows = []; let prodOk = true;
  const lateral = (N, L, n) => (sm, w) => { w.cell = Math.floor(N / 2) * N + Math.floor(N * 0.35); w.perf = [{ cell: w.cell, f: 1 }]; sm.setCompletion(w, "hs", { L, az: 90 }); if (n) sm.setCompletion(w, "mgrp", { n, xf: 80 }); };
  let jv0 = 0;
  for (const N of [25, 50, 100]) {
    const jv = pss(N, 100), jh = pss(N, 100, lateral(N, 400, 0)), jf = pss(N, 20, (sm, w) => sm.setCompletion(w, "frac", { xf: 80, az: 90 })), jv20 = pss(N, 20);
    const jh1 = pss(N, 20, lateral(N, 1000, 0)), jm = pss(N, 20, lateral(N, 1000, 6));
    if (N === 50) jv0 = jv;
    const rH = jh / jv, rF = jf / jv20, rM = jm / jh1;
    if (!(rH > 2.7 && rH < 3.75 && Math.abs(rF / fracCellFactor(20, 80, 2).ratio - 1) < 0.12 && rM > 1.1 && rM < 1.5)) prodOk = false;
    rows.push(`${N}: ВС ${jv.toFixed(2)}, ГС/ВС ${rH.toFixed(2)}, ГРП ${rF.toFixed(2)}, МГРП/ГС ${rM.toFixed(2)}`);
  }
  t.push({ name: "сетка: продуктивность ВС одинакова на сетках 25, 50, 100, ГС в границах Джоши, ГРП по Cinco-Ley ±12 %, МГРП выше ГС", pass: prodOk && Math.abs(pss(25, 100) / jv0 - 1) < 0.02 && Math.abs(pss(100, 100) / jv0 - 1) < 0.02, details: rows.join("; ") });
  // балансы на крупной и средней сетке: год с ГС, ГРП и нагнетательной
  const bal = [];
  let balOk = true;
  for (const N of [25, 40]) {
    const Pg = { ...P0, ...scenarioParams("yuv1", 3), grid: N }, r = buildReservoir2(Pg), sm = createSim(r, Pg), oil = r.cells.filter((c) => r.hOil[c] >= r.h * r.thick[c] - 1e-6);
    sm.addWell(oil[Math.floor(oil.length * 0.3)], "prod", Math.max(20, r.P0 - 80)); sm.addWell(oil[Math.floor(oil.length * 0.5)], "prod", Math.max(20, r.P0 - 80)); sm.addWell(oil[Math.floor(oil.length * 0.7)], "inj", r.P0 + 25);
    sm.setCompletion(sm.wells[0], "hs", { L: 600, az: 45 }); sm.setCompletion(sm.wells[1], "frac", { xf: 80, az: 0 }); advance(sm, 365);
    let dW = 0; for (const c of r.cells) dW += r.poreVol[c] * (sm.Sw[c] - r.Sw0[c]);
    const inj = sm.wells[2].cum.inj, wat = sm.wells[0].cum.water + sm.wells[1].cum.water, liq = sm.wells[0].cum.oil + sm.wells[1].cum.oil + wat;
    const ex = r.cells.reduce((q, c) => q + r.poreVol[c] * r.ct * (r.P0 - sm.P[c]), 0), eW = (inj - wat - dW) / Math.max(1, inj), eV = (liq - inj - ex) / Math.max(1, liq);
    if (!(Math.abs(eW) < 1e-3 && Math.abs(eV) < 0.01 && liq > 0)) balOk = false;
    bal.push(`${N}: вода ${(eW * 100).toFixed(3)} %, объём ${(eV * 100).toFixed(3)} %`);
  }
  t.push({ name: "сетка: на сетках 25 и 40 баланс воды за год < 0.1 %, объёма < 1 % (ГС, ГРП, закачка)", pass: balOk, details: bal.join("; ") });
  // расчётные настройки меняют решение предсказуемо: меньше Курант и точнее решатель дают тот же результат (±2 %), настройки по умолчанию – как раньше
  const run = (calc) => { const Pg = { ...P0, ...scenarioParams("bv8", 0), calc }, r = buildReservoir2(Pg), sm = createSim(r, Pg), oil = r.cells.filter((c) => r.hOil[c] >= r.h - 1e-6);
    sm.addWell(oil[Math.floor(oil.length * 0.4)], "prod", 100); sm.addWell(oil[Math.floor(oil.length * 0.7)], "inj", 240); advance(sm, 200); return { oil: sm.wells[0].cum.oil, steps: sm.t, it: sm.lastCG.iters }; };
  const a0 = run(undefined), a1 = run({ courant: 0.25, tol: 1e-8, dtMax: 1 }), a2 = run({ ...DEFAULT_CALC });
  t.push({ name: "расчёт: настройки по умолчанию дают прежний результат; Курант 0.25, точность 1e-8, шаг 1 сут – тот же результат (±2 %)", pass: a0.oil === a2.oil && Math.abs(a1.oil / a0.oil - 1) < 0.02, details: `нефть ${(a0.oil / 1e3).toFixed(1)} / ${(a1.oil / 1e3).toFixed(1)} тыс. м³` });
  return t;
}

// ---------- Тесты: объекты по сиду ----------
function seedTests() {
  const t = [], P0 = { ...DEFAULT_PARAMS, ...DEFAULT_COSTS };
  const build = (id, seed) => buildReservoir2({ ...P0, ...scenarioParams(id, seed) });
  const a1 = build("ach", 4821), a2 = build("ach", 4821), b1 = build("ach", 4822);
  const same = a1.k.every((v, c) => v === a2.k[c]) && a1.hOil.every((v, c) => v === a2.hOil[c]) && a1.explore.map((e) => e.cell).join() === a2.explore.map((e) => e.cell).join();
  const diff = a1.k.some((v, c) => v !== b1.k[c]) && a1.owc !== b1.owc;
  t.push({ name: "сид: одинаковый сид – тот же объект (k, толщины, ВНК, разведка), соседний сид – другой; сид 0 – канонический объект",
           pass: same && diff && SCENARIO_ORDER.every((id) => scenarioForSeed(id, 0) === SCENARIOS[id]) && build("bv8", 0).owc === buildReservoir2({ ...P0, ...scenarioParams("bv8") }).owc });
  const bad = [];
  for (const id of SCENARIO_ORDER) {
    const b = SCENARIOS[id];
    for (let sd = 1; sd <= 10; sd++) {
      const sc = scenarioForSeed(id, sd);
      if (!(sc.mu_o >= 0.69 * b.mu_o && sc.mu_o <= 1.51 * b.mu_o && sc.k.med >= 0.59 * b.k.med && sc.k.med <= 1.61 * b.k.med && Math.abs(sc.phi - b.phi) <= 0.0201 &&
            sc.h >= 0.79 * b.h && sc.h <= 1.26 * b.h && Math.abs(sc.depth - b.depth) <= 120 && sc.geo.faults.length <= 3 && sc.Swc > 0.1 && sc.Sor > 0.15)) bad.push(`${id}/${sd}`);
    }
  }
  t.push({ name: "сид: свойства в диапазонах группы (вязкость ×0,7–1,5, k ×0,6–1,6, Кп ±0,02, h ×0,8–1,25, глубина ±120 м, ≤ 3 разломов)", pass: !bad.length, details: bad.join(", ") || "60 объектов" });
  const det = [];
  let ok = true;
  for (const id of SCENARIO_ORDER) {
    const P = { ...P0, ...scenarioParams(id, 5) }, r = buildReservoir2(P), hs = r.explore.map((e) => r.hOil[e.cell]);
    let logOk = true;
    for (const e of r.explore) { const L = wellLog(r, e.cell); if (Math.abs(L.hOil - r.hOil[e.cell]) > 0.15 || Math.abs(L.hOil + L.hWater - r.h * r.thick[e.cell]) > 0.2) logOk = false; }
    const oilN = r.cells.filter((c) => r.hOil[c] > 0).length, sm = createSim(r, P), oil = r.cells.filter((c) => r.hOil[c] >= r.h * r.thick[c] - 1e-6);
    sm.addWell(oil[Math.floor(oil.length * 0.3)], "prod", Math.max(20, r.P0 - 80)); sm.addWell(oil[Math.floor(oil.length * 0.7)], "inj", r.P0 + 25); advance(sm, 365);
    let dW = 0; for (const c of r.cells) dW += r.poreVol[c] * (sm.Sw[c] - r.Sw0[c]);
    const inj = sm.wells[1].cum.inj, errW = (inj - dW - sm.wells[0].cum.water) / Math.max(1, inj);
    if (!(hs[0] > 0 && hs.some((x) => x <= 0) && logOk && oilN >= 450 && Math.abs(errW) < 1e-3 && sm.wells[0].cum.oil > 0)) ok = false;
    det.push(`${scenarioForSeed(id, 5).short}: нефть в ${oilN} яч., вода ${(errW * 100).toFixed(3)} %`);
  }
  t.push({ name: "сид 5 у всех групп: разведка вскрывает нефть (свод) и воду, РИГИС = модель с картой толщин, площадь нефтеносности ≥ 450 ячеек, баланс воды за год < 0.1 %", pass: ok, details: det.join("; ") });
  // исполнитель политики в ядре воспроизводит эталон, найденный оптимизатором (канонический АВ1)
  const Pa = { ...P0, ...scenarioParams("av12") }, x = runGen(policyRun(buildReservoir2(Pa), Pa, POLICIES.av12));
  t.push({ name: "эталон по политике: исполнитель в ядре воспроизводит найденный оптимизатором эталон (АВ1, ±0.5 %)", pass: Math.abs(x.npv / 1e6 / REF.av12.npv - 1) < 0.005,
           details: `${(x.npv / 1e6).toFixed(1)} против ${REF.av12.npv} млн руб` });
  return t;
}

// ---------- Тесты: типы заканчивания (ГС, ГРП, боковой ствол) ----------
function completionTests() {
  const t = [];
  const mk = () => createSim(buildReservoir(DEFAULT_PARAMS), DEFAULT_PARAMS);
  const cellAt = (sm, i, j) => j * sm.r.nx + i;
  // ГС против вертикальной в той же ячейке
  const a = mk(), c0 = cellAt(a, 20, 24);
  a.addWell(c0, "prod", 150); advance(a, 5); const qv = a.wells[0].q;
  const b = mk(); b.addWell(c0, "prod", 150); const rb = b.setCompletion(b.wells[0], "hs", { L: 400, dir: "E" }); advance(b, 5); const qh = b.wells[0].q;
  t.push({ name: "ГС 400 м: дебит заметно выше вертикальной скважины в той же точке", pass: rb.ok && b.wells[0].perf.length >= 8 && qh > 1.8 * qv, details: `ГС ${qh.toFixed(0)} против ВС ${qv.toFixed(0)} м³/сут, ячеек ${b.wells[0].perf.length}` });
  // ГРП на работающей скважине
  const g = mk(); g.addWell(c0, "prod", 150); advance(g, 60); const q0 = g.wells[0].q;
  const rg = g.setCompletion(g.wells[0], "frac", { xf: 80, dir: "E" }); advance(g, 30); const q1 = g.wells[0].q;
  t.push({ name: "ГРП на уже работавшей скважине (xf = 80 м): дебит растёт", pass: rg.ok && g.wells[0].kind === "frac" && q1 > 1.25 * q0, details: `${q0.toFixed(0)} → ${q1.toFixed(0)} м³/сут, ячеек ${g.wells[0].perf.length}` });
  const rg2 = g.setCompletion(g.wells[0], "frac", { xf: 80, dir: "E" });
  t.push({ name: "повторный ГРП и ЗБС на скважине с ГРП запрещены", pass: !rg2.ok });
  // боковой ствол: старый интервал изолирован
  const z = mk(); z.addWell(c0, "prod", 150); advance(z, 30);
  const rz = z.setCompletion(z.wells[0], "zbs", { L: 400, dir: "N", isolate: true });
  t.push({ name: "боковой ствол: старый интервал изолирован, новый участок вскрыт", pass: rz.ok && z.wells[0].perf[0].f === 0 && z.wells[0].perf.length > 4 && z.wells[0].kind === "zbs" });
  // обрезка по соседней скважине
  const o = mk(); o.addWell(cellAt(o, 24, 24), "inj", 330); o.addWell(c0, "prod", 150);
  const ro = o.setCompletion(o.wells[1], "hs", { L: 600, dir: "E" });
  const maxI = Math.max(...o.wells[1].perf.map((x) => x.cell % o.r.nx));
  t.push({ name: "боковой/горизонтальный ствол упирается в соседнюю скважину и обрезается", pass: ro.ok && maxI < 24, details: `дальняя ячейка i=${maxI}` });
  // год работы с ГС + ГРП + нагнетательной: балансы
  const m = mk();
  m.addWell(cellAt(m, 12, 24), "prod", 120); m.addWell(cellAt(m, 30, 22), "prod", 120); m.addWell(cellAt(m, 22, 28), "inj", 360);
  m.setCompletion(m.wells[0], "hs", { L: 400, dir: "E" }); advance(m, 100); m.setCompletion(m.wells[1], "frac", { xf: 80, dir: "N" }); advance(m, 265);
  let dW = 0; for (const c of m.r.cells) dW += m.r.poreVol[c] * (m.Sw[c] - m.r.Swc);
  const inj = m.wells[2].cum.inj, pw = m.wells[0].cum.water + m.wells[1].cum.water, errW = (inj - dW - pw) / Math.max(1, inj), mb = materialBalance(m);
  const moved = m.cumProdM3 + inj, errP = (mb.withdrawn - mb.expansion) / Math.max(1, moved); // чистый отбор близок к нулю, поэтому – от суммарного объёма отбора и закачки
  t.push({ name: "ГС + ГРП + нагнетательная: баланс воды < 0.1 %, материальный баланс < 0.5 % от объёма", pass: Math.abs(errW) < 1e-3 && Math.abs(errP) < 0.005, details: `вода ${(errW * 100).toFixed(3)} %, давление ${(errP * 100).toFixed(3)} % (объём ${(moved / 1e3).toFixed(0)} тыс. м³)` });
  // физичность: продуктивность в ПУР против аналитики (однородный пласт, одна скважина в центре квадрата 2×2 км)
  const uni = (kk) => { const rr = buildReservoir2(DEFAULT_PARAMS); rr.k.fill(kk); rr.Sw0.fill(rr.Swc); rr.tmE.fill(1); rr.tmN.fill(1); return rr; };
  const pss = (kk, setup) => { const sm = createSim(uni(kk), DEFAULT_PARAMS); sm.addWell(25 * sm.r.nx + 25, "prod", 150); const w = sm.wells[0]; if (setup) setup(sm, w); advance(sm, 200); return w.q / (sm.avgPressure() - w.pwf); };
  const A = 4e6, Bd = 0.5 * Math.log((4 * A) / (1.781 * 30.88 * 0.01)), Jan = (kk, s) => (2 * Math.PI * CONV_K * kk * 10) / (5 * (Bd + s));
  const jv = pss(100);
  t.push({ name: "физика: ВС в ПУР совпадает с формулой Дитца (±12 %)", pass: Math.abs(jv / Jan(100, 0) - 1) < 0.12, details: `модель ${jv.toFixed(2)}, Дитц ${Jan(100, 0).toFixed(2)} м³/сут/атм` });
  const jh = pss(100, (sm, w) => { w.cell = 25 * sm.r.nx + 20; w.perf = [{ cell: w.cell, f: 1 }]; sm.setCompletion(w, "hs", { L: 400, dir: "E" }); });
  t.push({ name: "физика: ГС 400 м – J/Jвс в диапазоне Джоши (kv/kh 0.1…1: 3.0–3.4, допуск ±10 %)", pass: jh / jv > 2.7 && jh / jv < 3.75, details: `модель ${(jh / jv).toFixed(2)}` });
  let fracOk = true; const fd = [];
  for (const kk of [20, 100, 500]) {
    const jvk = pss(kk), jf = pss(kk, (sm, w) => sm.setCompletion(w, "frac", { xf: 80, dir: "E" }));
    const target = fracCellFactor(kk, 80, 2).ratio, got = jf / jvk;
    if (Math.abs(got / target - 1) > 0.1) fracOk = false;
    fd.push(`k=${kk}: ${got.toFixed(2)} (аналит. ${target.toFixed(2)})`);
  }
  t.push({ name: "физика: ГРП xf = 80 м – J/Jвс по Cinco-Ley (±10 %), эффект падает с ростом k", pass: fracOk, details: fd.join("; ") });
  // независимость от направления: ствол и трещина под 30° и 45° к сетке дают ту же продуктивность, что вдоль оси
  const orient = [];
  let orOk = true;
  for (const az of [30, 45]) {
    const jhd = pss(100, (sm, w) => { w.cell = 25 * sm.r.nx + 21; w.perf = [{ cell: w.cell, f: 1 }]; sm.setCompletion(w, "hs", { L: 400, az }); });
    const jfd = pss(20, (sm, w) => sm.setCompletion(w, "frac", { xf: 80, az })), jfa = pss(20, (sm, w) => sm.setCompletion(w, "frac", { xf: 80, az: 90 })), jv20 = pss(20);
    if (Math.abs(jhd / jh - 1) > 0.1 || Math.abs(jfd / jfa - 1) > 0.1) orOk = false;
    orient.push(`${az}°: ГС ${(jhd / jv).toFixed(2)} (ось ${(jh / jv).toFixed(2)}), ГРП ${(jfd / jv20).toFixed(2)} (ось ${(jfa / jv20).toFixed(2)})`);
  }
  t.push({ name: "физика: продуктивность ГС и ГРП не зависит от направления относительно сетки (±10 %)", pass: orOk, details: orient.join("; ") });
  t.push({ name: "физика: при FCD → ∞ скин трещины → Пратс −ln(xf/2rw)", pass: Math.abs(fracSkin(1000, 80) + Math.log(80 / 0.2)) < 0.05 });
  // МГРП: ГС 1000 м, поперечные трещины xf = 80 м
  const hsAt = (sm, w, az = 90) => { w.cell = 25 * sm.r.nx + 13; w.perf = [{ cell: w.cell, f: 1 }]; sm.setCompletion(w, "hs", { L: 1000, az }); };
  const mg = {};
  for (const kk of [20, 100]) {
    const j0 = pss(kk, (sm, w) => hsAt(sm, w)), jn = (n, az = 90) => pss(kk, (sm, w) => { hsAt(sm, w, az); sm.setCompletion(w, "mgrp", { n, xf: 80 }); });
    mg[kk] = { j0, j3: jn(3), j6: jn(6), j12: jn(12), jv: pss(kk), jvf: pss(kk, (sm, w) => sm.setCompletion(w, "frac", { xf: 80, az: 90 })), j6d: jn(6, 60) };
  }
  const g20 = mg[20], g100 = mg[100], gain = (g) => g.j6 / g.j0;
  t.push({ name: "МГРП: продуктивность растёт с числом стадий, но с убывающей отдачей (интерференция трещин)",
           pass: g20.j3 > 1.1 * g20.j0 && g20.j6 > g20.j3 && g20.j12 > g20.j6 && (g20.j12 - g20.j6) / 6 < (g20.j3 - g20.j0) / 3,
           details: `k = 20 мД, J/J_ГС: 3 ст. ${(g20.j3 / g20.j0).toFixed(2)}, 6 ст. ${(g20.j6 / g20.j0).toFixed(2)}, 12 ст. ${(g20.j12 / g20.j0).toFixed(2)}` });
  t.push({ name: "МГРП: эффект сильнее в низкопроницаемом пласте; прирост от стадии меньше, чем от ГРП на вертикальной (скин стягивания)",
           pass: gain(g20) > gain(g100) && (g20.j6 - g20.j0) / 6 < g20.jvf - g20.jv && fracChokeSkin(100, 10) > 0,
           details: `6 стадий: ×${gain(g20).toFixed(2)} при 20 мД, ×${gain(g100).toFixed(2)} при 100 мД; стадия +${((g20.j6 - g20.j0) / 6).toFixed(2)}, ГРП на ВС +${(g20.jvf - g20.jv).toFixed(2)} м³/сут/атм; s_c(100 мД) = ${fracChokeSkin(100, 10).toFixed(2)}` });
  t.push({ name: "МГРП: продуктивность не зависит от направления ствола относительно сетки (±12 %)", pass: Math.abs(g20.j6d / g20.j6 - 1) < 0.12,
           details: `аз. 60°: ${g20.j6d.toFixed(2)}, аз. 90°: ${g20.j6.toFixed(2)} м³/сут/атм` });
  const mm = mk(); mm.addWell(cellAt(mm, 10, 20), "prod", 120); mm.addWell(cellAt(mm, 30, 32), "inj", 340);
  mm.setCompletion(mm.wells[0], "hs", { L: 1000, az: 90 }); const rm = mm.setCompletion(mm.wells[0], "mgrp", { n: 5, xf: 80 }), rm2 = mm.setCompletion(mm.wells[0], "mgrp", { n: 5, xf: 80 });
  advance(mm, 365);
  let dWm = 0; for (const c of mm.r.cells) dWm += mm.r.poreVol[c] * (mm.Sw[c] - mm.r.Swc);
  const errM = (mm.wells[1].cum.inj - dWm - mm.wells[0].cum.water) / Math.max(1, mm.wells[1].cum.inj);
  t.push({ name: "МГРП: 5 стадий на ГС, повторный МГРП запрещён, баланс воды за год < 0.1 %",
           pass: rm.ok && !rm2.ok && mm.wells[0].mgrp.n === 5 && mm.wells[0].mgrp.stages.length === 5 && Math.abs(errM) < 1e-3, details: `ячеек ${mm.wells[0].perf.length}, вода ${(errM * 100).toFixed(3)} %` });
  // трещина останавливается на разломе
  const fz = createSim(buildReservoir2(DEFAULT_PARAMS), DEFAULT_PARAMS), fr = fz.r;
  let fc = -1; for (let i = 1; i < 49 && fc < 0; i++) for (let j = 10; j < 40; j++) if (fr.tmE[j * fr.nx + i] === 0 && fr.active[j * fr.nx + i]) { fc = j * fr.nx + i; break; }
  fz.addWell(fc, "prod", 150); fz.setCompletion(fz.wells[0], "frac", { xf: 120, dir: "E" });
  t.push({ name: "ГРП: трещина не пересекает разлом (обрезается на нём)", pass: fz.wells[0].perf.every((pf) => pf.cell % fr.nx <= fc % fr.nx), details: `ячеек ${fz.wells[0].perf.length}` });
  const cl = cloneSim(m);
  t.push({ name: "клон сохраняет заканчивание скважин", pass: cl.wells[0].perf.length === m.wells[0].perf.length && cl.wells[1].kind === "frac" && cl.wells[1].perf !== m.wells[1].perf });
  // стресс: трещины по максимальному горизонтальному напряжению
  const s1 = createSim(buildReservoir2(DEFAULT_PARAMS), DEFAULT_PARAMS), saz1 = s1.r.stressAz;
  s1.addWell(cellAt(s1, 22, 22), "prod", 150);
  const rs1 = s1.setCompletion(s1.wells[0], "frac", { xf: 80 });
  const s1b = createSim(buildReservoir2(DEFAULT_PARAMS), DEFAULT_PARAMS);
  s1b.addWell(cellAt(s1b, 22, 22), "prod", 150); s1b.setCompletion(s1b.wells[0], "frac", { xf: 80, az: 45 });
  t.push({ name: "стресс: ГРП без явного азимута строится по SHmax, явный азимут сохраняется",
           pass: rs1.ok && s1.wells[0].frac.az === saz1 % 180 && s1b.wells[0].frac.az === 45, details: `SHmax ${saz1}°, трещина ${s1.wells[0].frac.az}°; с az=45 → 45°` });
  const s2 = createSim(buildReservoir2(DEFAULT_PARAMS), DEFAULT_PARAMS), saz2 = s2.r.stressAz;
  s2.addWell(cellAt(s2, 22, 22), "prod", 150);
  const rl = s2.setCompletion(s2.wells[0], "hs", { L: 800, az: saz2 % 180 }), nStem = s2.wells[0].perf.length;
  const rmL = s2.setCompletion(s2.wells[0], "mgrp", { n: 3, xf: 80 });
  const s3 = createSim(buildReservoir2(DEFAULT_PARAMS), DEFAULT_PARAMS);
  s3.addWell(cellAt(s3, 22, 22), "prod", 150);
  const rp = s3.setCompletion(s3.wells[0], "hs", { L: 800, az: (saz2 + 90) % 180 }), nStemP = s3.wells[0].perf.length;
  const rmP = s3.setCompletion(s3.wells[0], "mgrp", { n: 3, xf: 80 });
  t.push({ name: "стресс: ГС вдоль SHmax – продольные трещины (ячейки только ствола), поперёк SHmax – поперечные (вне ствола)",
           pass: rl.ok && rmL.ok && s2.wells[0].perf.length === nStem && rp.ok && rmP.ok && s3.wells[0].perf.length > nStemP,
           details: `SHmax ${saz2}°: вдоль ${nStem} → ${s2.wells[0].perf.length} ячеек, поперёк ${nStemP} → ${s3.wells[0].perf.length}` });
  const st = (g, s) => scenarioForSeed(g, s).stress;
  t.push({ name: "стресс: у сида свой азимут в ±15° от группы (БВ8 330°, Бб 50°), детерминирован",
           pass: Math.abs(st("bv8", 42) - 330) <= 15 && Math.abs(st("bb", 42) - 50) <= 15 && st("bv8", 42) === scenarioForSeed("bv8", 42).stress,
           details: `БВ8 сид 42: ${st("bv8", 42)}°, Бб сид 42: ${st("bb", 42)}°` });
  return t;
}

registerCore({
  setAccel, accelOn: () => !!ACCEL,
  VERSION: "0.13.0",
  DEFAULT_PARAMS, GRID, CONV_K,
  mulberry32, gauss, buildReservoir, isConnected,
  POLICIES, policyRun, seedRefRun, runGen, segCross, GRID_SIZES, DEFAULT_CALC, BASE_N, L2, SCENARIOS, SCENARIO_ORDER, scenOf, scenarioParams, scenarioForSeed, scenOfParams, SEED_MAX, hashSeed, l2Flip, buildReservoir2, wellLog, l2Top, l2Column, l2OilNet, l2Altitude,
  krw, kro, fw, lambdaT, wellIndex,
  createSim, buildFaceT, solvePressure, updateWellRates, advance, materialBalance,
  computeFaceFluxes, transportSubstep, cflLimit, simStats, estimatePathPV,
  dutyOf, Q_INJ_MAX, orderWell, cancelOrder, buyRig, drillStart, drillDays, SCORE_BONUS, SEIS_WELLS, createEconomy, flowOf, costOf, CAPEX, FRAC_MULT, DEFAULT_COSTS, WELL_OPEX_INJ, WELL_OPEX_IDLE, KNS_EFF, fracChokeSkin, RHO_OIL, gatherPressure, ATM_PA, solveEquipment, applyEquipment, wellG, HS_EFF, FRAC_EFF, FRAC_COND, fracSkin, fracCellFactor, espHeadM, chokeDpAtm, espPowerKW, espLoad, espEff, PUMPS, PUMP_DEFAULT, PUMP_NOMINALS, l2Skin, E1, pressureBuildup, interpretBuildup, buildupPres, buildupQuality, suggestWindow, buildSeismic, nearestSealFaultM,
  reservoirTests, relPermTests, pressureTests, wellTests,
  saturationTests, breakthroughTests, economyTests, level2Tests, level2bTests, equipmentTests, completionTests, scenarioTests, gridTests, seedTests, reportTests, wellZones, REF, refKey, cloneSim, yearlyFromSim, refYearly, npvOf, scoreDevelopment, level2bTests,
  runSelfTests() {
    return [...reservoirTests(), ...relPermTests(), ...pressureTests(), ...wellTests(),
            ...saturationTests(), ...breakthroughTests(), ...economyTests(), ...level2Tests(), ...level2bTests(), ...equipmentTests(), ...completionTests(), ...scenarioTests(), ...gridTests(), ...seedTests(), ...reportTests()];
  },
});
