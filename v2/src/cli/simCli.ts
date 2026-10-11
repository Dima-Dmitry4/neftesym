// Headless CLI для запуска симуляции.
//
// Использование:
//   npm run sim -- --preset five-spot --days 365 --out result.json
//
//   --preset <name>         Имя пресета (см. data/presets)
//   --days <N>              Длительность прогона, сут (по умолчанию 365)
//   --dt-hours <N>          Жёсткий шаг dt, ч (по умолчанию — адаптивный)
//   --seed <N>              Seed для генератора поля (по умолчанию 42)
//   --out <path>            Файл для JSON-результата (опционально)
//   --report-interval-hours <N>  Интервал записи в history, ч (по умолчанию 24)
//   --history-only          Сохранять только history (без поля и state)
//
// Печатает прогресс в stderr каждые 30 сут. Возвращает 0 при успехе.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PRESET_NAMES, getScenario } from '../data/presets/index.ts';
import { defaultField } from '../data/defaultField.ts';
import {
  DEFAULT_FLUID,
  DEFAULT_RELPERM,
  DEFAULT_ROCK,
  DEFAULT_SOLVER,
} from '../data/defaultParameters.ts';
import { makeInitialState } from '../core/state/FieldState.ts';
import { History } from '../core/state/History.ts';
import { step } from '../core/time/TimeStepper.ts';
import type { Well } from '../core/wells/Well.ts';
import type { Reservoir } from '../core/grid/Reservoir.ts';

interface CliOptions {
  preset: string;
  days: number;
  dtHours: number | null;
  seed: number;
  out: string | null;
  reportIntervalHours: number;
  historyOnly: boolean;
  noDefaultField: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    preset: 'five-spot',
    days: 365,
    dtHours: null,
    seed: 42,
    out: null,
    reportIntervalHours: 24,
    historyOnly: false,
    noDefaultField: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--preset') {
      const v = argv[++i];
      if (typeof v === 'string') opts.preset = v;
    } else if (a === '--days') {
      const v = argv[++i];
      if (typeof v === 'string') opts.days = Number(v);
    } else if (a === '--dt-hours') {
      const v = argv[++i];
      if (typeof v === 'string') opts.dtHours = Number(v);
    } else if (a === '--seed') {
      const v = argv[++i];
      if (typeof v === 'string') opts.seed = Number(v);
    } else if (a === '--out') {
      const v = argv[++i];
      if (typeof v === 'string') opts.out = v;
    } else if (a === '--report-interval-hours') {
      const v = argv[++i];
      if (typeof v === 'string') opts.reportIntervalHours = Number(v);
    } else if (a === '--history-only') {
      opts.historyOnly = true;
    } else if (a === '--no-default-field') {
      opts.noDefaultField = true;
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else if (typeof a === 'string' && a.startsWith('--')) {
      process.stderr.write(`Unknown option: ${a}\n`);
    }
  }
  return opts;
}

function printHelp(): void {
  process.stdout.write(`oilgame CLI — headless simulator

Usage:
  npm run sim -- [options]

Options:
  --preset <name>            Preset name (${PRESET_NAMES.join(', ')})
  --days <N>                 Simulation duration in days (default 365)
  --dt-hours <N>             Fixed dt in hours (default: adaptive)
  --seed <N>                 Seed for synthetic field (default 42)
  --out <path>               Output JSON file (default: none)
  --report-interval-hours N  History record interval in hours (default 24)
  --history-only             Save only history (no field/state)
  --no-default-field         Use synthetic field instead of preset's
  --help                     Show this help
`);
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    printHelp();
    return;
  }
  const opts = parseArgs(argv);

  let reservoir: Reservoir;
  let wells: readonly Well[];
  let xFault: Uint8Array | undefined;
  let yFault: Uint8Array | undefined;
  let presetName = opts.preset;
  if (opts.preset === 'default') {
    reservoir = defaultField();
    wells = [];
    presetName = 'default';
  } else {
    const scenario = getScenario(opts.preset);
    if (opts.noDefaultField) {
      reservoir = defaultField();
    } else {
      reservoir = scenario.reservoir;
    }
    wells = scenario.wells;
    xFault = scenario.xFault;
    yFault = scenario.yFault;
  }
  const initialState = makeInitialState(reservoir.initialP, reservoir.initialSw);

  const history = new History(opts.reportIntervalHours);
  const params = {
    dtMaxHours: DEFAULT_SOLVER.dtMaxHours,
    dtMinHours: DEFAULT_SOLVER.dtMinHours,
    cflTarget: DEFAULT_SOLVER.cflTarget,
    cgTolerance: DEFAULT_SOLVER.cgTolerance,
    cgMaxIterations: DEFAULT_SOLVER.cgMaxIterations,
    crAtm: DEFAULT_ROCK.crAtm,
    historyIntervalHours: opts.reportIntervalHours,
    pressureRelaxation: DEFAULT_SOLVER.pressureRelaxation,
  };
  const totalDtHours = opts.days * 24;
  const stepDt = opts.dtHours ?? Math.min(48, params.dtMaxHours);
  const startMs = Date.now();
  process.stderr.write(
    `[sim] preset=${presetName} wells=${wells.length} days=${opts.days} dt=${stepDt}h\n`,
  );
  process.stderr.write(
    `[sim] active cells=${reservoir.activeCount()} / ${reservoir.grid.nCells}\n`,
  );

  let state = initialState;
  let lastRecordT = -Infinity;
  const totalDays = opts.days;
  let elapsed = 0;
  while (elapsed < totalDtHours) {
    const dt = Math.min(stepDt, totalDtHours - elapsed);
    const out = step({
      state,
      dt,
      reservoir,
      wells,
      fluid: DEFAULT_FLUID,
      rock: DEFAULT_ROCK,
      relperm: DEFAULT_RELPERM,
      params,
      xFault,
      yFault,
    });
    state = out.state;
    elapsed += dt;
    // Запись в history
    if (state.time - lastRecordT >= opts.reportIntervalHours - 1e-6) {
      const info = out.subSteps[out.subSteps.length - 1];
      if (info) {
        // dtRecord: фактический шаг = info.dt
        const wBhps = new Map<string, number>();
        for (const ws of info.wellStates) {
          wBhps.set(ws.wellId, state.pressure[ws.cellIndex] ?? ws.bhp);
        }
        history.append(
          state.time,
          info.pAvg,
          info.swAvg,
          info.dt,
          info.wellStates,
          wBhps,
          DEFAULT_FLUID.rhoOilSurface,
          DEFAULT_FLUID.bo,
        );
        lastRecordT = state.time;
      }
    }
    // Прогресс каждые 30 сут.
    if (Math.floor(state.time / (24 * 30)) > Math.floor((state.time - dt) / (24 * 30))) {
      const last = history.last();
      const tDays = (state.time / 24).toFixed(1);
      const cumOil = last ? last.cumOil.toFixed(2) : '0';
      const cumOilT = last ? last.cumOilTons.toFixed(2) : '0';
      process.stderr.write(
        `[sim] t=${tDays} сут (${totalDays} target) cumOil=${cumOil} м³ (${cumOilT} т)\n`,
      );
    }
  }

  const endMs = Date.now();
  const wallSec = (endMs - startMs) / 1000;
  process.stderr.write(
    `[sim] done in ${wallSec.toFixed(2)}s, steps=${state.step}, history entries=${history.size()}\n`,
  );

  if (opts.out) {
    const out: Record<string, unknown> = {
      schemaVersion: 1,
      appVersion: '0.1.0',
      preset: presetName,
      seed: opts.seed,
      days: opts.days,
      steps: state.step,
      wallTimeSeconds: wallSec,
      history: history.all(),
    };
    if (!opts.historyOnly) {
      out.field = {
        grid: {
          nx: reservoir.grid.nx,
          ny: reservoir.grid.ny,
          dx: reservoir.grid.dx,
          dy: reservoir.grid.dy,
          depthTop: reservoir.grid.depthTop,
        },
        thickness: Array.from(reservoir.thickness),
        porosity: Array.from(reservoir.porosity),
        permX: Array.from(reservoir.permX),
        permY: Array.from(reservoir.permY),
        initialP: Array.from(reservoir.initialP),
        initialSw: Array.from(reservoir.initialSw),
        active: Array.from(reservoir.active),
      };
      out.state = {
        pressure: Array.from(state.pressure),
        sw: Array.from(state.sw),
        time: state.time,
        step: state.step,
      };
      out.wells = wells as Well[];
    }
    const path = resolve(opts.out);
    writeFileSync(path, JSON.stringify(out, null, 2), 'utf-8');
    process.stderr.write(`[sim] saved to ${path}\n`);
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`[sim] error: ${(err as Error).message}\n`);
  process.exit(1);
}
