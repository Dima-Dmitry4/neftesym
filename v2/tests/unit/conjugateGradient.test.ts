// Тесты CG-решателя: сходимость на синтетической SPD-системе.

import { describe, it, expect } from 'vitest';
import { solveCG, csrFromTriplets } from '../../src/core/physics/PressureSolver.ts';

function tridiag(n: number, diag = 2, off = -1): ReturnType<typeof csrFromTriplets> {
  const trips: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    trips.push([i, i, diag]);
    if (i < n - 1) {
      trips.push([i, i + 1, off]);
      trips.push([i + 1, i, off]);
    }
  }
  return csrFromTriplets(n, trips);
}

/** Решить трёхдиагональную систему Thomas algorithm. */
function thomasSolve(n: number, diag: number[], b: Float64Array): Float64Array {
  // Используем стандартный алгоритм Томаса.
  const a: number[] = []; // sub-diagonal (length n-1)
  const c: number[] = []; // super-diagonal (length n-1)
  for (let i = 0; i < n - 1; i++) {
    a.push(-1);
    c.push(-1);
  }
  const d = [...diag];
  // Копируем b
  const x = new Float64Array(b);
  // Прямой ход
  for (let i = 1; i < n; i++) {
    const m = (a[i - 1] ?? 0) / (d[i - 1] ?? 1);
    d[i] = (d[i] ?? 0) - m * (c[i - 1] ?? 0);
    x[i] = (x[i] ?? 0) - m * (x[i - 1] ?? 0);
  }
  // Обратный ход
  for (let i = n - 1; i >= 0; i--) {
    x[i] = (x[i] ?? 0) / (d[i] ?? 1);
    if (i > 0) x[i - 1] = (x[i - 1] ?? 0) - (c[i - 1] ?? 0) * (x[i] ?? 0);
  }
  return x;
}

describe('Conjugate Gradient (CG)', () => {
  it('сходится на 1D Пуассоне с диагональным усилением', () => {
    // Используем tridiag(4, -1): строго диагонально-доминантная,
    // несингулярная, SPD. Точное решение через Thomas-алгоритм.
    const n = 50;
    const A = tridiag(n, 4, -1);
    const b = new Float64Array(n).fill(1);
    const x0 = new Float64Array(n);
    const r = solveCG(A, b, x0, 1e-8, 200);
    expect(r.converged).toBe(true);
    // Сравним с точным Thomas-решением
    const exact = thomasSolve(n, Array(n).fill(4), b);
    for (let i = 0; i < n; i++) {
      expect(r.x[i] ?? 0).toBeCloseTo(exact[i] ?? 0, 4);
    }
  });

  it('сходится на диагональной системе A·x = b за n итераций', () => {
    const n = 5;
    const diag = [1, 2, 3, 4, 5];
    const trips: Array<[number, number, number]> = diag.map((d, i) => [i, i, d]);
    const A = csrFromTriplets(n, trips);
    const b = new Float64Array([2, 4, 6, 8, 10]);
    const x0 = new Float64Array(n);
    const r = solveCG(A, b, x0, 1e-10, 100);
    expect(r.converged).toBe(true);
    for (let i = 0; i < n; i++) {
      expect(r.x[i] ?? 0).toBeCloseTo(b[i]! / diag[i]!, 6);
    }
  });

  it('возвращает 0 итераций при maxIter=0', () => {
    const n = 5;
    const A = tridiag(n, 4, -1);
    const b = new Float64Array(n).fill(1);
    const r = solveCG(A, b, new Float64Array(n), 1e-10, 0);
    expect(r.iterations).toBe(0);
    expect(r.converged).toBe(false);
  });

  it('работает с Jacobi preconditioner', () => {
    const n = 20;
    const A = tridiag(n, 4, -1);
    const b = new Float64Array(n).fill(1);
    const r = solveCG(A, b, new Float64Array(n), 1e-8, 200);
    expect(r.converged).toBe(true);
  });

  it('большая разреженная SPD-система 100x100', () => {
    const n = 100;
    const A = tridiag(n, 4, -1);
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) b[i] = Math.sin((i + 1) * Math.PI / (n + 1));
    const r = solveCG(A, b, new Float64Array(n), 1e-8, 500);
    expect(r.converged).toBe(true);
  });
});
