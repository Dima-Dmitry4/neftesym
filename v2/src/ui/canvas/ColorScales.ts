// Цветовые шкалы для визуализации карт.
//
// Все шкалы принимают `t ∈ [0, 1]` и возвращают CSS-цвет.
// Используется только в UI (Canvas2D) — в core/ цвета не нужны.

/** RGB-цвет как триплет [0..255]. */
export type Rgb = readonly [number, number, number];

/** Интерполяция двух цветов. */
export function interpolateColor(c1: Rgb, c2: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * k),
    Math.round(c1[1] + (c2[1] - c1[1]) * k),
    Math.round(c1[2] + (c2[2] - c1[2]) * k),
  ];
}

/** RGB → CSS-строка. */
export function rgbToCss(c: Rgb): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Viridis-апроксимация (5 контрольных точек).
 *
 *  Реальный viridis — это 256 точек из matplotlib, но для
 *  Canvas-heatmap 50×50 (2500 ячеек) хватает 5 узлов с линейной
 *  интерполяцией: визуально почти неотличимо.
 */
const VIRIDIS_STOPS: readonly Rgb[] = [
  [68, 1, 84],   // 0.0  — тёмно-фиолетовый
  [59, 82, 139], // 0.25
  [33, 144, 141],// 0.5
  [94, 201, 98], // 0.75
  [253, 231, 37],// 1.0  — ярко-жёлтый
];

/** Цвет viridis для `t ∈ [0, 1]`. CSS-строка. */
export function viridis(t: number): string {
  return sampleStops(VIRIDIS_STOPS, t);
}

/** BrownBlue: для S_w.
 *
 *  t=0 — тёмно-коричневый (нефть, S_w ≈ S_wc).
 *  t=1 — насыщенный синий (вода, S_w ≈ 1 - S_or).
 *  Тонкая интерполяция через 5 узлов в стиле "petroleum" колора.
 */
const BROWN_BLUE_STOPS: readonly Rgb[] = [
  [40, 25, 15],   // 0.0  — почти чёрно-коричневый
  [120, 75, 35],  // 0.25 — охра
  [180, 150, 90], // 0.5  — бронза (фронт вытеснения)
  [80, 130, 180], // 0.75 — серо-синий
  [30, 80, 160],  // 1.0  — глубокий синий
];

/** Цвет brownBlue для `t ∈ [0, 1]`. CSS-строка. */
export function brownBlue(t: number): string {
  return sampleStops(BROWN_BLUE_STOPS, t);
}

function sampleStops(stops: readonly Rgb[], t: number): string {
  const x = Math.max(0, Math.min(1, t));
  if (x <= 0) return rgbToCss(stops[0] ?? [0, 0, 0]);
  const last = stops.length - 1;
  if (x >= 1) return rgbToCss(stops[last] ?? [0, 0, 0]);
  const pos = x * last;
  const i = Math.floor(pos);
  const frac = pos - i;
  const a = stops[i] ?? [0, 0, 0];
  const b = stops[i + 1] ?? a;
  return rgbToCss(interpolateColor(a, b, frac));
}

/** Линейная нормализация значения в [0, 1] по диапазону. */
export function normalize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || max <= min) return 0;
  return (value - min) / (max - min);
}
