// Заглушка для NPV (Phase 6). Сейчас — простая сумма DCF.

import type { CashFlowEntry } from './CashFlow.ts';

export function npv(cashFlow: readonly CashFlowEntry[]): number {
  let sum = 0;
  for (const cf of cashFlow) sum += cf.dcf;
  return sum;
}
