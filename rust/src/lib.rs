//! Вычислительное ядро симулятора для WebAssembly: проводимости граней, неявное давление (PCG с
//! Якоби-предобуславливателем), потоки через грани, явный перенос насыщенности против потока и шаг CFL.
//!
//! Статические свойства пласта хранятся в `Grid`; динамические массивы (давление, насыщенность, потоки,
//! поправки от скважин) живут в JS и передаются срезами. Формулы — те же, что в JS-ядре `#sim-core`
//! (линейные ОФП, гармоническое среднее k, среднее λt по грани), поэтому результаты совпадают с JS до
//! точности решателя. Скважины, оборудование и экономика остаются в JS: для решателя они дают только
//! добавки к диагонали и правой части.

use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn start() {
    // паника Rust иначе молча рвёт промис в JS — выводим её текст в консоль
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn version() -> String {
    "oilcore 0.1.0".into()
}

#[wasm_bindgen]
pub struct Grid {
    nx: usize,
    ny: usize,
    active: Vec<u8>,
    cells: Vec<usize>,
    k: Vec<f64>,
    tm_e: Vec<f64>,
    tm_n: Vec<f64>,
    pore: Vec<f64>,
    ct: f64,
    h: f64,
    swc: f64,
    sor: f64,
    sw_max: f64,
    mu_w: f64,
    mu_o: f64,
    conv_k: f64,
    // рабочие массивы решателя (по строкам матрицы = активным ячейкам)
    diag: Vec<f64>,
    b: Vec<f64>,
    x: Vec<f64>,
    res: Vec<f64>,
    z: Vec<f64>,
    pk: Vec<f64>,
    ap: Vec<f64>,
    // строка матрицы активной ячейки (usize::MAX — неактивна)
    row_of: Vec<usize>,
    // проводимости граней текущего решения (для A·v) и приращение насыщенности (перенос)
    te_cache: Vec<f64>,
    tn_cache: Vec<f64>,
    dsw: Vec<f64>,
    // DILU-предобуславливатель: обратные модифицированные диагонали
    dinv: Vec<f64>,
    /// предобуславливатель: true — DILU (неполное разложение, в 3–4 раза меньше итераций), false — Якоби (как в JS)
    pub dilu: bool,
    pub last_iters: u32,
    pub last_resid: f64,
    pub last_rhs0: f64,
}

#[inline]
fn krw(sw: f64, swc: f64, sor: f64) -> f64 {
    ((sw - swc) / (1.0 - swc - sor)).clamp(0.0, 1.0)
}
#[inline]
fn kro(sw: f64, swc: f64, sor: f64) -> f64 {
    ((1.0 - sor - sw) / (1.0 - swc - sor)).clamp(0.0, 1.0)
}

#[wasm_bindgen]
impl Grid {
    /// tm_e / tm_n — множители проводимости граней (разломы); пустой срез — все 1.
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        nx: usize, ny: usize, active: &[u8], k: &[f64], tm_e: &[f64], tm_n: &[f64], pore: &[f64],
        ct: f64, h: f64, swc: f64, sor: f64, sw_max: f64, mu_w: f64, mu_o: f64, conv_k: f64,
    ) -> Grid {
        let n = nx * ny;
        let cells: Vec<usize> = (0..n).filter(|&c| active[c] != 0).collect();
        let mut row_of = vec![usize::MAX; n];
        for (i, &c) in cells.iter().enumerate() {
            row_of[c] = i;
        }
        let m = cells.len();
        let ones = || vec![1.0; n];
        Grid {
            nx, ny, active: active.to_vec(), cells, k: k.to_vec(),
            tm_e: if tm_e.len() == n { tm_e.to_vec() } else { ones() },
            tm_n: if tm_n.len() == n { tm_n.to_vec() } else { ones() },
            pore: pore.to_vec(), ct, h, swc, sor, sw_max, mu_w, mu_o, conv_k,
            diag: vec![0.0; m], b: vec![0.0; m], x: vec![0.0; m], res: vec![0.0; m], z: vec![0.0; m],
            pk: vec![0.0; m], ap: vec![0.0; m], row_of, te_cache: vec![0.0; n], tn_cache: vec![0.0; n], dsw: vec![0.0; n],
            dinv: vec![0.0; m], dilu: true,
            last_iters: 0, last_resid: 0.0, last_rhs0: 0.0,
        }
    }

    #[inline]
    fn lambda_t(&self, sw: f64) -> f64 {
        krw(sw, self.swc, self.sor) / self.mu_w + kro(sw, self.swc, self.sor) / self.mu_o
    }
    #[inline]
    fn fw(&self, sw: f64) -> f64 {
        let a = krw(sw, self.swc, self.sor) / self.mu_w;
        let b = kro(sw, self.swc, self.sor) / self.mu_o;
        if a + b > 0.0 { a / (a + b) } else { 0.0 }
    }

    /// Проводимости восточной (te) и северной (tn) граней: CONV_K·k_гарм·h·½(λt_c + λt_nb)·множитель разлома.
    pub fn face_t(&self, sw: &[f64], te: &mut [f64], tn: &mut [f64]) {
        let (nx, n) = (self.nx, self.nx * self.ny);
        te.fill(0.0);
        tn.fill(0.0);
        for &c in &self.cells {
            let e = c + 1;
            let nn = c + nx;
            if c % nx < nx - 1 && self.active[e] != 0 {
                let kh = 2.0 * self.k[c] * self.k[e] / (self.k[c] + self.k[e]);
                te[c] = self.conv_k * kh * self.h * 0.5 * (self.lambda_t(sw[c]) + self.lambda_t(sw[e])) * self.tm_e[c];
            }
            if nn < n && self.active[nn] != 0 {
                let kh = 2.0 * self.k[c] * self.k[nn] / (self.k[c] + self.k[nn]);
                tn[c] = self.conv_k * kh * self.h * 0.5 * (self.lambda_t(sw[c]) + self.lambda_t(sw[nn])) * self.tm_n[c];
            }
        }
    }

    /// Неявное давление за шаг dt: (acc + ΣT + G)·P − ΣT·P_nb = acc·P_old + G·Pwf, где добавки скважин
    /// G и G·Pwf переданы по ячейкам (w_diag, w_rhs). P — на входе P_old (и начальное приближение), на выходе решение.
    /// Сходимость: |r| ≤ tol·|b| или maxit итераций (как в JS-ядре). Возвращает число итераций.
    #[allow(clippy::too_many_arguments)]
    pub fn solve(&mut self, te: &[f64], tn: &[f64], w_diag: &[f64], w_rhs: &[f64], dt: f64, p: &mut [f64], tol: f64, maxit: u32) -> u32 {
        let nx = self.nx;
        let m = self.cells.len();
        self.te_cache.copy_from_slice(te);
        self.tn_cache.copy_from_slice(tn);
        for i in 0..m {
            let c = self.cells[i];
            let acc = self.pore[c] * self.ct / dt;
            let mut d = acc + w_diag[c];
            if te[c] > 0.0 { d += te[c]; }
            if tn[c] > 0.0 { d += tn[c]; }
            if c % nx > 0 && te[c - 1] > 0.0 { d += te[c - 1]; }
            if c >= nx && tn[c - nx] > 0.0 { d += tn[c - nx]; }
            self.diag[i] = d;
            self.b[i] = acc * p[c] + w_rhs[c];
            self.x[i] = p[c];
        }
        // r = b − A·x
        self.apply_a_x();
        let mut rhs2 = 0.0;
        for i in 0..m {
            self.res[i] = self.b[i] - self.ap[i];
            rhs2 += self.b[i] * self.b[i];
        }
        let rhs0 = if rhs2 > 0.0 { rhs2.sqrt() } else { 1.0 };
        if self.dilu { self.dilu_factor(); }
        self.precond();
        let (mut rz, mut r2) = (0.0, 0.0);
        for i in 0..m {
            rz += self.res[i] * self.z[i];
            r2 += self.res[i] * self.res[i];
            self.pk[i] = self.z[i];
        }
        let mut iters = 0u32;
        let mut resid = r2.sqrt();
        while resid > tol * rhs0 && iters < maxit {
            self.apply_a_pk();
            let mut pap = 0.0;
            for i in 0..m { pap += self.pk[i] * self.ap[i]; }
            let ak = rz / pap;
            for i in 0..m {
                self.x[i] += ak * self.pk[i];
                self.res[i] -= ak * self.ap[i];
            }
            self.precond();
            let (mut rz_new, mut r2n) = (0.0, 0.0);
            for i in 0..m {
                rz_new += self.res[i] * self.z[i];
                r2n += self.res[i] * self.res[i];
            }
            let bk = rz_new / rz;
            for i in 0..m { self.pk[i] = self.z[i] + bk * self.pk[i]; }
            rz = rz_new;
            resid = r2n.sqrt();
            iters += 1;
        }
        for i in 0..m { p[self.cells[i]] = self.x[i]; }
        self.last_iters = iters;
        self.last_resid = resid;
        self.last_rhs0 = rhs0;
        iters
    }

    /// Потоки через грани по давлению: ue[c] > 0 — из c на восток, un[c] > 0 — из c на север.
    pub fn fluxes(&self, te: &[f64], tn: &[f64], p: &[f64], ue: &mut [f64], un: &mut [f64]) {
        let nx = self.nx;
        for &c in &self.cells {
            ue[c] = if te[c] > 0.0 { te[c] * (p[c] - p[c + 1]) } else { 0.0 };
            un[c] = if tn[c] > 0.0 { tn[c] * (p[c] - p[c + nx]) } else { 0.0 };
        }
    }

    /// Явный шаг переноса воды против потока: src — источник воды в ячейке, м³/сут (+закачка, −отбор воды).
    pub fn transport(&mut self, ue: &[f64], un: &[f64], src: &[f64], dt: f64, sw: &mut [f64]) {
        let (nx, n) = (self.nx, self.nx * self.ny);
        let mut d = std::mem::take(&mut self.dsw);
        for &c in &self.cells {
            let mut net = 0.0;
            if c % nx > 0 && self.active[c - 1] != 0 {
                let u = ue[c - 1];
                net += if u > 0.0 { u * self.fw(sw[c - 1]) } else { u * self.fw(sw[c]) };
            }
            if c % nx < nx - 1 && self.active[c + 1] != 0 {
                let u = ue[c];
                net += if u > 0.0 { -u * self.fw(sw[c]) } else { -u * self.fw(sw[c + 1]) };
            }
            if c >= nx && self.active[c - nx] != 0 {
                let u = un[c - nx];
                net += if u > 0.0 { u * self.fw(sw[c - nx]) } else { u * self.fw(sw[c]) };
            }
            if c + nx < n && self.active[c + nx] != 0 {
                let u = un[c];
                net += if u > 0.0 { -u * self.fw(sw[c]) } else { -u * self.fw(sw[c + nx]) };
            }
            d[c] = (net + src[c]) * dt / self.pore[c];
        }
        for &c in &self.cells {
            sw[c] = (sw[c] + d[c]).max(self.swc).min(self.sw_max);
        }
        self.dsw = d;
    }

    /// Шаг CFL: fac·Vp / max(приток, отток) по ячейкам (q_in — закачка, q_out — отбор скважин), не больше dt_max.
    pub fn cfl(&self, ue: &[f64], un: &[f64], q_in: &[f64], q_out: &[f64], fac: f64, dt_max: f64) -> f64 {
        let (nx, n) = (self.nx, self.nx * self.ny);
        let mut dt = dt_max;
        for &c in &self.cells {
            let (mut inflow, mut out) = (q_in[c], q_out[c]);
            if c % nx > 0 && self.active[c - 1] != 0 { let u = ue[c - 1]; if u > 0.0 { inflow += u } else { out -= u } }
            if c % nx < nx - 1 && self.active[c + 1] != 0 { let u = ue[c]; if u < 0.0 { inflow -= u } else { out += u } }
            if c >= nx && self.active[c - nx] != 0 { let u = un[c - nx]; if u > 0.0 { inflow += u } else { out -= u } }
            if c + nx < n && self.active[c + nx] != 0 { let u = un[c]; if u < 0.0 { inflow -= u } else { out += u } }
            let thr = inflow.max(out);
            if thr > 0.0 { dt = dt.min(fac * self.pore[c] / thr); }
        }
        dt
    }
}

impl Grid {
    // A·x и A·pk — по проводимостям текущего вызова solve (te_cache/tn_cache)
    // DILU для 5-точечной матрицы при естественном порядке: d_i = a_ii − Σ_{нижние соседи j} T_ij² / d_j
    // (нижние соседи — запад c−1 и юг c−nx: их строки меньше). M = (D + L)·D⁻¹·(D + U).
    fn dilu_factor(&mut self) {
        let nx = self.nx;
        let m = self.cells.len();
        for i in 0..m {
            let c = self.cells[i];
            let mut d = self.diag[i];
            if c % nx > 0 { let t = self.te_cache[c - 1]; if t > 0.0 { d -= t * t * self.dinv[self.row_of[c - 1]]; } }
            if c >= nx { let t = self.tn_cache[c - nx]; if t > 0.0 { d -= t * t * self.dinv[self.row_of[c - nx]]; } }
            self.dinv[i] = 1.0 / d;
        }
    }
    // z = M⁻¹·res: Якоби или DILU (прямой и обратный ход; внедиагональные элементы A = −T)
    fn precond(&mut self) {
        let m = self.cells.len();
        if !self.dilu {
            for i in 0..m { self.z[i] = self.res[i] / self.diag[i]; }
            return;
        }
        let nx = self.nx;
        for i in 0..m {
            let c = self.cells[i];
            let mut s = self.res[i];
            if c % nx > 0 { let t = self.te_cache[c - 1]; if t > 0.0 { s += t * self.z[self.row_of[c - 1]]; } }
            if c >= nx { let t = self.tn_cache[c - nx]; if t > 0.0 { s += t * self.z[self.row_of[c - nx]]; } }
            self.z[i] = s * self.dinv[i];
        }
        for i in (0..m).rev() {
            let c = self.cells[i];
            let mut s = 0.0;
            let t = self.te_cache[c]; if t > 0.0 { s += t * self.z[self.row_of[c + 1]]; }
            let t = self.tn_cache[c]; if t > 0.0 { s += t * self.z[self.row_of[c + nx]]; }
            self.z[i] += s * self.dinv[i];
        }
    }
    fn apply_a_x(&mut self) { self.apply(true) }
    fn apply_a_pk(&mut self) { self.apply(false) }
    fn apply(&mut self, use_x: bool) {
        let nx = self.nx;
        let m = self.cells.len();
        let (te, tn) = (&self.te_cache, &self.tn_cache);
        let v = if use_x { &self.x } else { &self.pk };
        for i in 0..m {
            let c = self.cells[i];
            let mut s = self.diag[i] * v[i];
            if te[c] > 0.0 { s -= te[c] * v[self.row_of[c + 1]]; }
            if tn[c] > 0.0 { s -= tn[c] * v[self.row_of[c + nx]]; }
            if c % nx > 0 && te[c - 1] > 0.0 { s -= te[c - 1] * v[self.row_of[c - 1]]; }
            if c >= nx && tn[c - nx] > 0.0 { s -= tn[c - nx] * v[self.row_of[c - nx]]; }
            self.ap[i] = s;
        }
    }
}
