/** Example 8-week training plan: exact sets, reps and loads for every session.
 *
 * The same plan as girlgarmin/plans/example_plan.py. It is the single source of truth for the app
 * ("Today" tab, plan vs. actual) and for the workouts the app can put on your watch.
 *
 * MAKE IT YOURS
 *   1. Copy this file to `myPlan.ts` in this folder (it is git-ignored, so it stays private) and
 *      edit the copy - the app automatically prefers it over this example (restart `npx expo start`
 *      after creating it).
 *   2. Change the starting load (6th number) of every exercise to what you can lift now for the
 *      starting reps. The example numbers are only a starting point; week 1 is flagged as "adjust".
 *   3. Pick the Monday of week 1 in the app: Settings -> Plan start.
 *
 * Split: Mon Glutes, Tue Upper A, Thu Legs, Sat Upper B (glute + shoulder priority), with cardio on
 * the days in between. Never more than two training days in a row.
 *
 * Progression (double progression): add 1 rep per set each week; once every set reaches the top of
 * the rep range, add the load increment and drop back to the bottom of the range. Targets come from
 * what you actually logged last time (src/progression.ts); the numbers below are only used until an
 * exercise has been logged. Lighter weeks (deloadWeeks) use 2/3 of the sets, the bottom of the range
 * and the previous week's load.
 */

import { ex, type PlanDef, type Session } from '../plan';

const WARMUP_LOWER =
  '5 min incline walk (treadmill ~10% incline, easy - Garmin HR zone 1-2), ' +
  'then 2 warm-up sets of the first exercise: ~50% x 8, ~70% x 3. No stair machine before leg days.';
const WARMUP_UPPER =
  '5 min incline walk or stair machine, easy (Garmin HR zone 1-2), ' +
  'then 2 warm-up sets of the first exercise: ~50% x 8, ~70% x 3.';

// ex(name, sets, rep_lo, rep_hi, start_reps, start_kg, inc_kg, rest_s, rir, garmin_category, garmin_name, {options})
// Example starting loads - replace them with your own. Garmin names come from Garmin Connect's
// exercise list; they decide what the watch shows and logs.
const GLUTES: Session = {
  weekday: 0, title: 'Glutes', warmup: WARMUP_LOWER, exercises: [
    ex('Barbell hip thrust', 4, 6, 10, 8, 60, 5, 150, '1-2', 'HIP_RAISE', 'BARBELL_HIP_THRUST_WITH_BENCH', { note: 'Pause 1 s at the top.' }),
    ex('Romanian deadlift', 3, 8, 10, 8, 40, 5, 150, '2', 'DEADLIFT', 'ROMANIAN_DEADLIFT', { note: 'Hips back until hamstrings are fully stretched.' }),
    ex('Dumbbell step-up (knee-height box)', 2, 8, 12, 8, 8, 2, 90, '1-2', 'SQUAT', 'DUMBBELL_STEP_UP', { perLeg: true, note: 'Drive through the front heel.' }),
    ex('Seated leg curl', 3, 10, 15, 10, 25, 2.5, 90, '1', 'LEG_CURL', 'LEG_CURL'),
    ex('Hip abduction machine', 2, 12, 20, 12, 35, 5, 75, '0-1', 'HIP_STABILITY', 'STANDING_HIP_ABDUCTION', { note: 'Lean slightly forward.' }),
  ],
};
const UPPER_A: Session = {
  weekday: 1, title: 'Upper A - shoulders', warmup: WARMUP_UPPER, cardioAfter: 'VO2max intervals on the bike (see Cardio column).', exercises: [
    ex('Seated dumbbell overhead press', 3, 6, 10, 8, 20, 2, 120, '1-2', 'SHOULDER_PRESS', 'OVERHEAD_DUMBBELL_PRESS'),
    ex('Lat pulldown', 3, 8, 12, 8, 35, 2.5, 120, '1-2', 'PULL_UP', 'LAT_PULLDOWN'),
    ex('Incline dumbbell bench press', 3, 8, 12, 8, 16, 2, 120, '1-2', 'BENCH_PRESS', 'INCLINE_DUMBBELL_BENCH_PRESS'),
    ex('Seated cable row', 3, 8, 12, 8, 35, 2.5, 120, '1-2', 'ROW', 'SEATED_CABLE_ROW'),
    ex('Dumbbell lateral raise', 4, 10, 20, 10, 6, 2, 75, '0-1', 'LATERAL_RAISE', 'DUMBBELL_LATERAL_RAISE', { note: 'Controlled, no swinging.' }),
    ex('Dumbbell biceps curl', 2, 8, 12, 8, 8, 2, 75, '1', 'CURL', 'DUMBBELL_BICEPS_CURL'),
  ],
};
const LEGS: Session = {
  weekday: 3, title: 'Legs', warmup: WARMUP_LOWER, exercises: [
    ex('Barbell back squat (full depth)', 3, 6, 10, 8, 40, 2.5, 150, '2', 'SQUAT', 'BARBELL_BACK_SQUAT', { note: 'Below parallel.' }),
    ex('Barbell hip thrust (lighter)', 3, 10, 15, 10, 50, 5, 120, '1-2', 'HIP_RAISE', 'BARBELL_HIP_THRUST_WITH_BENCH'),
    ex('Dumbbell Bulgarian split squat', 3, 8, 12, 8, 8, 2, 105, '1-2', 'LUNGE', 'DUMBBELL_BULGARIAN_SPLIT_SQUAT', { perLeg: true, note: 'Lean torso slightly forward.' }),
    ex('Leg extension', 3, 10, 15, 10, 30, 5, 90, '0-1', 'CRUNCH', 'WEIGHTED_LEG_EXTENSIONS'),
    ex('Standing cable hip abduction', 2, 12, 20, 12, 10, 2.5, 60, '0-1', 'HIP_STABILITY', 'STANDING_CABLE_HIP_ABDUCTION', { perLeg: true }),
  ],
};
const UPPER_B: Session = {
  weekday: 5, title: 'Upper B - shoulders + glutes', warmup: WARMUP_UPPER, cardioAfter: '20 min zone-2 incline walk after lifting.', exercises: [
    ex('One-arm cable lateral raise', 4, 12, 20, 12, 2.5, 1.25, 60, '0-1', 'LATERAL_RAISE', 'ONE_ARM_CABLE_LATERAL_RAISE', { perLeg: true, note: 'Per arm.' }),
    ex('Machine shoulder press', 3, 8, 12, 8, 15, 2.5, 120, '1-2', 'SHOULDER_PRESS', 'SHOULDER_PRESS'),
    ex('Barbell bent-over row', 3, 8, 12, 8, 25, 2.5, 120, '1-2', 'ROW', 'BENT_OVER_ROW_WITH_BARBELL'),
    ex('Lat pulldown (neutral / close grip)', 2, 10, 12, 10, 30, 2.5, 90, '1-2', 'PULL_UP', 'CLOSE_GRIP_LAT_PULLDOWN'),
    ex('Reverse cable fly / kneeling rear fly', 3, 12, 20, 12, 10, 2.5, 60, '0-1', 'FLYE', 'KNEELING_REAR_FLYE'),
    ex('45-degree back extension (glute bias)', 2, 10, 15, 10, 5, 2.5, 90, '1', 'HYPEREXTENSION', 'WEIGHTED_STATIC_BACK_EXTENSION', { note: 'Round upper back, squeeze glutes.' }),
  ],
};

const WEEKS = 8;
// Cardio per week: [number of hard intervals, seconds each]. Follows Helgerud 2007 (4 x 4 min, 3 min easy between).
const INTERVALS: Record<number, [number, number]> = {
  1: [3, 180], 2: [4, 180], 3: [4, 240], 4: [4, 240], 5: [4, 240], 6: [4, 240], 7: [4, 240], 8: [3, 240],
};

const plan: PlanDef = {
  weeks: WEEKS,
  deloadWeeks: [8],
  sessions: [GLUTES, UPPER_A, LEGS, UPPER_B],
  intervals: INTERVALS,
  // Garmin activity each cardio workout is recorded as: "running", "cycling" or "walking".
  // (Not Garmin's "Cardio" type - the watch logs that like strength sets.) After changing these,
  // use Settings -> Watch workouts -> Replace cardio.
  intervalSport: 'cycling', // "running" for treadmill intervals
  zone2Sport: 'walking',
  zone2Walk: 'Zone-2 incline walk {m} min (Garmin HR zone 2 - you can still talk in full sentences).',
  outdoorTest:
    'Easy 25-30 min OUTDOOR run or brisk walk with GPS - most Garmin watches only update VO2max ' +
    'from outdoor runs/walks. Compare the week-1 and week-8 readings.',
  rest: 'Rest. Keep ~10k steps.',
  intervalsText: (week) => {
    const [n, secs] = INTERVALS[week];
    return (
      `VO2max intervals: 5 min easy, then ${n} x ${Math.floor(secs / 60)} min HARD (8/10 effort, only a few words possible, ` +
      'Garmin HR zone 4) with 3 min easy between, 3 min easy to finish. Exercise bike.'
    );
  },
  // Weekly template: weekday (0 = Monday) -> [session, cardio].
  template: {
    0: [GLUTES, null],
    1: [UPPER_A, 'intervals'],
    2: [null, 'zone2-30'],
    3: [LEGS, null],
    4: [null, 'zone2-30'],
    5: [UPPER_B, 'zone2-20'],
    6: [null, 'rest'],
  },
  // Per-week exceptions: the VO2max check runs on Friday of week 1 and the last week so you can
  // compare the two readings.
  overrides: {
    1: { 4: [null, 'vo2check'] },
    [WEEKS]: { 4: [null, 'vo2check'] },
  },
};

export default plan;
