"""Example 8-week training plan: exact sets, reps and loads for every session.

This is the single source of truth for the dashboard ("Today" tab, plan vs. actual) and for
the workouts that girlgarmin.workouts uploads to your watch.

MAKE IT YOURS
    1. Copy this file to ``my_plan.py`` in this folder (it is git-ignored, so it stays private)
       and edit the copy - girlgarmin/plan.py automatically prefers it over this example.
    2. Change ``start_kg`` of every exercise to what you can lift now for the starting reps.
       The example numbers are only a starting point; week 1 is flagged as "adjust".
    3. The plan starts on the Monday saved in ``data/plan_start.txt``. That file is created the
       first time any script runs (next Monday, or today if today is a Monday). Edit the date
       in it to move the whole plan.

Split: Mon Glutes, Tue Upper A, Thu Legs, Sat Upper B (glute + shoulder priority), with
cardio on the days in between. Never more than two training days in a row.

Progression (double progression, pre-planned): each week add 1 rep per set; once the top of the
rep range is reached, the next week adds the load increment and drops back to the bottom of the
range. Week 8 is a lighter week (2/3 of the sets, week-7 load, bottom of the range).
Rule in the gym: if you can't hit the prescribed reps at the prescribed RIR, repeat last week's
numbers instead.
"""

from dataclasses import dataclass
from datetime import date, timedelta

from girlgarmin.paths import DATA

START_FILE = DATA / "plan_start.txt"


def _plan_start() -> date:
    """Monday of week 1, fixed the first time any script runs so the plan doesn't drift."""
    if START_FILE.exists():
        start = date.fromisoformat(START_FILE.read_text(encoding="utf-8").strip())
    else:
        today = date.today()
        start = today + timedelta(days=(7 - today.weekday()) % 7)  # today if Monday, else next Monday
        START_FILE.parent.mkdir(parents=True, exist_ok=True)
        START_FILE.write_text(start.isoformat(), encoding="utf-8")
    return start - timedelta(days=start.weekday())  # snap to Monday in case the file was hand-edited


START = _plan_start()  # Monday of week 1
FIRST_DAY = START  # first day anything is scheduled (can be later than START if you join mid-week)
WEEKS = 8
DELOAD_WEEK = 8  # lighter last week


@dataclass
class Ex:
    """One exercise in a session. Loads are in kg, exactly as you log them in Garmin Connect."""
    name: str
    sets: int
    rep_lo: int             # bottom of the rep range
    rep_hi: int             # top of the rep range - reach it on every set, then add load
    start_reps: int         # reps per set in week 1
    start_kg: float | None  # week-1 load; None = bodyweight / no load target
    inc_kg: float           # load jump once the top of the rep range is reached
    rest_s: int             # rest between sets, as a guide (on the watch rest ends on lap press)
    rir: str                # reps in reserve: how many more clean reps you could have done
    garmin_category: str    # Garmin exercise category, e.g. "HIP_RAISE" (shown on the watch)
    garmin_name: str        # Garmin exercise name, e.g. "BARBELL_HIP_THRUST_WITH_BENCH"
    per_leg: bool = False   # reps are per leg / per arm
    estimate: bool = True   # starting load is a guess - flagged "adjust" in week 1
    logged_both_sides: bool = False  # per-leg exercise you log in Garmin as the total of both legs
    note: str = ""


@dataclass
class Session:
    weekday: int  # 0 = Monday
    title: str
    exercises: list[Ex]
    warmup: str
    cardio_after: str = ""


WARMUP_LOWER = ("5 min incline walk (treadmill ~10% incline, easy - Garmin HR zone 1-2), "
                "then 2 warm-up sets of the first exercise: ~50% x 8, ~70% x 3. No stair machine before leg days.")
WARMUP_UPPER = ("5 min incline walk or stair machine, easy (Garmin HR zone 1-2), "
                "then 2 warm-up sets of the first exercise: ~50% x 8, ~70% x 3.")

# Example starting loads - replace them with your own (see "MAKE IT YOURS" above).
# Garmin names come from Garmin Connect's exercise list; they decide what the watch shows and logs.
SESSIONS = [
    Session(0, "Glutes", [
        Ex("Barbell hip thrust", 4, 6, 10, 8, 60, 5, 150, "1-2", "HIP_RAISE", "BARBELL_HIP_THRUST_WITH_BENCH", note="Pause 1 s at the top."),
        Ex("Romanian deadlift", 3, 8, 10, 8, 40, 5, 150, "2", "DEADLIFT", "ROMANIAN_DEADLIFT", note="Hips back until hamstrings are fully stretched."),
        Ex("Dumbbell step-up (knee-height box)", 2, 8, 12, 8, 8, 2, 90, "1-2", "SQUAT", "DUMBBELL_STEP_UP", per_leg=True, note="Drive through the front heel."),
        Ex("Seated leg curl", 3, 10, 15, 10, 25, 2.5, 90, "1", "LEG_CURL", "LEG_CURL"),
        Ex("Hip abduction machine", 2, 12, 20, 12, 35, 5, 75, "0-1", "HIP_STABILITY", "STANDING_HIP_ABDUCTION", note="Lean slightly forward."),
    ], WARMUP_LOWER),
    Session(1, "Upper A - shoulders", [
        Ex("Seated dumbbell overhead press", 3, 6, 10, 8, 20, 2, 120, "1-2", "SHOULDER_PRESS", "OVERHEAD_DUMBBELL_PRESS"),
        Ex("Lat pulldown", 3, 8, 12, 8, 35, 2.5, 120, "1-2", "PULL_UP", "LAT_PULLDOWN"),
        Ex("Incline dumbbell bench press", 3, 8, 12, 8, 16, 2, 120, "1-2", "BENCH_PRESS", "INCLINE_DUMBBELL_BENCH_PRESS"),
        Ex("Seated cable row", 3, 8, 12, 8, 35, 2.5, 120, "1-2", "ROW", "SEATED_CABLE_ROW"),
        Ex("Dumbbell lateral raise", 4, 10, 20, 10, 6, 2, 75, "0-1", "LATERAL_RAISE", "DUMBBELL_LATERAL_RAISE", note="Controlled, no swinging."),
        Ex("Dumbbell biceps curl", 2, 8, 12, 8, 8, 2, 75, "1", "CURL", "DUMBBELL_BICEPS_CURL"),
    ], WARMUP_UPPER, "VO2max intervals on the bike (see Cardio column)."),
    Session(3, "Legs", [
        Ex("Barbell back squat (full depth)", 3, 6, 10, 8, 40, 2.5, 150, "2", "SQUAT", "BARBELL_BACK_SQUAT", note="Below parallel."),
        Ex("Barbell hip thrust (lighter)", 3, 10, 15, 10, 50, 5, 120, "1-2", "HIP_RAISE", "BARBELL_HIP_THRUST_WITH_BENCH"),
        Ex("Dumbbell Bulgarian split squat", 3, 8, 12, 8, 8, 2, 105, "1-2", "LUNGE", "DUMBBELL_BULGARIAN_SPLIT_SQUAT", per_leg=True, note="Lean torso slightly forward."),
        Ex("Leg extension", 3, 10, 15, 10, 30, 5, 90, "0-1", "CRUNCH", "WEIGHTED_LEG_EXTENSIONS"),
        Ex("Standing cable hip abduction", 2, 12, 20, 12, 10, 2.5, 60, "0-1", "HIP_STABILITY", "STANDING_CABLE_HIP_ABDUCTION", per_leg=True),
    ], WARMUP_LOWER),
    Session(5, "Upper B - shoulders + glutes", [
        Ex("One-arm cable lateral raise", 4, 12, 20, 12, 2.5, 1.25, 60, "0-1", "LATERAL_RAISE", "ONE_ARM_CABLE_LATERAL_RAISE", per_leg=True, note="Per arm."),
        Ex("Machine shoulder press", 3, 8, 12, 8, 15, 2.5, 120, "1-2", "SHOULDER_PRESS", "SHOULDER_PRESS"),
        Ex("Barbell bent-over row", 3, 8, 12, 8, 25, 2.5, 120, "1-2", "ROW", "BENT_OVER_ROW_WITH_BARBELL"),
        Ex("Lat pulldown (neutral / close grip)", 2, 10, 12, 10, 30, 2.5, 90, "1-2", "PULL_UP", "CLOSE_GRIP_LAT_PULLDOWN"),
        Ex("Reverse cable fly / kneeling rear fly", 3, 12, 20, 12, 10, 2.5, 60, "0-1", "FLYE", "KNEELING_REAR_FLYE"),
        Ex("45-degree back extension (glute bias)", 2, 10, 15, 10, 5, 2.5, 90, "1", "HYPEREXTENSION", "WEIGHTED_STATIC_BACK_EXTENSION", note="Round upper back, squeeze glutes."),
    ], WARMUP_UPPER, "20 min zone-2 incline walk after lifting."),
]

# Cardio per week: (number of hard intervals, seconds each). Follows Helgerud 2007 (4 x 4 min, 3 min easy between).
INTERVALS = {1: (3, 180), 2: (4, 180), 3: (4, 240), 4: (4, 240), 5: (4, 240), 6: (4, 240), 7: (4, 240), 8: (3, 240)}
# Garmin activity each cardio workout is recorded as: "running", "cycling" or "walking".
# (Not Garmin's "Cardio" type - the watch logs that like strength sets.) Run
# `python -m girlgarmin.workouts --replace-cardio` after changing these.
INTERVAL_SPORT = "cycling"  # "running" for treadmill intervals
ZONE2_SPORT = "walking"
ZONE2_WALK = "Zone-2 incline walk {m} min (Garmin HR zone 2 - you can still talk in full sentences)."
OUTDOOR_TEST = ("Easy 25-30 min OUTDOOR run or brisk walk with GPS - most Garmin watches only update VO2max "
                "from outdoor runs/walks. Compare the week-1 and week-8 readings.")


def prescription(ex: Ex, week: int) -> tuple[int, int, float | None]:
    """(sets, reps, kg) for an exercise in a given week, following double progression."""
    w = min(week, DELOAD_WEEK - 1)
    reps, kg = ex.start_reps, ex.start_kg
    for _ in range(w - 1):
        if reps < ex.rep_hi:
            reps += 1
        else:
            reps = ex.rep_lo
            kg = kg + ex.inc_kg if kg is not None else None
    sets = ex.sets
    if week == DELOAD_WEEK:
        sets, reps = max(1, round(ex.sets * 2 / 3)), ex.rep_lo
    return sets, reps, kg


def intervals_text(week: int) -> str:
    n, secs = INTERVALS[week]
    return (f"VO2max intervals: 5 min easy, then {n} x {secs // 60} min HARD (8/10 effort, only a few words possible, "
            f"Garmin HR zone 4) with 3 min easy between, 3 min easy to finish. Exercise bike.")


GLUTES, UPPER_A, LEGS, UPPER_B = SESSIONS
REST = "Rest. Keep ~10k steps."

# Weekly template: weekday -> (session, cardio). Cardio is "intervals", "zone2-<min>", "vo2check",
# "rest" or None (nothing extra).
TEMPLATE = {
    0: (GLUTES, None),
    1: (UPPER_A, "intervals"),
    2: (None, "zone2-30"),
    3: (LEGS, None),
    4: (None, "zone2-30"),
    5: (UPPER_B, "zone2-20"),
    6: (None, "rest"),
}
# Per-week exceptions: week -> {weekday: (session, cardio)}. Here: VO2max check runs on Friday of
# week 1 and the last week so you can compare the two readings.
OVERRIDES = {
    1: {4: (None, "vo2check")},
    DELOAD_WEEK: {4: (None, "vo2check")},
}


def cardio_text(kind: str | None, week: int) -> str:
    """Human-readable text for a cardio code from TEMPLATE / OVERRIDES."""
    if kind is None:
        return ""
    if kind == "intervals":
        return intervals_text(week)
    if kind.startswith("zone2-"):
        m = int(kind.split("-")[1])
        return ZONE2_WALK.format(m=m) + (" Optional." if m == 30 else "")
    if kind == "vo2check":
        return OUTDOOR_TEST
    return REST


def days():
    """Yield one dict per calendar day: week, date, session (or None), cardio kind + text."""
    for week in range(1, WEEKS + 1):
        plan = {**TEMPLATE, **OVERRIDES.get(week, {})}
        for wd in range(7):
            day = START + timedelta(days=(week - 1) * 7 + wd)
            s, kind = plan[wd]
            yield {"week": week, "date": day, "session": s, "cardio_kind": kind, "cardio": cardio_text(kind, week)}
