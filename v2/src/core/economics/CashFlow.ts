// Заглушка для экономики (Phase 6). Минимально полезный API,
// чтобы CLI мог собирать cash flow, но NPV/IRR — на потом.

import type { HistoryEntry } from '../state/History.ts';
import { BARREL_PER_M3 } from '../units.ts';

export interface CashFlowParams {
  /** Цена нефти, USD/баррель. */
  oilPriceUsdPerBarrel: number;
  /** Стоимость закачки воды, USD/м³. */
  waterInjectionCostUsdPerM3: number;
  /** OPEX на скважину, USD/мес. */
  opexPerWellPerMonthUsd: number;
  /** CAPEX на скважину, USD. */
  capexPerWellUsd: number;
  /** Годовая ставка дисконтирования, доли. */
  discountRateAnnual: number;
  /** Число скважин. */
  wellCount: number;
}

/** Cash flow на интервале (USD). */
export interface CashFlowEntry {
  t: number;
  revenue: number;
  opex: number;
  waterCost: number;
  capex: number;
  net: number;
  discountFactor: number;
  dcf: number;
}

const HOURS_PER_YEAR = 24 * 365.25;

export function cashFlowFromHistory(
  history: readonly HistoryEntry[],
  params: CashFlowParams,
): CashFlowEntry[] {
  const out: CashFlowEntry[] = [];
  for (const h of history) {
    const years = h.t / HOURS_PER_YEAR;
    const discountFactor = Math.pow(1 + params.discountRateAnnual, -years);
    // cumOilTons (т) → m3 surface = tons * 1000 / rho → barrel = m3 * 6.29
    const rho = 850;
    const m3Surface = h.cumOilTons * (1000 / rho);
    const cumBarrel = m3Surface * BARREL_PER_M3;
    // revenue = ΔcumBarrel * price
    const prev = out.length > 0 ? out[out.length - 1] : undefined;
    const prevBarrel = prev ? prev.revenue / params.oilPriceUsdPerBarrel : 0;
    const revenue = (cumBarrel - prevBarrel) * params.oilPriceUsdPerBarrel;
    // OPEX: per well per month → per interval
    const months = (h.t - (prev?.t ?? 0)) / (24 * 30);
    const opex = params.opexPerWellPerMonthUsd * params.wellCount * months;
    const waterCost = h.waterInjInterval * params.waterInjectionCostUsdPerM3;
    const capex = 0;
    const net = revenue - opex - waterCost - capex;
    const dcf = net * discountFactor;
    out.push({ t: h.t, revenue, opex, waterCost, capex, net, discountFactor, dcf });
  }
  return out;
}
