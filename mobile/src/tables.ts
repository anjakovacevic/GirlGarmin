/** Flatten the downloaded Garmin JSON into the tables the dashboard reads (sync.py's build_tables).
 *
 * Layout in the app's storage (everything is your personal data and stays on the phone):
 *   raw/activities.json        {activityId: activity summary}
 *   raw/exercise_sets.json     {activityId: sets/reps/weight of a strength activity}
 *   raw/daily/<YYYY-MM-DD>.json  {stats, sleep, hrv, training_readiness} for one day (only the fields used)
 *   raw/profile/*.json         profile, HR zones, weigh-ins, cycle calendar
 *   tables.json                the flat tables built from raw - what the screens read
 */

import type { ISODate } from './lib/dates';
import { isNum, type Num, round } from './lib/stats';
import { store } from './lib/store';

export interface Activity {
  activity_id: number;
  start: string; // local start time "YYYY-MM-DD HH:MM:SS"
  date: ISODate;
  name: string;
  type: string;
  duration_min: number;
  distance_km: number;
  calories: Num;
  avg_hr: Num;
  max_hr: Num;
  aerobic_te: Num;
  anaerobic_te: Num;
  training_load: Num;
  total_sets: Num;
  total_reps: Num;
  vo2max: Num;
  // minutes in each heart-rate zone, using the zones your watch had when you recorded it
  z1_min: Num;
  z2_min: Num;
  z3_min: Num;
  z4_min: Num;
  z5_min: Num;
}

export interface SetRow {
  activity_id: number;
  start: string;
  date: ISODate;
  category: string | null;
  exercise: string | null;
  reps: Num;
  weight_kg: Num; // null = bodyweight
  duration_s: Num;
}

export interface DailyRow {
  date: ISODate;
  steps: Num;
  resting_hr: Num;
  avg_stress: Num;
  body_battery_high: Num;
  body_battery_low: Num;
  active_kcal: Num;
  intensity_min_moderate: Num;
  intensity_min_vigorous: Num;
  sleep_h: Num;
  sleep_score: Num;
  hrv_last_night: Num;
  hrv_weekly_avg: Num;
  hrv_status: string | null;
  training_readiness: Num;
  skin_temp_dev: Num; // overnight skin temperature vs personal baseline (deg C); drives the cycle view
  body_battery_gain: Num;
  body_battery_wake: Num;
  deep_min: Num;
  light_min: Num;
  rem_min: Num;
  awake_min: Num;
  sleep_stress: Num;
  sleep_avg_hr: Num;
  restless_moments: Num;
  bedtime: string | null; // local "YYYY-MM-DD HH:MM"
  wake_time: string | null;
}

export interface WeightRow {
  date: ISODate;
  weight_kg: number;
}

export interface CycleRow {
  start: ISODate;
  period_days: Num;
  garmin_ovulation: ISODate | null;
}

export interface Tables {
  activities: Activity[];
  sets: SetRow[];
  daily: DailyRow[];
  weight: WeightRow[];
  cycles: CycleRow[];
  built?: string; // when the tables were built (ISO timestamp)
}

export const EMPTY: Tables = { activities: [], sets: [], daily: [], weight: [], cycles: [] };

const n = (v: unknown): Num => (isNum(v) ? v : null);
const minutes = (s: unknown, digits = 0): Num => (isNum(s) ? round(s / 60, digits) : null);

/** Garmin's *Local timestamps are local wall-clock time stored as if it were UTC. */
const localTime = (ms: unknown): string | null =>
  isNum(ms) && ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : null;

/** Keep only what the tables use from a day's downloads, so a year of data stays a few MB. */
export function trimDay(kind: string, data: any): any {
  if (!data || typeof data !== 'object') return data ?? null;
  if (kind === 'stats') {
    const keys = ['totalSteps', 'restingHeartRate', 'averageStressLevel', 'bodyBatteryHighestValue',
      'bodyBatteryLowestValue', 'activeKilocalories', 'moderateIntensityMinutes', 'vigorousIntensityMinutes',
      'bodyBatteryAtWakeTime', 'totalKilocalories', 'floorsAscended'];
    return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]));
  }
  if (kind === 'sleep') {
    const dto = data.dailySleepDTO ?? {};
    const keys = ['sleepTimeSeconds', 'sleepScores', 'deepSleepSeconds', 'lightSleepSeconds', 'remSleepSeconds',
      'awakeSleepSeconds', 'avgSleepStress', 'avgHeartRate', 'sleepStartTimestampLocal', 'sleepEndTimestampLocal',
      'averageRespirationValue'];
    return {
      dailySleepDTO: Object.fromEntries(keys.filter((k) => k in dto).map((k) => [k, dto[k]])),
      avgSkinTempDeviationC: data.avgSkinTempDeviationC, skinTempDataExists: data.skinTempDataExists,
      bodyBatteryChange: data.bodyBatteryChange, restlessMomentsCount: data.restlessMomentsCount,
    };
  }
  if (kind === 'hrv') return { hrvSummary: data.hrvSummary ?? null };
  if (kind === 'training_readiness') {
    const first = Array.isArray(data) ? data[0] : null;
    return first ? [{ score: first.score, level: first.level }] : [];
  }
  return data;
}

export function activityRow(a: any): Activity {
  const start: string = a.startTimeLocal ?? '';
  return {
    activity_id: a.activityId,
    start,
    date: start.slice(0, 10),
    name: a.activityName ?? '',
    type: a.activityType?.typeKey ?? '',
    duration_min: round((a.duration || 0) / 60, 1),
    distance_km: round((a.distance || 0) / 1000, 2),
    calories: n(a.calories),
    avg_hr: n(a.averageHR),
    max_hr: n(a.maxHR),
    aerobic_te: n(a.aerobicTrainingEffect),
    anaerobic_te: n(a.anaerobicTrainingEffect),
    training_load: n(a.activityTrainingLoad),
    total_sets: n(a.totalSets),
    total_reps: n(a.totalReps),
    vo2max: n(a.vO2MaxValue),
    z1_min: minutes(a.hrTimeInZone_1, 1),
    z2_min: minutes(a.hrTimeInZone_2, 1),
    z3_min: minutes(a.hrTimeInZone_3, 1),
    z4_min: minutes(a.hrTimeInZone_4, 1),
    z5_min: minutes(a.hrTimeInZone_5, 1),
  };
}

export function setRows(id: string, s: any): SetRow[] {
  const out: SetRow[] = [];
  for (const es of s?.exerciseSets ?? []) {
    if (es.setType !== 'ACTIVE') continue;
    const ex = (es.exercises ?? [{}])[0] ?? {};
    const w = es.weight;
    const start: string = es.startTime ?? '';
    out.push({
      activity_id: Number(s.activityId ?? id),
      start,
      date: start.slice(0, 10),
      category: ex.category ?? null,
      // Garmin often leaves name empty (e.g. lateral raises) - fall back to category
      exercise: ex.name || ex.category || null,
      reps: n(es.repetitionCount),
      weight_kg: isNum(w) && w > 0 ? w / 1000 : null, // -1 = bodyweight
      duration_s: n(es.duration),
    });
  }
  return out;
}

export function dailyRow(ds: ISODate, day: any): DailyRow | null {
  const st = day?.stats ?? {};
  const sleep = day?.sleep ?? {};
  const sl = sleep.dailySleepDTO ?? {};
  const hrv = day?.hrv?.hrvSummary ?? {};
  const trl = day?.training_readiness;
  const tr = Array.isArray(trl) && trl.length ? trl[0] : {};
  const hasHrv = hrv && Object.keys(hrv).length > 0;
  if (!(st.totalSteps || sl.sleepTimeSeconds || hasHrv)) return null; // no watch data that day
  return {
    date: ds,
    steps: n(st.totalSteps),
    resting_hr: n(st.restingHeartRate),
    avg_stress: n(st.averageStressLevel),
    body_battery_high: n(st.bodyBatteryHighestValue),
    body_battery_low: n(st.bodyBatteryLowestValue),
    active_kcal: n(st.activeKilocalories),
    intensity_min_moderate: n(st.moderateIntensityMinutes),
    intensity_min_vigorous: n(st.vigorousIntensityMinutes),
    sleep_h: round((sl.sleepTimeSeconds || 0) / 3600, 2) || null,
    sleep_score: n(sl.sleepScores?.overall?.value),
    hrv_last_night: n(hrv.lastNightAvg),
    hrv_weekly_avg: n(hrv.weeklyAvg),
    hrv_status: hrv.status ?? null,
    training_readiness: n(tr.score),
    skin_temp_dev: sleep.skinTempDataExists ? n(sleep.avgSkinTempDeviationC) : null,
    body_battery_gain: n(sleep.bodyBatteryChange),
    body_battery_wake: n(st.bodyBatteryAtWakeTime),
    deep_min: minutes(sl.deepSleepSeconds),
    light_min: minutes(sl.lightSleepSeconds),
    rem_min: minutes(sl.remSleepSeconds),
    awake_min: minutes(sl.awakeSleepSeconds),
    sleep_stress: n(sl.avgSleepStress),
    sleep_avg_hr: n(sl.avgHeartRate),
    restless_moments: n(sleep.restlessMomentsCount),
    bedtime: localTime(sl.sleepStartTimestampLocal),
    wake_time: localTime(sl.sleepEndTimestampLocal),
  };
}

export function cycleRows(calendar: any[]): CycleRow[] {
  const cycles = new Map<string, CycleRow>();
  for (const chunk of calendar ?? []) {
    for (const c of chunk?.cycleSummaries ?? []) {
      if (!c.predictedCycle) {
        cycles.set(c.startDate, { start: c.startDate, period_days: n(c.periodLength), garmin_ovulation: c.predictedOvulationDate ?? null });
      }
    }
  }
  return [...cycles.values()].sort((a, b) => a.start.localeCompare(b.start));
}

export function weightRows(w: any): WeightRow[] {
  return (w?.dailyWeightSummaries ?? [])
    .filter((s: any) => s.latestWeight)
    .map((s: any) => ({ date: s.summaryDate, weight_kg: s.latestWeight.weight / 1000 }))
    .sort((a: WeightRow, b: WeightRow) => a.date.localeCompare(b.date));
}

/** Rebuild tables.json from raw/. */
export async function buildTables(log: (s: string) => void = () => {}): Promise<Tables> {
  const s = store();
  log('Building tables...');
  const acts = (await s.read<Record<string, any>>('raw/activities.json')) ?? {};
  const activities = Object.values(acts).map(activityRow).sort((a, b) => a.start.localeCompare(b.start));

  const ex = (await s.read<Record<string, any>>('raw/exercise_sets.json')) ?? {};
  const sets = Object.entries(ex).flatMap(([id, v]) => setRows(id, v)).sort((a, b) => a.start.localeCompare(b.start));

  const daily: DailyRow[] = [];
  for (const f of (await s.list('raw/daily')).filter((x) => x.endsWith('.json')).sort()) {
    const ds = f.slice(0, 10);
    const row = dailyRow(ds, await s.read(`raw/daily/${f}`));
    if (row) daily.push(row);
  }

  const cycles = cycleRows((await s.read<any[]>('raw/profile/menstrual_calendar.json')) ?? []);
  const weight = weightRows(await s.read('raw/profile/weigh_ins.json'));

  const t: Tables = { activities, sets, daily, weight, cycles, built: new Date().toISOString() };
  await s.write('tables.json', t);
  log(`  activities=${activities.length} strength_sets=${sets.length} days=${daily.length} weigh_ins=${weight.length}`);
  return t;
}

export async function loadTables(): Promise<Tables> {
  return (await store().read<Tables>('tables.json')) ?? EMPTY;
}
