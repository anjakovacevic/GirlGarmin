"""Upload the 8-week plan to Garmin Connect as scheduled workouts (they sync to your watch).

    python garmin_workouts.py --test      # upload 2 sample workouts, print them back, delete them
    python garmin_workouts.py             # create + schedule the whole plan on your Garmin calendar
    python garmin_workouts.py --delete    # remove everything this script created

The plan comes from my_program.py if you have one, else program.py (see plan.py). Strength
workouts show exercise, reps and target weight on the watch; warm-up and rest steps end when
you press the lap button. Everything created is recorded in data/garmin_workouts.json so it
can be removed cleanly - run --delete before uploading a changed plan.

Requires a saved login (python garmin_login.py).
"""

import argparse
import json
import sys
import time
from pathlib import Path

from garminconnect import Garmin
from garminconnect.workout import (
    WEIGHT_UNIT_KILOGRAM,
    ConditionType,
    FitnessEquipmentWorkout,
    RunningWorkout,
    StrengthWorkout,
    TargetType,
    WorkoutSegment,
    create_cooldown_step,
    create_interval_step,
    create_recovery_step,
    create_repeat_group,
    create_strength_exercise_step,
    create_strength_rest_step,
    create_warmup_step,
)

from plan import P

TOKENSTORE = Path("~/.garminconnect").expanduser()  # written by garmin_login.py, outside the repo
MANIFEST = Path(__file__).parent / "data" / "garmin_workouts.json"
STRENGTH = {"sportTypeId": 5, "sportTypeKey": "strength_training", "displayOrder": 5}
CARDIO = {"sportTypeId": 6, "sportTypeKey": "cardio_training", "displayOrder": 6}
RUNNING = {"sportTypeId": 1, "sportTypeKey": "running", "displayOrder": 1}


def hr_zone(zone: int) -> dict:
    """Garmin target: stay in heart-rate zone `zone` (uses the zones set on your Garmin profile)."""
    return {"workoutTargetTypeId": TargetType.HEART_RATE_ZONE, "workoutTargetTypeKey": "heart.rate.zone",
            "displayOrder": 4, "zoneNumber": zone}


def with_zone(step, zone: int):
    step.targetType = hr_zone(zone)
    step.zoneNumber = zone  # Garmin reads the zone from the step itself
    return step


LAP_BUTTON = {"conditionTypeId": ConditionType.LAP_BUTTON, "conditionTypeKey": "lap.button",
              "displayOrder": 1, "displayable": True}


def until_lap(step):
    """Step ends when the lap button is pressed instead of on a timer."""
    step.endCondition = dict(LAP_BUTTON)
    step.endConditionValue = None
    return step


def strength_workout(session: P.Session, week: int, date, cardio: str) -> StrengthWorkout:
    """One strength session for one date: warm-up, then sets x (exercise + rest) per exercise."""
    steps, order = [until_lap(create_warmup_step(0, 1))], 2
    lines = [f"Week {week}{' (lighter week)' if week == P.DELOAD_WEEK else ''}. Warm-up (press lap when done): {session.warmup}",
             "Rest: press lap when you're ready for the next set. Guide: ~2-3 min big lifts, ~1-1.5 min isolation."]
    for ex in session.exercises:
        sets, reps, kg = P.prescription(ex, week)
        exercise = create_strength_exercise_step(ex.garmin_category, order + 1, reps, exercise_name=ex.garmin_name)
        if kg is not None:
            # Garmin workouts take the weight in the stated unit (kg). The library's helper multiplies by
            # 1000 (activity sets are stored in grams), which made every target 1000x too heavy.
            exercise.weightValue = float(kg)
            exercise.weightUnit = dict(WEIGHT_UNIT_KILOGRAM)
        rest = until_lap(create_strength_rest_step(0, order + 2))
        steps.append(create_repeat_group(sets, [exercise, rest], order))
        order += 3
        per = " per leg" if ex.per_leg else ""
        load = f" @ {kg:g} kg" if kg is not None else ""
        lines.append(f"{ex.name}: {sets}x{reps}{per}{load}, RIR {ex.rir}"
                     + (" (estimate - adjust)" if ex.estimate and week == 1 else ""))
    if cardio:
        lines.append("After: " + cardio)
    return StrengthWorkout(
        workoutName=f"W{week} {session.title} {date:%d %b}",
        sportType=STRENGTH,
        estimatedDurationInSecs=60 * 60,
        description="\n".join(lines)[:1000],
        workoutSegments=[WorkoutSegment(segmentOrder=1, sportType=STRENGTH, workoutSteps=steps)],
    )


def interval_workout(week: int) -> FitnessEquipmentWorkout:
    """VO2max intervals: warm-up (lap to end), n x hard in zone 4 / 3 min easy in zone 2, cool-down."""
    n, secs = P.INTERVALS[week]
    hard = with_zone(create_interval_step(secs, 3), 4)
    easy = with_zone(create_recovery_step(180, 4), 2)
    steps = [until_lap(create_warmup_step(0, 1)), create_repeat_group(n, [hard, easy], 2), create_cooldown_step(180, 5)]
    return FitnessEquipmentWorkout(
        workoutName=f"W{week} VO2max {n}x{secs // 60}min",
        sportType=CARDIO,
        estimatedDurationInSecs=300 + n * (secs + 180) + 180,
        description=P.intervals_text(week),
        workoutSegments=[WorkoutSegment(segmentOrder=1, sportType=CARDIO, workoutSteps=steps)],
    )


def zone2_workout(minutes: int) -> FitnessEquipmentWorkout:
    """Steady walk in heart-rate zone 2 (reused on every day it is scheduled)."""
    steps = [with_zone(create_interval_step(minutes * 60, 1), 2)]
    return FitnessEquipmentWorkout(
        workoutName=f"Zone 2 incline walk {minutes} min",
        sportType=CARDIO,
        estimatedDurationInSecs=minutes * 60,
        description=P.ZONE2_WALK.format(m=minutes),
        workoutSegments=[WorkoutSegment(segmentOrder=1, sportType=CARDIO, workoutSteps=steps)],
    )


def vo2_check_workout() -> RunningWorkout:
    """Easy outdoor run/walk - the kind of activity Garmin uses to update VO2max."""
    steps = [with_zone(create_interval_step(25 * 60, 1), 2)]
    return RunningWorkout(
        workoutName="VO2max check - easy outdoor run 25 min",
        sportType=RUNNING,
        estimatedDurationInSecs=25 * 60,
        description=P.OUTDOOR_TEST,
        workoutSegments=[WorkoutSegment(segmentOrder=1, sportType=RUNNING, workoutSteps=steps)],
    )


def login() -> Garmin:
    if not TOKENSTORE.exists():
        sys.exit("No saved login. Run first: python garmin_login.py")
    api = Garmin()
    api.login(str(TOKENSTORE))
    return api


def upload(api: Garmin, workout) -> int:
    res = api.upload_workout(workout.to_dict())
    time.sleep(0.5)
    return res["workoutId"]


def schedule(api: Garmin, workout_id: int, day) -> int | None:
    res = api.schedule_workout(workout_id, day.isoformat())
    time.sleep(0.5)
    return (res or {}).get("workoutScheduleId") or (res or {}).get("id")


def test(api: Garmin) -> None:
    """Round-trip check: upload two workouts, print what Garmin stored, delete them again."""
    for w in (strength_workout(P.GLUTES, 2, P.START, ""), interval_workout(3)):
        wid = upload(api, w)
        back = api.get_workout_by_id(wid)
        print(f"uploaded {back['workoutName']} (id {wid})")
        for seg in back["workoutSegments"]:
            for st in seg["workoutSteps"]:
                inner = st.get("workoutSteps") or [st]
                for s in inner:
                    print("   ", st.get("numberOfIterations", ""), s["stepType"]["stepTypeKey"], s.get("category"),
                          s.get("exerciseName"), (s.get("endCondition") or {}).get("conditionTypeKey"), s.get("endConditionValue"),
                          "RAW weightValue:", s.get("weightValue"), (s.get("weightUnit") or {}).get("unitKey"),
                          (s.get("targetType") or {}).get("workoutTargetTypeKey"),
                          s.get("zoneNumber"))
        api.delete_workout(wid)
        print("   deleted test workout")


def create_all(api: Garmin) -> None:
    """Upload and schedule every workout of the plan. The manifest is saved after each call so a
    crash half-way can still be cleaned up with --delete."""
    if MANIFEST.exists():
        sys.exit(f"{MANIFEST} exists - plan already uploaded. Run with --delete first.")
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    made = {"workouts": [], "scheduled": []}

    def record(workout, day=None):
        wid = upload(api, workout)
        made["workouts"].append({"id": wid, "name": workout.workoutName})
        MANIFEST.write_text(json.dumps(made, indent=1), encoding="utf-8")
        return wid

    def sched(wid, day, name):
        sid = schedule(api, wid, day)
        made["scheduled"].append({"id": sid, "workout_id": wid, "date": day.isoformat(), "name": name})
        MANIFEST.write_text(json.dumps(made, indent=1), encoding="utf-8")

    z2_20, z2_30, vo2 = record(zone2_workout(20)), record(zone2_workout(30)), record(vo2_check_workout())
    for d in P.days():
        s, day, week, kind = d["session"], d["date"], d["week"], d["cardio_kind"]
        if day < P.FIRST_DAY:
            continue
        if s:
            w = strength_workout(s, week, day, d["cardio"])
            sched(record(w), day, w.workoutName)
        if kind == "intervals":
            iw = interval_workout(week)
            sched(record(iw), day, iw.workoutName)
        elif kind == "zone2-20":
            sched(z2_20, day, "Zone 2 walk 20 min")
        elif kind == "zone2-30":
            sched(z2_30, day, "Zone 2 walk 30 min (optional)")
        elif kind == "vo2check":
            sched(vo2, day, "VO2max check run")
        print(f"  {day} done")
    print(f"Created {len(made['workouts'])} workouts, {len(made['scheduled'])} calendar entries. Manifest: {MANIFEST}")


def delete_all(api: Garmin) -> None:
    """Delete every workout listed in the manifest, then the manifest itself."""
    if not MANIFEST.exists():
        sys.exit(f"Nothing to delete - {MANIFEST} not found.")
    made = json.loads(MANIFEST.read_text(encoding="utf-8"))
    for w in made["workouts"]:  # deleting a workout also removes its calendar entries
        api.delete_workout(w["id"])
        time.sleep(0.3)
    MANIFEST.unlink()
    print(f"Deleted {len(made['workouts'])} workouts.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Upload the training plan to Garmin Connect.")
    ap.add_argument("--test", action="store_true", help="upload 2 sample workouts, show them, delete them")
    ap.add_argument("--delete", action="store_true", help="remove everything this script uploaded")
    args = ap.parse_args()
    api = login()
    if args.test:
        test(api)
    elif args.delete:
        delete_all(api)
    else:
        create_all(api)
