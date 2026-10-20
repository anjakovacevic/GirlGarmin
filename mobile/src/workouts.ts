/** Put your plans on your Garmin calendar as scheduled workouts, so they sync to your watch
 * (workouts.py), and keep the calendar in step: after every plan change and every sync, syncWatch
 * fixes only the days that differ. Strength workouts show exercise, reps and target weight on the
 * watch; warm-up and rest steps end when you press lap. Targets come from what you logged last time
 * (progression.ts), so the coming week's strength workouts follow your latest sessions.
 *
 * Everything uploaded is recorded in garmin_workouts.json (in the app's storage) so it can be
 * removed cleanly. That record is per device: workouts uploaded from the computer can only be
 * removed from the computer, and the other way round.
 */

import type { Garmin } from './garmin/api';
import { addDays, fmtShort, type ISODate, todayISO } from './lib/dates';
import { store } from './lib/store';
import { fmtG, groupBy } from './lib/stats';
import { type CardioSport, isDeload, P, scheduledPlans, type Session, withPlan } from './plan';
import { type Hist, target } from './progression';
import { SyncCancelled } from './sync';

const MANIFEST = 'garmin_workouts.json';

const SPORT = {
  strength_training: { sportTypeId: 5, sportTypeKey: 'strength_training', displayOrder: 5 },
  running: { sportTypeId: 1, sportTypeKey: 'running', displayOrder: 1 },
  cycling: { sportTypeId: 2, sportTypeKey: 'cycling', displayOrder: 2 },
  walking: { sportTypeId: 17, sportTypeKey: 'walking', displayOrder: 17 },
};
const STEP = {
  warmup: { stepTypeId: 1, stepTypeKey: 'warmup', displayOrder: 1 },
  cooldown: { stepTypeId: 2, stepTypeKey: 'cooldown', displayOrder: 2 },
  interval: { stepTypeId: 3, stepTypeKey: 'interval', displayOrder: 3 },
  recovery: { stepTypeId: 4, stepTypeKey: 'recovery', displayOrder: 4 },
  rest: { stepTypeId: 5, stepTypeKey: 'rest', displayOrder: 5 },
  repeat: { stepTypeId: 6, stepTypeKey: 'repeat', displayOrder: 6 },
};
const LAP_BUTTON = { conditionTypeId: 1, conditionTypeKey: 'lap.button', displayOrder: 1, displayable: true };
const TIME = { conditionTypeId: 2, conditionTypeKey: 'time', displayOrder: 2, displayable: true };
const REPS = { conditionTypeId: 10, conditionTypeKey: 'reps', displayOrder: 10, displayable: true };
const ITERATIONS = { conditionTypeId: 7, conditionTypeKey: 'iterations', displayOrder: 7, displayable: false };
const NO_TARGET = { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target', displayOrder: 1 };
const KILOGRAM = { unitId: 8, unitKey: 'kilogram', factor: 1000.0 };

type Step = Record<string, unknown>;

/** One step; without `seconds` it ends when you press lap. */
function step(order: number, type: keyof typeof STEP, seconds?: number, zone?: number): Step {
  return {
    type: 'ExecutableStepDTO', stepOrder: order, stepType: STEP[type],
    endCondition: seconds === undefined ? LAP_BUTTON : TIME,
    ...(seconds === undefined ? {} : { endConditionValue: seconds }),
    // Garmin target: stay in heart-rate zone `zone` (uses the zones set on your Garmin profile)
    targetType: zone ? { workoutTargetTypeId: 4, workoutTargetTypeKey: 'heart.rate.zone', displayOrder: 4, zoneNumber: zone } : NO_TARGET,
    ...(zone ? { zoneNumber: zone } : {}), // Garmin reads the zone from the step itself
  };
}

function repeat(order: number, n: number, steps: Step[]): Step {
  return {
    type: 'RepeatGroupDTO', stepOrder: order, stepType: STEP.repeat, numberOfIterations: n, workoutSteps: steps,
    endCondition: ITERATIONS, endConditionValue: n, smartRepeat: false,
  };
}

interface Workout {
  workoutName: string;
  sportType: (typeof SPORT)[keyof typeof SPORT];
  estimatedDurationInSecs: number;
  workoutSegments: { segmentOrder: number; sportType: Workout['sportType']; workoutSteps: Step[] }[];
  author: Record<string, never>;
  description: string;
}

function workout(name: string, sport: Workout['sportType'], secs: number, description: string, steps: Step[]): Workout {
  return {
    workoutName: name, sportType: sport, estimatedDurationInSecs: secs,
    workoutSegments: [{ segmentOrder: 1, sportType: sport, workoutSteps: steps }], author: {}, description,
  };
}

/** One strength session for one date: warm-up, then sets x (exercise + rest) per exercise. */
export function strengthWorkout(session: Session, week: number, day: ISODate, cardio: string, hist: Hist): Workout {
  const steps: Step[] = [step(1, 'warmup')];
  let order = 2;
  const lines = [
    `Week ${week}${isDeload(week) ? ' (lighter week)' : ''}. Warm-up (press lap when done): ${session.warmup}`,
    "Rest: press lap when you're ready for the next set. Guide: ~2-3 min big lifts, ~1-1.5 min isolation.",
  ];
  for (const ex of session.exercises) {
    const t = target(ex, session, day, hist);
    const both = ex.loggedBothSides; // watch target = what you log: both legs together
    const exercise: Step = {
      type: 'ExecutableStepDTO', stepOrder: order + 1, stepType: STEP.interval, endCondition: REPS,
      endConditionValue: both ? t.reps * 2 : t.reps, targetType: NO_TARGET, category: ex.garminCategory,
      exerciseName: ex.garminName,
      // workouts take the weight in the stated unit (kg), not grams like logged sets
      ...(t.kg !== null ? { weightValue: t.kg, weightUnit: KILOGRAM } : {}),
    };
    steps.push(repeat(order, t.sets, [exercise, step(order + 2, 'rest')]));
    order += 3;
    const side = ex.note.toLowerCase().includes('arm') ? 'arm' : 'leg';
    const per = ex.perLeg ? (both ? ` per ${side} (log ${t.reps * 2})` : ` per ${side}`) : '';
    const load = t.kg !== null ? ` @ ${fmtG(t.kg)} kg` : '';
    lines.push(`${ex.name}: ${t.sets}x${t.reps}${per}${load}, RIR ${ex.rir}`
      + (t.basedOn === null && t.kg !== null ? ' (first time - adjust)' : ''));
  }
  if (cardio) lines.push('After: ' + cardio);
  return workout(`W${week} ${session.title} ${fmtShort(day)}`, SPORT.strength_training, 3600, lines.join('\n').slice(0, 1000), steps);
}

const cardioSport = (key: CardioSport) => SPORT[key] ?? SPORT.walking;

/** VO2max intervals: warm-up (lap to end), n x hard in zone 4 / 3 min easy in zone 2, cool-down. */
function intervalWorkout(week: number): Workout {
  const [n, secs] = P().intervals[week];
  const steps = [step(1, 'warmup'), repeat(2, n, [step(3, 'interval', secs, 4), step(4, 'recovery', 180, 2)]), step(5, 'cooldown', 180)];
  return workout(`W${week} VO2max ${n}x${Math.floor(secs / 60)}min`, cardioSport(P().intervalSport), 300 + n * (secs + 180) + 180,
    P().intervalsText(week), steps);
}

/** Steady walk in heart-rate zone 2 (reused on every day it is scheduled). */
function zone2Workout(minutes: number): Workout {
  return workout(`Zone 2 incline walk ${minutes} min`, cardioSport(P().zone2Sport), minutes * 60,
    P().zone2Walk.replace('{m}', String(minutes)), [step(1, 'interval', minutes * 60, 2)]);
}

/** Easy outdoor run/walk - the kind of activity Garmin uses to update VO2max. */
function vo2CheckWorkout(): Workout {
  return workout('VO2max check - easy outdoor run 25 min', SPORT.running, 25 * 60, P().outdoorTest,
    [step(1, 'interval', 25 * 60, 2)]);
}

// ---------------------------------------------------------------- keeping the calendar in step

interface Manifest {
  workouts: { id: number; name: string; kind: 'strength' | 'cardio'; hash?: string }[];
  // shape: the plan content behind a strength workout (without targets), to see if the plan changed
  scheduled: { id: number | null; workout_id: number; date: ISODate; name: string; shape?: string }[];
}

export type Log = (line: string) => void;

export const loadManifest = () => store().read<Manifest>(MANIFEST);
const saveManifest = (m: Manifest) => store().write(MANIFEST, m);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Short fingerprint of a JSON value (to tell whether a workout changed). */
function hash(v: unknown): string {
  const s = JSON.stringify(v);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Strength targets are re-checked for this many days ahead (they follow what you last lifted). */
const TARGET_DAYS = 7;

/** One calendar entry the plans call for. */
interface Wanted {
  date: ISODate;
  kind: 'strength' | 'cardio';
  workout: Workout;
  hash: string; // the whole workout
  shape: string; // strength: the plan content without targets; cardio: same as hash
}

/** Every workout your scheduled plans call for from `from` on (each plan's days built with that
 * plan, so a plan that hasn't started yet gets its own weeks and lighter weeks). */
function wanted(hist: Hist, from: ISODate): Wanted[] {
  const out: Wanted[] = [];
  for (const plan of scheduledPlans()) {
    withPlan(plan, () => {
      for (const d of plan.days) {
        if (d.date < from) continue;
        if (d.session) {
          const w = strengthWorkout(d.session, d.week, d.date, d.cardio, hist);
          const shape = hash({ title: d.session.title, warmup: d.session.warmup, ex: d.session.exercises, week: d.week, lighter: isDeload(d.week), cardio: d.cardio });
          out.push({ date: d.date, kind: 'strength', workout: w, hash: hash(w), shape });
        }
        const kind = d.cardioKind;
        if (kind === 'intervals' || kind?.startsWith('zone2-') || kind === 'vo2check') {
          const w = kind === 'intervals' ? intervalWorkout(d.week) : kind === 'vo2check' ? vo2CheckWorkout() : zone2Workout(Number(kind.split('-')[1]));
          const h = hash(w);
          out.push({ date: d.date, kind: 'cardio', workout: w, hash: h, shape: h });
        }
      }
    });
  }
  return out;
}

/** Make the Garmin calendar match your plans from today on: remove what's no longer planned (an
 * ended plan, a moved day, a changed session), add what's missing (a new or queued plan, extra
 * weeks), and refresh the next week's strength targets. Unchanged days are left alone, past days
 * are never touched, and nothing happens until the plans were first put on the watch. */
export async function syncWatch(api: Garmin, hist: Hist, log: Log, cancelled: () => boolean = () => false): Promise<void> {
  const made = await loadManifest();
  if (!made) return;
  const today = todayISO();
  const targetsUntil = addDays(today, TARGET_DAYS - 1);
  const want = wanted(hist, today);
  const kindOf = (wid: number) => made.workouts.find((w) => w.id === wid)?.kind ?? 'strength';
  const hashOf = (wid: number) => made.workouts.find((w) => w.id === wid)?.hash;

  // which calendar entries from today on are still right
  const keep = new Set<Manifest['scheduled'][number]>();
  const missing: Wanted[] = [];
  for (const w of want) {
    const found = made.scheduled.find((x) => {
      if (keep.has(x) || x.date !== w.date || kindOf(x.workout_id) !== w.kind) return false;
      if (w.kind === 'cardio') return hashOf(x.workout_id) ? hashOf(x.workout_id) === w.hash : x.name === w.workout.workoutName;
      if (x.shape ? x.shape !== w.shape : x.name !== w.workout.workoutName) return false; // the plan changed
      return w.date > targetsUntil || hashOf(x.workout_id) === w.hash; // near days: targets must match too
    });
    if (found) keep.add(found);
    else missing.push(w);
  }
  const stale = made.scheduled.filter((x) => x.date >= today && !keep.has(x));
  if (!stale.length && !missing.length) {
    log('Your watch is up to date.');
    return;
  }

  // take stale entries off the calendar; a workout with nothing else on the calendar is deleted
  for (const [wid, xs] of groupBy(stale, (x) => x.workout_id)) {
    if (cancelled()) throw new SyncCancelled();
    const rest = made.scheduled.filter((y) => y.workout_id === wid && !xs.includes(y)); // past or still right
    if (rest.length && xs.every((x) => x.id)) {
      for (const x of xs) {
        await api.unscheduleWorkout(x.id as number);
        await pause(300);
      }
      made.scheduled = made.scheduled.filter((y) => !xs.includes(y));
    } else {
      // nothing else uses it - or an entry can't be taken off on its own (no id): delete the
      // workout, and put back the days from today on that were still right
      await api.deleteWorkout(wid);
      await pause(300);
      for (const y of rest.filter((y) => y.date >= today)) missing.push(...want.filter((w) => w.date === y.date && w.kind === kindOf(wid)));
      made.workouts = made.workouts.filter((w) => w.id !== wid);
      made.scheduled = made.scheduled.filter((y) => y.workout_id !== wid);
    }
    await saveManifest(made);
  }

  // add what's missing; cardio workouts that are the same every time are uploaded once and reused
  for (const w of missing) {
    if (cancelled()) throw new SyncCancelled();
    let wid = w.kind === 'cardio' ? made.workouts.find((x) => x.hash === w.hash)?.id : undefined;
    if (wid === undefined) {
      const res = await api.uploadWorkout(w.workout);
      await pause(500);
      wid = res.workoutId as number;
      made.workouts.push({ id: wid, name: w.workout.workoutName, kind: w.kind, hash: w.hash });
      await saveManifest(made);
    }
    const res = await api.scheduleWorkout(wid, w.date);
    await pause(500);
    made.scheduled.push({ id: res?.workoutScheduleId ?? res?.id ?? null, workout_id: wid, date: w.date, name: w.workout.workoutName, shape: w.shape });
    await saveManifest(made);
    log(`  ${w.date} ${w.workout.workoutName}`);
  }
  log(`Watch updated: ${stale.length} removed, ${missing.length} added.`);
}

/** Start keeping your watch in step with your plans: from now on every plan change and every sync
 * updates the Garmin calendar. */
export async function createAll(api: Garmin, hist: Hist, log: Log): Promise<void> {
  if (await loadManifest()) throw new Error('Your plans are already on your watch.');
  await saveManifest({ workouts: [], scheduled: [] });
  await syncWatch(api, hist, log);
}

/** Delete every workout this phone uploaded (past calendar entries too), and stop updating the watch. */
export async function deleteAll(api: Garmin, log: Log): Promise<void> {
  const made = await loadManifest();
  if (!made) throw new Error('Nothing to delete - no plan was uploaded from this phone.');
  for (const w of made.workouts) {
    await api.deleteWorkout(w.id);
    await pause(300);
  }
  await store().remove(MANIFEST);
  log(`Deleted ${made.workouts.length} workouts.`);
}
