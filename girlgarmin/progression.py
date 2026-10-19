"""Targets from what you actually lifted, instead of numbers written in advance.

For each exercise the next target comes from the last time you logged it (same session if
possible, e.g. the heavy Monday hip thrust is not mixed up with Thursday's lighter one):

- working weight = the heaviest weight you did at least the bottom of the rep range with
- all sets at that weight reached the top of the range -> add the load increment, bottom of range
- otherwise -> same weight, one rep more than your weakest set at it (never below the range)
- no set reached the bottom of the range -> repeat the weight you used most, bottom of range

Weeks further ahead are projected from there with +1 rep per week (the plan's double
progression), so the calendar is never empty; they are recalculated after every sync. Lighter
weeks use fewer sets and the bottom of the range, and are never used as a starting point.
Exercises you haven't logged yet (and bodyweight ones) fall back to the plan's own numbers.
"""

from dataclasses import dataclass
from datetime import date, timedelta

import pandas as pd

from girlgarmin.plan import P


@dataclass
class Target:
    sets: int
    reps: int
    kg: float | None
    based_on: date | None  # date of the logged session the target comes from; None = plan numbers


def week_of(day) -> int:
    """Plan week of a date (week 1 starts on P.START; earlier dates give 0 or less)."""
    return (pd.Timestamp(day).date() - P.START).days // 7 + 1


def is_deload(week: int) -> bool:
    return week in P.DELOAD_WEEKS


def _session_title(name: str) -> str | None:
    """Session an activity belongs to, from its name ("W3 Legs 15 Oct" -> "Legs")."""
    for s in sorted(P.SESSIONS, key=lambda s: -len(s.title)):  # longest first: "Upper A - ..." before "Legs"
        if s.title in str(name):
            return s.title
    return None


def history(sets: pd.DataFrame, acts: pd.DataFrame) -> pd.DataFrame:
    """Logged sets with the plan session they were done in (None if it can't be told)."""
    if sets.empty:
        return sets
    titles = dict(zip(acts.activity_id, acts.name.map(_session_title))) if not acts.empty else {}
    h = sets.assign(session=sets.activity_id.map(titles))
    return h[~h.date.map(lambda d: is_deload(week_of(d)))]  # lighter weeks don't set the next target


def _step(ex, reps: int, kg: float | None) -> tuple[int, float | None]:
    """One week of double progression (bodyweight exercises stop at the top of the range)."""
    if kg is None:
        return min(reps + 1, ex.rep_hi), None
    return (reps + 1, kg) if reps < ex.rep_hi else (ex.rep_lo, kg + ex.inc_kg)


def _sessions_between(title: str, start: date, end: date) -> int:
    """Number of times session `title` is planned in [start, end), lighter weeks not counted."""
    return sum(1 for d in P.days() if d["session"] and d["session"].title == title
               and start <= d["date"] < end and not is_deload(d["week"]))


def _next_from(ex, done: pd.DataFrame) -> tuple[int, float]:
    """Target for the session after `done` (the sets of one logged session of `ex`)."""
    per_side = 2 if getattr(ex, "logged_both_sides", False) else 1
    d = done[done.weight_kg > 0].assign(reps=lambda x: x.reps / per_side)
    ok = d[d.reps >= ex.rep_lo]
    if ok.empty:
        counts = d.weight_kg.value_counts()
        return ex.rep_lo, float(max(counts[counts == counts.max()].index))
    kg = float(ok.weight_kg.max())
    weakest = int(d[d.weight_kg == kg].reps.min())
    if weakest >= ex.rep_hi:
        return ex.rep_lo, kg + ex.inc_kg
    return max(ex.rep_lo, weakest + 1), kg


def target(ex, session, day: date, hist: pd.DataFrame, today: date | None = None) -> Target:
    """Sets, reps and kg for `ex` in `session` on `day`, based on sessions logged before `day`."""
    day = pd.Timestamp(day).date()
    now = min(today or date.today(), day)
    names = {ex.garmin_name, *getattr(ex, "aliases", ())}
    mine = hist[hist.exercise.isin(names) & (hist.date < pd.Timestamp(day))] if not hist.empty else hist
    if ex.start_kg is None or mine.empty:
        # nothing logged yet: the plan's starting numbers at the first session from now on
        reps, kg, last = ex.start_reps, ex.start_kg, None
        since = now
    else:
        same = mine[mine.session == session.title]
        mine = same if not same.empty else mine  # e.g. a new slot for an exercise you already do elsewhere
        last = mine.date.max().date()
        reps, kg = _next_from(ex, mine[mine.date == pd.Timestamp(last)])
        since = max(now, last + timedelta(days=1))  # sessions you skipped in the past don't count
    # every session still ahead before `day` counts as done: +1 step each (a lighter week keeps
    # the load of the session before it)
    lighter = is_deload(week_of(day))
    for _ in range(max(0, _sessions_between(session.title, since, day) - lighter)):
        reps, kg = _step(ex, reps, kg)
    sets = ex.sets
    if lighter:  # fewer sets, bottom of the range
        sets, reps = max(1, round(ex.sets * 2 / 3)), ex.rep_lo
    return Target(sets, reps, kg, based_on=last)
