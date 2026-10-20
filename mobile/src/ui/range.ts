/** The time range the charts show (Week / Month / Year / All), and how values are averaged for it:
 * a week or a month shows every day; a year shows weekly averages; all time shows monthly
 * averages once there is more than about half a year of data, so the bars stay readable on a phone. */

import { addDays, daysInMonth, diffDays, fmtShort, type ISODate, mondayOf, monthStart, MONTHS, toDays, todayISO } from '../lib/dates';
import { isNum, max, mean, type Num, sum } from '../lib/stats';
import type { Pt } from './Chart';

export type Range = 'Week' | 'Month' | 'Year' | 'All';
export const RANGES: Range[] = ['Week', 'Month', 'Year', 'All'];
export type Bucket = 'day' | 'week' | 'month';

const DAYS: Record<Exclude<Range, 'All'>, number> = { Week: 7, Month: 30, Year: 365 };

/** First day the range shows (null = from the first data), ending today. `minDays` widens short
 * ranges for data that only exists per week (e.g. weekly zone minutes). */
export function rangeStart(range: Range, minDays = 0): ISODate | null {
  return range === 'All' ? null : addDays(todayISO(), -Math.max(DAYS[range], minDays) + 1);
}

/** Rows whose date is inside the range. */
export function inRange<T>(rows: readonly T[], date: (r: T) => ISODate, range: Range, minDays = 0): T[] {
  const start = rangeStart(range, minDays);
  return start ? rows.filter((r) => date(r) >= start) : [...rows];
}

/** How to group days for the range: daily for a week or month, weekly for a year, monthly for
 * all time when the data spans more than ~6 months. */
export function bucketFor(range: Range, firstDate?: ISODate | null): Bucket {
  if (range === 'Week' || range === 'Month') return 'day';
  if (range === 'Year') return 'week';
  return firstDate && diffDays(todayISO(), firstDate) > 200 ? 'month' : 'week';
}

export const bucketStart = (d: ISODate, b: Bucket): ISODate => (b === 'day' ? d : b === 'week' ? mondayOf(d) : monthStart(d));

/** Chart x of a bucket: the middle of the week / month, so bars sit over the days they cover. */
const bucketX = (start: ISODate, b: Bucket): number =>
  b === 'day' ? toDays(start) : b === 'week' ? toDays(start) + 3 : toDays(start) + (daysInMonth(start) - 1) / 2;

/** Bar width in chart x units (days) for a bucket. */
export const barWidthFor = (b: Bucket): number => (b === 'day' ? 0.8 : b === 'week' ? 5.6 : 24);

/** "Week of 14 Oct" / "Oct 2026" / "Mon 14 Oct" - what a tap on an averaged point shows. */
export function bucketTitle(start: ISODate, b: Bucket): string {
  if (b === 'week') return `Week of ${fmtShort(start)}`;
  if (b === 'month') return `${MONTHS[+start.slice(5, 7) - 1]} ${start.slice(0, 4)}`;
  return fmtShort(start);
}

/** Series name with the averaging spelled out ("HRV, weekly average"). */
export function averaged(name: string, b: Bucket, how: 'mean' | 'max' | 'sum' = 'mean'): string {
  if (b === 'day') return name;
  const per = b === 'week' ? 'weekly' : 'monthly';
  return how === 'mean' ? `${name}, ${per} average` : how === 'max' ? `${name}, best each ${b}` : `${name} per ${b}`;
}

/** Group rows into buckets and reduce each to one point (empty values are skipped). `name`,
 * `fmt` and `unit` make the tap label ("HRV, weekly average: 42 (6 days)"). */
export function bucketed<T>(
  rows: readonly T[], date: (r: T) => ISODate, value: (r: T) => Num, b: Bucket,
  o: { how?: 'mean' | 'max' | 'sum'; name?: string; fmt?: (v: number) => string; unit?: [string, string] } = {},
): Pt[] {
  const groups = new Map<ISODate, Num[]>();
  for (const r of rows) {
    const k = bucketStart(date(r), b);
    const g = groups.get(k);
    if (g) g.push(value(r));
    else groups.set(k, [value(r)]);
  }
  const how = o.how ?? 'mean';
  return [...groups.entries()]
    .sort((a, c) => a[0].localeCompare(c[0]))
    .map(([k, vs]) => {
      const y = vs.length === 1 ? vs[0] : how === 'max' ? max(vs) : how === 'sum' ? sum(vs) : mean(vs);
      const n = vs.filter(isNum).length;
      const [one, many] = o.unit ?? ['day', 'days'];
      const label = b !== 'day' && o.name && isNum(y)
        ? `${o.name}: ${o.fmt ? o.fmt(y) : String(Math.round(y * 10) / 10)} (${n} ${n === 1 ? one : many})`
        : undefined;
      return { x: bucketX(k, b), y, label };
    });
}
