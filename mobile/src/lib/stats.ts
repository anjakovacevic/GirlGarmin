/** Small numeric helpers standing in for pandas / numpy. Missing values are null and are skipped,
 * as pandas skips NaN. */

export type Num = number | null;

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const nums = (xs: readonly unknown[]): number[] => xs.filter(isNum);

export function sum(xs: readonly unknown[]): number {
  return nums(xs).reduce((a, b) => a + b, 0);
}

export function mean(xs: readonly unknown[]): Num {
  const v = nums(xs);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function median(xs: readonly unknown[]): Num {
  const v = nums(xs).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function max(xs: readonly unknown[]): Num {
  const v = nums(xs);
  return v.length ? Math.max(...v) : null;
}

export function min(xs: readonly unknown[]): Num {
  const v = nums(xs);
  return v.length ? Math.min(...v) : null;
}

/** Least-squares straight line (numpy.polyfit(x, y, 1)). */
export function polyfit(x: number[], y: number[]): { slope: number; intercept: number } {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
  }
  const slope = sxx ? sxy / sxx : 0;
  return { slope, intercept: my - slope * mx };
}

/** Pearson correlation over the pairs where both values exist (pandas Series.corr). */
export function corr(a: readonly Num[], b: readonly Num[]): Num {
  const x: number[] = [];
  const y: number[] = [];
  a.forEach((v, i) => {
    if (isNum(v) && isNum(b[i])) {
      x.push(v);
      y.push(b[i] as number);
    }
  });
  if (x.length < 2) return null;
  const mx = x.reduce((s, v) => s + v, 0) / x.length;
  const my = y.reduce((s, v) => s + v, 0) / y.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Python's round(v, digits): rounds the exact binary value, and exact halves go to the even
 * neighbour (2.5 -> 2, 0.125 -> 0.12, while 2.05 -> 2.0 because 2.05 is really 2.04999...). */
export function round(v: number, digits = 0): number {
  if (!Number.isFinite(v)) return v;
  const [int, frac] = Math.abs(v).toFixed(100).split('.'); // toFixed(100) is the exact binary value
  const keep = frac.slice(0, digits);
  const rest = frac.slice(digits);
  const last = Number((digits ? keep : int).slice(-1));
  const up = rest[0] > '5' || (rest[0] === '5' && (/[1-9]/.test(rest.slice(1)) || last % 2 === 1));
  const r = Number(`${int}.${keep || '0'}`) + (up ? 10 ** -digits : 0);
  return Math.sign(v) * Number(r.toFixed(digits));
}

export const roundHalfEven = (v: number): number => round(v, 0);

/** Group rows by a key, keeping first-seen order. */
export function groupBy<T, K>(rows: readonly T[], key: (r: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const g = m.get(k);
    if (g) g.push(r);
    else m.set(k, [r]);
  }
  return m;
}

/** Number formatting like Python's f"{v:.1f}"; '-' when missing. */
export function fmt(v: unknown, digits = 0, suffix = ''): string {
  return isNum(v) ? round(v, digits).toFixed(digits) + suffix : '-';
}

/** f"{v:+.1f}" */
export function fmtSigned(v: number, digits = 0, suffix = ''): string {
  const s = round(v, digits).toFixed(digits);
  return (v >= 0 && !s.startsWith('-') ? '+' : '') + s + suffix;
}

/** f"{v:g}": 60 -> "60", 62.5 -> "62.5" */
export const fmtG = (v: number): string => String(round(v, 4));

/** f"{v:.0%}" */
export const pct = (v: number): string => `${round(v * 100)}%`;
