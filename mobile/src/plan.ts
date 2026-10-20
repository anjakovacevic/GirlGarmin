/** The training plan: types, the helpers plan files use, and the active plan with its dates.
 *
 * Plan files live in src/plans/. The app uses src/plans/myPlan.ts if it exists (git-ignored, so
 * it stays private), else src/plans/examplePlan.ts - metro.config.js picks the file. Week 1 starts
 * on the Monday chosen in the app's Settings (first launch: next Monday, or today if it's Monday).
 */

import { addDays, diffDays, type ISODate, mondayOf, todayISO } from './lib/dates';

export interface Ex {
  name: string;
  sets: number;
  repLo: number; // bottom of the rep range
  repHi: number; // top of the rep range - reach it on every set, then add load
  startReps: number; // reps per set in week 1
  startKg: number | null; // week-1 load; null = bodyweight / no load target
  incKg: number; // load jump once the top of the rep range is reached
  restS: number; // rest between sets, as a guide (on the watch rest ends on lap press)
  rir: string; // reps in reserve: how many more clean reps you could have done
  garminCategory: string; // Garmin exercise category, e.g. "HIP_RAISE" (shown on the watch)
  garminName: string; // Garmin exercise name, e.g. "BARBELL_HIP_THRUST_WITH_BENCH"
  perLeg: boolean; // reps are per leg / per arm
  estimate: boolean; // starting load is a guess - flagged "adjust" in week 1
  loggedBothSides: boolean; // per-leg exercise you log in Garmin as the total of both legs
  aliases: string[]; // other Garmin names you sometimes log this exercise under
  note: string;
}

type ExOptions = Partial<Pick<Ex, 'perLeg' | 'estimate' | 'loggedBothSides' | 'aliases' | 'note'>>;

/** Same argument order as Ex(...) in the Python plan files, so a plan can be copied over. */
export function ex(
  name: string, sets: number, repLo: number, repHi: number, startReps: number, startKg: number | null,
  incKg: number, restS: number, rir: string, garminCategory: string, garminName: string, o: ExOptions = {},
): Ex {
  return {
    name, sets, repLo, repHi, startReps, startKg, incKg, restS, rir, garminCategory, garminName,
    perLeg: o.perLeg ?? false, estimate: o.estimate ?? true, loggedBothSides: o.loggedBothSides ?? false,
    aliases: o.aliases ?? [], note: o.note ?? '',
  };
}

export interface Session {
  weekday: number; // 0 = Monday
  title: string;
  exercises: Ex[];
  warmup: string;
  cardioAfter?: string;
}

/** "intervals", "zone2-<min>", "vo2check", "rest" or null (nothing extra). */
export type CardioKind = string | null;
export type DayPlan = [Session | null, CardioKind];
export type CardioSport = 'running' | 'cycling' | 'walking';

export interface PlanDef {
  weeks: number;
  deloadWeeks: number[]; // lighter weeks
  sessions: Session[];
  /** Cardio per week: [number of hard intervals, seconds each]. */
  intervals: Record<number, [number, number]>;
  intervalSport: CardioSport; // Garmin activity the VO2max intervals are recorded as
  zone2Sport: CardioSport; // ... and the zone-2 walks
  zone2Walk: string; // "{m}" is replaced by the minutes
  outdoorTest: string;
  rest: string;
  intervalsText: (week: number) => string;
  /** Weekly template: weekday -> [session, cardio]. */
  template: Record<number, DayPlan>;
  /** Per-week exceptions: week -> {weekday: [session, cardio]}. */
  overrides: Record<number, Record<number, DayPlan>>;
  /** Optional Monday of week 1, used until you pick another one in Settings. */
  start?: ISODate;
}

export interface PlanDay {
  week: number;
  date: ISODate;
  session: Session | null;
  cardioKind: CardioKind;
  cardio: string;
}

export interface Plan extends PlanDef {
  start: ISODate; // Monday of week 1
  firstDay: ISODate; // first day anything is scheduled
  end: ISODate; // last day of the plan
  days: PlanDay[];
}

/** Human-readable text for a cardio code from template / overrides. */
export function cardioText(def: PlanDef, kind: CardioKind, week: number): string {
  if (kind === null) return '';
  if (kind === 'intervals') return def.intervalsText(week);
  if (kind.startsWith('zone2-')) {
    const m = Number(kind.split('-')[1]);
    return def.zone2Walk.replace('{m}', String(m)) + (m === 30 ? ' Optional.' : '');
  }
  if (kind === 'vo2check') return def.outdoorTest;
  return def.rest;
}

/** Default plan start: today if it's a Monday, else next Monday. */
export function defaultStart(): ISODate {
  const t = todayISO();
  const m = mondayOf(t);
  return m === t ? t : addDays(m, 7);
}

export function makePlan(def: PlanDef, startDay: ISODate): Plan {
  const start = mondayOf(startDay); // snap to Monday
  const days: PlanDay[] = [];
  for (let week = 1; week <= def.weeks; week++) {
    const plan = { ...def.template, ...(def.overrides[week] ?? {}) };
    for (let wd = 0; wd < 7; wd++) {
      const [session, kind] = plan[wd];
      days.push({
        week, date: addDays(start, (week - 1) * 7 + wd), session, cardioKind: kind,
        cardio: cardioText(def, kind, week),
      });
    }
  }
  return { ...def, start, firstDay: start, end: addDays(start, 7 * def.weeks - 1), days };
}

let active: Plan | null = null;

export function setPlan(p: Plan): void {
  active = p;
}

/** The plan in use (set at startup from the plan file + the start date in Settings). */
export function P(): Plan {
  if (!active) throw new Error('Plan not loaded');
  return active;
}

/** Plan week of a date (week 1 starts on the plan start; earlier dates give 0 or less). */
export const weekOf = (day: ISODate): number => Math.floor(diffDays(day, P().start) / 7) + 1;

export const isDeload = (week: number): boolean => P().deloadWeeks.includes(week);

export function dayPlan(day: ISODate): PlanDay | null {
  return P().days.find((d) => d.date === day) ?? null;
}
