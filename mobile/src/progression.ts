/** Targets from what you actually lifted, instead of numbers written in advance (progression.py).
 *
 * For each exercise the next target comes from the last time you logged it (same session if
 * possible, e.g. the heavy Monday hip thrust is not mixed up with Thursday's lighter one):
 *
 * - working weight = the heaviest weight you did at least the bottom of the rep range with
 * - all sets at that weight reached the top of the range -> add the load increment, bottom of range
 * - otherwise -> same weight, one rep more than your weakest set at it (never below the range)
 * - no set reached the bottom of the range -> repeat the weight you used most, bottom of range
 *
 * Weeks further ahead are projected from there with +1 rep per week (the plan's double
 * progression), so the calendar is never empty; they are recalculated after every sync. Lighter
 * weeks use fewer sets and the bottom of the range, and are never used as a starting point.
 * Exercises you haven't logged yet (and bodyweight ones) fall back to the plan's own numbers.
 */

import type { Activity } from './tables';
import type { LiftSet } from './analysis';
import { addDays, type ISODate, todayISO } from './lib/dates';
import { type Ex, isDeload, P, type Session, weekOf } from './plan';

export interface Target {
  sets: number;
  reps: number;
  kg: number | null;
  basedOn: ISODate | null; // date of the logged session the target comes from; null = plan numbers
}

export type HistSet = LiftSet & { session: string | null };

/** Session an activity belongs to, from its name ("W3 Legs 15 Oct" -> "Legs"). */
function sessionTitle(name: string): string | null {
  // longest first: "Upper A - ..." before "Legs"
  for (const s of [...P().sessions].sort((a, b) => b.title.length - a.title.length)) {
    if (String(name).includes(s.title)) return s.title;
  }
  return null;
}

/** Logged sets with the plan session they were done in (null if it can't be told). */
export function history(sets: LiftSet[], acts: Activity[]): HistSet[] {
  const titles = new Map(acts.map((a) => [a.activity_id, sessionTitle(a.name)]));
  return sets
    .map((s) => ({ ...s, session: titles.get(s.activity_id) ?? null }))
    .filter((s) => !isDeload(weekOf(s.date))); // lighter weeks don't set the next target
}

/** One week of double progression (bodyweight exercises stop at the top of the range). */
function step(ex: Ex, reps: number, kg: number | null): [number, number | null] {
  if (kg === null) return [Math.min(reps + 1, ex.repHi), null];
  return reps < ex.repHi ? [reps + 1, kg] : [ex.repLo, kg + ex.incKg];
}

/** Number of times session `title` is planned in [start, end), lighter weeks not counted. */
function sessionsBetween(title: string, start: ISODate, end: ISODate): number {
  return P().days.filter((d) => d.session?.title === title && d.date >= start && d.date < end && !isDeload(d.week)).length;
}

/** Target for the session after `done` (the sets of one logged session of `ex`). */
function nextFrom(ex: Ex, done: HistSet[]): [number, number | null] {
  const perSide = ex.loggedBothSides ? 2 : 1;
  const d = done.filter((s) => (s.weight_kg ?? 0) > 0).map((s) => ({ kg: s.weight_kg as number, reps: (s.reps ?? 0) / perSide }));
  if (!d.length) return [ex.repLo, ex.startKg]; // only bodyweight sets logged: keep the plan's load
  const ok = d.filter((s) => s.reps >= ex.repLo);
  if (!ok.length) {
    // repeat the weight you used most (the heaviest of those if there's a tie)
    const counts = new Map<number, number>();
    for (const s of d) counts.set(s.kg, (counts.get(s.kg) ?? 0) + 1);
    const top = Math.max(...counts.values());
    return [ex.repLo, Math.max(...[...counts].filter(([, c]) => c === top).map(([k]) => k))];
  }
  const kg = Math.max(...ok.map((s) => s.kg));
  const weakest = Math.trunc(Math.min(...d.filter((s) => s.kg === kg).map((s) => s.reps)));
  if (weakest >= ex.repHi) return [ex.repLo, kg + ex.incKg];
  return [Math.max(ex.repLo, weakest + 1), kg];
}

/** Sets, reps and kg for `ex` in `session` on `day`, based on sessions logged before `day`. */
export function target(ex: Ex, session: Session, day: ISODate, hist: HistSet[], today?: ISODate): Target {
  const now = [today ?? todayISO(), day].sort()[0];
  const names = new Set([ex.garminName, ...ex.aliases]);
  let mine = hist.filter((s) => s.exercise !== null && names.has(s.exercise) && s.date < day);
  let reps: number;
  let kg: number | null;
  let last: ISODate | null = null;
  let since: ISODate;
  if (ex.startKg === null || !mine.length) {
    // nothing logged yet: the plan's starting numbers at the first session from now on
    [reps, kg] = [ex.startReps, ex.startKg];
    since = now;
  } else {
    const same = mine.filter((s) => s.session === session.title);
    if (same.length) mine = same; // e.g. a new slot for an exercise you already do elsewhere
    last = mine.reduce((m, s) => (s.date > m ? s.date : m), mine[0].date);
    [reps, kg] = nextFrom(ex, mine.filter((s) => s.date === last));
    since = [now, addDays(last, 1)].sort()[1]; // sessions you skipped in the past don't count
  }
  // every session still ahead before `day` counts as done: +1 step each (a lighter week keeps
  // the load of the session before it)
  const lighter = isDeload(weekOf(day));
  for (let i = 0; i < Math.max(0, sessionsBetween(session.title, since, day) - (lighter ? 1 : 0)); i++) {
    [reps, kg] = step(ex, reps, kg);
  }
  let sets = ex.sets;
  if (lighter) [sets, reps] = [Math.max(1, Math.round((ex.sets * 2) / 3)), ex.repLo]; // fewer sets, bottom of the range
  return { sets, reps, kg, basedOn: last };
}
