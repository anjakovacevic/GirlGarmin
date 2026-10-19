"""Calculations and simple predictions behind the dashboard. No Streamlit here - pure pandas.

Reads the CSVs that girlgarmin.sync writes to ./data and the plan from girlgarmin.plan.

Predictions are deliberately simple and explainable:
- weight: straight-line trend through weigh-ins -> projected weight at the end of the plan
- lifts: estimated 1RM (Epley) per session, straight-line trend -> projected 1RM at the end of the plan
- cycle: nightly skin-temperature shift (3 nights above the previous 6, ignoring one outlier night and
  period days) marks
  ovulation after the fact; next period = ovulation + luteal length (else last start + median cycle length)
"""

import json
from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np
import pandas as pd

from girlgarmin import progression
from girlgarmin.paths import DATA
from girlgarmin.plan import P

PLAN_END = P.START + timedelta(days=7 * P.WEEKS - 1)
TYPICAL_LUTEAL_DAYS = 14  # used until your own ovulation -> period length is known
# Target weight-loss pace on the "Body & diet" tab, only shown if you choose "Lose weight" there.
# Losing ~0.5-0.7% of your bodyweight per week keeps strength and muscle best in a deficit
# (at 70 kg that is ~0.35-0.5 kg/week).
TARGET_LOSS_PCT_PER_WEEK = (0.5, 0.7)
SETTINGS = DATA / "settings.json"  # choices made on the dashboard (e.g. your weight goal)

# Garmin exercise category (or exact exercise name) -> muscle group it mainly trains
MUSCLE_BY_EXERCISE = {
    "ROMANIAN_DEADLIFT": "Hamstrings", "WEIGHTED_LEG_EXTENSIONS": "Quads", "KNEELING_REAR_FLYE": "Rear delts",
    "_45_DEGREE_CABLE_EXTERNAL_ROTATION": "Rear delts", "KETTLEBELL_SWING": "Glutes", "LEG_ABDUCTION": "Glutes",
    "DUMBBELL_STEP_UP": "Glutes", "FACE_PULL": "Rear delts", "DEAD_BUG": "Core",
}
MUSCLE_BY_CATEGORY = {
    "HIP_RAISE": "Glutes", "HIP_STABILITY": "Glutes", "HIP_SWING": "Glutes", "HYPEREXTENSION": "Glutes",
    "DEADLIFT": "Hamstrings", "LEG_CURL": "Hamstrings", "SQUAT": "Quads", "LUNGE": "Quads",
    "SHOULDER_PRESS": "Front delts", "LATERAL_RAISE": "Side delts", "FLYE": "Rear delts",
    "PULL_UP": "Back", "ROW": "Back", "BENCH_PRESS": "Chest", "PUSH_UP": "Chest",
    "CURL": "Biceps", "TRICEPS_EXTENSION": "Triceps",
}
NOT_LIFTING = {"CARDIO", "UNKNOWN", "SIT_UP", "PLANK"}


# ---------------------------------------------------------------- loading

def load() -> dict[str, pd.DataFrame]:
    """Read all CSVs (missing ones become empty tables) and add date / muscle / e1RM to the sets."""
    def csv(name, dates):
        p = DATA / name
        return pd.read_csv(p, parse_dates=dates) if p.exists() else pd.DataFrame()

    d = {
        "activities": csv("activities.csv", ["start"]),
        "sets": csv("strength_sets.csv", ["start"]),
        "daily": csv("daily.csv", ["date"]),
        "weight": csv("weight.csv", ["date"]),
        "cycles": csv("cycles.csv", ["start", "garmin_ovulation"]),
    }
    s = d["sets"]
    if not s.empty:
        s["date"] = s.start.dt.tz_localize(None).dt.normalize() if s.start.dt.tz else s.start.dt.normalize()
        s["muscle"] = [MUSCLE_BY_EXERCISE.get(e) or MUSCLE_BY_CATEGORY.get(c) for e, c in zip(s.exercise, s.category)]
        s["e1rm"] = e1rm(s.weight_kg, s.reps)
    return d


def e1rm(weight, reps):
    """Epley estimated 1-rep max; only for 1-15 rep sets with a load (else NaN)."""
    w, r = pd.Series(weight, dtype=float), pd.Series(reps, dtype=float)
    return (w * (1 + r / 30)).where((r >= 1) & (r <= 15) & (w > 0))


# ---------------------------------------------------------------- trends

@dataclass
class Trend:
    """Straight-line fit: slope per week and the value it projects for `target_date`."""
    per_week: float          # change per week
    projected: float | None  # value at the target date
    target_date: date
    n: int


def linear_trend(dates: pd.Series, values: pd.Series, target: date) -> Trend | None:
    """Least-squares line through (date, value); None with fewer than 3 points or under a week of data."""
    ok = values.notna()
    if ok.sum() < 3:
        return None
    x = (pd.to_datetime(dates[ok]) - pd.Timestamp("2026-01-01")).dt.days.to_numpy(float)
    y = values[ok].to_numpy(float)
    if np.ptp(x) < 7:
        return None
    slope, intercept = np.polyfit(x, y, 1)
    tx = (pd.Timestamp(target) - pd.Timestamp("2026-01-01")).days
    return Trend(per_week=slope * 7, projected=slope * tx + intercept, target_date=target, n=int(ok.sum()))


def load_settings() -> dict:
    return json.loads(SETTINGS.read_text()) if SETTINGS.exists() else {}


def save_setting(key: str, value) -> None:
    SETTINGS.write_text(json.dumps(load_settings() | {key: value}, indent=1))


def loss_target(weight_kg: float) -> tuple[float, float]:
    """Target loss pace in kg/week (low, high) for your current weight."""
    lo, hi = TARGET_LOSS_PCT_PER_WEEK
    return round(weight_kg * lo / 100, 2), round(weight_kg * hi / 100, 2)


def weight_forecast(weight: pd.DataFrame, since: date | None = None) -> Trend | None:
    w = weight if since is None else weight[weight.date >= pd.Timestamp(since)]
    return linear_trend(w.date, w.weight_kg, PLAN_END) if not w.empty else None


# ---------------------------------------------------------------- lifting

def lift_sessions(sets: pd.DataFrame) -> pd.DataFrame:
    """Best set per exercise per day: top weight, reps at that weight, best e1RM, number of sets."""
    s = sets[~sets.category.isin(NOT_LIFTING) & sets.muscle.notna()]
    # drop obvious logging errors (e.g. 1.5 kg lateral raise when you use 12 kg)
    typical = s.groupby("exercise").weight_kg.transform("median")
    s = s[~(s.weight_kg < 0.5 * typical)]
    g = s.groupby(["exercise", "date"])
    out = g.agg(sets=("reps", "size"), top_kg=("weight_kg", "max"), best_e1rm=("e1rm", "max"),
                muscle=("muscle", "first")).reset_index()
    loaded = s[s.weight_kg.notna()]
    top_reps = loaded.loc[loaded.groupby(["exercise", "date"]).weight_kg.idxmax()][["exercise", "date", "reps"]]
    return out.merge(top_reps.rename(columns={"reps": "top_reps"}), on=["exercise", "date"], how="left")


def weekly_sets_by_muscle(sets: pd.DataFrame) -> pd.DataFrame:
    """Number of working sets per muscle group per week (Mon-Sun)."""
    s = sets[sets.muscle.notna() & ~sets.category.isin(NOT_LIFTING)]
    s = s.assign(week=s.date.dt.to_period("W-SUN").dt.start_time)
    return s.groupby(["week", "muscle"]).size().rename("sets").reset_index()


def lift_forecasts(sessions: pd.DataFrame, lookback_days: int = 42) -> pd.DataFrame:
    """Per exercise: best / last e1RM, trend over the last `lookback_days`, projected e1RM at plan end."""
    rows = []
    cutoff = sessions.date.max() - pd.Timedelta(days=lookback_days) if not sessions.empty else None
    for ex, g in sessions.groupby("exercise"):
        g = g[g.best_e1rm.notna()]
        if len(g) < 3:
            continue
        recent = g[g.date >= cutoff]
        t = linear_trend(recent.date, recent.best_e1rm, PLAN_END) if len(recent) >= 3 else None
        recent_best = recent.best_e1rm.max() if len(recent) else g.best_e1rm.max()
        # a few noisy sessions can extrapolate wildly - keep the projection within +-10% of the recent best
        proj = float(np.clip(t.projected, 0.9 * recent_best, 1.1 * recent_best)) if t else None
        rows.append({"exercise": ex, "sessions": len(g), "best_e1rm": g.best_e1rm.max(),
                     "last_e1rm": g.sort_values("date").best_e1rm.iloc[-1],
                     "trend_kg_per_week": t.per_week if t else None,
                     "projected_e1rm_at_plan_end": proj})
    return pd.DataFrame(rows).sort_values("sessions", ascending=False) if rows else pd.DataFrame()


# ---------------------------------------------------------------- plan vs actual

def plan_rows(sets: pd.DataFrame, acts: pd.DataFrame, today: date) -> pd.DataFrame:
    """Every planned exercise of every day as one row (date, sets, reps, kg). Targets come from what
    was logged before each day (girlgarmin.progression)."""
    hist = progression.history(sets, acts)
    rows = []
    for d in P.days():
        s = d["session"]
        for ex in (s.exercises if s else []):
            t = progression.target(ex, s, d["date"], hist, today)
            n, reps, kg = t.sets, t.reps, t.kg
            rows.append({"date": pd.Timestamp(d["date"]), "week": d["week"], "session": s.title, "exercise": ex.name,
                         "garmin_name": ex.garmin_name, "garmin_category": ex.garmin_category,
                         "plan_sets": n, "plan_reps": reps, "plan_kg": kg,
                         # reps logged for both legs together -> compare per leg
                         "reps_logged_x": 2 if getattr(ex, "logged_both_sides", False) else 1})
    return pd.DataFrame(rows)


def plan_vs_actual(sets: pd.DataFrame, acts: pd.DataFrame, today: date) -> pd.DataFrame:
    """Planned exercises up to `today` next to what Garmin logged that day. Matches on the Garmin
    exercise name first, then on the category (Garmin often leaves the name empty)."""
    plan = plan_rows(sets, acts, today)
    plan = plan[(plan.date >= pd.Timestamp(P.FIRST_DAY)) & (plan.date <= pd.Timestamp(today))]
    if plan.empty:
        return plan
    done = sets.groupby(["date", "exercise"]).agg(actual_sets=("reps", "size"), actual_kg=("weight_kg", "max"),
                                                 actual_best_reps=("reps", "max")).reset_index()
    by_name = plan.merge(done, left_on=["date", "garmin_name"], right_on=["date", "exercise"], how="left",
                         suffixes=("", "_logged"))
    by_cat = plan.merge(done, left_on=["date", "garmin_category"], right_on=["date", "exercise"], how="left",
                        suffixes=("", "_logged"))
    for c in ("actual_sets", "actual_kg", "actual_best_reps"):
        by_name[c] = by_name[c].fillna(by_cat[c])
    by_name["actual_best_reps"] = by_name.actual_best_reps / by_name.reps_logged_x
    by_name["hit_load"] = by_name.actual_kg >= by_name.plan_kg - 0.01
    return by_name.drop(columns=[c for c in by_name.columns if c.endswith("_logged")])


def today_plan(today: date) -> dict | None:
    """The plan entry for one date (see days() in the plan), or None outside the plan."""
    for d in P.days():
        if d["date"] == today:
            return d
    return None


# ---------------------------------------------------------------- cycle

@dataclass
class CycleInfo:
    """One logged cycle, with ovulation detected from skin temperature (or Garmin's estimate)."""
    start: pd.Timestamp
    length: int | None           # days until next period (None for the current cycle)
    shift_day: int | None        # cycle day of the sustained temperature rise
    ovulation: pd.Timestamp | None
    ovulation_source: str        # "temperature", "garmin", or ""
    luteal_days: int | None


def temperature_shift(nights: pd.Series, min_day: int = 7, margin: float = 0.2) -> int | None:
    """First cycle day of 3 nights >= cover line + margin, where the cover line is the 2nd-highest
    of the previous 6 nights. Using the 2nd-highest ignores a single warm night (short sleep,
    alcohol, a hot room) that would otherwise hide a real rise for the next 6 nights.
    Period days are excluded (wrist temperature dips hard during menses and fakes an early shift)."""
    v = nights[nights.index >= min_day].dropna().sort_index()
    for i in range(6, len(v) - 2):
        cover = v.iloc[i - 6:i].nlargest(2).iloc[-1]
        if all(round(v.iloc[i + k] - cover, 2) >= margin for k in range(3)):  # round: 0.6-0.4 != 0.2 in floats
            return int(v.index[i])
    return None


def analyse_cycles(daily: pd.DataFrame, cycles: pd.DataFrame) -> list[CycleInfo]:
    """Split the nightly skin temperature by logged period starts and find ovulation in each cycle."""
    out = []
    starts = list(cycles.start.sort_values())
    for i, start in enumerate(starts):
        nxt = starts[i + 1] if i + 1 < len(starts) else None
        end = nxt or pd.Timestamp(date.today()) + pd.Timedelta(days=1)
        nights = daily[(daily.date >= start) & (daily.date < end)].set_index("date").skin_temp_dev
        nights.index = (nights.index - start).days + 1
        shift = temperature_shift(nights)
        ov, src = None, ""
        if shift:
            ov, src = start + pd.Timedelta(days=shift - 2), "temperature"
        else:
            g = cycles.loc[cycles.start == start, "garmin_ovulation"]
            if len(g) and pd.notna(g.iloc[0]):
                ov, src = g.iloc[0], "garmin"
        out.append(CycleInfo(start=start, length=(nxt - start).days if nxt else None, shift_day=shift,
                             ovulation=ov, ovulation_source=src,
                             luteal_days=(nxt - ov).days if (nxt is not None and ov is not None) else None))
    return out


@dataclass
class CyclePrediction:
    """Where you are in the current cycle and what comes next."""
    cycle_day: int
    phase: str
    next_period: pd.Timestamp
    next_period_basis: str
    ovulation: pd.Timestamp | None
    ovulation_confirmed: bool
    fertile_start: pd.Timestamp | None
    fertile_end: pd.Timestamp | None
    median_cycle: float | None
    median_luteal: float | None


def predict_cycle(info: list[CycleInfo], today: date) -> CyclePrediction | None:
    """Next period = confirmed ovulation + your median luteal length, else last start + median cycle."""
    if not info:
        return None
    cur = info[-1]
    t = pd.Timestamp(today)
    done = [c for c in info if c.length]
    med_len = float(np.median([c.length for c in done])) if done else None
    lut = [c.luteal_days for c in done if c.luteal_days and 10 <= c.luteal_days <= 17]
    med_lut = float(np.median(lut)) if lut else None
    luteal = round(med_lut or TYPICAL_LUTEAL_DAYS)
    day = (t - cur.start).days + 1
    if cur.ovulation is not None and cur.ovulation_source == "temperature":
        nxt, basis = cur.ovulation + pd.Timedelta(days=luteal + 1), f"temperature rise on day {cur.shift_day} + {luteal}-day luteal phase"
        ov, confirmed = cur.ovulation, True
    else:
        length = round(med_len) if med_len else 30
        nxt, basis = cur.start + pd.Timedelta(days=length), f"median cycle length ({length} days)"
        ov, confirmed = nxt - pd.Timedelta(days=luteal + 1), False
    if nxt <= t:  # overdue - push to tomorrow and say so
        nxt, basis = t + pd.Timedelta(days=1), basis + " - already passed, any day now"
    period_days = 6
    if day <= period_days:
        phase = "Period"
    elif confirmed and t > ov:
        phase = "After ovulation (luteal)"
    elif ov is not None and abs((t - ov).days) <= 2:
        phase = "Around ovulation"
    else:
        phase = "Before ovulation (follicular)"
    return CyclePrediction(cycle_day=day, phase=phase, next_period=nxt, next_period_basis=basis, ovulation=ov,
                           ovulation_confirmed=confirmed,
                           fertile_start=ov - pd.Timedelta(days=5) if ov is not None else None,
                           fertile_end=ov + pd.Timedelta(days=1) if ov is not None else None,
                           median_cycle=med_len, median_luteal=med_lut)


def phase_by_date(daily: pd.DataFrame, info: list[CycleInfo]) -> pd.Series:
    """Label each day 'period', 'follicular' or 'luteal' (luteal only where ovulation is known)."""
    ph = pd.Series(index=daily.date, dtype=object)
    for c in info:
        end = c.start + pd.Timedelta(days=c.length or 60)
        m = (daily.date >= c.start) & (daily.date < end)
        for d in daily.date[m]:
            day = (d - c.start).days + 1
            ph[d] = "period" if day <= 6 else ("luteal" if c.ovulation is not None and d > c.ovulation else "follicular")
    return ph


# ---------------------------------------------------------------- recovery

def recovery_today(daily: pd.DataFrame, phase: pd.Series) -> dict:
    """Plan's recovery rule, cycle-aware: Low HRV in the luteal phase is normal and not a reason to cut sets."""
    if daily.empty:
        return {}
    last = daily.sort_values("date").iloc[-1]
    ph = phase.get(last.date)
    same_phase = daily[daily.date.map(phase) == ph] if ph else daily
    base = same_phase.hrv_last_night.median()
    low = last.hrv_status == "LOW"
    poor_sleep = pd.notna(last.sleep_score) and last.sleep_score < 70
    if low and poor_sleep:
        advice = "Do today's session with 1 fewer set per exercise, same loads."
    elif low and ph == "luteal":
        advice = "HRV is Low, but that's common after ovulation. Train as planned unless you feel off."
    elif low:
        advice = "HRV is Low but sleep was fine - train as planned, watch how the first sets feel."
    else:
        advice = "Recovery looks normal - train as planned."
    return {"date": last.date, "hrv": last.hrv_last_night, "hrv_status": last.hrv_status, "phase_baseline": base,
            "sleep_score": last.sleep_score, "resting_hr": last.resting_hr, "phase": ph, "advice": advice}


# ---------------------------------------------------------------- heart-rate zones

ZONE_PCT = (0.5, 0.6, 0.7, 0.8, 0.9)        # zone 1-5 floors, as % of max HR or of HR reserve
LTHR_RUN_PCT = (0.0, 0.85, 0.90, 0.95, 1.0)  # Joe Friel's running zones as % of lactate-threshold HR
HR_TESTS = DATA / "hr_tests.json"            # your own test results, entered on the dashboard


@dataclass
class ZoneSetup:
    method: str            # Garmin's trainingMethod, e.g. HR_MAX, HRR, LACTATE_THRESHOLD
    max_hr: int            # max HR Garmin uses
    resting_hr: int        # resting HR Garmin uses
    floors: list[int]      # zone 1-5 lower limits Garmin uses
    resting_auto: bool     # does Garmin update resting HR by itself
    age: int | None


def garmin_zones() -> ZoneSetup | None:
    """The zones your watch uses now (data/raw/profile/heart_rate_zones.json, sport DEFAULT)."""
    p = DATA / "raw" / "profile" / "heart_rate_zones.json"
    if not p.exists():
        return None
    zs = json.loads(p.read_text())
    zs = [x for x in zs if isinstance(x, dict)] if isinstance(zs, list) else []
    z = next((x for x in zs if x.get("sport") == "DEFAULT"), zs[0] if zs else None)
    if not z or not z.get("maxHeartRateUsed") or any(z.get(f"zone{i}Floor") is None for i in range(1, 6)):
        return None
    age = None
    prof = DATA / "raw" / "profile" / "user_profile.json"
    if prof.exists():
        born = (json.loads(prof.read_text()).get("userData") or {}).get("birthDate")
        if born:
            b, t = date.fromisoformat(born), date.today()
            age = t.year - b.year - ((t.month, t.day) < (b.month, b.day))
    return ZoneSetup(z.get("trainingMethod") or "unknown", z["maxHeartRateUsed"], z.get("restingHeartRateUsed"),
                     [z[f"zone{i}Floor"] for i in range(1, 6)], bool(z.get("restingHrAutoUpdateUsed")), age)


def load_hr_tests() -> dict:
    return json.loads(HR_TESTS.read_text()) if HR_TESTS.exists() else {}


def save_hr_tests(tests: dict) -> None:
    HR_TESTS.write_text(json.dumps({k: v for k, v in tests.items() if v}, indent=1))


def zones_pct_max(max_hr: float) -> list[int]:
    return [round(p * max_hr) for p in ZONE_PCT]


def zones_hrr(max_hr: float, resting_hr: float) -> list[int]:
    """Karvonen: resting + % of (max - resting). Uses your fitness via resting HR."""
    return [round(resting_hr + p * (max_hr - resting_hr)) for p in ZONE_PCT]


def zones_lthr(lthr: float) -> list[int]:
    return [round(p * lthr) for p in LTHR_RUN_PCT]


def zone_table(rows: dict[str, tuple[list[int], float]]) -> pd.DataFrame:
    """{method: (zone 1-5 floors, max HR)} -> one row per method with 'from-to' text per zone."""
    out = {}
    for name, (f, max_hr) in rows.items():
        ends = [x - 1 for x in f[1:]] + [round(max_hr)]
        out[name] = {f"Zone {i + 1}": f"{a}-{b}" if a else f"up to {b}" for i, (a, b) in enumerate(zip(f, ends))}
    return pd.DataFrame(out).T


def hr_zone_advice(z: ZoneSetup, daily: pd.DataFrame, acts: pd.DataFrame, tests: dict) -> dict:
    """Compare Garmin's zone settings with your data and test results; return numbers + suggestions."""
    rhr = daily.sort_values("date").resting_hr.dropna().tail(30).median() if "resting_hr" in daily else None
    rhr = round(rhr) if pd.notna(rhr) else (z.resting_hr or 60)
    seen = acts.max_hr.max() if "max_hr" in acts else None
    seen = seen if pd.notna(seen) else None
    formula_max = 220 - z.age if z.age else None
    max_hr = tests.get("max_hr") or z.max_hr
    max_from_formula = not tests.get("max_hr") and formula_max is not None and abs(z.max_hr - formula_max) <= 1

    tips = []
    if z.resting_hr is None or abs(rhr - z.resting_hr) >= 3:
        tips.append(f"**Update resting HR to {rhr}.** Garmin uses {z.resting_hr or 'none'}, but your last 30 days "
                    f"are around {rhr}." + ("" if z.resting_auto else " Or turn on its automatic update."))
    if tests.get("max_hr") and abs(tests["max_hr"] - z.max_hr) >= 3:
        tips.append(f"**Set max HR to {tests['max_hr']}** (your test) instead of {z.max_hr}.")
    elif max_from_formula:
        tips.append(f"**Your max HR ({z.max_hr}) is only the 220 - age formula** - it can be off by 10-15 bpm. "
                    + (f"Highest you have reached in a workout: {seen:.0f}. " if seen else "")
                    + "A max-HR test (below) fixes this.")
    if seen and seen > max_hr:
        tips.append(f"You reached {seen:.0f} bpm in a workout - higher than the max HR in use ({max_hr}). Raise it.")
    if z.method == "HR_MAX":
        tips.append("**Switch the method to %HRR** (heart-rate reserve) - it uses your resting HR, so zones follow "
                    "your fitness. With a threshold test you can use %LTHR instead.")

    rows = {f"Garmin now ({z.method})": (z.floors, z.max_hr),
            f"%HRR (max {max_hr}, resting {rhr})": (zones_hrr(max_hr, rhr), max_hr)}
    if tests.get("max_hr"):
        rows[f"%max HR (tested max {max_hr})"] = (zones_pct_max(max_hr), max_hr)
    if tests.get("lthr"):
        rows[f"%LTHR running (threshold {tests['lthr']})"] = (zones_lthr(tests["lthr"]), max_hr)

    # Zone 2 estimate: best evidence wins - threshold test, then talk test, then the formula range
    hrr, pmax = zones_hrr(max_hr, rhr), zones_pct_max(max_hr)
    if tests.get("lthr"):
        z2, basis = (round(0.85 * tests["lthr"]), round(0.89 * tests["lthr"])), "your threshold test (85-89% of LTHR)"
    elif tests.get("talk_hr"):
        z2, basis = (tests["talk_hr"] - 12, tests["talk_hr"]), "your talk test (top of zone 2 = its average HR)"
    else:
        z2 = (pmax[1], hrr[2] - 1)
        basis = "formulas only - the true value is somewhere in this range; do the talk test to narrow it"
    return {"resting_now": rhr, "max_used": max_hr, "max_seen": seen, "max_from_formula": max_from_formula,
            "tips": tips, "table": zone_table(rows), "zone2": z2, "zone2_basis": basis}


# ---------------------------------------------------------------- sleep

LONG_NIGHT_H = 7          # nights at least this long "should" be restorative
LOW_BATTERY_GAIN = 45     # Body Battery charged this much or less overnight = poor recharge
LOW_BATTERY_WAKE = 65     # ... or woke up at this level or lower
LOW_DEEP_PCT = 15         # deep sleep below this share of the night = low
MIN_NIGHTS = 14           # 7h+ nights needed before a correlation or per-phase tip is shown
LATE_BED_H = 24.5         # 00:30 - bedtimes after this get less deep sleep in your data
VERY_LATE_BED_H = 25.5    # 01:30 - a "late night", checked for its effect on the next night
SLEEP_KINDS = {"restorative": "#3c9a5f", "long - low battery": "#e0a030", "long - low deep sleep": "#8e6cc0",
               "long - both": "#d9534f", "short (<7 h)": "#9aa5b1"}


def _clock_h(ts: pd.Series) -> pd.Series:
    """Local time as hours, with after-midnight bedtimes past 24 (00:30 -> 24.5) so they sort after 23:00."""
    t = pd.to_datetime(ts)
    h = t.dt.hour + t.dt.minute / 60
    return h.where(h >= 12, h + 24)


def sleep_nights(daily: pd.DataFrame, phase: pd.Series) -> pd.DataFrame:
    """One row per night (dated by the morning you woke up) with the labels the Sleep tab uses."""
    if "deep_min" not in daily:
        return pd.DataFrame()
    n = daily[daily.sleep_h.notna()].sort_values("date").copy()
    # a night without sleep stages (older watch, or watch off the wrist) reports 0 deep/light/REM - unknown, not zero
    no_stages = n[["deep_min", "light_min", "rem_min"]].fillna(0).sum(axis=1) == 0
    n.loc[no_stages, ["deep_min", "light_min", "rem_min"]] = np.nan
    n["bed_h"] = _clock_h(n.bedtime)
    n["wake_h"] = _clock_h(n.wake_time) - 24
    n["deep_pct"] = n.deep_min / (n.sleep_h * 60) * 100
    # how you went into the night: yesterday's daytime stress and lowest Body Battery
    prev = daily.set_index("date")[["avg_stress", "body_battery_low"]].shift(1, freq="D")
    n = n.join(prev.add_prefix("prev_"), on="date")
    n["phase"] = n.date.map(phase) if not phase.empty else None
    long = n.sleep_h >= LONG_NIGHT_H
    low_bb = (n.body_battery_gain <= LOW_BATTERY_GAIN) | (n.body_battery_wake <= LOW_BATTERY_WAKE)
    low_deep = n.deep_pct < LOW_DEEP_PCT
    n["kind"] = np.select([~long, low_bb & low_deep, low_bb, low_deep],
                          ["short (<7 h)", "long - both", "long - low battery", "long - low deep sleep"], "restorative")
    n["low_battery"], n["low_deep"] = long & low_bb, long & low_deep
    n["after_late_night"] = n.bed_h.shift(1).ge(VERY_LATE_BED_H) & n.date.diff().dt.days.eq(1)
    return n


def sleep_compare(n: pd.DataFrame) -> pd.DataFrame:
    """Medians on 7h+ nights: restorative vs low battery vs low deep sleep."""
    cols = {"sleep_h": "Sleep (h)", "deep_min": "Deep sleep (min)", "body_battery_gain": "Body Battery gained",
            "sleep_stress": "Stress during sleep", "sleep_avg_hr": "Heart rate during sleep",
            "hrv_last_night": "HRV (ms)", "prev_avg_stress": "Day-before stress",
            "prev_body_battery_low": "Day-before lowest Body Battery", "restless_moments": "Restless moments",
            "skin_temp_dev": "Skin temp vs baseline (deg C)", "bed_h": "Bedtime"}
    long = n[n.sleep_h >= LONG_NIGHT_H]
    t = pd.DataFrame({"Restorative": long[long.kind == "restorative"][list(cols)].median(),
                      "Low battery": long[long.low_battery][list(cols)].median(),
                      "Low deep sleep": long[long.low_deep][list(cols)].median()}).round(1).astype(object)
    t.loc["bed_h"] = [f"{int(h % 24):02d}:{int(round(h % 1 * 60)) % 60:02d}" if pd.notna(h) else "-" for h in t.loc["bed_h"]]
    t.index = [cols[c] for c in t.index]
    counts = [(long.kind == "restorative").sum(), long.low_battery.sum(), long.low_deep.sum()]
    t.columns = [f"{c} ({k} nights)" for c, k in zip(t.columns, counts)]
    return t.fillna("-").astype(str)  # all text: Streamlit can't show mixed number/text columns


def sleep_tips(n: pd.DataFrame) -> list[str]:
    """Suggestions that only appear when your own data shows the pattern."""
    long = n[n.sleep_h >= LONG_NIGHT_H]
    good, low = long[long.kind == "restorative"], long[long.low_battery]
    tips = []
    if len(low) >= 3 and len(good) >= 5:
        ds = low.sleep_stress.median() - good.sleep_stress.median()
        dhr = low.sleep_avg_hr.median() - good.sleep_avg_hr.median()
        if ds >= 3:
            tips.append(f"**Low battery after a long sleep comes from a body that doesn't calm down, not from too little "
                        f"sleep.** On those nights your stress during sleep is {ds:.0f} points higher and your heart rate "
                        f"{dhr:.0f} bpm higher. Sleeping longer won't fix it; winding down before bed will "
                        "(10 min slow breathing, a walk or shower, a cooler room, no alcohol).")
        dp = low.prev_avg_stress.median() - good.prev_avg_stress.median()
        if dp >= 4:
            tips.append(f"**Stressful days carry into the night.** Before low-battery nights your daytime stress averaged "
                        f"{low.prev_avg_stress.median():.0f} vs {good.prev_avg_stress.median():.0f}. On high-stress days, "
                        "plan a calm last hour before bed.")
    if long.phase.notna().any():
        g = long.groupby("phase").low_battery
        rate = g.mean()[g.size() >= 5]  # need a few nights per phase
        if "luteal" in rate and rate.drop("luteal").size and rate["luteal"] - rate.drop("luteal").max() >= 0.1:
            tips.append(f"**After ovulation your battery recharges worse:** {rate['luteal']:.0%} of long nights had low "
                        f"battery vs {rate.drop('luteal').max():.0%} at most in other phases. That's normal (higher body "
                        "temperature and heart rate). Keep the room cool, avoid alcohol and don't judge your recovery "
                        "by Body Battery alone in that week.")
    early, late = long[long.bed_h < 24].deep_min.median(), long[long.bed_h >= LATE_BED_H].deep_min.median()
    if (long.bed_h >= LATE_BED_H).sum() >= 4 and early - late >= 10:
        tips.append(f"**Bedtime after 00:30 costs you deep sleep:** {late:.0f} min vs {early:.0f} min when you're "
                    "asleep before midnight. Most deep sleep happens in the first 3 hours, so protect the start of the night.")
    after, rest = long[long.after_late_night], long[~long.after_late_night]
    if len(after) >= 3 and rest.body_battery_gain.median() - after.body_battery_gain.median() >= 5:
        tips.append(f"**A late night (bed after 01:30) still costs you the night after:** Body Battery gain "
                    f"{after.body_battery_gain.median():.0f} vs {rest.body_battery_gain.median():.0f}. Make the next day "
                    "an easy one.")
    if len(long) >= MIN_NIGHTS and long.restless_moments.corr(long.deep_pct) <= -0.3:
        tips.append("**Restless nights have less deep sleep.** Check what disturbs the first hours: a warm room, a late "
                    "heavy meal, alcohol, light or noise.")
    return tips


# ---------------------------------------------------------------- time in heart-rate zones

CARDIO_TYPES = ["indoor_cardio", "treadmill_running", "running", "treadmill_walking", "walking", "stair_climbing",
                "floor_climbing", "cycling", "indoor_cycling", "hiking", "elliptical", "swimming", "lap_swimming"]
ZONES = [f"z{i}_min" for i in range(1, 6)]
ZONE_COLORS = {"Zone 1": "#9aa5b1", "Zone 2": "#3a8fd9", "Zone 3": "#3c9a5f", "Zone 4": "#e08a30", "Zone 5": "#d9534f"}
# WHO health guideline: 150-300 min moderate activity a week, where 1 vigorous minute counts as 2.
# Here zone 2-3 = moderate, zone 4-5 = vigorous.
WHO_WEEKLY_MIN = (150, 300)
EASY_SHARE_TARGET = 0.8  # "80/20": ~80% of cardio time easy (zone 1-2), the rest harder


def zone_time(acts: pd.DataFrame, cardio_only: bool = True) -> pd.DataFrame:
    """Minutes per zone per activity, plus moderate-equivalent minutes (WHO: vigorous counts double)."""
    if acts.empty or "z1_min" not in acts:
        return pd.DataFrame()
    a = acts[acts.type.isin(CARDIO_TYPES)] if cardio_only else acts
    a = a[["start", "name", "type", "duration_min"] + ZONES].copy()
    a[ZONES] = a[ZONES].fillna(0)
    a["moderate_eq"] = a.z2_min + a.z3_min + 2 * (a.z4_min + a.z5_min)
    return a


def zone_periods(z: pd.DataFrame, freq: str, daily: pd.DataFrame | None = None) -> pd.DataFrame:
    """Sum zone minutes per week ('W', starting Monday) or month ('M'); empty weeks/months show as 0.
    With `daily`, also Garmin's all-day intensity minutes (moderate + 2 x vigorous, as Garmin counts them)."""
    rule = "W-SUN" if freq == "W" else "MS"
    p = z.set_index("start")[ZONES + ["moderate_eq"]].resample(rule).sum()
    if daily is not None and "intensity_min_moderate" in daily:
        i = daily.set_index("date")[["intensity_min_moderate", "intensity_min_vigorous"]].resample(rule).sum()
        p = p.join((i.intensity_min_moderate + 2 * i.intensity_min_vigorous).rename("garmin_intensity"), how="outer")
        p[ZONES + ["moderate_eq"]] = p[ZONES + ["moderate_eq"]].fillna(0)
    p.index = p.index - pd.Timedelta(days=6) if freq == "W" else p.index  # label weeks by their Monday
    total = p[ZONES].sum(axis=1)
    p["easy_share"] = (p.z1_min + p.z2_min) / total.where(total > 0)
    weeks = 1 if freq == "W" else p.index.days_in_month / 7
    p["target_lo"], p["target_hi"] = WHO_WEEKLY_MIN[0] * weeks, WHO_WEEKLY_MIN[1] * weeks
    return p
