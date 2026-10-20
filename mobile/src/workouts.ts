/** Put the plan on your Garmin calendar as scheduled workouts, so they sync to your watch
 * (workouts.py). Strength workouts show exercise, reps and target weight on the watch; warm-up and
 * rest steps end when you press lap. Targets come from what you logged last time
 * (progression.ts), so every sync re-uploads the coming week's strength workouts.
 *
 * Everything uploaded is recorded in garmin_workouts.json (in the app's storage) so it can be
 * removed cleanly. That record is per device: workouts uploaded from the computer can only be
 * removed from the computer, and the other way round.
 */

import type { Garmin } from './garmin/api';
import { addDays, fmtShort, type ISODate, todayISO } from './lib/dates';
import { fmtG } from './lib/stats';
import { store } from './lib/store';
import { type CardioSport, isDeload, P, type Session } from './plan';
import { type HistSet, target } from './progression';

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
export function strengthWorkout(session: Session, week: number, day: ISODate, cardio: string, hist: HistSet[]): Workout {
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

// ---------------------------------------------------------------- uploading

interface Manifest {
  workouts: { id: number; name: string; kind: 'strength' | 'cardio' }[];
  scheduled: { id: number | null; workout_id: number; date: ISODate; name: string }[];
}

export type Log = (line: string) => void;

export const loadManifest = () => store().read<Manifest>(MANIFEST);
const saveManifest = (m: Manifest) => store().write(MANIFEST, m);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Upload a workout and note it in the manifest right away (so a crash can still be cleaned up). */
async function record(api: Garmin, made: Manifest, w: Workout, kind: 'strength' | 'cardio'): Promise<number> {
  const res = await api.uploadWorkout(w);
  await pause(500);
  made.workouts.push({ id: res.workoutId, name: w.workoutName, kind });
  await saveManifest(made);
  return res.workoutId;
}

async function sched(api: Garmin, made: Manifest, wid: number, day: ISODate, name: string): Promise<void> {
  const res = await api.scheduleWorkout(wid, day);
  await pause(500);
  made.scheduled.push({ id: res?.workoutScheduleId ?? res?.id ?? null, workout_id: wid, date: day, name });
  await saveManifest(made);
}

/** Upload the cardio workouts and schedule them on every plan day from `fromDay` on.
 * Zone-2 walks and the VO2max check are uploaded once and reused on each of their days. */
async function uploadCardio(api: Garmin, made: Manifest, fromDay: ISODate, log: Log): Promise<void> {
  const reused = new Map<string, number>();
  for (const w of made.workouts) {
    if (w.name.startsWith('Zone 2 incline walk ')) {
      const k = `zone2-${w.name.split(' ')[4]}`;
      if (!reused.has(k)) reused.set(k, w.id);
    } else if (w.name.startsWith('VO2max check') && !reused.has('vo2check')) reused.set('vo2check', w.id);
  }
  for (const d of P().days) {
    const kind = d.cardioKind;
    if (d.date < fromDay || !kind) continue;
    if (kind === 'intervals') {
      const w = intervalWorkout(d.week);
      await sched(api, made, await record(api, made, w, 'cardio'), d.date, w.workoutName);
      log(`  ${d.date} ${w.workoutName}`);
    } else if (kind.startsWith('zone2-') || kind === 'vo2check') {
      if (!reused.has(kind)) {
        const w = kind === 'vo2check' ? vo2CheckWorkout() : zone2Workout(Number(kind.split('-')[1]));
        reused.set(kind, await record(api, made, w, 'cardio'));
      }
      const name = kind === 'vo2check' ? 'VO2max check run' : `Zone 2 walk ${kind.split('-')[1]} min`;
      await sched(api, made, reused.get(kind) as number, d.date, name);
    }
  }
}

/** Upload one strength workout per session day from `fromDay` (to `toDay`) and schedule it. */
async function uploadStrength(api: Garmin, made: Manifest, hist: HistSet[], fromDay: ISODate, toDay: ISODate | null, log: Log) {
  for (const d of P().days) {
    if (d.session && d.date >= fromDay && (toDay === null || d.date <= toDay)) {
      const w = strengthWorkout(d.session, d.week, d.date, d.cardio, hist);
      await sched(api, made, await record(api, made, w, 'strength'), d.date, w.workoutName);
      log(`  ${d.date} ${w.workoutName}`);
    }
  }
}

/** Upload and schedule every workout of the plan. */
export async function createAll(api: Garmin, hist: HistSet[], log: Log): Promise<void> {
  if (await loadManifest()) throw new Error('The plan is already on your watch. Delete it first, or use Replace.');
  const made: Manifest = { workouts: [], scheduled: [] };
  const from = [P().firstDay, todayISO()].sort()[1];
  await uploadStrength(api, made, hist, from, null, log);
  await uploadCardio(api, made, from, log);
  log(`Created ${made.workouts.length} workouts, ${made.scheduled.length} calendar entries.`);
}

const isCardio = (w: Manifest['workouts'][number]) =>
  (w.kind ?? (w.name.includes('VO2max') || w.name.includes('Zone 2') ? 'cardio' : 'strength')) === 'cardio';

/** Re-upload one kind of workout from today on, after editing the plan. With `days`, only the
 * strength workouts of the next `days` days.
 *   strength: deletes the strength workouts scheduled from today on (past ones stay on your
 *             calendar) and uploads them again from the current plan.
 *   cardio:   deletes all cardio workouts (zone-2 walks are shared across dates, so their past
 *             calendar entries disappear too) and uploads them again from today on.
 * Recorded activities are never touched. */
export async function replace(api: Garmin, hist: HistSet[], kind: 'strength' | 'cardio', log: Log, days?: number): Promise<void> {
  const made = await loadManifest();
  if (!made) throw new Error('The plan is not on your watch yet - upload it first.');
  const fromDay = [todayISO(), P().firstDay].sort()[1];
  const toDay = days ? addDays(fromDay, days - 1) : null;
  let old: Set<number>;
  if (kind === 'cardio') old = new Set(made.workouts.filter(isCardio).map((w) => w.id));
  else {
    const strength = new Set(made.workouts.filter((w) => !isCardio(w)).map((w) => w.id));
    old = new Set(made.scheduled.filter((x) => strength.has(x.workout_id) && x.date >= fromDay && (toDay === null || x.date <= toDay))
      .map((x) => x.workout_id));
  }
  for (const wid of old) {
    // deleting a workout also removes its calendar entries
    await api.deleteWorkout(wid);
    await pause(300);
  }
  made.workouts = made.workouts.filter((w) => !old.has(w.id));
  made.scheduled = made.scheduled.filter((x) => !old.has(x.workout_id));
  await saveManifest(made);
  log(`Deleted ${old.size} ${kind} workouts.`);
  const before = made.workouts.length;
  if (kind === 'cardio') await uploadCardio(api, made, fromDay, log);
  else await uploadStrength(api, made, hist, fromDay, toDay, log);
  log(`Uploaded ${made.workouts.length - before} ${kind} workouts, scheduled from ${fromDay}.`);
}

/** Re-upload the coming week's strength workouts so their targets follow your latest logs.
 * Does nothing if the plan was never uploaded from this phone. */
export async function refresh(api: Garmin, hist: HistSet[], log: Log, days = 7): Promise<void> {
  if (await loadManifest()) {
    log("Updating the coming week's workouts on your watch...");
    await replace(api, hist, 'strength', log, days);
  }
}

/** Upload the plan days after the last day already on your calendar (e.g. after making the plan
 * longer). Days before that are left as they are. */
export async function extend(api: Garmin, hist: HistSet[], log: Log): Promise<void> {
  const made = await loadManifest();
  if (!made) throw new Error('The plan is not on your watch yet - upload it first.');
  const last = made.scheduled.map((x) => x.date).sort().pop();
  const fromDay = [last ? addDays(last, 1) : P().firstDay, todayISO()].sort()[1];
  const before = made.workouts.length;
  await uploadStrength(api, made, hist, fromDay, null, log);
  await uploadCardio(api, made, fromDay, log);
  log(`Uploaded ${made.workouts.length - before} workouts for the days from ${fromDay}.`);
}

/** Delete every workout listed in the manifest, then the manifest itself. */
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
