# AGENTS.md — Oilgame

Браузерный симулятор добычи нефти. Учебный уровень реализма,
двухфазная (oil + water) задача, 2D сверху + динамические
графики показателей, Vanilla TypeScript + Canvas2D.
Подробный план — в `plan.md`.

> Этот файл — справочник по проекту для AI-агента и для
> разработчика. Он компактнее `plan.md` и ориентирован на
> практические вопросы: «куда положить код», «как назвать»,
> «что тестировать».

---

## 1. Назначение и рамка

- **Что это:** обучающая браузерная игра. Игрок расставляет
  добывающие и нагнетательные скважины, задаёт BHP,
  наблюдает за распространением фронта вытеснения, снимает
  показатели.
- **Текущее состояние (MVP + v2):** Phase 0–4 завершены + v2
  модель давления (superposition). Работает pure-симулятор:
  **steady-state superposition** радиальных решений + материальный
  баланс для дрейфа P_avg (заменили IMPES-CG с leaky-BC
  аквифером). Насыщенность — на сетке (upwind), фронт Бакли-
  Леверетта сохраняется. UI (MapView, ChartsPanel из 6 графиков,
  WellsList с BHP-sparkline'ами, TopBar, StatusBar).
  **202/202 unit/property/integration тестов + 1 e2e** — зелёные.
- **Чего это НЕ:** не инженерный симулятор уровня Eclipse/CMG.
  Упрощения — двухфазная (oil+water), изотермическая, `μ, ρ, B` —
  константы, без гравитации (на первом этапе), воронка депрессии
  мгновенная (steady-state, без transient).
- **Ключевые слова для контекста:** Darcy, superposition,
  FVM, TPFA, Corey, Buckley-Leverett, BHP, ОФП, waterflood,
  voidage replacement ratio, water cut, КИН (recovery factor),
  material balance, well interaction (linear system N×N),
  radius of influence (R_e).

---

## 2. Структура репозитория

Текущая фактическая раскладка: **60 TS-файлов в `src/`** (~7 860
строк) и **37 в `tests/`** (~4 220 строк).

```
src/
├── core/                # чистая доменная логика (без UI, без I/O)
│   ├── grid/            # Grid2D, Reservoir, Contour
│   ├── properties/      # Rock/Fluid, Corey, RelPerm, CapPressure
│   ├── physics/         # Transmissibility(+Map), DarcyFlux,
│   │                      PressureSolver (legacy), SaturationSolver,
│   │                      WellIndex, MaterialBalance,
│   │                      timestep/CFL
│   ├── pressure/        # Superposition (v2), MaterialBalanceDrift (v2)
│   ├── wells/           # Well, BHPControl (legacy), WellManager,
│   │                      RateSolver (v2)
│   ├── time/            # SimulationClock, TimeStepper (legacy),
│   │                      SuperpositionStepper (v2, активен)
│   ├── state/           # FieldState, History, EventLog
│   ├── economics/       # NPV, CashFlow (модули готовы, UI — Phase 6)
│   └── units.ts         # константы (C_DARCY, HOURS_PER_DAY, …)
├── data/                # defaultField, defaultParameters, пресеты
│   └── presets/         # fiveSpot, invertedFiveSpot, lineDrive,
│                          channel, faultBlock, empty
├── ui/                  # всё, что рисует и принимает ввод
│   ├── canvas/          # MapView, Heatmap, WellOverlay, ColorScales
│   │                      (CrossSectionView — модуль сохранён,
│   │                       но в layout не выводится)
│   ├── controls/        # ClickHandler, KeyboardShortcuts
│   ├── panels/          # TopBar, WellsList, ChartsPanel
│   └── charts/          # LineChart, Sparkline, ChartData
├── app/                 # App, SimulationEngine, EventBus, Config
├── cli/                 # simCli (headless-прогон)
├── styles.css
└── main.ts
scripts/                 # dev-утилиты (вне сборки)
├── build-standalone.mjs # npm run standalone → standalone/oilgame.html
├── verifyStability.ts   # год симуляции на всех пресетах, метрики
└── diagStability.ts     # разбор механизмов устойчивости
tests/
├── unit/                # 23 файла (Peaceman, CFL, IMPES, …)
├── property/            # 4 файла (fast-check: mass balance,
│                          bounds, Corey, …)
├── integration/         # 9 файлов (BL 1D, 5-spot, channel,
│                          faultBlock, CFL-adaptive, uiSmoke,
│                          SuperpositionStep, stabilityRegression,
│                          addWellRepro)
├── e2e/                 # 1 файл (Playwright smoke)
└── (fixtures/ — пока не выделены, конфиги строятся в тестах)
standalone/              # собранный однофайловый HTML (tracked — это
                       # артефакт публикации на pages; src для сборки
                       # не нужен в собранном сайте)
```

**Пока не создано (Phase 5+):**
- `src/save/` — Save/Load (планируется Phase 5).
- `src/ui/canvas/CrossSectionView.ts` — модуль остался,
  но в активный layout не выведен (см. §3.5).
- `src/ui/tutorial/` — Phase 8.
- `tests/visual/` — Phase 7 (visual regression).
- `tests/fixtures/` — Phase 7 (готовые JSON).

### Где что писать (быстрая шпаргалка)

| Задача | Куда |
|---|---|
| Карта, ячейка, контур | `core/grid/` |
| Свойства породы/флюидов | `core/properties/` |
| Уравнения, transmissibility, IMPES | `core/physics/` |
| Скважины, Писман, BHP | `core/wells/` |
| Состояние поля, история | `core/state/` |
| Холст, отрисовка карты | `ui/canvas/` |
| Кнопки, слайдеры, панели | `ui/panels/` |
| Линейные графики | `ui/charts/` |
| Обработка кликов/клавиатуры | `ui/controls/` |
| Связка всего в один tick | `app/SimulationEngine.ts` |
| Новый сценарий-пресет | `data/presets/` + тест в `tests/integration/` |
| NPV / экономика | `core/economics/` (UI дашборд — Phase 6) |
| Save / Load | `save/` (Phase 5) |

**Правило:** если модуль не зависит от `canvas`/`window`/`localStorage`,
он лежит в `core/`. Всё, что в `core/`, тестируется без браузера
(`vitest node`).

---

## 3. Соглашения по коду

### 3.1. Стиль

- **TypeScript strict.** `tsconfig.json` включает
  `strict: true`, `noUncheckedIndexedAccess: true`,
  `exactOptionalPropertyTypes: true`.
- **Prettier** (конфиг в `package.json`):
  `printWidth: 100`, `singleQuote: true`, `trailingComma: 'all'`,
  `semi: true`, `arrowParens: 'always'`.
- **ESLint** с `@typescript-eslint` (recommended + strict).
- **Именование:**
  - `camelCase` — переменные, функции, методы, свойства.
  - `PascalCase` — типы, классы, интерфейсы, generic-параметры.
  - `UPPER_SNAKE` — константы модуля (массивы коэффициентов,
    пороги, размеры по умолчанию).
  - Файлы — `PascalCase.ts` для типов/классов, `camelCase.ts`
    для утилит и pure-функций.
- **Без `any`.** Если встретился — нужен комментарий, почему.
  Предпочтение — `unknown` + type guard.
- **Без дефолтного экспорта в `core/`.** Именованные экспорты —
  проще рефакторить и тестировать.

### 3.2. Архитектурные правила

1. **Pure core.** `core/**` не импортирует из `ui/`, `save/`,
   `app/`. Тесты `core/**` запускаются под `vitest node`.
2. **`FieldState` — single source of truth.** UI и тесты читают
   состояние через `engine.getState()`. Никто не дублирует
   массивы `P` и `S_w`.
3. **`step()` — чистая функция.** Сигнатура:
   ```ts
   step(state: FieldState, dt: number, controls: Controls): FieldState
   ```
   Внутри IMPES разбит на подшаги: `solvePressure`,
   `solveSaturation`, `applyWells`. Каждый — тестируемый.
4. **События через `EventBus`** в `app/` (тонкий wrapper,
   generic `EventBus<Events>`). `core/` о событиях не знает.
5. **Единицы — полевые метрические, везде.** Давление в атм,
   проницаемость в мД, вязкость в сП, дебит жидкости в м³/сут,
   дебит нефти в т/сут, время в часах. Эти единицы — и в коде,
   и в UI. `core/units.ts` хранит только константы и используется
   для пересчёта `м³ ↔ т` (масса нефти) и `ч ↔ мс` (для `Date`).
   В самих формулах Дарси/IMPES/transmissibility/Peaceman
   никаких конверсий нет — все выражено в полевых единицах
   с коэффициентом `C_DARCY = 0.0543` (см. `plan.md` §3.6).
6. **Детерминизм.** Все «случайные» величины (генерация
   синтетического поля) принимают `seed` (mulberry32 или
   xoshiro). Дефолт — фиксированный seed для воспроизводимости
   тестов.

### 3.3. Численные конвенции

- **Давление** в **атм** (технических), `P_0 ≈ 245 атм`. Поле
  давления — **steady-state суперпозиция** аналитических
  радиальных решений (Dake, Craft-Hawkins). Время в формулу
  не входит: воронка депрессии мгновенная и стабильная.
  Реализация: `core/pressure/Superposition.ts`.
- **Время** в **часах**. UI показывает дату, сконвертированную
  через `startDate + hours · 3600 · 1000` (мс для `Date`).
- **Проницаемость** в **мД**, **вязкость** в **сП**.
- **Дебит** жидкости в **м³/сут**, дебит нефти в **т/сут**
  (масса, пересчёт `м³ → т` через `ρ_surface / B_o`).
- **Шаг `dt`** — часы. `CFL`-адаптивный шаг с защитой
  (дефолты в `defaultParameters.ts`):
  - `dtMaxHours = 20`, `dtMinHours = 0.1`, `cflTarget = 0.3`.
- **Радиус влияния R_e** (v2) — по умолчанию **динамический**:
  `0.5 · min(до соседа, до границы)`. Можно переключить на
  фиксированный через `DEFAULT_PRESSURE_MODEL.radiusMode`.
- **k_eff, h_eff на скважину** (v2) — по умолчанию средние
  в круге R_e (`mean-in-radius`). Метод: см.
  `core/wells/RateSolver.ts`.
- **P_avg дрейф** (v2) — по материальному балансу:
  `ΔP_avg = -(N_p − N_inj)·B / (V_pore · c_t)`,
  `c_t = 1e-4 атм⁻¹`. Заменяет leaky aquifer.
- **Transmissibility** между ячейками (м³/(сут·атм)):
  ```ts
  T_ij = C_DARCY * 2 * k_i * k_j / (k_i + k_j) * A / (mu * B * d)
  ```
  где `C_DARCY = 0.0543` (см. `core/units.ts` и `plan.md` §3.6).
  Гармоническое среднее `k`, чтобы выдерживало скачки.
- **Скважины (v2)** — линейная система N×N:
  `A·q = (P_avg − P_bhp)`, где
  `A_ji = (μ·B)/(2π·k_i·h_i) · ln(R_e_i / d_ij)`.
  Метод: Гаусс с частичным выбором (см. `core/wells/RateSolver.ts`).
  **Знак `q` закреплён за типом скважины** (`boundsForWell`):
  producer ∈ [0, cap], injector ∈ [−cap, 0]. Без этого при падении
  `P_avg` ниже BHP продюсер «переворачивался» в закачку на полный
  rateLimit и возникал предельный цикл (limit cycle).
- **Rate limits — внутри системы, а не post-factum.** Применяется
  active set (`solveBoundedLinear`): скважины, нарушившие границы,
  «прикалываются» к границе (столбец заменяется на `e_j`), после чего
  система пересчитывается. Так скважина на лимите продолжает
  «чувствовать» соседей. Раньше лимит применялся к решению после
  решателя, что разрывало связь между дебитами и полем давления.
  Дефолт: producer 500, injector 2000 м³/сут.
- **Релаксация дебитов** (стандартный приём wellbore storage):
  `q = q_ref + ω·(q_solved − q_ref)`, где `q_ref` — дебиты
  предыдущего **внешнего** шага, а `ω` подрезается так, чтобы скачок
  не превышал `rateChangeTarget · cap`. Даёт жёсткую гарантию:
  **изменение дебита за внешний шаг ≤ rateChangeTarget·cap**.
  Уменьшать `dt` для этого бесполезно — при насыщенном решении
  `q_solved` не зависит от размера шага.
- **Демпфер P_avg** (`pAvgDamping`): инкремент материального баланса
  применяется частично — сглаживает фронт, не меняя установившийся
  тренд давления.
- **Три ограничителя шага dt** в `SuperpositionStepper`:
  1. **Поячеечный потоковый CFL** (`cflTimestep`) —
     `dt = min_i cfl · V_p,i / (Σ_грани |F| + |q_well,i|)`.
  2. **По реакции скважин** (`wellResponseTimestep`) —
     `|ΔP_avg| ≤ cflPressureFraction · max(|P_avg − BHP|, floor)`.
     Заставляет давление подходить к порогу асимптотически, а не
     перескакивать его.
  3. **По дебитам** — адаптивный регулятор, подрезающий `dt`, если
     изменение дебитов между внешними шагами превышает
     `rateChangeTarget`.
  Первый подшаг оценивается **пробным расчётом** (`probeCflTimestep`):
  `solveRates → computeCellPressures → computeFluxes`. Раньше стояло
  `min(dtMax, remaining)`, из-за чего адаптация шага была мёртвым кодом
  (60 шагов → 60 подшагов по 1).
- **Нижняя граница шага — `HARD_MIN_HOURS` (1e-4 ч), а НЕ `dtMinHours`.**
  `dtMinHours` — только «пожелание», которому CFL может не подчиниться.
  Раньше `dt` поднимался до `dtMin` ПОСЛЕ `min(dt, remaining)`, из-за
  чего подшаг удлинялся за пределы остатка и симуляция уходила вперёд
  по часам.
- **Самосогласованность состояния.** Поле давления пересчитывается по
  **обновлённому** `P_avg`, иначе `state.pressure` и `pAvg` описывали
  разные моменты времени (расхождение доходило до 20+ атм).
- **Аварийный предел дебита** для скважин без `rateLimit` —
  10 000 м³/сут (`SAFETY_CAP_M3_PER_DAY`). Раньше было 100 000: это
  50× крупнейшего штатного дебита, то есть скважина выпивала поровый
  объём активной зоны за 20 сут.
- **СЛАУ для давления** — в v2 не используется. Старый CG в
  `core/physics/PressureSolver.ts` оставлен как legacy
  (не активен). Подробнее: `plan.md §11.2`.
- **Аквифер (leaky BC)** — в v2 заменён дрейфом P_avg.
  Поля `pAquiferAtm` и `aquiferTransmissibilityFrac` сохранены
  в `TimeStepper.ts` (legacy, не активны).
- **Saturation step** — upwind первого порядка. На фронте
  вытеснения в учебной задаче осцилляции терпимы.

### 3.4. Единицы измерения (полевые метрические)

| Величина | Единица | В коде |
|---|---|---|
| Давление | атм | `atm` |
| Время | час | `h` |
| Длина, толщина | м | `m` |
| Объём | м³ | `m3` |
| Пористость, насыщенность | доли | `fraction` (0..1) |
| Проницаемость | мД | `mD` |
| Вязкость | сП | `cP` |
| Плотность | кг/м³ | `kg_m3` |
| Сжимаемость | 1/атм | `atm-1` |
| Объёмный коэф. | м³/м³ | `m3_m3` |
| Дебит жидкости | м³/сут | `m3_d` |
| Дебит нефти (масса) | т/сут | `t_d` |
| Температура | °C | `C` |

**В коде нет конверсий** для этих величин — все формулы
написаны напрямую в полевых единицах. `core/units.ts` хранит
только константы (`C_DARCY`, `SEC_PER_HOUR`, `BARREL_PER_M3`,
`HOURS_PER_DAY`, `TONS_PER_M3_FROM_RHO_OVER_B`) и используется
для пересчёта `м³ ↔ т` (для нефти) и `ч ↔ мс` (для `Date`).

### 3.5. UI-раскладка (актуальная)

```
┌──────────────────────────────────────────────────────────────────┐
│ TopBar: пресет, скорость, play/pause, время                      │
├────────────────────────────────────┬─────────────────────────────┤
│                                    │                             │
│  MapView (Canvas2D)                │  ChartsPanel (2×3)          │
│  - heatmap P / S_w                 │  1) Дебиты (Qн, Qв)         │
│  - WellOverlay (точки скважин)     │  2) Обводнённость (WC)      │
│  - Click → place/remove            │  3) P ср. (атм)             │
│                                    │  4) Накопленная добыча/закач.│
│                                    │  5) КИН + VRR               │
│                                    │  6) Qн по скважинам         │
├────────────────────────────────────┴─────────────────────────────┤
│ WellsList: карточки скважин (BHP-слайдер + BHP-sparkline)        │
├──────────────────────────────────────────────────────────────────┤
│ StatusBar: FPS, steps, cum oil (т)                               │
└──────────────────────────────────────────────────────────────────┘
```

**Изменение от исходного плана:** правый столбец изначально
планировался под cross-section view, но в итерации
(по запросу пользователя) был заменён на `ChartsPanel` с 6
графиками. `CrossSectionView.ts` остался в `ui/canvas/`, но
в `App.ts` сейчас не монтируется — при необходимости легко
вернуть (см. `App.ts`, search `view-charts`).

---

## 4. Команды

```bash
# разработка
npm run dev         # vite dev-сервер, http://localhost:5173
npm run build       # tsc --noEmit && vite build → dist/
npm run preview     # локальный просмотр сборки

# качество
npm run typecheck   # tsc --noEmit + tsc -p tsconfig.test.json
npm run lint        # eslint .
npm run format      # prettier --write .
npm test            # vitest run (36 файлов / 202 теста)
npm run test:watch  # vitest
npm run test:cov    # vitest run --coverage
npm run test:e2e    # playwright test (1 smoke-тест)
npm run test:visual # playwright test --grep @visual (пока пусто)

# CLI-симулятор (headless, после Phase 1)
npm run sim -- --preset five-spot --days 365 --out result.json
npm run sim -- --preset channel    --days 180 --out channel.json

# Standalone HTML (один файл, открывается без сервера)
npm run standalone        # tsc + vite build + инлайн JS/CSS → standalone/oilgame.html

# Диагностика устойчивости ядра
node --import tsx scripts/verifyStability.ts   # год симуляции на всех пресетах
node --import tsx scripts/diagStability.ts     # разбор конкретных механизмов
```

Опции `sim`: `--preset`, `--days`, `--dt`, `--seed`,
`--report-interval`, `--out`.

---

## 5. Тестирование (что и как)

### 5.1. Обязательные проверки перед merge

- `npm run typecheck` — без ошибок.
- `npm run lint` — без ошибок (warnings допустимы, но не новые).
- `npm test` — все 202 теста в 36 файлах зелёные.
- `npm run test:e2e` — 1 smoke-тест проходит (UI поднимается,
  heatmap рисуется).

### 5.2. Текущая раскладка тестов

| Тип | Папка | Файлов | Тестов | Что проверяет |
|---|---|---|---|---|
| Unit | `tests/unit/` | 23 | ~130 | Peaceman, CFL, IMPES, CG, Corey, Transmissibility, units, **Superposition, RateSolver, MaterialBalanceDrift**, … |
| Property (fast-check) | `tests/property/` | 4 | 5 | mass balance, S_w bounds, P bounds, Corey monotonicity |
| Integration | `tests/integration/` | 9 | 36 | BL 1D vs Welge, 5-spot, channel, faultBlock, CFL-adaptive, uiSmoke, **SuperpositionStep**, **stabilityRegression**, addWellRepro |
| E2E | `tests/e2e/` | 1 | 1 | Playwright smoke (UI поднимается) |
| Visual | `tests/visual/` | 0 | 0 | Phase 7 |

### 5.3. Ключевые инварианты для тестов

Эти проверки должны быть в `tests/`, иначе симулятор
«врёт» незаметно:

| Инвариант | Тип теста |
|---|---|
| `S_w ∈ [S_wc, 1 - S_or]` | property-based |
| `P ∈ [min(BHP), max(BHP, P_0)]` | property-based |
| `Σ q_in - q_out = Σ φ·V·ΔS / dt` (mass balance) | property-based + integration |
| `k_rw(S_w=S_wc) = 0`, `k_ro(S_w=1-S_or) = 0` | unit |
| `k_ro` монотонно убывает с `S_w`, `k_rw` — растёт | unit |
| WI сходится к Писману при `dx → 0` | property-based |
| 1D Buckley-Leverett vs Welge, ошибка позиции фронта < 5% | integration |
| 5-spot: симметрия P и S_w относительно центра | integration |
| Aquifer держит `P_avg` при большом отборе | integration (`impesStep.test.ts`) |
| CFL дробление при больших скважинах | integration (`cflAdaptive.test.ts`) |
| **Знак `q` соответствует типу скважины** (producer ≥ 0, injector ≤ 0) | unit + integration (`stabilityRegression.test.ts`) |
| **`\|Δq\| ≤ rateChangeTarget · cap`** за внешний шаг | integration (`stabilityRegression.test.ts`) |
| **`ΔP_поля < 2%` масштаба давления** после переходного процесса | `scripts/verifyStability.ts` |
| **`dt` не перелетает остаток** через `dtMin` | integration (`stabilityRegression.test.ts`) |
| **Результат слабо зависит от внешнего `dt`** (разброс < 1 атм) | integration (`stabilityRegression.test.ts`) |
| Save → Load roundtrip — бит-в-бит идентичное состояние | integration (Phase 5) |
| UI: поставить скважину, прокрутить 1 год, увидеть фронт | e2e |

### 5.4. Фикстуры

`tests/fixtures/` пока не выделен — каждая интеграция строит
конфиг в коде теста с фиксированным seed. Когда появится
общий набор (Phase 7) — переедет в `tests/fixtures/`.

---

## 6. Соглашения по коммитам и PR

- **Conventional Commits** (`feat:`, `fix:`, `refactor:`,
  `test:`, `docs:`, `chore:`).
- Один PR — одна логическая фаза или её часть.
- В описании PR — ссылка на фазу в `plan.md` §9.

---

## 7. Связанные документы

- `plan.md` — детальный план с физикой, параметрами, фазами.
- `docs/parameters.md` — справочник всех параметров и их
  актуальных дефолтов (источник истины — `defaultParameters.ts`).
- `docs/tNavigator_reference.md` — запуск Eclipse-style data-файла
  через **tNavigator-con** (консольная) и парсинг результатов в
  формате Eclipse E1 (`UNRST`/`EGRID`/`INIT`/`SMSPEC`/`UNSMRY`).
  Использовать как **эталон** при валидации нашего pure-симулятора:
  та же геометрия и PVT, сравнить давление/насыщенность с oilgame.
  Готовая обёртка: `C:\Temp\1\tnav_run_1\tnav_run_and_report.bat`.
- `docs/physics.md`, `docs/architecture.md`, `docs/scenarios.md` —
  **ещё не созданы** (черновики лежат в `plan.md` §3/§5/§4.9).

---

## 8. Текущая фаза

**Phase 0–4 — завершены.** Активная работа — Phase 5+
(Save/Load, экономический дашборд, visual regression,
tutorial, polish). См. `plan.md` §9 для статуса по фазам
и `plan.md` §11 для открытых вопросов.

**Что готово в коде:**

- Скелет: package.json, tsconfig, Vite, Vitest, Playwright,
  ESLint, Prettier.
- Pure-симулятор: `core/` целиком (grid, properties, physics,
  wells, time, state, economics, units).
- 6 пресетов в `src/data/presets/`.
- CLI-симулятор (`npm run sim`).
- UI: `MapView` + `ChartsPanel` (6 графиков) + `WellsList`
  (BHP-слайдеры + sparkline'ы) + `TopBar` + `StatusBar`.
- EventBus + SimulationEngine.
- Стабилизация v2: ограничение знака дебита типом скважины +
  active set для rate limits, релаксация дебитов с адаптивным ω,
  демпфер `P_avg`, три ограничителя шага (потоковый CFL по ячейкам,
  CFL по реакции скважин, адаптивный по дебитам), самосогласованное
  поле давления. Подробно — §3.3.
- `scripts/verifyStability.ts` — верификация устойчивости: год
  симуляции на всех пресетах + стресс-тесты (15 скважин, без лимитов).

**Что не готово (Phase 5+):**

- Save/Load (папка `save/`).
- Экономический дашборд (модули `core/economics/` есть,
  UI не выведен).
- Cross-section view в layout (модуль остался в коде).
- Visual regression tests.
- Tutorial / guided tour.
- Drag-pan / zoom на карте (есть только Click + Keyboard).

---

## 9. UI локаль

- Язык интерфейса — **русский** (RU).
- Технические сообщения, идентификаторы в коде, JSON-поля,
  названия файлов — на английском.
- Если позже понадобится i18n — выделяем строки в один словарь
  (`src/i18n/ru.json`).

## 10. Среда запуска

- Разработка и CI — **локально** (Windows + PowerShell).
- `npm test`, `npm run lint`, `npm run typecheck`, `npm run test:e2e` —
  всё запускается руками. Без GitHub Actions / GitLab CI.
- Деплой сборки `dist/` — при необходимости вручную
  (например, `python -m http.server` для проверки).

## 11. Зафиксированные пользовательские настройки

Эти значения выбраны пользователем в процессе итераций
и зафиксированы в `src/data/defaultParameters.ts` —
менять с осторожностью (стабильность 5-spot подобрана
под них):

- `dtMaxHours = 20`, `dtMinHours = 0.1`, `cflTarget = 0.3`,
  `pressureRelaxation = 0.5`, `historyIntervalHours = 1`
  (см. `core/time/TimeStepper.ts`).
- `producerRateLimit = 500`, `injectorRateLimit = 2000`
  (см. `DEFAULT_WELL_CONTROLS`).
- **Параметры стабилизации v2** (`DEFAULT_SOLVER`):
  `pAvgDamping = 0.35`, `rateRelaxation = 0.5`,
  `rateChangeTarget = 0.2`, `cflPressureFraction = 0.3`,
  `pressureMarginFloorAtm = 0.5`.
  Добавлены при исправлении неустойчивости «скачков при добавлении
  скважин». `rateChangeTarget` задаёт жёсткую границу изменения дебита
  за внешний шаг: 100 м³/сут для продюсера (0.2 × 500) и 400 для
  инжектора (0.2 × 2000) — её нельзя поднимать без проверки
  `scripts/verifyStability.ts`.
- `K_MAX_MD = 2000` в `defaultField.ts`; пресет `channel`
  использует `kMultiplier = 2` поверх него.
- `aquiferTransmissibilityFrac = 0.05` в `TimeStepper.ts`.
