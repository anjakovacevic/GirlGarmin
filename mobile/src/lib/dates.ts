/** Calendar dates as "YYYY-MM-DD" strings. Day arithmetic happens in UTC so time zones and
 * daylight-saving changes can never shift a date by one. */

export type ISODate = string;

const DAY_MS = 86400000;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Days since 1970-01-01 (what the charts use as x). */
export const toDays = (d: ISODate): number =>
  Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY_MS;

export const fromDays = (n: number): ISODate => new Date(Math.round(n) * DAY_MS).toISOString().slice(0, 10);

export const addDays = (d: ISODate, n: number): ISODate => fromDays(toDays(d) + n);

/** a - b in days. */
export const diffDays = (a: ISODate, b: ISODate): number => toDays(a) - toDays(b);

/** Today (or the day of `t`) on the phone's own clock. */
export function todayISO(t = new Date()): ISODate {
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

/** 0 = Monday ... 6 = Sunday. */
export const weekday = (d: ISODate): number => (new Date(toDays(d) * DAY_MS).getUTCDay() + 6) % 7;

export const mondayOf = (d: ISODate): ISODate => addDays(d, -weekday(d));

export const monthStart = (d: ISODate): ISODate => d.slice(0, 8) + '01';

export function daysInMonth(d: ISODate): number {
  return new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 0)).getUTCDate();
}

export const isISODate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(toDays(s));

/** "Mon 14 Oct", with options for the year / long weekday / no weekday. */
export function fmtDate(d: ISODate, o: { weekday?: boolean | 'long'; year?: boolean } = {}): string {
  const wd = o.weekday === 'long' ? WEEKDAYS_LONG[weekday(d)] + ' ' : o.weekday === false ? '' : WEEKDAYS[weekday(d)] + ' ';
  return `${wd}${d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]}${o.year ? ' ' + d.slice(0, 4) : ''}`;
}

/** "14 Oct" */
export const fmtShort = (d: ISODate): string => fmtDate(d, { weekday: false });

/** Chart x for a "YYYY-MM-DD HH:MM:SS" time: the day plus the time of day. */
export const timeX = (ts: string): number => toDays(ts.slice(0, 10)) + (+ts.slice(11, 13) + +ts.slice(14, 16) / 60) / 24;

/** Hours and minutes of a "YYYY-MM-DD HH:MM" local time. */
export const clockText = (ts: string | null | undefined): string => (ts ? ts.slice(11, 16) : '-');
