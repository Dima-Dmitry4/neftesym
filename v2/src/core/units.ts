// Константы единиц измерения и единственные допустимые конверсии.
//
// Проект использует **полевые метрические** единицы повсюду —
// и в коде, и в UI. Никаких переводов давления, проницаемости,
// вязкости внутри формул: они пишутся так, как в учебнике.
//
// `units.ts` хранит только:
// 1) коэффициенты для формул (C_DARCY для Дарси/Писмана),
// 2) пересчёт м³ ↔ т для нефти (для экономики),
// 3) пересчёт ч ↔ мс для Date в UI.
//
// Любая конверсия вне этого файла — code smell, ревью.

/** Переводной множитель Дарси для полевых метрических единиц.
 *
 *  q [м³/сут] = C_DARCY · k [мД] · A [м²] · ΔP [атм]
 *             / (μ [сП] · B [м³/м³] · L [м])
 *
 *  Вывод: см. plan.md §3.6.
 */
export const C_DARCY = 0.0543;

/** Атмосфера техническая → Па. */
export const PA_PER_ATM = 98_066.5;

/** Миллидарр → м². */
export const M2_PER_MD = 9.869_233e-16;

/** Центпуаз → Па·с. */
export const PA_S_PER_CP = 1e-3;

/** Секунд в часе. */
export const SEC_PER_HOUR = 3600;

/** Часов в сутках. */
export const HOURS_PER_DAY = 24;

/** Секунд в сутках. */
export const SEC_PER_DAY = SEC_PER_HOUR * HOURS_PER_DAY;

/** Баррелей в м³. */
export const BARREL_PER_M3 = 6.2898;

/** М³ в барреле. */
export const M3_PER_BARREL = 1 / BARREL_PER_M3;

/** Пересчёт м³ (поверхн.) → т (масса нефти) при известных ρ, B. */
export function surfaceM3ToTons(surfaceM3: number, rhoSurface: number): number {
  return (surfaceM3 * rhoSurface) / 1000; // кг → т
}

/** Пересчёт т (масса нефти) → м³ (поверхн.) при известной ρ. */
export function tonsToSurfaceM3(tons: number, rhoSurface: number): number {
  return (tons * 1000) / rhoSurface;
}

/** Пересчёт reservoir m³ → surface m³. */
export function reservoirM3ToSurfaceM3(resM3: number, b: number): number {
  return resM3 / b;
}

/** Пересчёт surface m³ → reservoir m³. */
export function surfaceM3ToReservoirM3(surfM3: number, b: number): number {
  return surfM3 * b;
}

/** Reservoir m³/сут → surface m³/сут. */
export function resRateToSurface(resRate: number, b: number): number {
  return resRate / b;
}

/** Reservoir m³/сут → тонны/сут (массовый дебит нефти). */
export function resOilRateToTons(
  resRate: number,
  bOil: number,
  rhoSurface: number,
): number {
  return surfaceM3ToTons(reservoirM3ToSurfaceM3(resRate, bOil), rhoSurface);
}

/** Безопасно получить devicePixelRatio (1 в node-среде, без `window`). */
export function getDevicePixelRatio(): number {
  if (typeof globalThis !== 'undefined') {
    const w = (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
    if (typeof w === 'number' && isFinite(w) && w > 0) return w;
  }
  return 1;
}
