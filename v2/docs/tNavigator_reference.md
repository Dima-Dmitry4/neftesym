# tNavigator — консольный прогон и парсинг E1

Справочник для AI-агента и разработчика по запуску Eclipse-style data-файла
через консольную версию tNavigator и чтению результатов в формате Eclipse E1
(UNRST, EGRID, INIT, SMSPEC, UNSMRY, RSSPEC, INSPEC).

Это внешний по отношению к oilgame инструмент; здесь задокументирован,
потому что может использоваться как эталон для валидации нашего pure-симулятора
(сравнение с IMPES-решением tNavigator на той же геометрии и PVT).

---

## 1. Предусловия

### 1.1. Установка

- **tNavigator установлен** в `C:\Program Files\tNavigator\26.2\`
  (версия `v26.2-4547-gf7aca9d0f12a`).
- Доступны **консольные исполняемые файлы**:
  - `tNavigator-con-v26.2-4547-gf7aca9d0f12a.exe` — sequential.
  - `tNavigator-con-mpi-v26.2-4547-gf7aca9d0f12a.exe` — MPI (для кластера).
  - `tNavigator-v26.2-4547-gf7aca9d0f12a.exe` — GUI.
  - `tNavigator-API-client.exe` (в `ai/26.2/`) — мост к Дизайнеру Моделей.
- **Python 3.12+** с библиотеками:
  - `pip install resfo` (чистый Python, 19 КБ, чтение ECL-форматов).
  - `pip install matplotlib` (для статического PNG-превью).
  - `pip install numpy` (уже ставится как зависимость `resfo`).

### 1.2. Лицензия

- Сеть: `tnav://tnavigator-license.rfdyn.ru:8057/tNavigatorGubkinUniversity/`.
- Для расчёта через `tNavigator-con` достаточно **Black Oil** (`LICENSE_BO`).
- Для работы через API Дизайнера нужно явно запросить лицензию в workflow:

  ```python
  request_license_features(requested_features=[
      {"feature": "FEAT_MODEL_DESIGNER"},
      {"feature": "FEAT_BLACK_OIL"},
  ])
  ```

  Без `FEAT_MODEL_DESIGNER` функции `project_import_dynamic_model`,
  `get_result_values`, `get_all_dynamic_models` недоступны (вернут
  ошибку `необходима лицензия: МатБаланс, Дизайнер Моделей`).

---

## 2. Запуск расчёта

### 2.1. Команда

```powershell
# Подготовить рабочую директорию
New-Item -ItemType Directory -Path "C:\Temp\1\tnav_run_1" -Force | Out-Null
Copy-Item -Path "C:\Temp\1\mdl_1_well_circle_const_pressure_boundary.data" `
          -Destination "C:\Temp\1\tnav_run_1\" -Force

# Запуск (без GPU, без MPI, на 4 CPU ядрах)
Push-Location "C:\Temp\1\tnav_run_1"
& "C:\Program Files\tNavigator\26.2\tNavigator-con-v26.2-4547-gf7aca9d0f12a.exe" `
    -d -e -i -r --ecl-root -n 4 `
    "mdl_1_well_circle_const_pressure_boundary.data"
Pop-Location
```

### 2.2. Ключевые флаги

| Флаг | Назначение |
|------|-----------|
| `-d` (`--ecl-dump`) | UNSMRY, SMSPEC — **только если есть секция SUMMARY** |
| `-e` (`--ecl-egrid`) | EGRID — описание сетки |
| `-i` (`--ecl-init`) | INIT — начальные свойства |
| `-r` (`--ecl-unrst`) | UNRST — рестарт-данные на каждом шаге |
| `--ecl-root` | Писать бинарники в директорию data-файла, **не** в `RESULTS/` |
| `-n <N>` | Число CPU-ядер (sequential режим) |
| `--use-gpu` | Включить GPU (нужна лицензия `LICENSE_GPU`) |
| `--license-wait-time-limit=<sec>` | Сколько секунд ждать лицензию |

Полный список опций: `--help`. Для расчётов с **BHP**-управлением скважинами
`tNavigator` использует **полностью неявный** метод — расчёт устойчив при больших
шагах.

### 2.3. Что получаем на выходе

После успешного расчёта в директории data-файла появятся:

| Файл | Размер (для 55×55×1, 100 дней, 1 скважина) | Назначение |
|------|------------------------------------------:|-----------|
| `.EGRID`  | ~186 КБ | Сетка + ACTNUM |
| `.INIT`   | ~204 КБ | Начальные свойства (PORO, PERM, SGAS…) |
| `.INSPEC` | ~2.5 КБ | Спецификация INIT |
| `.RSSPEC` | ~138 КБ | Спецификация рестартов |
| `.UNRST`  | ~5.5 МБ | **PRESSURE, SWAT, SGAS, RS** на каждом шаге |
| `.SMSPEC` | ~4 КБ | Спецификация временных рядов (только если есть SUMMARY) |
| `.UNSMRY` | ~23 КБ | Временные ряды (только если есть SUMMARY) |

Файл `RESULTS/<case>/result.log` содержит отчёт расчётчика, `result.sum` —
нативный summary в формате tNavigator.

### 2.4. Секция SUMMARY обязательна для UNSMRY

`tNavigator-con` создаёт `UNSMRY`/`SMSPEC` **только если** в data-файле есть
секция `SUMMARY`. Без неё — UNRST/EGRID/INIT будут, а временных рядов нет.

Стандартные ключевые слова для односкважинной модели:

```
SUMMARY
-- Field-level
FOPR                    -- дебит нефти (field, oil rate), м³/сут
FOPT                    -- накопленная добыча нефти (field, oil total), м³
FGPR                    -- дебит газа (field, gas rate), м³/сут
FGPT                    -- накопленная добыча газа, м³
FPR                     -- средневзвешенное давление пласта, бара
FWPR                    -- дебит воды, м³/сут
FWPT                    -- накопленная добыча воды, м³
-- Well WU1_1
WBHP  'WU1_1'           -- забойное давление, бар (НЕ атм!)
WOPR  'WU1_1'           -- дебит нефти по скважине
WOPT  'WU1_1'           -- накопленная добыча нефти
WGPR  'WU1_1'           -- дебит газа по скважине
WGPT  'WU1_1'           -- накопленный газ
WPR   'WU1_1'           -- дебит жидкости
-- Block pressure в точках
BPR  28 28 1             -- (i, j, k), 1-based
/

SCHEDULE
```

`tNavigator` автоматически дописывает: `TIME`, `YEARS`, `DAY`, `MONTH`,
`YEAR`, `#WSTAT1..#WSTATH2` (статусы скважин). При BHP-control он **не
пишет** `WOPR`/`WOPT` (если их явно запросили — может игнорировать), но
обязательно пишет `WBHP`.

### 2.5. Известные особенности tNavigator

- **Единицы давления в UNRST vs UNSMRY** разные:
  - UNRST хранит в **атм** (метрические единицы data-файла).
  - UNSMRY/SMSPEC хранит в **барах** (`BARA`).
  - Пересчёт: 1 бар ≈ 0.987 атм.
- **BHP = 25 атм в data-файле** → в UNSMRY это ~25 бар. На экране —
  ~24.7 атм. Пересчитывать при визуализации.
- **Порядок ячеек в UNRST** — только активные (`ACTNUM=1`) подряд.
  Чтобы построить 2D-карту в правильных (i, j), нужно:
  1. Прочитать `ACTNUM` из `EGRID` (длина `NX*NY*NZ`).
  2. Построить reverse-map: `rmap[global_flat_idx] = position_in_active_array`.
  3. Заполнять 2D-сетку: `grid[j, i] = data[rmap[j*NX + i]]` (NaN если
     `ACTNUM=0`).
- **tNavigator UNSMRY имеет упрощённый layout** (отличается от
  классического Eclipse):
  - `TNAVHEAD` (один раз, int[14]).
  - На каждом мини-шаге: `SEQHDR` (int[1]) + `MINISTEP` (int[1]) +
    `TNAVTIME` (int[4]) + `PARAMS` (float32[N_keywords]).
  - **Все 17 keywords** упакованы в один `PARAMS`-массив на каждом
    мини-шаге, не разнесены по записям.

---

## 3. Чтение результатов через `resfo`

### 3.1. Установка и базовый API

```bash
pip install resfo
```

API в `resfo 5.0+`:

```python
import resfo
import numpy as np

# Lazy-чтение бинарного файла
for entry in resfo.lazy_read("file.UNRST", resfo.Format.UNFORMATTED):
    kw = entry.read_keyword().strip()
    arr = entry.read_array()
    # ...
```

### 3.2. UNRST — поля сетки по шагам

```python
def read_unrst_field(path, kw):
    out, step = {}, None
    for entry in resfo.lazy_read(str(path), resfo.Format.UNFORMATTED):
        name = entry.read_keyword().strip()
        if name == "SEQNUM":
            step = int(entry.read_array()[0])
        elif step is not None and name == kw:
            out[step] = np.asarray(entry.read_array(), dtype=np.float32)
    return out

p_data = read_unrst_field(path, "PRESSURE")  # {step: array, ...}
p_step1 = p_data[1]
p_final = p_data[100]
```

INTEHEAD-индексы **зависят от версии tNavigator**. В нашей (v26.2):
- `head[8] = NX`, `head[9] = NY`, `head[10] = NZ`.

Не рассчитывайте на стандартные ECL-позиции (0/1/2/3 = NX/NY/NZ/NTOTAL).

### 3.3. EGRID — сетка и ACTNUM

```python
def read_actnum(path):
    for entry in resfo.lazy_read(str(path), resfo.Format.UNFORMATTED):
        if entry.read_keyword().strip() == "ACTNUM":
            return entry.read_array()
    raise RuntimeError("ACTNUM not found")

actnum = read_actnum("file.EGRID")  # shape (NX*NY*NZ,), int32
n_active = int((actnum > 0).sum())
n_inactive = int((actnum == 0).sum())
```

`ACTNUM` нужен для **корректной 2D-карты**: без него активные ячейки раскладываются
в массив `(ny, nx)` в порядке `ACTNUM==1`, а не геометрическом, что приводит к
смещению круга и скважины.

### 3.4. SMSPEC + UNSMRY — временные ряды

```python
def read_smspec(path):
    out = {}
    for entry in resfo.lazy_read(str(path), resfo.Format.UNFORMATTED):
        kw = entry.read_keyword().strip()
        if kw == "KEYWORDS":
            out["KEYWORDS"] = [s.decode("ascii","replace").strip() for s in entry.read_array()]
        elif kw == "NAMES":
            out["NAMES"]    = [s.decode("ascii","replace").strip() for s in entry.read_array()]
        elif kw == "UNITS":
            out["UNITS"]    = [s.decode("ascii","replace").strip() for s in entry.read_array()]
        elif kw == "STARTDAT":
            out["STARTDAT"] = entry.read_array()  # [day, mon, year, h, m, s]
    return out

def read_unsmry(path, nkeys):
    """tNavigator layout: SEQHDR + MINISTEP + TNAVTIME + PARAMS[N_keys]."""
    rows = []
    for entry in resfo.lazy_read(str(path), resfo.Format.UNFORMATTED):
        if entry.read_keyword().strip() == "PARAMS":
            arr = np.asarray(entry.read_array(), dtype=np.float32)
            if arr.size == nkeys:
                rows.append(arr)
    return np.vstack(rows) if rows else np.empty((0, nkeys))
```

`KEYWORDS` обычно: `[TIME, YEARS, DAY, MONTH, YEAR, FWPR, FOPR, FGPR, FWPT,
FOPT, FGPT, FPR, WBHP, #WSTAT1, #WSTAT2, #WSTATH1, #WSTATH2]` (17 шт).
`#WSTAT*` — это мусорные значения типа `-1.6e+37` (tNavigator-маркер «нет значения»).
**Отфильтровать** их при визуализации: `if v > -1e30 and abs(v) < 1e30`.

### 3.5. Готовый скрипт

См. `make_html.py` и `make_png.py` в `C:\Temp\1\tnav_run_1\` для
полноценных примеров: чтение UNRST, ACTNUM, SMSPEC, UNSMRY, генерация
HTML (vanilla JS + Canvas) и PNG (matplotlib).

---

## 4. Визуализация результатов

### 4.1. PNG через matplotlib (рекомендуется для быстрого просмотра)

См. `make_png.py`. 2D-карты давления и насыщенности с правильным кругом,
скважиной в центре, временными рядами FOPR/FGPR/FWPR и таблицей ключевых
показателей. Размер файла — ~150 КБ.

### 4.2. Самодостаточный HTML (vanilla JS + Canvas)

См. `make_html.py`. Один файл ~4 МБ (base64-закодированные массивы).
**Без внешних зависимостей** (без D3.js, без CDN). Открыть в Chrome/Firefox/Edge.

Включает:
- Сводная таблица ключевых показателей.
- Time series (один показатель + переключатель).
- Multi-curve (FOPR/FGPR/FWPR в log-шкале).
- 2D-карта давления с ползунком шага (D3.js-free, Canvas).
- 2D-карта насыщенности (Sw / Sg).
- ACTNUM-фон (неактивные ячейки серым).

### 4.3. Headless-скриншот через Edge (для проверки)

```powershell
$msEdge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
& $msEdge --headless=new --no-sandbox --disable-gpu --hide-scrollbars `
    --run-all-compositor-stages-before-draw --virtual-time-budget=20000 `
    --window-size=1280,2200 `
    --screenshot="C:\Temp\1\tnav_run_1\report_final.png" `
    "file:///C:/Temp/1/tnav_run_1/<case>.html"
```

**Важно:** `--virtual-time-budget=20000` нужен, чтобы D3/Canvas успели отрисовать
(иначе скриншот будет пустой).

---

## 5. Готовая обёртка `tnav_run_and_report.bat`

В `C:\Temp\1\tnav_run_1\tnav_run_and_report.bat` — единая команда:
1. Запуск `tNavigator-con` с записью E1.
2. `make_png.py` для статического превью.
3. `make_html.py` для самодостаточного HTML.

```bat
@echo off
setlocal
set DATA=%1
set TN_BIN="C:\Program Files\tNavigator\26.2\tNavigator-con-v26.2-4547-gf7aca9d0f12a.exe"
set WORK=C:\Temp\1\tnav_run_1

if "%DATA%"=="" (
  echo Usage: tnav_run_and_report.bat ^<path-to-data-file^>
  exit /b 1
)

if not exist "%DATA%" (
  echo Data file not found: %DATA%
  exit /b 1
)

for %%F in ("%DATA%") do set BASENAME=%%~nF
echo === Copying to working dir: %WORK%\%BASENAME%.data ===
copy /Y "%DATA%" "%WORK%\%BASENAME%.data" >nul

echo === Running tNavigator-con ===
pushd %WORK%
%TN_BIN% -d -e -i -r --ecl-root -n 4 "%BASENAME%.data"
if errorlevel 1 (
  echo tNavigator failed
  popd
  exit /b 1
)

echo === Generating PNG preview ===
py make_png.py "%BASENAME%" || echo PNG failed

echo === Generating HTML report ===
py make_html.py "%BASENAME%" || echo HTML failed

popd
echo === Done ===
```

---

## 6. Альтернатива: API Дизайнера Моделей

Для интерактивной работы (3D-визуализация, отчёты ГОСТ, расчёт через API)
есть MCP-сервер. Запуск:

```powershell
"C:\Program Files\tNavigator\26.2\ai\26.2\tNavigator-API-client.exe" `
    --mcp-server --gui-mode
```

Подключение из workflow Python API (через MCP-тулы `open_project`, `run_workflow`):

```python
# 1. Запросить лицензию Дизайнера Моделей
request_license_features(requested_features=[
    {"feature": "FEAT_MODEL_DESIGNER"},
    {"feature": "FEAT_BLACK_OIL"},
])

# 2. Импорт data-файла в проект
project_import_dynamic_model(
    data_file_path="C:/Temp/1/tnav_api_run/<case>.data",
    select_import_mode="Load Without Conversion",
    select_calculation_results="Add path to existing results",
    overwrite_project_data=True,
    physics_type="Blackoil",
    select_units_action="change_project_units",
    ...
)

# 3. Инициализация dynamic model
open_or_reload_dynamic_model(
    model=typed_object_name(obj_name="<case>", obj_type="Model_ex"),
    result_name="result",
    maps_result_mode="tnav_map",
    graphs_result_mode_for_requested_maps="tnav_graph",
    graphs_result_mode_for_maps_off="tnav_graph",
    overwrite_existing_result=True,
)

# 4. Расчёт
run_dynamic_model_calculations(is_go_to_step=True, go_to_step_number=N)

# 5. Доступ к свойствам модели
dm = get_current_dynamic_model()
df_props = dm.get_mapping(type="grid_properties")  # PORO, NTG, PERM, ACTNUM
prop = get_grid_by_name(name=dm.name).get_property_by_name(name="PORO")
stats = prop.compute_statistics(type="min")  # min/max/mean/rms/...
```

**Известные ограничения API:**
- API пишет результаты в собственный формат `tnav_map` (`*.res`/`*.meta`),
  **не** в ECL UNRST/UNSMRY. Чтобы получить ECL-формат, нужно отдельно
  вызвать `results_writing_mapping(settings="ecl_properties", ...)` и затем
  перезагрузить бинарники через `load_binaries(...)`.
- Без лицензии `FEAT_MODEL_DESIGNER` функции импорта модели, чтения
  результатов, расчёта — недоступны.
- API-клиент может зависнуть после длинной серии вызовов — нуждается в
  перезапуске.

---

## 7. Чек-лист перед отчётом

- [ ] Data-файл содержит секцию `SUMMARY` (если нужны `UNSMRY`/`SMSPEC`).
- [ ] Запущен `tNavigator-con` с флагами `-d -e -i -r --ecl-root`.
- [ ] Создан PNG-превью через `make_png.py` — есть 4 панели (2 heatmap +
  1 rates + 1 P/WBHP + 1 таблица).
- [ ] Создан HTML через `make_html.py` — открыть в браузере, проверить
  что все 4 секции работают (таблица, time series, multi, heatmap).
- [ ] Карты показывают **круг радиуса 28** (по ACTNUM), скважина в центре
  `(28, 28)`.
- [ ] Давление в центре ≈ `P_max - ∠EXT·√(k/φ)`, на границе ≈ `P_max`
  (если `NTG=1e6` на границе).
- [ ] FOPT (накопленная нефтида) ≈ `FOPR·days` (для BHP-control без вариаций).
- [ ] FGPT ≈ `FOPT · Rs` (для модели с растворённым газом).
- [ ] WBHP ≈ `BHP_control` для закрытой модели, или растёт при истощении.