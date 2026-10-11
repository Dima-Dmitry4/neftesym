// Применение скважин: для каждой вычисляем дебит/приёмистость
// нефти и воды по Писману, добавляем вклад в систему давления и
// возвращаем массив состояний для отчёта.
//
// Для каждой скважины считаем J_base — phase-independent Peaceman
// constant: J_base = 2π · k · h · C_DARCY / ln(r_e / r_w).
//
// Тогда:
//   J_α = J_base / (μ_α · B_α)
//   q_α = J_α · k_rα · (P_cell - BHP)   (producer)
//   q_α = J_α · k_rα · (BHP - P_cell)   (injector, только вода)
//
// Знаки: q_total > 0 — добыча (отток), q_total < 0 — закачка (приток).
// В матрице давления скважина вносит:
//   A_ii += J_base · λ_t
//   b_i  += J_base · λ_t · BHP

import { coreyRelPerm, mobility } from '../properties/Corey.ts';
import type { RelPermParameters } from '../properties/RelativePermeability.ts';
import type { FluidProperties } from '../properties/FluidProperties.ts';
import { C_DARCY } from '../units.ts';
import { peacemanEquivalentRadius } from '../physics/WellIndex.ts';
import type { Reservoir } from '../grid/Reservoir.ts';
import type { Well } from './Well.ts';

export interface WellState {
  wellId: string;
  /** Давление в ячейке (атм). */
  pCell: number;
  /** BHP скважины (атм). */
  bhp: number;
  /** Phase-independent J_base (м³/(сут·атм)·(сП·B)). */
  jBase: number;
  /** λ_t = k_ro/(μ_o·B_o) + k_rw/(μ_w·B_w). */
  lambdaTotal: number;
  /** λ_w = k_rw/(μ_w·B_w). */
  lambdaWater: number;
  /** Дебит нефти (м³/сут в пласте). Положительный = добыча. */
  qOil: number;
  /** Дебит воды (м³/сут в пласте). Положительный = добыча,
   *  отрицательный — закачка. */
  qWater: number;
  /** Суммарный дебит жидкости (м³/сут). */
  qLiq: number;
  /** Обводнённость = qWater / qLiq (для producer, 0 для injector). */
  waterCut: number;
  /** Индекс ячейки (для интеграции в давление). */
  cellIndex: number;
  /** Тип скважины. */
  type: 'producer' | 'injector';
}

export interface ApplyWellsResult {
  states: WellState[];
  /** Массив длинной nCells: для каждой ячейки — индекс скважины
   *  в массиве wells, или -1, если скважин нет. */
  wellsByCell: Int32Array;
  totalProduction: number;
  totalInjection: number;
}

/** Вычислить J_base по Писману (phase-independent).
 *  J_base = 2π · k · h · C_DARCY / ln(r_e / r_w + S). */
function peacemanBase(
  k: number,
  h: number,
  rw: number,
  skin: number,
  dx: number,
  dy: number,
): number {
  if (k <= 0 || h <= 0 || rw <= 0) return 0;
  const re = peacemanEquivalentRadius(dx, dy);
  if (re <= rw) return 0;
  const denom = Math.log(re / rw) + skin;
  if (denom <= 0) return 0;
  return (C_DARCY * 2 * Math.PI * k * h) / denom;
}

/** Применить BHP-контроль к набору скважин. */
export function applyWells(
  reservoir: Reservoir,
  p: Float64Array,
  sw: Float64Array,
  wells: readonly Well[],
  relperm: RelPermParameters,
  fluid: FluidProperties,
): ApplyWellsResult {
  const states: WellState[] = [];
  const nCells = reservoir.grid.nCells;
  const wellsByCell = new Int32Array(nCells).fill(-1);
  let totalProduction = 0;
  let totalInjection = 0;
  for (let w = 0; w < wells.length; w++) {
    const well = wells[w];
    if (!well) continue;
    const idx = reservoir.grid.cellIndex(well.i, well.j);
    if (idx < 0 || idx >= nCells) {
      throw new Error(`Well ${well.id} at (${well.i},${well.j}) is out of grid`);
    }
    const pCell = p[idx] ?? 0;
    const swCell = sw[idx] ?? relperm.swc;
    const k = reservoir.permX[idx] ?? 0;
    const h = reservoir.thickness[idx] ?? 0;
    const jBase = peacemanBase(k, h, well.rw, well.skin, reservoir.grid.dx, reservoir.grid.dy);
    if (!reservoir.active[idx] || jBase <= 0) {
      wellsByCell[idx] = w;
      states.push({
        wellId: well.id,
        pCell,
        bhp: well.bhpAtm,
        jBase: 0,
        lambdaTotal: 0,
        lambdaWater: 0,
        qOil: 0,
        qWater: 0,
        qLiq: 0,
        waterCut: 0,
        cellIndex: idx,
        type: well.type,
      });
      continue;
    }
    wellsByCell[idx] = w;
    const kr = coreyRelPerm(swCell, relperm);
    const lambdaOil = mobility(kr.kro, fluid.muOilCP, fluid.bo);
    const lambdaWater = mobility(kr.krw, fluid.muWaterCP, fluid.bw);
    const lambdaTotal = lambdaOil + lambdaWater;
    if (well.type === 'producer') {
      const dP = pCell - well.bhpAtm;
      let qOil = 0;
      let qWater = 0;
      if (dP > 0) {
        qOil = jBase * lambdaOil * dP;
        qWater = jBase * lambdaWater * dP;
        const qLiqRaw = qOil + qWater;
        const limit = well.rateLimit ?? 0;
        if (limit > 0 && qLiqRaw > limit) {
          const scale = limit / qLiqRaw;
          qOil *= scale;
          qWater *= scale;
        }
      }
      const qLiq = qOil + qWater;
      states.push({
        wellId: well.id,
        pCell,
        bhp: well.bhpAtm,
        jBase,
        lambdaTotal,
        lambdaWater,
        qOil,
        qWater,
        qLiq,
        waterCut: qLiq > 0 ? qWater / qLiq : 0,
        cellIndex: idx,
        type: well.type,
      });
      totalProduction += qLiq;
    } else {
      // injector
      const dP = well.bhpAtm - pCell;
      let qWater = 0;
      if (dP > 0) {
        qWater = jBase * lambdaWater * dP;
        const limit = well.rateLimit ?? 0;
        if (limit > 0 && qWater > limit) qWater = limit;
      }
      states.push({
        wellId: well.id,
        pCell,
        bhp: well.bhpAtm,
        jBase,
        lambdaTotal: lambdaWater, // для injector в матрицу идёт только вода
        lambdaWater,
        qOil: 0,
        qWater: -qWater, // знак: отрицательный = закачка
        qLiq: -qWater,
        waterCut: 0,
        cellIndex: idx,
        type: well.type,
      });
      totalInjection -= qWater;
    }
  }
  return { states, wellsByCell, totalProduction, totalInjection };
}
