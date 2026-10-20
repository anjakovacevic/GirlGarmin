/** Download your Garmin Connect data to the phone (incremental - safe to re-run any time).
 *
 * The same steps as girlgarmin/sync.py: all activities (+ sets/reps/weights of strength
 * workouts), profile and heart-rate zones, weigh-ins, daily health since your first activity, and
 * the menstrual cycle calendar. Only new days are downloaded; the last few days are always
 * refreshed because Garmin keeps updating them (sleep, HRV). The first sync takes a while (about
 * 4 requests per day of history), later ones a minute or two.
 */

import { GarminAuthError, GarminRateLimitError } from './garmin/auth';
import { type Garmin, GarminNotFoundError } from './garmin/api';
import { addDays, diffDays, type ISODate, todayISO } from './lib/dates';
import { store } from './lib/store';
import { buildTables, type Tables, trimDay } from './tables';

const REFRESH_RECENT_DAYS = 3; // re-fetch the last few days, which may still be incomplete
const DELAY_MS = 400; // between API calls - be gentle, Garmin rate-limits

// activity types that can contain sets/reps/weights
const STRENGTH_TYPES = new Set(['strength_training', 'indoor_cardio', 'hiit', 'fitness_equipment']);

export type Log = (line: string) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Call Garmin with a pause; null if not found, back off when rate-limited. */
async function call<T>(fn: () => Promise<T>, log: Log, cancelled: () => boolean): Promise<T | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (cancelled()) throw new SyncCancelled();
    try {
      const r = await fn();
      await sleep(DELAY_MS);
      return r;
    } catch (e) {
      if (e instanceof GarminNotFoundError) return null;
      if (e instanceof GarminRateLimitError) {
        const wait = 60 * (attempt + 1);
        log(`  rate limited, waiting ${wait}s`);
        await sleep(wait * 1000);
        continue;
      }
      throw e;
    }
  }
  throw new Error('Garmin keeps rate-limiting - try again in an hour.');
}

export class SyncCancelled extends Error {}

export interface SyncOptions {
  log: Log;
  /** Called with 0..1 during the long daily-health step. */
  progress?: (fraction: number) => void;
  cancelled?: () => boolean;
}

async function syncActivities(api: Garmin, o: Required<SyncOptions>): Promise<ISODate> {
  const s = store();
  o.log('Activities (all time)...');
  const acts = (await call(() => api.getActivitiesByDate('2000-01-01', todayISO()), o.log, o.cancelled)) ?? [];
  o.log(`  ${acts.length} activities found`);
  const saved = (await s.read<Record<string, any>>('raw/activities.json')) ?? {};
  const sets = (await s.read<Record<string, any>>('raw/exercise_sets.json')) ?? {};
  let fresh = 0;
  for (const a of acts) {
    const id = String(a.activityId);
    if (!(id in saved)) fresh++;
    saved[id] = a;
    if (STRENGTH_TYPES.has(a.activityType?.typeKey ?? '') && !(id in sets)) {
      sets[id] = await call(() => api.getActivityExerciseSets(id), o.log, o.cancelled);
      await s.write('raw/exercise_sets.json', sets); // saved as we go, so a cancelled sync keeps its progress
    }
  }
  await s.write('raw/activities.json', saved);
  o.log(`  ${fresh} new`);
  const starts = acts.map((a: any) => String(a.startTimeLocal).slice(0, 10)).sort();
  return starts[0] ?? todayISO();
}

async function syncProfile(api: Garmin, start: ISODate, end: ISODate, o: Required<SyncOptions>) {
  o.log('Profile, heart-rate zones, weigh-ins...');
  const save = async (name: string, fn: () => Promise<any>) =>
    store().write(`raw/profile/${name}.json`, await call(fn, o.log, o.cancelled));
  await save('user_profile', api.getUserProfile);
  await save('userprofile_settings', api.getUserprofileSettings);
  await save('personal_records', api.getPersonalRecord);
  await save('devices', api.getDevices);
  await save('body_composition', () => api.getBodyComposition(start, end));
  await save('weigh_ins', () => api.getWeighIns(start, end));
  await save('heart_rate_zones', api.getHeartRateZones);
}

const DAILY: Record<string, (api: Garmin, d: ISODate) => Promise<any>> = {
  stats: (api, d) => api.getStats(d),
  sleep: (api, d) => api.getSleepData(d),
  hrv: (api, d) => api.getHrvData(d),
  training_readiness: (api, d) => api.getTrainingReadiness(d),
};

async function syncDaily(api: Garmin, days: number, o: Required<SyncOptions>) {
  const s = store();
  const today = todayISO();
  o.log(`Daily health metrics (last ${days} days)...`);
  const have = new Set(await s.list('raw/daily'));
  for (let i = 0; i < days; i++) {
    const ds = addDays(today, -i);
    o.progress(i / days);
    if (have.has(`${ds}.json`) && i >= REFRESH_RECENT_DAYS) continue;
    const day: Record<string, any> = {};
    for (const [kind, fn] of Object.entries(DAILY)) day[kind] = trimDay(kind, await call(() => fn(api, ds), o.log, o.cancelled));
    await s.write(`raw/daily/${ds}.json`, day);
    if (i % 30 === 0) o.log(`  ${ds}`);
  }
  o.progress(1);
}

/** Menstrual cycle calendar (Garmin allows max 92 days per request) + today's cycle summary. */
async function syncCycle(api: Garmin, first: ISODate, o: Required<SyncOptions>) {
  o.log('Menstrual cycle...');
  const today = todayISO();
  const chunks: any[] = [];
  for (let start = addDays(first, -60); start <= today; ) {
    const end = [addDays(start, 91), today].sort()[0];
    const from = start;
    chunks.push((await call(() => api.getMenstrualCalendarData(from, end), o.log, o.cancelled)) ?? {});
    start = addDays(end, 1);
  }
  await store().write('raw/profile/menstrual_calendar.json', chunks);
  await store().write('raw/profile/menstrual_summary.json', await call(() => api.getMenstrualCycleSummary(today), o.log, o.cancelled));
}

/** Download everything new, then rebuild the tables. */
export async function sync(api: Garmin, opts: SyncOptions): Promise<Tables> {
  const o: Required<SyncOptions> = { progress: () => {}, cancelled: () => false, ...opts };
  try {
    await api.loadProfile();
  } catch (e) {
    if (e instanceof GarminAuthError) throw e;
    throw new Error(`Can't reach Garmin Connect: ${(e as Error).message}`);
  }
  o.log(`Logged in as ${api.fullName}`);
  const today = todayISO();
  const first = await syncActivities(api, o);
  const days = diffDays(today, first) + 1;
  // weigh-ins can predate the watch (logged manually in the app), so look back further
  await syncProfile(api, addDays(today, -Math.max(days, 730)), today, o);
  await syncDaily(api, days, o);
  await syncCycle(api, first, o);
  return buildTables(o.log);
}
