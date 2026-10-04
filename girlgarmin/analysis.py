"""Calculations and simple predictions behind the dashboard. No Streamlit here - pure pandas.

Reads the CSVs that girlgarmin.sync writes to ./data and the plan from girlgarmin.plan.

Predictions are deliberately simple and explainable:
- weight: straight-line trend through weigh-ins -> projected weight at the end of the plan
- lifts: estimated 1RM (Epley) per session, straight-line trend -> projected 1RM at the end of the plan
- cycle: nightly skin-temperature shift (3 nights above the previous 6, ignoring one outlier night and
  period days) marks
  ovulation after the fact; next period = ovulation + luteal length (else last start + median cycle length)
"""

from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np
import pandas as pd

from girlgarmin.paths import DATA
from girlgarmin.plan import P

PLAN_END = P.START + timedelta(days=7 * P.WEEKS - 1)
TYPICAL_LUTEAL_DAYS = 14  # used until your own ovulation -> period length is known
# Target weight-loss pace shown on the "Body & diet" tab (kg/week). ~0.5-0.7% of bodyweight per
# week keeps strength and muscle best in a deficit; at 70 kg that is ~0.35-0.5 kg/week.
TARGET_LOSS_KG_PER_WEEK = (0.35, 0.5)

# Garmin exercise category (or exact exercise name) -> muscle group it mainly trains
MUSCLE_BY_EXERCISE = {
    "ROMANIAN_DEADLIFT": "Hamstrings", "WEIGHTED_LEG_EXTENSIONS": "Quads", "KNEELING_REAR_FLYE": "Rear delts",
    "_45_DEGREE_CABLE_EXTERNAL_ROTATION": "Rear delts", "KETTLEBELL_SWING": "Glutes", "LEG_ABDUCTION": "Glutes",
    "DUMBBELL_STEP_UP": "Glutes",
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

def plan_rows() -> pd.DataFrame:
    """Every planned exercise of every day as one row (date, sets, reps, kg)."""
    rows = []
    for d in P.days():
        s = d["session"]
        for ex in (s.exercises if s else []):
            sets, reps, kg = P.prescription(ex, d["week"])
            rows.append({"date": pd.Timestamp(d["date"]), "week": d["week"], "session": s.title, "exercise": ex.name,
                         "garmin_name": ex.garmin_name, "garmin_category": ex.garmin_category,
                         "plan_sets": sets, "plan_reps": reps, "plan_kg": kg,
                         # reps logged for both legs together -> compare per leg
                         "reps_logged_x": 2 if getattr(ex, "logged_both_sides", False) else 1})
    return pd.DataFrame(rows)


def plan_vs_actual(sets: pd.DataFrame, today: date) -> pd.DataFrame:
    """Planned exercises up to `today` next to what Garmin logged that day. Matches on the Garmin
    exercise name first, then on the category (Garmin often leaves the name empty)."""
    plan = plan_rows()
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
