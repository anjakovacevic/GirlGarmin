/** Training plans: types, the helpers plan files use, the plans saved on the phone and which one
 * is active.
 *
 * Plans are kept on the phone and managed in the Plan tab (planStore.ts). On first launch the app
 * imports the plan file in src/plans/ - myPlan.ts if it exists (git-ignored, so it stays private),
 * else examplePlan.ts; metro.config.js picks the file. After that the file is only a starting point.
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
  name?: string;
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
  planName: string;
  planWeeks: number;
  week: number;
  date: ISODate;
  session: Session | null;
  cardioKind: CardioKind;
  cardio: string;
}

export interface Plan extends PlanDef {
  id: string;
  name: string;
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

export function makePlan(def: PlanDef, startDay: ISODate, o: { id?: string; name?: string; endedOn?: ISODate | null } = {}): Plan {
  const start = mondayOf(startDay); // snap to Monday
  const name = o.name ?? def.name ?? `${def.weeks}-week plan`;
  let days: PlanDay[] = [];
  for (let week = 1; week <= def.weeks; week++) {
    const plan = { ...def.template, ...(def.overrides[week] ?? {}) };
    for (let wd = 0; wd < 7; wd++) {
      const [session, kind] = plan[wd] ?? [null, null];
      days.push({
        week, date: addDays(start, (week - 1) * 7 + wd), session, cardioKind: kind,
        cardio: cardioText(def, kind, week), planName: name, planWeeks: def.weeks,
      });
    }
  }
  let end = addDays(start, 7 * def.weeks - 1);
  if (o.endedOn && o.endedOn < end) {
    end = o.endedOn;
    days = days.filter((d) => d.date <= end);
  }
  return { ...def, id: o.id ?? '', name, start, firstDay: start, end, days };
}

// ---------------------------------------------------------------- plans saved on the phone

/** A session in a saved plan; `id` links it to the weekly layout. */
export type SessionData = Session & { id: string };
type DayRef = [string | null, CardioKind]; // [session id, cardio]

/** A plan as saved on the phone: plain data (no functions), so it can be edited in the app. */
export interface PlanData {
  id: string;
  name: string;
  start: ISODate | null; // Monday of week 1; null = not scheduled (a draft)
  endedOn: ISODate | null; // set when the plan was ended early: its last day
  weeks: number;
  deloadWeeks: number[];
  sessions: SessionData[];
  template: Record<number, DayRef>; // weekday (0 = Monday) -> what's on
  overrides: Record<number, Record<number, DayRef>>; // week -> {weekday: ...}
  intervals: Record<number, [number, number]>; // week -> [hard intervals, seconds each]
  intervalSport: CardioSport;
  zone2Sport: CardioSport;
  zone2Walk: string; // "{m}" = minutes
  outdoorTest: string;
  rest: string;
  intervalsText: string; // "{n}" = number of hard intervals, "{min}" = minutes each
}

export const newId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Turn a plan file (src/plans/*.ts) into saved plan data. */
export function toData(def: PlanDef, o: { name?: string; start?: ISODate | null } = {}): PlanData {
  const sessions: SessionData[] = def.sessions.map((s) => ({ ...s, exercises: s.exercises.map((e) => ({ ...e })), id: newId() }));
  const idOf = (s: Session | null) => (s ? sessions[def.sessions.indexOf(s)]?.id ?? null : null);
  const ref = ([s, k]: DayPlan): DayRef => [idOf(s), k];
  const firstWeek = Number(Object.keys(def.intervals)[0] ?? 1);
  const [n, secs] = def.intervals[firstWeek] ?? [4, 240];
  const sample = def.intervalsText(firstWeek);
  const counts = `${n} x ${Math.floor(secs / 60)} min`;
  return {
    id: newId(), name: o.name ?? def.name ?? `${def.weeks}-week plan`, start: o.start ? mondayOf(o.start) : null, endedOn: null,
    weeks: def.weeks, deloadWeeks: [...def.deloadWeeks], sessions,
    template: Object.fromEntries(Object.entries(def.template).map(([wd, d]) => [wd, ref(d)])),
    overrides: Object.fromEntries(Object.entries(def.overrides).map(([w, o2]) => [w, Object.fromEntries(Object.entries(o2).map(([wd, d]) => [wd, ref(d)]))])),
    intervals: { ...def.intervals }, intervalSport: def.intervalSport, zone2Sport: def.zone2Sport, zone2Walk: def.zone2Walk,
    outdoorTest: def.outdoorTest, rest: def.rest,
    intervalsText: sample.includes(counts) ? sample.replace(counts, '{n} x {min} min') : sample,
  };
}

/** Intervals for a week; weeks past the saved ones repeat the last week's. */
export function intervalsFor(p: PlanData, week: number): [number, number] {
  if (p.intervals[week]) return p.intervals[week];
  const known = Object.keys(p.intervals).map(Number).filter((w) => w <= week).sort((a, b) => b - a);
  return p.intervals[known[0]] ?? [4, 240];
}

/** Saved plan data -> the plan definition the rest of the app uses. */
export function fromData(p: PlanData): PlanDef {
  const byId = new Map(p.sessions.map((s) => [s.id, s]));
  const day = ([id, k]: DayRef): DayPlan => [id ? byId.get(id) ?? null : null, k];
  const intervals: Record<number, [number, number]> = {};
  for (let w = 1; w <= p.weeks; w++) intervals[w] = intervalsFor(p, w);
  return {
    name: p.name, weeks: p.weeks, deloadWeeks: p.deloadWeeks, sessions: p.sessions,
    template: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((wd) => [wd, day(p.template[wd] ?? [null, null])])),
    overrides: Object.fromEntries(Object.entries(p.overrides).map(([w, o]) => [Number(w), Object.fromEntries(Object.entries(o).map(([wd, d]) => [Number(wd), day(d)]))])),
    intervals, intervalSport: p.intervalSport, zone2Sport: p.zone2Sport, zone2Walk: p.zone2Walk, outdoorTest: p.outdoorTest, rest: p.rest,
    intervalsText: (week) => {
      const [n, secs] = intervals[week] ?? intervalsFor(p, week);
      return p.intervalsText.replace('{n}', String(n)).replace('{min}', String(Math.floor(secs / 60)));
    },
  };
}

/** First and last day a saved plan runs (null for a draft). */
export function planDates(p: PlanData): { start: ISODate; end: ISODate } | null {
  if (!p.start) return null;
  const end = addDays(p.start, 7 * p.weeks - 1);
  return { start: p.start, end: p.endedOn && p.endedOn < end ? p.endedOn : end };
}

/** Name of the scheduled plan that overlaps `p` if it ran from `start`, or null if it fits. */
export function clash(all: PlanData[], p: PlanData, start: ISODate): string | null {
  const end = addDays(start, 7 * p.weeks - 1);
  for (const q of all) {
    const d = q.id === p.id ? null : planDates(q);
    if (d && start <= d.end && end >= d.start) return q.name;
  }
  return null;
}

// ---------------------------------------------------------------- the schedule

const NO_PLAN: PlanDef = {
  name: 'No plan', weeks: 0, deloadWeeks: [], sessions: [], intervals: {}, intervalSport: 'walking', zone2Sport: 'walking',
  zone2Walk: '', outdoorTest: '', rest: '', intervalsText: () => '', template: {}, overrides: {},
};

let scheduled: Plan[] = [];
let active: Plan = makePlan(NO_PLAN, todayISO());

/** Build every scheduled plan and pick the active one: the plan running today, else the next one
 * coming up. A plan that has ended is history - with nothing next, there is no active plan. */
export function setSchedule(plans: PlanData[]): void {
  const today = todayISO();
  scheduled = plans
    .filter((p) => p.start)
    .map((p) => makePlan(fromData(p), p.start as ISODate, { id: p.id, name: p.name, endedOn: p.endedOn }))
    .sort((a, b) => a.start.localeCompare(b.start));
  active = scheduled.find((p) => p.firstDay <= today && p.end >= today)
    ?? scheduled.find((p) => p.firstDay > today)
    ?? makePlan(NO_PLAN, today);
}

export function setPlan(p: Plan): void {
  active = p;
}

/** Every scheduled plan, oldest first. */
export const scheduledPlans = (): Plan[] => scheduled;

/** Run `fn` with `p` as the active plan (targets and workouts of a plan that isn't running yet). */
export function withPlan<T>(p: Plan, fn: () => T): T {
  const prev = active;
  active = p;
  try {
    return fn();
  } finally {
    active = prev;
  }
}

/** The active plan (an empty plan when none is running or coming up - see hasPlan). */
export function P(): Plan {
  return active;
}

export const hasPlan = (): boolean => P().weeks > 0;

/** Days of every scheduled plan, past ones included (for looking back at what was planned). */
export const allDays = (): PlanDay[] => scheduled.flatMap((p) => p.days);

/** Date that forecasts project to: the end of the active plan, else 12 weeks from today. */
export function projectionEnd(): ISODate {
  const today = todayISO();
  return hasPlan() && P().end > today ? P().end : addDays(today, 84);
}

/** Plan week of a date (week 1 starts on the plan start; earlier dates give 0 or less). */
export const weekOf = (day: ISODate): number => Math.floor(diffDays(day, P().start) / 7) + 1;

export const isDeload = (week: number): boolean => P().deloadWeeks.includes(week);

/** What was planned on a day, in whichever scheduled plan covers it. */
export function dayPlan(day: ISODate): PlanDay | null {
  return allDays().find((d) => d.date === day) ?? null;
}

// ---------------------------------------------------------------- editing helpers

/** Cardio choices in the plan editor ("none" = nothing extra that day). */
export const CARDIO_CHOICES: [string, string][] = [
  ['none', 'No cardio'], ['intervals', 'VO2max intervals'], ['zone2-20', 'Zone-2 walk 20 min'], ['zone2-30', 'Zone-2 walk 30 min (optional)'],
  ['zone2-45', 'Zone-2 walk 45 min'], ['vo2check', 'VO2max check run'], ['rest', 'Rest'],
];

/** A copy to edit or run again: new ids, not scheduled. */
export function duplicatePlan(p: PlanData, name = `${p.name} (copy)`): PlanData {
  const ids = new Map(p.sessions.map((s) => [s.id, newId()]));
  const ref = ([id, k]: DayRef): DayRef => [id ? ids.get(id) ?? null : null, k];
  return {
    ...p, id: newId(), name, start: null, endedOn: null, deloadWeeks: [...p.deloadWeeks], intervals: { ...p.intervals },
    sessions: p.sessions.map((s) => ({ ...s, id: ids.get(s.id) as string, exercises: s.exercises.map((e) => ({ ...e, aliases: [...e.aliases] })) })),
    template: Object.fromEntries(Object.entries(p.template).map(([wd, d]) => [wd, ref(d)])),
    overrides: Object.fromEntries(Object.entries(p.overrides).map(([w, o]) => [w, Object.fromEntries(Object.entries(o).map(([wd, d]) => [wd, ref(d)]))])),
  };
}

/** An empty plan; cardio texts and sports are taken from `like` (another plan) when given. */
export function blankPlan(like?: PlanData): PlanData {
  return {
    id: newId(), name: 'New plan', start: null, endedOn: null, weeks: 8, deloadWeeks: [], sessions: [],
    template: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((wd) => [wd, [null, null] as DayRef])), overrides: {},
    intervals: { 1: [4, 240] },
    intervalSport: like?.intervalSport ?? 'running',
    zone2Sport: like?.zone2Sport ?? 'walking',
    zone2Walk: like?.zone2Walk ?? 'Zone-2 walk {m} min (you can still talk in full sentences).',
    outdoorTest: like?.outdoorTest ?? 'Easy 25-30 min outdoor run or brisk walk with GPS - this updates VO2max on most Garmin watches.',
    rest: like?.rest ?? 'Rest. Keep ~10k steps.',
    intervalsText: like?.intervalsText ?? 'VO2max intervals: 5 min easy, then {n} x {min} min HARD (Garmin HR zone 4) with 3 min easy between, 3 min easy to finish.',
  };
}

/** A new exercise with everyday defaults. */
export const blankExercise = (): Ex => ex('New exercise', 3, 8, 12, 8, null, 2.5, 90, '1-2', '', '', { estimate: true });
