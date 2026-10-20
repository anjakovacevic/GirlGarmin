/** Calculations and simple predictions behind the dashboard (analysis.py, without pandas).
 *
 * Predictions are deliberately simple and explainable:
 * - weight: straight-line trend through weigh-ins -> projected weight at the end of the plan
 * - lifts: estimated 1RM (Epley) per session, straight-line trend -> projected 1RM at the end of the plan
 * - cycle: nightly skin-temperature shift (3 nights above the previous 6, ignoring one outlier night and
 *   period days) marks ovulation after the fact; next period = ovulation + luteal length (else last
 *   start + median cycle length)
 */

import { addDays, daysInMonth, diffDays, fmtShort, type ISODate, mondayOf, monthStart, todayISO, toDays } from './lib/dates';
import {
  corr, fmt, groupBy, isNum, max, mean, median, type Num, pct, polyfit, round, roundHalfEven, sum,
} from './lib/stats';
import { store } from './lib/store';
import { dayPlan, P, type PlanDay } from './plan';
import * as progression from './progression';
import type { Activity, CycleRow, DailyRow, SetRow, Tables, WeightRow } from './tables';

export const TYPICAL_LUTEAL_DAYS = 14; // used until your own ovulation -> period length is known
// Target weight-loss pace on the "Body & diet" tab, only shown if you choose "Lose weight" there.
// Losing ~0.5-0.7% of your bodyweight per week keeps strength and muscle best in a deficit
// (at 70 kg that is ~0.35-0.5 kg/week).
export const TARGET_LOSS_PCT_PER_WEEK: [number, number] = [0.5, 0.7];

// Garmin exercise category (or exact exercise name) -> muscle group it mainly trains
const MUSCLE_BY_EXERCISE: Record<string, string> = {
  ROMANIAN_DEADLIFT: 'Hamstrings', WEIGHTED_LEG_EXTENSIONS: 'Quads', KNEELING_REAR_FLYE: 'Rear delts',
  _45_DEGREE_CABLE_EXTERNAL_ROTATION: 'Rear delts', KETTLEBELL_SWING: 'Glutes', LEG_ABDUCTION: 'Glutes',
  DUMBBELL_STEP_UP: 'Glutes', FACE_PULL: 'Rear delts', DEAD_BUG: 'Core',
};
const MUSCLE_BY_CATEGORY: Record<string, string> = {
  HIP_RAISE: 'Glutes', HIP_STABILITY: 'Glutes', HIP_SWING: 'Glutes', HYPEREXTENSION: 'Glutes',
  DEADLIFT: 'Hamstrings', LEG_CURL: 'Hamstrings', SQUAT: 'Quads', LUNGE: 'Quads',
  SHOULDER_PRESS: 'Front delts', LATERAL_RAISE: 'Side delts', FLYE: 'Rear delts',
  PULL_UP: 'Back', ROW: 'Back', BENCH_PRESS: 'Chest', PUSH_UP: 'Chest',
  CURL: 'Biceps', TRICEPS_EXTENSION: 'Triceps',
};
const NOT_LIFTING = new Set(['CARDIO', 'UNKNOWN', 'SIT_UP', 'PLANK']);

// ---------------------------------------------------------------- loading

export type LiftSet = SetRow & { muscle: string | null; e1rm: Num };

export interface Settings {
  goal?: 'lose' | 'track';
  planStart?: ISODate;
}

export interface HrTests {
  talk_hr?: number;
  lthr?: number;
  max_hr?: number;
}

export interface Data {
  activities: Activity[];
  sets: LiftSet[];
  daily: DailyRow[];
  weight: WeightRow[];
  cycles: CycleRow[];
  zones: ZoneSetup | null;
}

/** Epley estimated 1-rep max; only for 1-15 rep sets with a load (else null). */
export function e1rm(weight: Num, reps: Num): Num {
  return isNum(weight) && isNum(reps) && weight > 0 && reps >= 1 && reps <= 15 ? weight * (1 + reps / 30) : null;
}

/** Add muscle / e1RM to the sets and read the heart-rate zone settings. */
export async function prepare(t: Tables): Promise<Data> {
  const sets = t.sets.map((s) => ({
    ...s,
    muscle: (s.exercise && MUSCLE_BY_EXERCISE[s.exercise]) || (s.category && MUSCLE_BY_CATEGORY[s.category]) || null,
    e1rm: e1rm(s.weight_kg, s.reps),
  }));
  return { ...t, sets, zones: await garminZones() };
}

export const loadSettings = async (): Promise<Settings> => (await store().read<Settings>('settings.json')) ?? {};

export async function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  await store().write('settings.json', { ...(await loadSettings()), [key]: value });
}

// ---------------------------------------------------------------- trends

/** Straight-line fit: slope per week and the value it projects for `targetDate`. */
export interface Trend {
  perWeek: number;
  projected: number;
  targetDate: ISODate;
  n: number;
}

/** Least-squares line through (date, value); null with fewer than 3 points or under a week of data. */
export function linearTrend(dates: ISODate[], values: Num[], target: ISODate): Trend | null {
  const x: number[] = [];
  const y: number[] = [];
  values.forEach((v, i) => {
    if (isNum(v)) {
      x.push(toDays(dates[i]));
      y.push(v);
    }
  });
  if (x.length < 3 || Math.max(...x) - Math.min(...x) < 7) return null;
  const { slope, intercept } = polyfit(x, y);
  return { perWeek: slope * 7, projected: slope * toDays(target) + intercept, targetDate: target, n: x.length };
}

/** Target loss pace in kg/week [low, high] for your current weight. */
export function lossTarget(weightKg: number): [number, number] {
  const [lo, hi] = TARGET_LOSS_PCT_PER_WEEK;
  return [round((weightKg * lo) / 100, 2), round((weightKg * hi) / 100, 2)];
}

export function weightForecast(weight: WeightRow[]): Trend | null {
  return weight.length ? linearTrend(weight.map((w) => w.date), weight.map((w) => w.weight_kg), P().end) : null;
}

// ---------------------------------------------------------------- lifting

export interface LiftSession {
  exercise: string;
  date: ISODate;
  sets: number;
  top_kg: Num;
  best_e1rm: Num;
  muscle: string | null;
  top_reps: Num;
}

const lifting = (s: LiftSet) => !NOT_LIFTING.has(s.category ?? '') && s.muscle !== null;

/** Best set per exercise per day: top weight, reps at that weight, best e1RM, number of sets. */
export function liftSessions(sets: LiftSet[]): LiftSession[] {
  let s = sets.filter(lifting);
  // drop obvious logging errors (e.g. 1.5 kg lateral raise when you use 12 kg)
  const typical = new Map([...groupBy(s, (x) => x.exercise)].map(([k, g]) => [k, median(g.map((x) => x.weight_kg))]));
  s = s.filter((x) => {
    const t = typical.get(x.exercise);
    return !(isNum(x.weight_kg) && isNum(t) && x.weight_kg < 0.5 * t);
  });
  const out: LiftSession[] = [];
  for (const g of groupBy(s, (x) => `${x.exercise}|${x.date}`).values()) {
    const loaded = g.filter((x) => isNum(x.weight_kg));
    const top = max(g.map((x) => x.weight_kg));
    const topSet = loaded.find((x) => x.weight_kg === top);
    out.push({
      exercise: g[0].exercise ?? '', date: g[0].date, sets: g.length, top_kg: top, best_e1rm: max(g.map((x) => x.e1rm)),
      muscle: g[0].muscle, top_reps: topSet ? topSet.reps : null,
    });
  }
  return out.sort((a, b) => a.exercise.localeCompare(b.exercise) || a.date.localeCompare(b.date));
}

/** Number of working sets per muscle group per week (Mon-Sun). */
export function weeklySetsByMuscle(sets: LiftSet[]): { week: ISODate; muscle: string; sets: number }[] {
  const g = groupBy(sets.filter(lifting), (s) => `${mondayOf(s.date)}|${s.muscle}`);
  return [...g.values()]
    .map((x) => ({ week: mondayOf(x[0].date), muscle: x[0].muscle as string, sets: x.length }))
    .sort((a, b) => a.week.localeCompare(b.week) || a.muscle.localeCompare(b.muscle));
}

export interface LiftForecast {
  exercise: string;
  sessions: number;
  best_e1rm: number;
  last_e1rm: number;
  trend_kg_per_week: Num;
  projected_e1rm_at_plan_end: Num;
}

/** Per exercise: best / last e1RM, trend over the last `lookbackDays`, projected e1RM at plan end. */
export function liftForecasts(sessions: LiftSession[], lookbackDays = 42): LiftForecast[] {
  if (!sessions.length) return [];
  const latest = sessions.reduce((m, s) => (s.date > m ? s.date : m), sessions[0].date);
  const cutoff = addDays(latest, -lookbackDays);
  const rows: LiftForecast[] = [];
  for (const [exercise, all] of groupBy(sessions, (s) => s.exercise)) {
    const g = all.filter((s) => isNum(s.best_e1rm)).sort((a, b) => a.date.localeCompare(b.date));
    if (g.length < 3) continue;
    const recent = g.filter((s) => s.date >= cutoff);
    const t = recent.length >= 3 ? linearTrend(recent.map((s) => s.date), recent.map((s) => s.best_e1rm), P().end) : null;
    const recentBest = max((recent.length ? recent : g).map((s) => s.best_e1rm)) as number;
    // a few noisy sessions can extrapolate wildly - keep the projection within +-10% of the recent best
    const proj = t ? Math.min(Math.max(t.projected, 0.9 * recentBest), 1.1 * recentBest) : null;
    rows.push({
      exercise, sessions: g.length, best_e1rm: max(g.map((s) => s.best_e1rm)) as number,
      last_e1rm: g[g.length - 1].best_e1rm as number, trend_kg_per_week: t ? t.perWeek : null,
      projected_e1rm_at_plan_end: proj,
    });
  }
  return rows.sort((a, b) => b.sessions - a.sessions);
}

// ---------------------------------------------------------------- plan vs actual

export interface PlanRow {
  date: ISODate;
  week: number;
  session: string;
  exercise: string;
  garmin_name: string;
  garmin_category: string;
  plan_sets: number;
  plan_reps: number;
  plan_kg: number | null;
  reps_logged_x: number; // reps logged for both legs together -> compare per leg
}

export type PlanVsActual = PlanRow & {
  actual_sets: Num; actual_kg: Num; actual_best_reps: Num; hit_load: boolean;
  done_on: ISODate | null; // the day the session was actually done, when that's not the planned day
};

/** Which strength workout did each planned session (planned date -> activity). Sessions often get
 * done a day early or late, so this matches within the plan week (Monday-Sunday), not by date:
 * 1. by name - workouts put on the watch are called e.g. "W3 Upper A - shoulders 13 Oct", so the
 *    longest session title in the name wins, and the date in the name settles repeats;
 * 2. any other lifting workout goes to the open session on the same day, else the nearest one.
 *    A second workout on a day that already counts (e.g. a split recording) is not a session. */
export function matchSessions(acts: Activity[]): Map<ISODate, Activity> {
  const out = new Map<ISODate, Activity>();
  const lifts = acts.filter((a) => a.type === 'strength_training').sort((a, b) => a.start.localeCompare(b.start));
  const weeks = groupBy(P().days.filter((d) => d.session), (d) => mondayOf(d.date));
  for (const [monday, days] of weeks) {
    const sunday = addDays(monday, 6);
    let free = lifts.filter((a) => a.date >= monday && a.date <= sunday);
    let open = [...days];
    const take = (d: PlanDay, a: Activity) => {
      out.set(d.date, a);
      free = free.filter((x) => x !== a);
      open = open.filter((x) => x !== d);
    };
    for (const a of [...free]) {
      const name = a.name.toLowerCase();
      const hits = open.filter((d) => name.includes(d.session!.title.toLowerCase()));
      if (!hits.length) continue;
      const longest = Math.max(...hits.map((d) => d.session!.title.length));
      const best = hits.filter((d) => d.session!.title.length === longest);
      take(best.find((d) => name.includes(fmtShort(d.date).toLowerCase())) ?? best.find((d) => d.date === a.date) ?? best[0], a);
    }
    for (const a of [...free]) {
      if (!open.length) break;
      if ([...out.values()].some((x) => x.date === a.date)) continue;
      const near = (d: PlanDay) => Math.abs(diffDays(d.date, a.date));
      take(open.reduce((b, d) => (near(d) < near(b) ? d : b)), a);
    }
  }
  return out;
}

/** Planned exercises up to `today` next to what Garmin logged that day. Matches on the Garmin
 * exercise name first, then on the category (Garmin often leaves the name empty). */
export function planVsActual(sets: LiftSet[], acts: Activity[], today: ISODate): PlanVsActual[] {
  const hist = progression.history(sets, acts);
  const doneOn = matchSessions(acts);
  const plan: PlanRow[] = [];
  for (const d of P().days) {
    if (!d.session || d.date < P().firstDay || d.date > today) continue;
    for (const ex of d.session.exercises) {
      const t = progression.target(ex, d.session, d.date, hist, today);
      plan.push({
        date: d.date, week: d.week, session: d.session.title, exercise: ex.name, garmin_name: ex.garminName,
        garmin_category: ex.garminCategory, plan_sets: t.sets, plan_reps: t.reps, plan_kg: t.kg,
        reps_logged_x: ex.loggedBothSides ? 2 : 1,
      });
    }
  }
  const done = new Map(
    [...groupBy(sets, (s) => `${s.date}|${s.exercise}`)].map(([k, g]) => [
      k, { sets: g.length, kg: max(g.map((s) => s.weight_kg)), reps: max(g.map((s) => s.reps)) },
    ]),
  );
  return plan.map((p) => {
    const day = doneOn.get(p.date)?.date ?? p.date; // look for the sets on the day the session was done
    const a = done.get(`${day}|${p.garmin_name}`) ?? done.get(`${day}|${p.garmin_category}`);
    const kg = a ? a.kg : null;
    return {
      ...p, actual_sets: a ? a.sets : null, actual_kg: kg, done_on: day !== p.date ? day : null,
      actual_best_reps: a && isNum(a.reps) ? a.reps / p.reps_logged_x : null,
      hit_load: isNum(kg) && isNum(p.plan_kg) && kg >= p.plan_kg - 0.01,
    };
  });
}

export const todayPlan = (today: ISODate): PlanDay | null => dayPlan(today);

// ---------------------------------------------------------------- cycle

/** One logged cycle, with ovulation detected from skin temperature (or Garmin's estimate). */
export interface CycleInfo {
  start: ISODate;
  length: number | null; // days until next period (null for the current cycle)
  shiftDay: number | null; // cycle day of the sustained temperature rise
  ovulation: ISODate | null;
  ovulationSource: 'temperature' | 'garmin' | '';
  lutealDays: number | null;
}

/** First cycle day of 3 nights >= cover line + margin, where the cover line is the 2nd-highest
 * of the previous 6 nights. Using the 2nd-highest ignores a single warm night (short sleep,
 * alcohol, a hot room) that would otherwise hide a real rise for the next 6 nights.
 * Period days are excluded (wrist temperature dips hard during menses and fakes an early shift). */
export function temperatureShift(nights: [number, Num][], minDay = 7, margin = 0.2): number | null {
  const v = nights.filter(([d, t]) => d >= minDay && isNum(t)).sort((a, b) => a[0] - b[0]) as [number, number][];
  for (let i = 6; i < v.length - 2; i++) {
    const cover = v.slice(i - 6, i).map((x) => x[1]).sort((a, b) => b - a)[1];
    // round: 0.6-0.4 != 0.2 in floats
    if ([0, 1, 2].every((k) => round(v[i + k][1] - cover, 2) >= margin)) return v[i][0];
  }
  return null;
}

/** Split the nightly skin temperature by logged period starts and find ovulation in each cycle. */
export function analyseCycles(daily: DailyRow[], cycles: CycleRow[]): CycleInfo[] {
  const starts = cycles.map((c) => c.start).sort();
  return starts.map((start, i) => {
    const nxt = starts[i + 1] ?? null;
    const end = nxt ?? addDays(todayISO(), 1);
    const nights = daily
      .filter((d) => d.date >= start && d.date < end)
      .map((d) => [diffDays(d.date, start) + 1, d.skin_temp_dev] as [number, Num]);
    const shift = temperatureShift(nights);
    let ov: ISODate | null = null;
    let src: CycleInfo['ovulationSource'] = '';
    if (shift) {
      ov = addDays(start, shift - 2);
      src = 'temperature';
    } else {
      const g = cycles.find((c) => c.start === start)?.garmin_ovulation;
      if (g) [ov, src] = [g, 'garmin'];
    }
    return {
      start, length: nxt ? diffDays(nxt, start) : null, shiftDay: shift, ovulation: ov, ovulationSource: src,
      lutealDays: nxt && ov ? diffDays(nxt, ov) : null,
    };
  });
}

/** Where you are in the current cycle and what comes next. */
export interface CyclePrediction {
  cycleDay: number;
  phase: string;
  nextPeriod: ISODate;
  nextPeriodBasis: string;
  ovulation: ISODate | null;
  ovulationConfirmed: boolean;
  fertileStart: ISODate | null;
  fertileEnd: ISODate | null;
  medianCycle: Num;
  medianLuteal: Num;
}

/** Next period = confirmed ovulation + your median luteal length, else last start + median cycle. */
export function predictCycle(info: CycleInfo[], today: ISODate): CyclePrediction | null {
  if (!info.length) return null;
  const cur = info[info.length - 1];
  const done = info.filter((c) => c.length);
  const medLen = median(done.map((c) => c.length));
  const medLut = median(done.map((c) => c.lutealDays).filter((l) => l && l >= 10 && l <= 17));
  const luteal = roundHalfEven(medLut || TYPICAL_LUTEAL_DAYS);
  const day = diffDays(today, cur.start) + 1;
  let nxt: ISODate;
  let basis: string;
  let ov: ISODate | null;
  let confirmed: boolean;
  if (cur.ovulation && cur.ovulationSource === 'temperature') {
    nxt = addDays(cur.ovulation, luteal + 1);
    basis = `temperature rise on day ${cur.shiftDay} + ${luteal}-day luteal phase`;
    [ov, confirmed] = [cur.ovulation, true];
  } else {
    const length = medLen ? roundHalfEven(medLen) : 30;
    nxt = addDays(cur.start, length);
    basis = `median cycle length (${length} days)`;
    [ov, confirmed] = [addDays(nxt, -(luteal + 1)), false];
  }
  if (nxt <= today) {
    // overdue - push to tomorrow and say so
    nxt = addDays(today, 1);
    basis += ' - already passed, any day now';
  }
  const PERIOD_DAYS = 6;
  let phase: string;
  if (day <= PERIOD_DAYS) phase = 'Period';
  else if (confirmed && today > ov) phase = 'After ovulation (luteal)';
  else if (ov && Math.abs(diffDays(today, ov)) <= 2) phase = 'Around ovulation';
  else phase = 'Before ovulation (follicular)';
  return {
    cycleDay: day, phase, nextPeriod: nxt, nextPeriodBasis: basis, ovulation: ov, ovulationConfirmed: confirmed,
    fertileStart: ov ? addDays(ov, -5) : null, fertileEnd: ov ? addDays(ov, 1) : null,
    medianCycle: medLen, medianLuteal: medLut,
  };
}

export type Phase = 'period' | 'follicular' | 'luteal';

/** Label each day 'period', 'follicular' or 'luteal' (luteal only where ovulation is known). */
export function phaseByDate(daily: DailyRow[], info: CycleInfo[]): Map<ISODate, Phase> {
  const ph = new Map<ISODate, Phase>();
  for (const c of info) {
    const end = addDays(c.start, c.length || 60);
    for (const d of daily) {
      if (d.date < c.start || d.date >= end) continue;
      const day = diffDays(d.date, c.start) + 1;
      ph.set(d.date, day <= 6 ? 'period' : c.ovulation && d.date > c.ovulation ? 'luteal' : 'follicular');
    }
  }
  return ph;
}

// ---------------------------------------------------------------- recovery

export interface Recovery {
  date: ISODate;
  hrv: Num;
  hrvStatus: string | null;
  phaseBaseline: Num;
  sleepScore: Num;
  restingHr: Num;
  phase: Phase | null;
  advice: string;
}

/** Plan's recovery rule, cycle-aware: Low HRV in the luteal phase is normal and not a reason to cut sets. */
export function recoveryToday(daily: DailyRow[], phase: Map<ISODate, Phase>): Recovery | null {
  if (!daily.length) return null;
  const last = [...daily].sort((a, b) => a.date.localeCompare(b.date))[daily.length - 1];
  const ph = phase.get(last.date) ?? null;
  const samePhase = ph ? daily.filter((d) => phase.get(d.date) === ph) : daily;
  const base = median(samePhase.map((d) => d.hrv_last_night));
  const low = last.hrv_status === 'LOW';
  const poorSleep = isNum(last.sleep_score) && last.sleep_score < 70;
  let advice: string;
  if (low && poorSleep) advice = "Do today's session with 1 fewer set per exercise, same loads.";
  else if (low && ph === 'luteal') advice = "HRV is Low, but that's common after ovulation. Train as planned unless you feel off.";
  else if (low) advice = 'HRV is Low but sleep was fine - train as planned, watch how the first sets feel.';
  else advice = 'Recovery looks normal - train as planned.';
  return {
    date: last.date, hrv: last.hrv_last_night, hrvStatus: last.hrv_status, phaseBaseline: base,
    sleepScore: last.sleep_score, restingHr: last.resting_hr, phase: ph, advice,
  };
}

// ---------------------------------------------------------------- heart-rate zones

const ZONE_PCT = [0.5, 0.6, 0.7, 0.8, 0.9]; // zone 1-5 floors, as % of max HR or of HR reserve
const LTHR_RUN_PCT = [0.0, 0.85, 0.9, 0.95, 1.0]; // Joe Friel's running zones as % of lactate-threshold HR

export interface ZoneSetup {
  method: string; // Garmin's trainingMethod, e.g. HR_MAX, HRR, LACTATE_THRESHOLD
  maxHr: number; // max HR Garmin uses
  restingHr: number | null; // resting HR Garmin uses
  floors: number[]; // zone 1-5 lower limits Garmin uses
  restingAuto: boolean; // does Garmin update resting HR by itself
  age: number | null;
}

/** The zones your watch uses now (raw/profile/heart_rate_zones.json, sport DEFAULT). */
export async function garminZones(): Promise<ZoneSetup | null> {
  const raw = await store().read('raw/profile/heart_rate_zones.json');
  const zs: any[] = Array.isArray(raw) ? raw.filter((x) => x && typeof x === 'object') : [];
  const z = zs.find((x) => x.sport === 'DEFAULT') ?? zs[0];
  if (!z || !z.maxHeartRateUsed || [1, 2, 3, 4, 5].some((i) => z[`zone${i}Floor`] == null)) return null;
  let age: number | null = null;
  const born: string | undefined = (await store().read('raw/profile/user_profile.json'))?.userData?.birthDate;
  if (born) {
    const t = todayISO();
    age = +t.slice(0, 4) - +born.slice(0, 4) - (t.slice(5) < born.slice(5, 10) ? 1 : 0);
  }
  return {
    method: z.trainingMethod || 'unknown', maxHr: z.maxHeartRateUsed, restingHr: z.restingHeartRateUsed ?? null,
    floors: [1, 2, 3, 4, 5].map((i) => z[`zone${i}Floor`]), restingAuto: !!z.restingHrAutoUpdateUsed, age,
  };
}

export const loadHrTests = async (): Promise<HrTests> => (await store().read<HrTests>('hr_tests.json')) ?? {};

export async function saveHrTests(tests: HrTests): Promise<void> {
  await store().write('hr_tests.json', Object.fromEntries(Object.entries(tests).filter(([, v]) => v)));
}

export const zonesPctMax = (maxHr: number) => ZONE_PCT.map((p) => roundHalfEven(p * maxHr));

/** Karvonen: resting + % of (max - resting). Uses your fitness via resting HR. */
export const zonesHrr = (maxHr: number, rest: number) => ZONE_PCT.map((p) => roundHalfEven(rest + p * (maxHr - rest)));

export const zonesLthr = (lthr: number) => LTHR_RUN_PCT.map((p) => roundHalfEven(p * lthr));

/** {method: [zone 1-5 floors, max HR]} -> one row per method with 'from-to' text per zone. */
export function zoneTable(rows: [string, number[], number][]): { method: string; zones: string[] }[] {
  return rows.map(([method, f, maxHr]) => {
    const ends = [...f.slice(1).map((x) => x - 1), roundHalfEven(maxHr)];
    return { method, zones: f.map((a, i) => (a ? `${a}-${ends[i]}` : `up to ${ends[i]}`)) };
  });
}

export interface ZoneAdvice {
  restingNow: number;
  maxUsed: number;
  maxSeen: Num;
  maxFromFormula: boolean;
  tips: string[];
  table: { method: string; zones: string[] }[];
  zone2: [number, number];
  zone2Basis: string;
}

/** Compare Garmin's zone settings with your data and test results; return numbers + suggestions. */
export function hrZoneAdvice(z: ZoneSetup, daily: DailyRow[], acts: Activity[], tests: HrTests): ZoneAdvice {
  const rhrs = [...daily].sort((a, b) => a.date.localeCompare(b.date)).map((d) => d.resting_hr).filter(isNum);
  const med = median(rhrs.slice(-30));
  const rhr = isNum(med) ? roundHalfEven(med) : z.restingHr || 60;
  const seen = max(acts.map((a) => a.max_hr));
  const formulaMax = z.age ? 220 - z.age : null;
  const maxHr = tests.max_hr || z.maxHr;
  const maxFromFormula = !tests.max_hr && formulaMax !== null && Math.abs(z.maxHr - formulaMax) <= 1;

  const tips: string[] = [];
  if (z.restingHr === null || Math.abs(rhr - z.restingHr) >= 3) {
    tips.push(`**Update resting HR to ${rhr}.** Garmin uses ${z.restingHr || 'none'}, but your last 30 days are around ${rhr}.`
      + (z.restingAuto ? '' : ' Or turn on its automatic update.'));
  }
  if (tests.max_hr && Math.abs(tests.max_hr - z.maxHr) >= 3) {
    tips.push(`**Set max HR to ${tests.max_hr}** (your test) instead of ${z.maxHr}.`);
  } else if (maxFromFormula) {
    tips.push(`**Your max HR (${z.maxHr}) is only the 220 - age formula** - it can be off by 10-15 bpm. `
      + (seen ? `Highest you have reached in a workout: ${fmt(seen)}. ` : '')
      + 'A max-HR test (below) fixes this.');
  }
  if (seen && seen > maxHr) tips.push(`You reached ${fmt(seen)} bpm in a workout - higher than the max HR in use (${maxHr}). Raise it.`);
  if (z.method === 'HR_MAX') {
    tips.push('**Switch the method to %HRR** (heart-rate reserve) - it uses your resting HR, so zones follow '
      + 'your fitness. With a threshold test you can use %LTHR instead.');
  }

  const rows: [string, number[], number][] = [
    [`Garmin now (${z.method})`, z.floors, z.maxHr],
    [`%HRR (max ${maxHr}, resting ${rhr})`, zonesHrr(maxHr, rhr), maxHr],
  ];
  if (tests.max_hr) rows.push([`%max HR (tested max ${maxHr})`, zonesPctMax(maxHr), maxHr]);
  if (tests.lthr) rows.push([`%LTHR running (threshold ${tests.lthr})`, zonesLthr(tests.lthr), maxHr]);

  // Zone 2 estimate: best evidence wins - threshold test, then talk test, then the formula range
  const hrr = zonesHrr(maxHr, rhr);
  const pmax = zonesPctMax(maxHr);
  let z2: [number, number];
  let basis: string;
  if (tests.lthr) {
    z2 = [roundHalfEven(0.85 * tests.lthr), roundHalfEven(0.89 * tests.lthr)];
    basis = 'your threshold test (85-89% of LTHR)';
  } else if (tests.talk_hr) {
    z2 = [tests.talk_hr - 12, tests.talk_hr];
    basis = 'your talk test (top of zone 2 = its average HR)';
  } else {
    z2 = [pmax[1], hrr[2] - 1];
    basis = 'formulas only - the true value is somewhere in this range; do the talk test to narrow it';
  }
  return {
    restingNow: rhr, maxUsed: maxHr, maxSeen: seen, maxFromFormula, tips, table: zoneTable(rows), zone2: z2,
    zone2Basis: basis,
  };
}

// ---------------------------------------------------------------- sleep

export const LONG_NIGHT_H = 7; // nights at least this long "should" be restorative
export const LOW_BATTERY_GAIN = 45; // Body Battery charged this much or less overnight = poor recharge
export const LOW_BATTERY_WAKE = 65; // ... or woke up at this level or lower
export const LOW_DEEP_PCT = 15; // deep sleep below this share of the night = low
const MIN_NIGHTS = 14; // 7h+ nights needed before a correlation is shown
export const LATE_BED_H = 24.5; // 00:30 - bedtimes after this get less deep sleep in your data
const VERY_LATE_BED_H = 25.5; // 01:30 - a "late night", checked for its effect on the next night
export const SLEEP_KINDS: Record<string, string> = {
  restorative: '#3c9a5f', 'long - low battery': '#e0a030', 'long - low deep sleep': '#8e6cc0',
  'long - both': '#d9534f', 'short (<7 h)': '#9aa5b1',
};

/** Local time as hours, with after-midnight bedtimes past 24 (00:30 -> 24.5) so they sort after 23:00. */
function clockH(ts: string | null): Num {
  if (!ts) return null;
  const h = +ts.slice(11, 13) + +ts.slice(14, 16) / 60;
  return h >= 12 ? h : h + 24;
}

export type Night = DailyRow & {
  bed_h: Num;
  deep_pct: Num;
  prev_avg_stress: Num;
  prev_body_battery_low: Num;
  phase: Phase | null;
  kind: string;
  low_battery: boolean;
  low_deep: boolean;
  after_late_night: boolean;
};

/** One row per night (dated by the morning you woke up) with the labels the Sleep tab uses. */
export function sleepNights(daily: DailyRow[], phase: Map<ISODate, Phase>): Night[] {
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const rows = daily.filter((d) => isNum(d.sleep_h)).sort((a, b) => a.date.localeCompare(b.date));
  const out: Night[] = [];
  rows.forEach((d, i) => {
    // a night without sleep stages (older watch, or watch off the wrist) reports 0 deep/light/REM - unknown, not zero
    const noStages = (d.deep_min ?? 0) + (d.light_min ?? 0) + (d.rem_min ?? 0) === 0;
    const r = noStages ? { ...d, deep_min: null, light_min: null, rem_min: null } : { ...d };
    const sleepH = r.sleep_h as number;
    const deepPct = isNum(r.deep_min) ? (r.deep_min / (sleepH * 60)) * 100 : null;
    // how you went into the night: yesterday's daytime stress and lowest Body Battery
    const prev = byDate.get(addDays(r.date, -1));
    const long = sleepH >= LONG_NIGHT_H;
    const lowBb = (isNum(r.body_battery_gain) && r.body_battery_gain <= LOW_BATTERY_GAIN)
      || (isNum(r.body_battery_wake) && r.body_battery_wake <= LOW_BATTERY_WAKE);
    const lowDeep = isNum(deepPct) && deepPct < LOW_DEEP_PCT;
    const kind = !long ? 'short (<7 h)' : lowBb && lowDeep ? 'long - both' : lowBb ? 'long - low battery'
      : lowDeep ? 'long - low deep sleep' : 'restorative';
    const before = rows[i - 1];
    const prevBed = before ? clockH(before.bedtime) : null;
    out.push({
      ...r, bed_h: clockH(r.bedtime), deep_pct: deepPct, prev_avg_stress: prev?.avg_stress ?? null,
      prev_body_battery_low: prev?.body_battery_low ?? null, phase: phase.get(r.date) ?? null, kind,
      low_battery: long && lowBb, low_deep: long && lowDeep,
      after_late_night: isNum(prevBed) && prevBed >= VERY_LATE_BED_H && diffDays(r.date, before.date) === 1,
    });
  });
  return out;
}

const COMPARE_COLS: [keyof Night, string][] = [
  ['sleep_h', 'Sleep (h)'], ['deep_min', 'Deep sleep (min)'], ['body_battery_gain', 'Body Battery gained'],
  ['sleep_stress', 'Stress during sleep'], ['sleep_avg_hr', 'Heart rate during sleep'], ['hrv_last_night', 'HRV (ms)'],
  ['prev_avg_stress', 'Day-before stress'], ['prev_body_battery_low', 'Day-before lowest Body Battery'],
  ['restless_moments', 'Restless moments'], ['skin_temp_dev', 'Skin temp vs baseline (deg C)'], ['bed_h', 'Bedtime'],
];

const bedText = (h: Num) =>
  isNum(h) ? `${String(Math.trunc(h % 24)).padStart(2, '0')}:${String(Math.trunc(Math.round((h % 1) * 60)) % 60).padStart(2, '0')}` : '-';

/** Medians on 7h+ nights: restorative vs low battery vs low deep sleep. */
export function sleepCompare(n: Night[]): { columns: string[]; rows: string[][] } {
  const long = n.filter((x) => (x.sleep_h as number) >= LONG_NIGHT_H);
  const groups: [string, Night[]][] = [
    ['Restorative', long.filter((x) => x.kind === 'restorative')],
    ['Low battery', long.filter((x) => x.low_battery)],
    ['Low deep sleep', long.filter((x) => x.low_deep)],
  ];
  const rows = COMPARE_COLS.map(([col, label]) => [
    label,
    ...groups.map(([, g]) => {
      const m = median(g.map((x) => x[col] as Num));
      return col === 'bed_h' ? bedText(isNum(m) ? round(m, 1) : null) : fmt(isNum(m) ? round(m, 1) : null, 1);
    }),
  ]);
  return { columns: ['', ...groups.map(([name, g]) => `${name} (${g.length} nights)`)], rows };
}

/** Suggestions that only appear when your own data shows the pattern. */
export function sleepTips(n: Night[]): string[] {
  const long = n.filter((x) => (x.sleep_h as number) >= LONG_NIGHT_H);
  const good = long.filter((x) => x.kind === 'restorative');
  const low = long.filter((x) => x.low_battery);
  const med = (rows: Night[], col: keyof Night) => median(rows.map((x) => x[col] as Num));
  const tips: string[] = [];
  if (low.length >= 3 && good.length >= 5) {
    const ds = (med(low, 'sleep_stress') ?? NaN) - (med(good, 'sleep_stress') ?? NaN);
    const dhr = (med(low, 'sleep_avg_hr') ?? NaN) - (med(good, 'sleep_avg_hr') ?? NaN);
    if (ds >= 3) {
      tips.push("**Low battery after a long sleep comes from a body that doesn't calm down, not from too little "
        + `sleep.** On those nights your stress during sleep is ${fmt(ds)} points higher and your heart rate `
        + `${fmt(dhr)} bpm higher. Sleeping longer won't fix it; winding down before bed will `
        + '(10 min slow breathing, a walk or shower, a cooler room, no alcohol).');
    }
    const lp = med(low, 'prev_avg_stress');
    const gp = med(good, 'prev_avg_stress');
    if (isNum(lp) && isNum(gp) && lp - gp >= 4) {
      tips.push(`**Stressful days carry into the night.** Before low-battery nights your daytime stress averaged `
        + `${fmt(lp)} vs ${fmt(gp)}. On high-stress days, plan a calm last hour before bed.`);
    }
  }
  const byPhase = groupBy(long.filter((x) => x.phase), (x) => x.phase as Phase);
  const rate = new Map([...byPhase].filter(([, g]) => g.length >= 5).map(([p, g]) => [p, mean(g.map((x) => (x.low_battery ? 1 : 0))) as number]));
  const others = [...rate].filter(([p]) => p !== 'luteal').map(([, r]) => r);
  if (rate.has('luteal') && others.length && (rate.get('luteal') as number) - Math.max(...others) >= 0.1) {
    tips.push(`**After ovulation your battery recharges worse:** ${pct(rate.get('luteal') as number)} of long nights had low `
      + `battery vs ${pct(Math.max(...others))} at most in other phases. That's normal (higher body `
      + "temperature and heart rate). Keep the room cool, avoid alcohol and don't judge your recovery "
      + 'by Body Battery alone in that week.');
  }
  const early = median(long.filter((x) => isNum(x.bed_h) && x.bed_h < 24).map((x) => x.deep_min));
  const lateNights = long.filter((x) => isNum(x.bed_h) && x.bed_h >= LATE_BED_H);
  const late = median(lateNights.map((x) => x.deep_min));
  if (lateNights.length >= 4 && isNum(early) && isNum(late) && early - late >= 10) {
    tips.push(`**Bedtime after 00:30 costs you deep sleep:** ${fmt(late)} min vs ${fmt(early)} min when you're `
      + 'asleep before midnight. Most deep sleep happens in the first 3 hours, so protect the start of the night.');
  }
  const after = long.filter((x) => x.after_late_night);
  const rest = long.filter((x) => !x.after_late_night);
  const ga = med(after, 'body_battery_gain');
  const gr = med(rest, 'body_battery_gain');
  if (after.length >= 3 && isNum(ga) && isNum(gr) && gr - ga >= 5) {
    tips.push('**A late night (bed after 01:30) still costs you the night after:** Body Battery gain '
      + `${fmt(ga)} vs ${fmt(gr)}. Make the next day an easy one.`);
  }
  const c = corr(long.map((x) => x.restless_moments), long.map((x) => x.deep_pct));
  if (long.length >= MIN_NIGHTS && isNum(c) && c <= -0.3) {
    tips.push('**Restless nights have less deep sleep.** Check what disturbs the first hours: a warm room, a late '
      + 'heavy meal, alcohol, light or noise.');
  }
  return tips;
}

// ---------------------------------------------------------------- time in heart-rate zones

export const CARDIO_TYPES = ['indoor_cardio', 'treadmill_running', 'running', 'treadmill_walking', 'walking',
  'stair_climbing', 'floor_climbing', 'cycling', 'indoor_cycling', 'hiking', 'elliptical', 'swimming', 'lap_swimming'];
export const ZONES = ['z1_min', 'z2_min', 'z3_min', 'z4_min', 'z5_min'] as const;
export type ZoneKey = (typeof ZONES)[number];
export const ZONE_COLORS = ['#9aa5b1', '#3a8fd9', '#3c9a5f', '#e08a30', '#d9534f'];
// WHO health guideline: 150-300 min moderate activity a week, where 1 vigorous minute counts as 2.
// Here zone 2-3 = moderate, zone 4-5 = vigorous.
export const WHO_WEEKLY_MIN: [number, number] = [150, 300];
export const EASY_SHARE_TARGET = 0.8; // "80/20": ~80% of cardio time easy (zone 1-2), the rest harder

export type ZoneRow = Pick<Activity, 'start' | 'date' | 'name' | 'type' | 'duration_min'> & Record<ZoneKey, number> & { moderate_eq: number };

/** Minutes per zone per activity, plus moderate-equivalent minutes (WHO: vigorous counts double). */
export function zoneTime(acts: Activity[], cardioOnly = true): ZoneRow[] {
  return acts
    .filter((a) => !cardioOnly || CARDIO_TYPES.includes(a.type))
    .map((a) => {
      const z = Object.fromEntries(ZONES.map((k) => [k, a[k] ?? 0])) as Record<ZoneKey, number>;
      return {
        start: a.start, date: a.date, name: a.name, type: a.type, duration_min: a.duration_min, ...z,
        moderate_eq: z.z2_min + z.z3_min + 2 * (z.z4_min + z.z5_min),
      };
    });
}

export type ZonePeriod = Record<ZoneKey, number> & {
  period: ISODate; // Monday of the week, or 1st of the month
  moderate_eq: number;
  garmin_intensity: Num;
  easy_share: Num;
  target_lo: number;
  target_hi: number;
};

/** Sum zone minutes per week ('W', starting Monday) or month ('M'); empty weeks/months show as 0.
 * With `daily`, also Garmin's all-day intensity minutes (moderate + 2 x vigorous, as Garmin counts them). */
export function zonePeriods(z: ZoneRow[], freq: 'W' | 'M', daily?: DailyRow[]): ZonePeriod[] {
  const key = freq === 'W' ? mondayOf : monthStart;
  const next = (p: ISODate) => (freq === 'W' ? addDays(p, 7) : addDays(p, daysInMonth(p)));
  const span = (dates: ISODate[]): ISODate[] => {
    if (!dates.length) return [];
    const keys = dates.map(key).sort();
    const out: ISODate[] = [];
    for (let p = keys[0]; p <= keys[keys.length - 1]; p = next(p)) out.push(p);
    return out;
  };
  const zoneKeys = span(z.map((r) => r.date));
  const zBy = groupBy(z, (r) => key(r.date));
  const intensity = new Map<ISODate, number>();
  const dailyKeys = daily ? span(daily.map((d) => d.date)) : [];
  if (daily) {
    for (const p of dailyKeys) intensity.set(p, 0);
    for (const d of daily) {
      const p = key(d.date);
      intensity.set(p, (intensity.get(p) ?? 0) + (d.intensity_min_moderate ?? 0) + 2 * (d.intensity_min_vigorous ?? 0));
    }
  }
  const periods = [...new Set([...zoneKeys, ...dailyKeys])].sort();
  return periods.map((p) => {
    const rows = zBy.get(p) ?? [];
    const zs = Object.fromEntries(ZONES.map((k) => [k, sum(rows.map((r) => r[k]))])) as Record<ZoneKey, number>;
    const total = sum(ZONES.map((k) => zs[k]));
    const weeks = freq === 'W' ? 1 : daysInMonth(p) / 7;
    return {
      period: p, ...zs, moderate_eq: sum(rows.map((r) => r.moderate_eq)),
      garmin_intensity: intensity.has(p) ? (intensity.get(p) as number) : null,
      easy_share: total > 0 ? (zs.z1_min + zs.z2_min) / total : null,
      target_lo: WHO_WEEKLY_MIN[0] * weeks, target_hi: WHO_WEEKLY_MIN[1] * weeks,
    };
  });
}

// ---------------------------------------------------------------- small shared helpers

/** BARBELL_HIP_THRUST -> 'Barbell hip thrust'. */
export function pretty(code: string | null): string {
  const s = String(code ?? '').replace(/_/g, ' ').trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
