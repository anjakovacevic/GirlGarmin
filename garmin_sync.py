"""Download your Garmin Connect data to ./data (incremental - safe to re-run any time).

    python garmin_sync.py                     # all activities + daily health since your first activity
    python garmin_sync.py --days 730 --fit    # 2 years of daily health + original .FIT files
    python garmin_sync.py --tables-only       # rebuild the CSVs from data/raw without downloading

Only new days/activities are downloaded; the last few days are always refreshed because
Garmin keeps updating them (sleep, HRV). Needs a saved login first: python garmin_login.py

Layout (everything under data/ is git-ignored - it is your personal health data):
    data/raw/activities/<id>.json             activity summary
    data/raw/exercise_sets/<id>.json          sets/reps/weight for strength activities
    data/raw/fit/<id>.zip                     original FIT file (with --fit)
    data/raw/daily/<kind>/<YYYY-MM-DD>.json   daily health metrics (stats, sleep, HRV, ...)
    data/raw/profile/*.json                   profile, PRs, body composition, weigh-ins
    data/raw/profile/menstrual_*.json         cycle calendar + today's cycle summary
    data/activities.csv, daily.csv, strength_sets.csv, weight.csv, cycles.csv
                                              flat tables built from raw - what the dashboard reads
"""

import argparse
import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
from garminconnect import (
    Garmin,
    GarminConnectNotFoundError,
    GarminConnectTooManyRequestsError,
)

TOKENSTORE = Path("~/.garminconnect").expanduser()  # written by garmin_login.py, outside the repo
DATA = Path(__file__).parent / "data"
RAW = DATA / "raw"
REFRESH_RECENT_DAYS = 3  # re-fetch the last few days, which may still be incomplete
DELAY = 0.4  # seconds between API calls - be gentle, Garmin rate-limits

# activity types that can contain sets/reps/weights
STRENGTH_TYPES = {"strength_training", "indoor_cardio", "hiit", "fitness_equipment"}


def call(fn, *args):
    """Call a Garmin API function with a pause; None if not found, back off when rate-limited."""
    for attempt in range(5):
        try:
            result = fn(*args)
            time.sleep(DELAY)
            return result
        except GarminConnectNotFoundError:
            return None
        except GarminConnectTooManyRequestsError:
            wait = 60 * (attempt + 1)
            print(f"  rate limited, waiting {wait}s")
            time.sleep(wait)
    raise RuntimeError(f"gave up on {fn.__name__}{args}")


def save(path: Path, obj) -> None:
    """Write obj as JSON, creating folders as needed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=1, default=str), encoding="utf-8")


def sync_profile(api: Garmin, start: str, end: str) -> None:
    """Profile, devices, PRs, HR zones, and body composition / weigh-ins between start and end."""
    print("Profile, PRs, body composition...")
    d = RAW / "profile"
    save(d / "user_profile.json", call(api.get_user_profile))
    save(d / "userprofile_settings.json", call(api.get_userprofile_settings))
    save(d / "personal_records.json", call(api.get_personal_record))
    save(d / "devices.json", call(api.get_devices))
    save(d / "body_composition.json", call(api.get_body_composition, start, end))
    save(d / "weigh_ins.json", call(api.get_weigh_ins, start, end))
    save(d / "heart_rate_zones.json", call(api.get_heart_rate_zones))


def sync_activities(api: Garmin, fit: bool) -> date:
    """All activities (+ strength sets, + FIT files if asked). Returns the date of the first activity."""
    print("Activities (all time)...")
    acts = call(api.get_activities_by_date, "2000-01-01", date.today().isoformat()) or []
    print(f"  {len(acts)} activities found")
    new = 0
    for a in acts:
        aid = a["activityId"]
        path = RAW / "activities" / f"{aid}.json"
        if not path.exists():
            new += 1
        save(path, a)
        type_key = a.get("activityType", {}).get("typeKey", "")
        sets_path = RAW / "exercise_sets" / f"{aid}.json"
        if type_key in STRENGTH_TYPES and not sets_path.exists():
            save(sets_path, call(api.get_activity_exercise_sets, aid))
        fit_path = RAW / "fit" / f"{aid}.zip"
        if fit and not fit_path.exists():
            data = call(api.download_activity, aid, Garmin.ActivityDownloadFormat.ORIGINAL)
            if data:
                fit_path.parent.mkdir(parents=True, exist_ok=True)
                fit_path.write_bytes(data)
    print(f"  {new} new")
    starts = [a["startTimeLocal"][:10] for a in acts]
    return date.fromisoformat(min(starts)) if starts else date.today()


def sync_cycle(api: Garmin, first: date) -> None:
    """Menstrual cycle calendar (Garmin allows max 92 days per request) + today's cycle summary."""
    print("Menstrual cycle...")
    chunks, start = [], first - timedelta(days=60)
    while start <= date.today():
        end = min(start + timedelta(days=91), date.today())
        chunks.append(call(api.get_menstrual_calendar_data, start.isoformat(), end.isoformat()) or {})
        start = end + timedelta(days=1)
    save(RAW / "profile" / "menstrual_calendar.json", chunks)
    save(RAW / "profile" / "menstrual_summary.json", call(api.get_menstrual_cycle_summary, date.today().isoformat()))


# daily health endpoints: file-folder name -> how to fetch one day
DAILY = {
    "stats": lambda api, d: api.get_stats(d),
    "sleep": lambda api, d: api.get_sleep_data(d),
    "hrv": lambda api, d: api.get_hrv_data(d),
    "training_readiness": lambda api, d: api.get_training_readiness(d),
    "training_status": lambda api, d: api.get_training_status(d),
    "max_metrics": lambda api, d: api.get_max_metrics(d),
}


def sync_daily(api: Garmin, days: int) -> None:
    """Daily health metrics for the last `days` days; skips days already downloaded."""
    today = date.today()
    print(f"Daily health metrics (last {days} days)...")
    for i in range(days):
        d = today - timedelta(days=i)
        ds = d.isoformat()
        recent = i < REFRESH_RECENT_DAYS
        for kind, fn in DAILY.items():
            path = RAW / "daily" / kind / f"{ds}.json"
            if path.exists() and not recent:
                continue
            save(path, call(fn, api, ds))
        if i % 30 == 0:
            print(f"  {ds}")


def load_json(path: Path):
    return (json.loads(path.read_text(encoding="utf-8")) or {}) if path.exists() else {}


def build_tables() -> None:
    """Flatten data/raw into the CSV tables the dashboard reads."""
    print("Building CSV tables...")
    rows = []
    for p in (RAW / "activities").glob("*.json"):
        a = json.loads(p.read_text(encoding="utf-8"))
        rows.append({
            "activity_id": a.get("activityId"),
            "start": a.get("startTimeLocal"),
            "name": a.get("activityName"),
            "type": a.get("activityType", {}).get("typeKey"),
            "duration_min": round((a.get("duration") or 0) / 60, 1),
            "distance_km": round((a.get("distance") or 0) / 1000, 2),
            "calories": a.get("calories"),
            "avg_hr": a.get("averageHR"),
            "max_hr": a.get("maxHR"),
            "aerobic_te": a.get("aerobicTrainingEffect"),
            "anaerobic_te": a.get("anaerobicTrainingEffect"),
            "training_load": a.get("activityTrainingLoad"),
            "total_sets": a.get("totalSets"),
            "total_reps": a.get("totalReps"),
            "vo2max": a.get("vO2MaxValue"),
        })
    if rows:
        pd.DataFrame(rows).sort_values("start").to_csv(DATA / "activities.csv", index=False)

    sets = []
    for p in (RAW / "exercise_sets").glob("*.json"):
        s = json.loads(p.read_text(encoding="utf-8")) or {}
        for es in s.get("exerciseSets") or []:
            if es.get("setType") != "ACTIVE":
                continue
            ex = (es.get("exercises") or [{}])[0]
            weight = es.get("weight")
            sets.append({
                "activity_id": s.get("activityId") or p.stem,
                "start": es.get("startTime"),
                "category": ex.get("category"),
                # Garmin often leaves name empty (e.g. lateral raises) - fall back to category
                "exercise": ex.get("name") or ex.get("category"),
                "reps": es.get("repetitionCount"),
                "weight_kg": weight / 1000 if weight and weight > 0 else None,  # -1 = bodyweight
                "duration_s": es.get("duration"),
            })
    if sets:
        pd.DataFrame(sets).sort_values("start").to_csv(DATA / "strength_sets.csv", index=False)

    def load(kind, ds):
        p = RAW / "daily" / kind / f"{ds}.json"
        return (json.loads(p.read_text(encoding="utf-8")) or {}) if p.exists() else {}

    daily = []
    for p in sorted((RAW / "daily" / "stats").glob("*.json")):
        ds = p.stem
        st = load("stats", ds)
        sleep = load("sleep", ds)
        sl = (sleep.get("dailySleepDTO") or {})
        hrv = (load("hrv", ds).get("hrvSummary") or {})
        tr = load("training_readiness", ds)
        tr = tr[0] if isinstance(tr, list) and tr else {}
        if not (st.get("totalSteps") or sl.get("sleepTimeSeconds") or hrv):
            continue  # no watch data that day (e.g. before the watch was bought)
        daily.append({
            "date": ds,
            "steps": st.get("totalSteps"),
            "resting_hr": st.get("restingHeartRate"),
            "avg_stress": st.get("averageStressLevel"),
            "body_battery_high": st.get("bodyBatteryHighestValue"),
            "body_battery_low": st.get("bodyBatteryLowestValue"),
            "active_kcal": st.get("activeKilocalories"),
            "intensity_min_moderate": st.get("moderateIntensityMinutes"),
            "intensity_min_vigorous": st.get("vigorousIntensityMinutes"),
            "sleep_h": round((sl.get("sleepTimeSeconds") or 0) / 3600, 2) or None,
            "sleep_score": ((sl.get("sleepScores") or {}).get("overall") or {}).get("value"),
            "hrv_last_night": hrv.get("lastNightAvg"),
            "hrv_weekly_avg": hrv.get("weeklyAvg"),
            "hrv_status": hrv.get("status"),
            "training_readiness": tr.get("score"),
            # overnight skin temperature vs personal baseline (deg C); drives the cycle view
            "skin_temp_dev": sleep.get("avgSkinTempDeviationC") if sleep.get("skinTempDataExists") else None,
            "body_battery_gain": sleep.get("bodyBatteryChange"),
        })
    if daily:
        pd.DataFrame(daily).to_csv(DATA / "daily.csv", index=False)

    cycles = {}
    for chunk in load_json(RAW / "profile" / "menstrual_calendar.json") or []:
        for c in (chunk or {}).get("cycleSummaries") or []:
            if not c.get("predictedCycle"):
                cycles[c["startDate"]] = {"start": c["startDate"], "period_days": c.get("periodLength"),
                                          "garmin_ovulation": c.get("predictedOvulationDate")}
    if cycles:
        pd.DataFrame(sorted(cycles.values(), key=lambda c: c["start"])).to_csv(DATA / "cycles.csv", index=False)

    w = load_json(RAW / "profile" / "weigh_ins.json")
    weights = [{"date": s["summaryDate"], "weight_kg": s["latestWeight"]["weight"] / 1000}
               for s in (w.get("dailyWeightSummaries") or []) if s.get("latestWeight")]
    if weights:
        pd.DataFrame(weights).sort_values("date").to_csv(DATA / "weight.csv", index=False)
    print(f"  activities={len(rows)} strength_sets={len(sets)} days={len(daily)} weigh_ins={len(weights)}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Download Garmin Connect data to ./data.")
    ap.add_argument("--days", type=int, help="days of daily health metrics (default: since first activity)")
    ap.add_argument("--fit", action="store_true", help="also download original FIT files")
    ap.add_argument("--tables-only", action="store_true", help="rebuild CSVs from raw data")
    args = ap.parse_args()

    if not args.tables_only:
        if not TOKENSTORE.exists():
            sys.exit("No saved login. Run first: python garmin_login.py")
        api = Garmin()
        api.login(str(TOKENSTORE))
        print(f"Logged in as {api.get_full_name()}")
        first = sync_activities(api, args.fit)
        days = args.days or (date.today() - first).days + 1
        # weigh-ins can predate the watch (logged manually in the app), so look back further
        weights_start = (date.today() - timedelta(days=max(days, 730))).isoformat()
        sync_profile(api, weights_start, date.today().isoformat())
        sync_daily(api, days)
        sync_cycle(api, first)
    build_tables()
    print(f"Done. Data in {DATA}")


if __name__ == "__main__":
    main()
