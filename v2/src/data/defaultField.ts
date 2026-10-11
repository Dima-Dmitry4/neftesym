// Синтетическое месторождение с фиксированным seed для воспроизводимости.
//
// 1) Базовая решётка пористости (логнормальное).
// 2) Связь k с φ (корреляция 0.7).
// 3) Толщина: h_mean + A·cos(2πx/L)·cos(2πy/L) + B·exp(-r²/R²) («sandy channel»).
// 4) Контур: круг в центре (радиус ≈ 0.45·L).
// 5) Начальное P: гидростатика (245 атм на глубине 2800 м).
// 6) Начальное S_w0 = S_wc + 0.05.

import { Grid2D } from '../core/grid/Grid2D.ts';
import { Reservoir } from '../core/grid/Reservoir.ts';
import { circleContour } from '../core/grid/Contour.ts';
import {
  DEFAULT_GRID,
  DEFAULT_INITIAL_SW,
  DEFAULT_PRESSURE_ATM,
  DEFAULT_ROCK,
  DEFAULT_THICKNESS_M,
} from './defaultParameters.ts';

/** Mulberry32 — детерминированный PRNG, 32-бит seed. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller: randn() ~ N(0, 1) из двух U(0, 1). */
function randn(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u <= 1e-12) u = rng();
  while (v <= 1e-12) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface DefaultFieldOptions {
  seed?: number;
  grid?: { nx: number; ny: number; dx: number; dy: number; depthTop: number };
  thicknessMean?: number;
  thicknessAmplitude?: number;
  /** Радиус активной зоны (доля от L). */
  activeRadiusFrac?: number;
}

/** Сгенерировать синтетическое месторождение. */
export function generateDefaultField(options: DefaultFieldOptions = {}): Reservoir {
  const seed = options.seed ?? 42;
  const gridSpec = options.grid ?? { ...DEFAULT_GRID };
  const grid = new Grid2D(gridSpec);
  const rng = mulberry32(seed);
  const n = grid.nCells;
  const porosity = new Float64Array(n);
  const permX = new Float64Array(n);
  const permY = new Float64Array(n);
  const permZ = new Float64Array(n);
  const thickness = new Float64Array(n);
  const initialP = new Float64Array(n);
  const initialSw = new Float64Array(n);
  const active = new Uint8Array(n);
  const depthCenter = new Float64Array(n);

  // 1) Пористость: логнормальное распределение.
  //    φ = exp(μ_φ + σ_φ · randn()), clamp [0.10, 0.30]
  const muPhi = Math.log(DEFAULT_ROCK.porosity); // mean ~ 0.20
  const sigmaPhi = 0.20;
  for (let i = 0; i < n; i++) {
    const v = Math.exp(muPhi + sigmaPhi * randn(rng));
    porosity[i] = Math.max(0.10, Math.min(0.30, v));
  }
  // 2) Корреляция k с φ: ln k = a + b·φ + σ·randn().
  //    a, b подобраны так, чтобы mean k ≈ 100 мД.
  //    Простой подбор: используем регрессию ln k = a + b·φ.
  //    Возьмём b = 4, a подгоним так, чтобы E[ln k] = ln(100).
  //    Верхний кламп 1000 мД — реалистичный максимум для песчаника.
  //    Каналы/разломы пресетов дают ×2 → до 4000 мД (трещиноватые зоны).
  //    RateLimit защищает от взрывных rates при высоком k.
  const a = Math.log(100) - 4 * muPhi;
  const b = 4;
  const sigmaK = 0.35;
  const K_MAX_MD = 2000;
  for (let i = 0; i < n; i++) {
    const lnk = a + b * (porosity[i] ?? 0) + sigmaK * randn(rng);
    let k = Math.exp(lnk);
    if (k < 0.5) k = 0.5;
    if (k > K_MAX_MD) k = K_MAX_MD;
    permX[i] = k;
    permY[i] = k;
    permZ[i] = k * DEFAULT_ROCK.permAnisotropy;
  }
  // 3) Толщина: гладкая карта.
  const hMean = options.thicknessMean ?? DEFAULT_THICKNESS_M;
  const hAmp = options.thicknessAmplitude ?? 4;
  const hChannelAmp = 6;
  const Lx = grid.nx * grid.dx;
  const Ly = grid.ny * grid.dy;
  const xc = Lx * 0.5;
  const yc = Ly * 0.5;
  const R = Math.min(Lx, Ly) * 0.15;
  for (let idx = 0; idx < n; idx++) {
    const i = idx % grid.nx;
    const j = Math.floor(idx / grid.nx);
    const x = (i + 0.5) * grid.dx;
    const y = (j + 0.5) * grid.dy;
    const wave = hAmp * Math.cos((2 * Math.PI * x) / Lx) * Math.cos((2 * Math.PI * y) / Ly);
    const dx = x - xc;
    const dy = y - yc;
    const r2 = dx * dx + dy * dy;
    const channel = hChannelAmp * Math.exp(-r2 / (R * R));
    thickness[idx] = hMean + wave + channel;
  }
  // 4) Контур: круг в центре, радиус ≈ 0.45·L.
  const radiusFrac = options.activeRadiusFrac ?? 0.45;
  const radius = radiusFrac * Math.min(Lx, Ly);
  const mask = circleContour(grid, xc, yc, radius);
  for (let i = 0; i < n; i++) active[i] = mask[i] ?? 0;
  // 5) Начальное давление: гидростатика P = 245 + 0.1·(2800 - depth).
  for (let idx = 0; idx < n; idx++) {
    const depth = grid.depthTop + (thickness[idx] ?? 0) * 0.5;
    depthCenter[idx] = depth;
    const p = DEFAULT_PRESSURE_ATM + 0.1 * (2800 - depth);
    initialP[idx] = p;
  }
  // 6) Начальное S_w0 = S_wc + 0.05 (выше S_wc, чтобы нефть подвижна).
  const sw0 = DEFAULT_INITIAL_SW;
  for (let i = 0; i < n; i++) initialSw[i] = sw0;

  return new Reservoir(grid, {
    thickness,
    porosity,
    permX,
    permY,
    permZ,
    initialP,
    initialSw,
    active,
    depthCenter,
  });
}

/** Дефолтный резервуар (seed=42, 50×50, 1×1 км). */
export function defaultField(): Reservoir {
  return generateDefaultField({ seed: 42 });
}
