"""minisim – учебный двухфазный симулятор «как в Нефтяше», но на 200 строк Python + numpy.

Те же формулы, что в ядре игры (см. главу «Как считает симулятор»):
  * закон Дарси в практических единицах: q = CONV_K * k*A/mu * dP/L, CONV_K = 0.00864;
  * сетка ячеек, двухточечная аппроксимация (TPFA): T = CONV_K * k_harm * h * lambda_t (dx/dx сокращается);
  * разлом – множитель проводимости граней, которые он пересекает (0 – запечатан);
  * давление неявно (метод сопряжённых градиентов без сборки матрицы, предобуславливатель Якоби);
  * насыщенность явно, против потока (upwind), шаг по условию Куранта;
  * скважина по Писману: q = WI * lambda_t * (P_ячейки - Pwf), WI = CONV_K*2*pi*k*h / (ln(re/rw) + s), re = 0.2*dx.
Единицы: атм, мД, сП, м, м³/сут, сут. Массивы полей – [j, i]: j – строка (север сверху), i – столбец (восток вправо).
"""
import numpy as np

CONV_K = 0.00864  # м³/сут·сП / (мД·м·атм)


def krw(Sw, Swc=0.2, Sor=0.25):
    return np.clip((Sw - Swc) / (1 - Swc - Sor), 0, 1)


def kro(Sw, Swc=0.2, Sor=0.25):
    return np.clip((1 - Sor - Sw) / (1 - Swc - Sor), 0, 1)


def fw(Sw, mu_o=5.0, mu_w=1.0, Swc=0.2, Sor=0.25):
    lw, lo = krw(Sw, Swc, Sor) / mu_w, kro(Sw, Swc, Sor) / mu_o
    return np.where(lw + lo > 0, lw / np.maximum(lw + lo, 1e-30), 0.0)


def peaceman_wi(k, h, dx, rw=0.1, skin=0.0):
    """Индекс скважины Писмана, м³/сут/атм на единицу подвижности (1/сП)."""
    return CONV_K * 2 * np.pi * k * h / max(0.5, np.log(0.2 * dx / rw) + skin)


def _seg_cross(a, b, c, d):
    o = lambda p, q, r: (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    return o(a, b, c) * o(a, b, d) < 0 and o(c, d, a) * o(c, d, b) < 0


class Model:
    """Пласт nx×ny ячеек с шагом dx, толщиной h, пористостью phi; k – число или массив [ny, nx], мД."""

    def __init__(self, nx=50, ny=50, dx=40.0, h=10.0, phi=0.2, k=100.0,
                 mu_o=5.0, mu_w=1.0, Swc=0.2, Sor=0.25, ct=1e-4, P0=250.0):
        self.nx, self.ny, self.dx, self.h, self.phi = nx, ny, dx, h, phi
        self.k = np.full((ny, nx), float(k)) if np.isscalar(k) else np.asarray(k, float)
        self.mu_o, self.mu_w, self.Swc, self.Sor, self.ct = mu_o, mu_w, Swc, Sor, ct
        self.Vp = dx * dx * h * phi * np.ones((ny, nx))  # поровый объём ячейки, м³
        self.P = np.full((ny, nx), float(P0))
        self.Sw = np.full((ny, nx), float(Swc))
        self.mE = np.ones((ny, nx - 1))  # множители проводимости граней «на восток»
        self.mN = np.ones((ny - 1, nx))  # и «на север» (между строкой j и j+1)
        self.faults, self.wells, self.t = [], [], 0.0
        self.iters = 0

    # ---------- геометрия ----------
    def add_fault(self, pts, trans=0.0, name=None):
        """Разлом – ломаная pts=[(i, j), ...] в координатах ячеек (центр ячейки (i, j) – точка (i, j))."""
        for j in range(self.ny):
            for i in range(self.nx):
                for a, b in zip(pts[:-1], pts[1:]):
                    if i + 1 < self.nx and _seg_cross((i, j), (i + 1, j), a, b):
                        self.mE[j, i] = min(self.mE[j, i], trans)
                    if j + 1 < self.ny and _seg_cross((i, j), (i, j + 1), a, b):
                        self.mN[j, i] = min(self.mN[j, i], trans)
        self.faults.append(dict(pts=pts, trans=trans, name=name or f"F-{len(self.faults) + 1}"))

    def add_well(self, i, j, kind="prod", pwf=None, skin=0.0, name=None):
        """Скважина в ячейке (i, j) с заданным забойным давлением pwf (атм): kind = 'prod' | 'inj'."""
        pwf = pwf if pwf is not None else (150.0 if kind == "prod" else 325.0)
        n = sum(w["kind"] == kind for w in self.wells) + 1
        self.wells.append(dict(i=i, j=j, kind=kind, pwf=pwf, skin=skin, q=0.0, qo=0.0, qw=0.0,
                               cum_o=0.0, cum_w=0.0, cum_inj=0.0, name=name or ("Д-" if kind == "prod" else "Н-") + str(n)))

    # ---------- подвижности и проводимости ----------
    def lam_t(self):
        return krw(self.Sw, self.Swc, self.Sor) / self.mu_w + kro(self.Sw, self.Swc, self.Sor) / self.mu_o

    def transmissibility(self):
        k, lt = self.k, self.lam_t()
        kE = 2 * k[:, :-1] * k[:, 1:] / (k[:, :-1] + k[:, 1:])       # гармоническое среднее
        kN = 2 * k[:-1, :] * k[1:, :] / (k[:-1, :] + k[1:, :])
        TE = CONV_K * kE * self.h * 0.5 * (lt[:, :-1] + lt[:, 1:]) * self.mE
        TN = CONV_K * kN * self.h * 0.5 * (lt[:-1, :] + lt[1:, :]) * self.mN
        return TE, TN

    def well_G(self):
        """Проводимость скважина–ячейка G = WI·λt по каждой скважине."""
        lt = self.lam_t()
        return [peaceman_wi(self.k[w["j"], w["i"]], self.h, self.dx, skin=w["skin"]) * lt[w["j"], w["i"]] for w in self.wells]

    # ---------- давление: (Vp·ct/dt)(P − Pold) = Σ T (Pnb − P) + G (Pwf − P) ----------
    def _apply(self, P, acc, TE, TN, Gm):
        out = (acc + Gm) * P
        fE = TE * (P[:, :-1] - P[:, 1:]); out[:, :-1] += fE; out[:, 1:] -= fE
        fN = TN * (P[:-1, :] - P[1:, :]); out[:-1, :] += fN; out[1:, :] -= fN
        return out

    def solve_pressure(self, dt=1.0, tol=1e-6, maxit=2000):
        """Неявный шаг давления длиной dt сут (dt=None – стационарное решение без упругого запаса)."""
        TE, TN = self.transmissibility()
        acc = np.zeros_like(self.P) if dt is None else self.Vp * self.ct / dt
        Gm, rhs = np.zeros_like(self.P), acc * self.P
        for w, G in zip(self.wells, self.well_G()):
            if w.get("on", True):
                Gm[w["j"], w["i"]] += G; rhs[w["j"], w["i"]] += G * w["pwf"]
        diag = acc + Gm
        diag[:, :-1] += TE; diag[:, 1:] += TE; diag[:-1, :] += TN; diag[1:, :] += TN
        # метод сопряжённых градиентов с предобуславливателем Якоби, тёплый старт от текущего P
        x = self.P.copy()
        r = rhs - self._apply(x, acc, TE, TN, Gm)
        z = r / diag; p = z.copy(); rz = np.sum(r * z); r0 = np.sqrt(np.sum(rhs * rhs)) + 1e-30
        for it in range(maxit):
            if np.sqrt(np.sum(r * r)) / r0 < tol:
                break
            Ap = self._apply(p, acc, TE, TN, Gm)
            a = rz / np.sum(p * Ap)
            x += a * p; r -= a * Ap
            z = r / diag; rz_new = np.sum(r * z); p = z + (rz_new / rz) * p; rz = rz_new
        self.iters = it
        self.P = x
        return TE, TN

    # ---------- дебиты скважин и перенос воды ----------
    def well_rates(self):
        f = fw(self.Sw, self.mu_o, self.mu_w, self.Swc, self.Sor)
        for w, G in zip(self.wells, self.well_G()):
            Pc = self.P[w["j"], w["i"]]
            if not w.get("on", True):
                w["q"] = w["qo"] = w["qw"] = 0.0
            elif w["kind"] == "prod":
                w["q"] = max(0.0, G * (Pc - w["pwf"]))  # добывающая не может нагнетать
                w["qw"] = w["q"] * f[w["j"], w["i"]]; w["qo"] = w["q"] - w["qw"]
            else:
                w["q"] = max(0.0, G * (w["pwf"] - Pc)); w["qw"] = w["q"]; w["qo"] = 0.0

    def step(self, dt=1.0, courant=0.5):
        """Один шаг IMPES: давление неявно на dt, затем вода явно субшагами CFL ровно на этот интервал."""
        TE, TN = self.solve_pressure(dt)
        uE = TE * (self.P[:, :-1] - self.P[:, 1:])  # м³/сут, > 0 – на восток
        uN = TN * (self.P[:-1, :] - self.P[1:, :])  # > 0 – из строки j в j+1 (на юг)
        self.well_rates()
        src_in, src_out = np.zeros_like(self.P), np.zeros_like(self.P)
        for w in self.wells:
            (src_in if w["kind"] == "inj" else src_out)[w["j"], w["i"]] += w["q"]
        inflow = src_in.copy(); outflow = src_out.copy()
        inflow[:, 1:] += np.maximum(uE, 0); outflow[:, :-1] += np.maximum(uE, 0)
        inflow[:, :-1] += np.maximum(-uE, 0); outflow[:, 1:] += np.maximum(-uE, 0)
        inflow[1:, :] += np.maximum(uN, 0); outflow[:-1, :] += np.maximum(uN, 0)
        inflow[:-1, :] += np.maximum(-uN, 0); outflow[1:, :] += np.maximum(-uN, 0)
        s = np.linspace(self.Swc, 1 - self.Sor, 200)
        slope = np.max(np.diff(fw(s, self.mu_o, self.mu_w, self.Swc, self.Sor))) / (s[1] - s[0]) * (1 - self.Swc - self.Sor)
        dt_cfl = courant / max(slope, 1.0) * (1 - self.Swc - self.Sor) * np.min(self.Vp / np.maximum(np.maximum(inflow, outflow), 1e-12))
        t = 0.0
        while t < dt - 1e-9:
            d = min(dt - t, dt_cfl)
            f = fw(self.Sw, self.mu_o, self.mu_w, self.Swc, self.Sor)
            wE = np.where(uE > 0, f[:, :-1], f[:, 1:]) * uE
            wN = np.where(uN > 0, f[:-1, :], f[1:, :]) * uN
            div = np.zeros_like(self.P)
            div[:, :-1] -= wE; div[:, 1:] += wE; div[:-1, :] -= wN; div[1:, :] += wN
            for w in self.wells:
                jj, ii = w["j"], w["i"]
                if w["kind"] == "inj":
                    div[jj, ii] += w["q"]; w["cum_inj"] += w["q"] * d
                else:
                    div[jj, ii] -= w["q"] * f[jj, ii]
                    w["cum_w"] += w["q"] * f[jj, ii] * d; w["cum_o"] += w["q"] * (1 - f[jj, ii]) * d
            self.Sw = np.clip(self.Sw + d / self.Vp * div, self.Swc, 1.0)
            t += d
        self.t += dt

    def run(self, days, dt=5.0, every=None, callback=None):
        """Расчёт на days суток шагами давления dt; callback(model) каждые every суток."""
        n = int(round(days / dt))
        for k in range(n):
            self.step(dt)
            if callback and every and (k + 1) * dt % every < 1e-9:
                callback(self)
        return self

    def ooip(self):
        return float(np.sum(self.Vp * (1 - self.Swc)))

    def report(self):
        for w in self.wells:
            if w["kind"] == "prod":
                print(f"{w['name']}: q = {w['q']:7.1f} м³/сут, обводн. {100 * w['qw'] / max(w['q'], 1e-9):5.1f} %, "
                      f"нефть накоп. {w['cum_o'] * 0.86 / 1000:8.1f} тыс. т")
            else:
                print(f"{w['name']}: закачка {w['q']:7.1f} м³/сут, накоп. {w['cum_inj'] / 1000:8.1f} тыс. м³")


# ---------- рисунки ----------
def show_map(model, field="P", ax=None, title=None, cmap=None, label=None, wells=True, faults=True, **kw):
    """Карта поля model.P / model.Sw / model.k (или массива) с разломами и скважинами."""
    import matplotlib.pyplot as plt
    data = getattr(model, field) if isinstance(field, str) else field
    name = field if isinstance(field, str) else ""
    cmap = cmap or {"P": "Oranges", "Sw": "Blues", "k": "Greens"}.get(name, "viridis")
    label = label or {"P": "давление, атм", "Sw": "водонасыщенность", "k": "проницаемость, мД"}.get(name, "")
    if ax is None:
        fig, ax = plt.subplots(figsize=(5.4, 4.6))
    im = ax.imshow(data, cmap=cmap, origin="upper", extent=(-0.5, model.nx - 0.5, model.ny - 0.5, -0.5), **kw)
    plt.colorbar(im, ax=ax, label=label, shrink=0.85)
    if faults:
        for F in model.faults:
            xs, ys = zip(*F["pts"])
            ax.plot(xs, ys, "--", color="#e34948", lw=2.2)
            ax.text(xs[1] + 0.7, ys[1], F["name"] + (" (герм.)" if F["trans"] == 0 else f" (×{F['trans']})"), color="#e34948", fontsize=9, fontweight="bold")
    if wells:
        for w in model.wells:
            if w["kind"] == "prod":
                ax.plot(w["i"], w["j"], "o", ms=8, mfc="white", mec="black", mew=1.8)
            else:
                ax.plot(w["i"], w["j"], "^", ms=10, mfc="#2a78d6", mec="white")
            ax.annotate(w["name"], (w["i"], w["j"]), textcoords="offset points", xytext=(0, 8), ha="center", fontsize=9, fontweight="bold")
    ax.set_xlim(-0.5, model.nx - 0.5); ax.set_ylim(model.ny - 0.5, -0.5)
    ax.set_xlabel("i (восток →)"); ax.set_ylabel("j (юг ↓)")
    ax.grid(False)
    if title:
        ax.set_title(title)
    return ax
