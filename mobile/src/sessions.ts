/** Which logged workout did which planned session - sessions often get done a day early or late. */

import { addDays, diffDays, fmtShort, type ISODate, mondayOf } from './lib/dates';
import { groupBy } from './lib/stats';
import { allDays, type PlanDay } from './plan';
import type { Activity } from './tables';

/** Which strength workout did each planned session (planned date -> activity). Sessions often get
 * done a day early or late, so this matches within the plan week (Monday-Sunday), not by date:
 * 1. by name - workouts put on the watch are called e.g. "W3 Upper A - shoulders 13 Oct", so the
 *    longest session title in the name wins, and the date in the name settles repeats;
 * 2. any other lifting workout goes to the open session on the same day, else the nearest one.
 *    A second workout on a day that already counts (e.g. a split recording) is not a session. */
export function matchSessions(acts: Activity[]): Map<ISODate, Activity> {
  const out = new Map<ISODate, Activity>();
  const lifts = acts.filter((a) => a.type === 'strength_training').sort((a, b) => a.start.localeCompare(b.start));
  const weeks = groupBy(allDays().filter((d) => d.session), (d) => mondayOf(d.date));
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
