/* Разреженные матрицы (CSR) и решатели: PCG+IC(0), BiCGStab+ILU(0). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.Pebi = root.Pebi || {}; Object.assign(root.Pebi, api); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // CSR-матрица с фиксированным шаблоном; индексы в каждой строке отсортированы.
  function CSR(n, indptr, indices, data) {
    this.n = n; this.indptr = indptr; this.indices = indices; this.data = data;
  }

  // Шаблон из записей (rows[k], cols[k]): сортировка по (строка, столбец), дедупликация.
  CSR.buildPattern = function (n, rows, cols) {
    var m = rows.length;
    var keys = new Float64Array(m);
    var order = new Array(m);
    for (var k = 0; k < m; k++) { keys[k] = rows[k] * n + cols[k]; order[k] = k; }
    order.sort(function (a, b) { return keys[a] - keys[b]; });
    var rowCounts = new Int32Array(n);
    var indices = new Int32Array(m);
    var w = 0, lastKey = NaN;
    for (k = 0; k < m; k++) {
      var t = order[k], key = keys[t];
      if (k === 0 || key !== lastKey) { indices[w++] = cols[t]; rowCounts[rows[t]]++; lastKey = key; }
    }
    var indptr = new Int32Array(n + 1), acc = 0;
    for (var i = 0; i < n; i++) { indptr[i] = acc; acc += rowCounts[i]; }
    indptr[n] = acc;
    return new CSR(n, indptr, indices.slice(0, w), new Float64Array(w));
  };

  CSR.prototype.pos = function (i, j) {
    var lo = this.indptr[i], hi = this.indptr[i + 1] - 1, idx = this.indices;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1, v = idx[mid];
      if (v === j) return mid;
      if (v < j) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  };

  CSR.prototype.zero = function () { this.data.fill(0); };

  CSR.prototype.add = function (i, j, v) {
    var p = this.pos(i, j);
    if (p < 0) throw new Error('CSR.add: элемент (' + i + ',' + j + ') вне шаблона');
    this.data[p] += v;
  };

  CSR.prototype.spmv = function (x, y) {
    var n = this.n, ip = this.indptr, ix = this.indices, d = this.data;
    for (var i = 0; i < n; i++) {
      var s = 0;
      for (var k = ip[i], e = ip[i + 1]; k < e; k++) s += d[k] * x[ix[k]];
      y[i] = s;
    }
  };

  function posInRow(idx, p0, p1, col) {
    var lo = p0, hi = p1 - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1, v = idx[mid];
      if (v === col) return mid;
      if (v < col) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  }

  // Неполное разложение Холецкого (IC(0)) для SPD-матрицы: A ~ L L^T.
  function ic0(A) {
    var n = A.n, ip = A.indptr, ix = A.indices, d = A.data;
    var cnt = 0, rowCounts = new Int32Array(n);
    var i, k;
    for (i = 0; i < n; i++)
      for (k = ip[i]; k < ip[i + 1]; k++) if (ix[k] <= i) { rowCounts[i]++; cnt++; }
    var lptr = new Int32Array(n + 1), lidx = new Int32Array(cnt), ldat = new Float64Array(cnt);
    var acc = 0;
    for (i = 0; i < n; i++) { lptr[i] = acc; acc += rowCounts[i]; }
    lptr[n] = acc;
    var w = 0;
    for (i = 0; i < n; i++)
      for (k = ip[i]; k < ip[i + 1]; k++) if (ix[k] <= i) lidx[w++] = ix[k];
    for (i = 0; i < n; i++) {
      var dSq = 0, j0 = lptr[i], j1 = lptr[i + 1];
      for (var kk = j0; kk < j1; kk++) {
        var j = lidx[kk];
        if (j === i) continue;
        var sum = d[posInRow(ix, ip[i], ip[i + 1], j)];
        var jp0 = lptr[j], jp1 = lptr[j + 1];
        for (var k2 = j0; k2 < kk; k2++) {
          var p = posInRow(lidx, jp0, jp1, lidx[k2]);
          if (p >= 0) sum -= ldat[k2] * ldat[p];
        }
        var ljj = ldat[posInRow(lidx, jp0, jp1, j)];
        if (!(ljj > 0)) throw new Error('IC0: матрица не SPD');
        ldat[kk] = sum / ljj;
        dSq += ldat[kk] * ldat[kk];
      }
      var aii = d[posInRow(ix, ip[i], ip[i + 1], i)];
      var dd = aii - dSq;
      // защита от потери SPD в IC(0): микро-сдвиг (предобуславливатель остается знакоопределенным)
      var floor = 1e-12 * Math.abs(aii) + 1e-300;
      if (!(dd > floor)) dd = floor;
      ldat[posInRow(lidx, j0, j1, i)] = Math.sqrt(dd);
    }
    return {
      solve: function (r, z) {
        var ii, k2, e2, s;
        for (ii = 0; ii < n; ii++) {
          s = r[ii];
          var dpos = lptr[ii + 1] - 1;
          for (k2 = lptr[ii]; k2 < dpos; k2++) s -= ldat[k2] * z[lidx[k2]];
          z[ii] = s / ldat[dpos];
        }
        for (ii = n - 1; ii >= 0; ii--) {
          var dpos2 = lptr[ii + 1] - 1;
          s = z[ii] / ldat[dpos2];
          for (k2 = lptr[ii]; k2 < dpos2; k2++) z[lidx[k2]] -= ldat[k2] * s;
          z[ii] = s;
        }
      }
    };
  }

  // ILU(0) (Saad) для несимметричной матрицы; L с единичной диагональю.
  function ilu0(A) {
    var n = A.n, ip = A.indptr, ix = A.indices;
    var f = Float64Array.from(A.data);
    var diagPos = new Int32Array(n);
    for (var i = 0; i < n; i++) {
      var pd = posInRow(ix, ip[i], ip[i + 1], i);
      if (pd < 0) throw new Error('ILU0: нет диагонали в строке ' + i);
      diagPos[i] = pd;
    }
    var marker = new Int32Array(n); // 0 = нет, иначе позиция+1
    var touched = [];
    for (i = 0; i < n; i++) {
      touched.length = 0;
      var e = ip[i + 1], k, k2;
      for (k = ip[i]; k < e; k++) { var c0 = ix[k]; if (marker[c0] === 0) touched.push(c0); marker[c0] = k + 1; }
      for (k = ip[i]; k < e; k++) {
        var j = ix[k];
        if (j >= i) break;
        f[k] /= f[diagPos[j]];
        var aik = f[k];
        for (k2 = ip[j]; k2 < ip[j + 1]; k2++) {
          var col2 = ix[k2];
          if (col2 <= j) continue;
          var mp = marker[col2];
          if (mp > 0) f[mp - 1] -= aik * f[k2];
        }
      }
      for (var tt = 0; tt < touched.length; tt++) marker[touched[tt]] = 0;
    }
    return {
      solve: function (r, z) {
        var ii, k2, e2, s;
        for (ii = 0; ii < n; ii++) {
          s = r[ii];
          for (k2 = ip[ii]; k2 < diagPos[ii]; k2++) s -= f[k2] * z[ix[k2]];
          z[ii] = s;
        }
        for (ii = n - 1; ii >= 0; ii--) {
          s = z[ii];
          for (k2 = diagPos[ii] + 1; k2 < ip[ii + 1]; k2++) s -= f[k2] * z[ix[k2]];
          z[ii] = s / f[diagPos[ii]];
        }
      }
    };
  }

  // Предобусловленный CG (для SPD).
  function pcg(A, b, opts) {
    var n = A.n, tol = (opts && opts.tol) || 1e-10, maxit = (opts && opts.maxit) || 1000;
    var M = opts && opts.M;
    var x = (opts && opts.x0) ? Float64Array.from(opts.x0) : new Float64Array(n);
    var r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n), Ap = new Float64Array(n);
    var i;
    A.spmv(x, Ap);
    for (i = 0; i < n; i++) r[i] = b[i] - Ap[i];
    var bnorm = nrm2(b); if (bnorm === 0) bnorm = 1;
    if (M) M.solve(r, z); else z.set(r);
    p.set(z);
    var rz = dot(r, z), iters = 0, relres = nrm2(r) / bnorm;
    while (relres > tol && iters < maxit) {
      A.spmv(p, Ap);
      var alpha = rz / dot(p, Ap);
      for (i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; }
      iters++;
      relres = nrm2(r) / bnorm;
      if (relres <= tol) break;
      if (M) M.solve(r, z); else z.set(r);
      var rzn = dot(r, z);
      var beta = rzn / rz;
      for (i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
      rz = rzn;
    }
    return { x: x, iters: iters, relres: relres, converged: relres <= tol };
  }

  // Предобусловленный BiCGStab (для несимметричных систем транспорта).
  function bicgstab(A, b, opts) {
    var n = A.n, tol = (opts && opts.tol) || 1e-8, maxit = (opts && opts.maxit) || 500;
    var M = opts && opts.M;
    var x = (opts && opts.x0) ? Float64Array.from(opts.x0) : new Float64Array(n);
    var r = new Float64Array(n), r0 = new Float64Array(n), v = new Float64Array(n);
    var p = new Float64Array(n), s = new Float64Array(n), t = new Float64Array(n);
    var ph = new Float64Array(n), sh = new Float64Array(n), tmp = new Float64Array(n);
    var i;
    A.spmv(x, tmp);
    for (i = 0; i < n; i++) { r[i] = b[i] - tmp[i]; r0[i] = r[i]; }
    var bnorm = nrm2(b); if (bnorm === 0) bnorm = 1;
    var relres = nrm2(r) / bnorm;
    var rho = 1, alpha = 1, omega = 1, iters = 0;
    while (relres > tol && iters < maxit) {
      var rhoNew = dot(r0, r);
      if (!isFinite(rhoNew) || rhoNew === 0) break;
      var beta = (rhoNew / rho) * (alpha / omega);
      for (i = 0; i < n; i++) p[i] = r[i] + beta * (p[i] - omega * v[i]);
      if (M) M.solve(p, ph); else ph.set(p);
      A.spmv(ph, v);
      var r0v = dot(r0, v);
      if (r0v === 0 || !isFinite(r0v)) break;
      alpha = rhoNew / r0v;
      for (i = 0; i < n; i++) s[i] = r[i] - alpha * v[i];
      var snrm = nrm2(s) / bnorm;
      if (snrm <= tol) {
        for (i = 0; i < n; i++) x[i] += alpha * ph[i];
        relres = snrm; iters++;
        break;
      }
      if (M) M.solve(s, sh); else sh.set(s);
      A.spmv(sh, t);
      var tt = dot(t, t);
      omega = tt > 0 ? dot(t, s) / tt : 0;
      for (i = 0; i < n; i++) { x[i] += alpha * ph[i] + omega * sh[i]; r[i] = s[i] - omega * t[i]; }
      relres = nrm2(r) / bnorm;
      rho = rhoNew; iters++;
      if (omega === 0) break;
    }
    return { x: x, iters: iters, relres: relres, converged: relres <= tol };
  }

  function dot(a, b) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }
  function nrm2(a) { return Math.sqrt(dot(a, a)); }

  return { CSR: CSR, ic0: ic0, ilu0: ilu0, pcg: pcg, bicgstab: bicgstab, dot: dot, nrm2: nrm2, posInRow: posInRow };
});
