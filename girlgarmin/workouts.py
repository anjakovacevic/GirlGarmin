"""Upload the 8-week plan to Garmin Connect as scheduled workouts (they sync to your watch).

    python -m girlgarmin.workouts --test      # upload 2 sample workouts, print them back, delete them
    python -m girlgarmin.workouts             # create + schedule the whole plan on your Garmin calendar
    python -m girlgarmin.workouts --delete    # remove everything this script created
    python -m girlgarmin.workouts --replace-cardio     # re-upload only the cardio workouts, from today on
    python -m girlgarmin.workouts --replace-strength   # re-upload only the strength workouts, from today on

The plan comes from plans/my_plan.py if you have one, else plans/example_plan.py. Strength
workouts show exercise, reps and target weight on the watch; warm-up and rest steps end when
you press the lap button. Everything created is recorded in data/garmin_workouts.json so it
can be removed cleanly - run --delete before uploading a changed plan.

Requires a saved login (python -m girlgarmin.login).
"""

import argparse
import json
import sys
import time
from datetime import date

from garminconnect import Garmin
from garminconnect.workout import (
    WEIGHT_UNIT_KILOGRAM,
    ConditionType,
    CyclingWorkout,
    RunningWorkout,
    StrengthWorkout,
    TargetType,
    WalkingWorkout,
    WorkoutSegment,
    create_cooldown_step,
    create_interval_step,
    create_recovery_step,
    create_repeat_group,
    create_strength_exercise_step,
    create_strength_rest_step,
    create_warmup_step,
)

from girlgarmin.paths import DATA, TOKENSTORE
from girlgarmin.plan import P

MANIFEST = DATA / "garmin_workouts.json"  # IDs of everything uploaded, for --delete
STRENGTH = {"sportTypeId": 5, "sportTypeKey": "strength_training", "displayOrder": 5}
RUNNING = {"sportTypeId": 1, "sportTypeKey": "running", "displayOrder": 1}
CYCLING = {"sportTypeId": 2, "sportTypeKey": "cycling", "displayOrder": 2}
WALKING = {"sportTypeId": 17, "sportTypeKey": "walking", "displayOrder": 17}
# Sports a cardio workout can be recorded as. Not Garmin's "Cardio" (cardio_training): the watch
# records that like strength, so every interval became a "set" with 0 reps.
CARDIO_SPORTS = {"running": (RunningWorkout, RUNNING), "cycling": (CyclingWorkout, CYCLING),
                 "walking": (WalkingWorkout, WALKING)}


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
        both = getattr(ex, "logged_both_sides", False)  # watch target = what you log: both legs together
        exercise = create_strength_exercise_step(ex.garmin_category, order + 1, reps * 2 if both else reps,
                                                 exercise_name=ex.garmin_name)
        if kg is not None:
            # Garmin workouts take the weight in the stated unit (kg). The library's helper multiplies by
            # 1000 (activity sets are stored in grams), which made every target 1000x too heavy.
            exercise.weightValue = float(kg)
            exercise.weightUnit = dict(WEIGHT_UNIT_KILOGRAM)
        rest = until_lap(create_strength_rest_step(0, order + 2))
        steps.append(create_repeat_group(sets, [exercise, rest], order))
        order += 3
        side = "arm" if "arm" in ex.note.lower() else "leg"
        per = (f" per {side} (log {reps * 2})" if both else f" per {side}") if ex.per_leg else ""
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


def cardio_sport(attr: str, default: str) -> tuple[type, dict]:
    """Workout class + Garmin sport for a cardio slot, from the plan (e.g. INTERVAL_SPORT = "running")."""
    key = getattr(P, attr, default)
    if key not in CARDIO_SPORTS:
        sys.exit(f"{attr} = {key!r} in the plan - use one of {sorted(CARDIO_SPORTS)}")
    return CARDIO_SPORTS[key]


def interval_workout(week: int):
    """VO2max intervals: warm-up (lap to end), n x hard in zone 4 / 3 min easy in zone 2, cool-down."""
    n, secs = P.INTERVALS[week]
    hard = with_zone(create_interval_step(secs, 3), 4)
    easy = with_zone(create_recovery_step(180, 4), 2)
    steps = [until_lap(create_warmup_step(0, 1)), create_repeat_group(n, [hard, easy], 2), create_cooldown_step(180, 5)]
    cls, sport = cardio_sport("INTERVAL_SPORT", "cycling")
    return cls(
        workoutName=f"W{week} VO2max {n}x{secs // 60}min",
        sportType=sport,
        estimatedDurationInSecs=300 + n * (secs + 180) + 180,
        description=P.intervals_text(week),
        workoutSegments=[WorkoutSegment(segmentOrder=1, sportType=sport, workoutSteps=steps)],
    )


def zone2_workout(minutes: int):
    """Steady walk in heart-rate zone 2 (reused on every day it is scheduled)."""
    steps = [with_zone(create_interval_step(minutes * 60, 1), 2)]
    cls, sport = cardio_sport("ZONE2_SPORT", "walking")
    return cls(
        workoutName=f"Zone 2 incline walk {minutes} min",
        sportType=sport,
        estimatedDurationInSecs=minutes * 60,
        description=P.ZONE2_WALK.format(m=minutes),
        workoutSegments=[WorkoutSegment(segmentOrder=1, sportType=sport, workoutSteps=steps)],
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
        sys.exit("No saved login. Run first: python -m girlgarmin.login")
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


def save_manifest(made: dict) -> None:
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(made, indent=1), encoding="utf-8")


def record(api: Garmin, made: dict, workout, kind: str) -> int:
    """Upload a workout and note it in the manifest right away (so a crash can still be cleaned up)."""
    wid = upload(api, workout)
    made["workouts"].append({"id": wid, "name": workout.workoutName, "kind": kind})
    save_manifest(made)
    return wid


def sched(api: Garmin, made: dict, wid: int, day, name: str) -> None:
    sid = schedule(api, wid, day)
    made["scheduled"].append({"id": sid, "workout_id": wid, "date": day.isoformat(), "name": name})
    save_manifest(made)


def upload_cardio(api: Garmin, made: dict, from_day) -> None:
    """Upload the cardio workouts and schedule them on every plan day from `from_day` on.
    Zone-2 walks and the VO2max check are uploaded once and reused on each of their days."""
    reused: dict[str, int] = {}
    for d in P.days():
        day, week, kind = d["date"], d["week"], d["cardio_kind"]
        if day < from_day or not kind:
            continue
        if kind == "intervals":
            w = interval_workout(week)
            sched(api, made, record(api, made, w, "cardio"), day, w.workoutName)
        elif kind.startswith("zone2-") or kind == "vo2check":
            if kind not in reused:
                w = vo2_check_workout() if kind == "vo2check" else zone2_workout(int(kind.split("-")[1]))
                reused[kind] = record(api, made, w, "cardio")
            name = "VO2max check run" if kind == "vo2check" else f"Zone 2 walk {kind.split('-')[1]} min"
            sched(api, made, reused[kind], day, name)


def upload_strength(api: Garmin, made: dict, from_day) -> None:
    """Upload one strength workout per session day from `from_day` on and schedule it."""
    for d in P.days():
        s, day = d["session"], d["date"]
        if s and day >= from_day:
            w = strength_workout(s, d["week"], day, d["cardio"])
            sched(api, made, record(api, made, w, "strength"), day, w.workoutName)
            print(f"  {day} {w.workoutName}")


def create_all(api: Garmin) -> None:
    """Upload and schedule every workout of the plan."""
    if MANIFEST.exists():
        sys.exit(f"{MANIFEST} exists - plan already uploaded. Run with --delete first.")
    made = {"workouts": [], "scheduled": []}
    upload_strength(api, made, P.FIRST_DAY)
    upload_cardio(api, made, P.FIRST_DAY)
    print(f"Created {len(made['workouts'])} workouts, {len(made['scheduled'])} calendar entries. Manifest: {MANIFEST}")


def is_cardio(w: dict) -> bool:
    """Manifest entries written before "kind" was recorded are told apart by name."""
    return w.get("kind", "cardio" if ("VO2max" in w["name"] or "Zone 2" in w["name"]) else "strength") == "cardio"


def replace(api: Garmin, kind: str) -> None:
    """Re-upload one kind of workout ("strength" or "cardio") from today on, after editing the plan.

    strength: deletes the strength workouts scheduled from today on (past ones stay on your
              calendar) and uploads them again from the current plan.
    cardio:   deletes all cardio workouts (zone-2 walks are shared across dates, so their past
              calendar entries disappear too) and uploads them again from today on.
    Recorded activities are never touched."""
    if not MANIFEST.exists():
        sys.exit(f"{MANIFEST} not found - upload the plan first.")
    made = json.loads(MANIFEST.read_text(encoding="utf-8"))
    from_day = max(date.today(), P.FIRST_DAY)
    if kind == "cardio":
        old = {w["id"] for w in made["workouts"] if is_cardio(w)}
    else:
        strength = {w["id"] for w in made["workouts"] if not is_cardio(w)}
        old = {x["workout_id"] for x in made["scheduled"]
               if x["workout_id"] in strength and x["date"] >= from_day.isoformat()}
    for wid in old:  # deleting a workout also removes its calendar entries
        api.delete_workout(wid)
        time.sleep(0.3)
    made["workouts"] = [w for w in made["workouts"] if w["id"] not in old]
    made["scheduled"] = [x for x in made["scheduled"] if x["workout_id"] not in old]
    save_manifest(made)
    print(f"Deleted {len(old)} {kind} workouts.")
    before = len(made["workouts"])
    (upload_cardio if kind == "cardio" else upload_strength)(api, made, from_day)
    print(f"Uploaded {len(made['workouts']) - before} {kind} workouts, scheduled from {from_day}.")


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
    ap.add_argument("--replace-cardio", action="store_true",
                    help="re-upload only the cardio workouts (from today on), e.g. after changing INTERVAL_SPORT")
    ap.add_argument("--replace-strength", action="store_true",
                    help="re-upload only the strength workouts from today on, e.g. after changing exercises or loads")
    args = ap.parse_args()
    api = login()
    if args.test:
        test(api)
    elif args.delete:
        delete_all(api)
    elif args.replace_cardio:
        replace(api, "cardio")
    elif args.replace_strength:
        replace(api, "strength")
    else:
        create_all(api)
