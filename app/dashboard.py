"""Local Garmin dashboard (Streamlit). Start it with:

    streamlit run app/dashboard.py        (from the repo folder, or scripts/dashboard.bat on Windows)

Tabs: Today, Training, Body & diet, Recovery, Cycle, Cardio & VO2max. Everything runs on your
computer from the files in ./data; the "Sync from Garmin" button runs girlgarmin.sync.
Calculations live in girlgarmin/analysis.py, the plan in girlgarmin/plans/.
"""

import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

ROOT = Path(__file__).resolve().parent.parent  # repo folder
sys.path.insert(0, str(ROOT))  # streamlit only puts app/ on the path; we need the girlgarmin package

from girlgarmin import analysis as A  # noqa: E402
from girlgarmin.plan import P  # noqa: E402

PHASE_COLORS = {"period": "rgba(220,60,90,0.15)", "luteal": "rgba(245,160,40,0.12)"}

st.set_page_config(page_title="Garmin Dashboard", page_icon="📈", layout="wide")


def pretty(code: str) -> str:
    """BARBELL_HIP_THRUST -> 'Barbell hip thrust'."""
    return str(code).replace("_", " ").strip().capitalize()


@st.cache_data(show_spinner=False)
def load_all(_stamp: float):
    """Cached data load; `_stamp` (newest CSV time) makes the cache refresh after a sync."""
    return A.load()


def data_stamp() -> float:
    files = list((ROOT / "data").glob("*.csv"))
    return max((f.stat().st_mtime for f in files), default=0.0)


def shade_phases(fig, phases: pd.Series):
    """Shade period (red) and post-ovulation (orange) days behind a time chart."""
    if phases.empty:
        return fig
    runs, cur, start, prev = [], None, None, None
    for d, ph in phases.sort_index().items():
        if ph != cur:
            if cur in PHASE_COLORS:
                runs.append((start, prev, cur))
            cur, start = ph, d
        prev = d
    if cur in PHASE_COLORS:
        runs.append((start, prev, cur))
    for a, b, ph in runs:
        fig.add_vrect(x0=a - pd.Timedelta(hours=12), x1=b + pd.Timedelta(hours=12), fillcolor=PHASE_COLORS[ph],
                      line_width=0, layer="below")
    return fig


# ---------------------------------------------------------------- sidebar
with st.sidebar:
    st.header("Data")
    if st.button("🔄 Sync from Garmin", width="stretch",
                 help="Downloads anything new from Garmin Connect (takes 1-3 minutes)."):
        with st.status("Syncing with Garmin Connect...", expanded=True) as status:
            proc = subprocess.Popen([sys.executable, "-m", "girlgarmin.sync"], cwd=ROOT,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            for line in proc.stdout:
                st.write(line.rstrip())
            ok = proc.wait() == 0
            status.update(label="Sync finished" if ok else "Sync failed - see log above",
                          state="complete" if ok else "error")
        st.cache_data.clear()
    today = st.date_input("Today", value=date.today(), help="Change to look at a different day of the plan.")
    st.caption("All data stays on this PC (./data). No subscription needed.")

d = load_all(data_stamp())
acts, sets, daily, weight, cycles = d["activities"], d["sets"], d["daily"], d["weight"], d["cycles"]
if daily.empty:
    st.error("No data yet. Log in once with `python -m girlgarmin.login`, then click **Sync from Garmin** "
             "in the sidebar.")
    st.stop()

cycle_info = A.analyse_cycles(daily, cycles) if not cycles.empty else []
phases = A.phase_by_date(daily, cycle_info) if cycle_info else pd.Series(dtype=object)
pred = A.predict_cycle(cycle_info, today)
sessions = A.lift_sessions(sets) if not sets.empty else pd.DataFrame()

st.title("Garmin dashboard")
st.caption(f"Data up to {daily.date.max():%a %d %b %Y} · plan {P.FIRST_DAY:%d %b} - {A.PLAN_END:%d %b %Y}"
           + (" (starts soon - edit data/plan_start.txt to move it)" if date.today() < P.FIRST_DAY and hasattr(P, "START_FILE") else ""))

tab_today, tab_train, tab_body, tab_rec, tab_cycle, tab_cardio = st.tabs(
    ["Today", "Training", "Body & diet", "Recovery", "Cycle", "Cardio & VO2max"])

# ---------------------------------------------------------------- today
with tab_today:
    day = A.today_plan(today)
    rec = A.recovery_today(daily, phases)
    wt = A.weight_forecast(weight)
    c1, c2, c3, c4 = st.columns(4)
    if day:
        c1.metric("Plan", day["session"].title if day["session"] else ("Rest" if "Rest" in day["cardio"] else "Cardio"),
                  f"week {day['week']} of {P.WEEKS}", delta_color="off")
    else:
        c1.metric("Plan", "Outside plan dates")
    if rec:
        c2.metric("HRV last night", f"{rec['hrv']:.0f} ms" if pd.notna(rec["hrv"]) else "-",
                  f"{rec['hrv'] - rec['phase_baseline']:+.0f} vs your {rec['phase'] or ''} normal"
                  if pd.notna(rec["hrv"]) and pd.notna(rec["phase_baseline"]) else None)
    if pred:
        c3.metric("Cycle day", pred.cycle_day, pred.phase, delta_color="off")
    if not weight.empty:
        last_w = weight.sort_values("date").iloc[-1]
        c4.metric("Weight", f"{last_w.weight_kg:.1f} kg", f"{wt.per_week:+.2f} kg/week trend" if wt else None,
                  delta_color="inverse")

    if rec:
        st.info(f"**Recovery:** {rec['advice']}  \n"
                f"HRV status {rec['hrv_status'] or '-'} · sleep score {rec['sleep_score'] or '-'} · "
                f"resting HR {rec['resting_hr']} ({rec['date']:%d %b})")

    if day and day["session"]:
        st.subheader(f"{today:%A %d %b}: {day['session'].title}")
        st.caption("Warm-up: " + day["session"].warmup)
        rows = []
        for ex in day["session"].exercises:
            n, reps, kg = P.prescription(ex, day["week"])
            unit = " /leg" if ex.per_leg else ""
            rows.append({"Exercise": ex.name, "Sets": n, "Reps": f"{reps}{unit}", "Load (kg)": kg, "RIR": ex.rir,
                         "Notes": ex.note + (" Load is an estimate - adjust." if ex.estimate and day["week"] == 1 else "")})
        st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch")
        if day["cardio"]:
            st.caption("After lifting: " + day["cardio"])
    elif day:
        st.subheader(f"{today:%A %d %b}")
        st.write(day["cardio"])

    st.subheader("This week")
    week_start = pd.Timestamp(today - timedelta(days=today.weekday()))
    plan_week = [x for x in P.days() if week_start <= pd.Timestamp(x["date"]) < week_start + pd.Timedelta(days=7)]
    done_days = set(acts[acts.type == "strength_training"].start.dt.normalize()) if not acts.empty else set()
    st.dataframe(pd.DataFrame([{
        "Day": f"{x['date']:%a %d %b}",
        "Planned": x["session"].title if x["session"] else ("Rest" if "Rest" in x["cardio"] else x["cardio"][:60]),
        "Done": ("✅" if pd.Timestamp(x["date"]) in done_days else ("—" if x["date"] > today else "❌"))
        if x["session"] else "",
    } for x in plan_week]), hide_index=True, width="stretch")

# ---------------------------------------------------------------- training
with tab_train:
    if sessions.empty:
        st.info("No strength data yet.")
    else:
        fc = A.lift_forecasts(sessions)
        st.subheader("Lift progress")
        options = list(fc.exercise) if not fc.empty else sorted(sessions.exercise.unique())
        ex = st.selectbox("Exercise", options, format_func=pretty)
        g = sessions[sessions.exercise == ex].sort_values("date")
        fig = go.Figure()
        fig.add_scatter(x=g.date, y=g.best_e1rm, mode="lines+markers", name="Estimated 1-rep max")
        fig.add_scatter(x=g.date, y=g.top_kg, mode="markers", name="Heaviest set logged", marker_symbol="diamond")
        row = fc[fc.exercise == ex]
        if not row.empty and pd.notna(row.iloc[0].projected_e1rm_at_plan_end):
            r = row.iloc[0]
            fig.add_scatter(x=[g.date.iloc[-1], pd.Timestamp(A.PLAN_END)], y=[r.last_e1rm, r.projected_e1rm_at_plan_end],
                            mode="lines", line_dash="dot", name="Projection (trend of last 6 weeks)")
        fig.update_layout(height=380, yaxis_title="kg", legend_orientation="h", margin=dict(t=10))
        st.plotly_chart(fig, width="stretch")
        if not row.empty:
            r = row.iloc[0]
            c1, c2, c3 = st.columns(3)
            c1.metric("Best estimated 1RM", f"{r.best_e1rm:.1f} kg")
            c2.metric("Trend", f"{r.trend_kg_per_week:+.1f} kg/week" if pd.notna(r.trend_kg_per_week) else "-")
            c3.metric(f"Projected on {A.PLAN_END:%d %b}", f"{r.projected_e1rm_at_plan_end:.1f} kg"
                      if pd.notna(r.projected_e1rm_at_plan_end) else "-")
        st.caption("Estimated 1RM = weight x (1 + reps/30) (Epley). Holding it steady during a diet means you're keeping muscle.")

        st.subheader("Weekly sets per muscle")
        ws = A.weekly_sets_by_muscle(sets)
        fig = px.bar(ws, x="week", y="sets", color="muscle", height=380)
        fig.update_layout(margin=dict(t=10), legend_orientation="h")
        st.plotly_chart(fig, width="stretch")

        st.subheader("Plan vs what you did")
        pva = A.plan_vs_actual(sets, today)
        if pva.empty:
            st.caption(f"Starts filling in from {P.FIRST_DAY:%d %b}.")
        else:
            show = pva[["date", "session", "exercise", "plan_sets", "plan_reps", "plan_kg", "actual_sets", "actual_kg",
                        "actual_best_reps", "hit_load"]].copy()
            show["date"] = show.date.dt.strftime("%a %d %b")
            st.dataframe(show, hide_index=True, width="stretch")
            logged = pva.actual_sets.notna()
            st.caption(f"{logged.sum()} of {len(pva)} planned exercises logged so far; "
                       f"planned load reached on {int(pva.hit_load[logged].sum())}.")

        with st.expander("All forecasts"):
            f = fc.copy()
            f["exercise"] = f.exercise.map(pretty)
            st.dataframe(f.round(1), hide_index=True, width="stretch")

# ---------------------------------------------------------------- body
with tab_body:
    if weight.empty:
        st.info("No weigh-ins yet. Log your weight in Garmin Connect 3-4 mornings a week.")
    else:
        w = weight.sort_values("date")
        wt = A.weight_forecast(w)
        fig = go.Figure()
        fig.add_scatter(x=w.date, y=w.weight_kg, mode="markers+lines", name="Weigh-ins")
        last = w.iloc[-1]
        end = pd.Timestamp(A.PLAN_END)
        weeks_left = max((end - last.date).days / 7, 0)
        lo, hi = A.TARGET_LOSS_KG_PER_WEEK
        fig.add_scatter(x=[last.date, end, end, last.date], fill="toself", fillcolor="rgba(46,160,67,0.12)",
                        line_width=0, name=f"Target pace (-{lo} to -{hi} kg/week)",
                        y=[last.weight_kg, last.weight_kg - lo * weeks_left, last.weight_kg - hi * weeks_left,
                           last.weight_kg])
        if wt:
            fig.add_scatter(x=[w.date.iloc[0], end], y=[wt.projected - wt.per_week / 7 * (end - w.date.iloc[0]).days,
                                                           wt.projected], mode="lines", line_dash="dot",
                            name="Your trend so far")
        fig.update_layout(height=420, yaxis_title="kg", legend_orientation="h", margin=dict(t=10))
        st.plotly_chart(fig, width="stretch")
        c1, c2, c3 = st.columns(3)
        c1.metric("Latest", f"{last.weight_kg:.1f} kg", f"{last.date:%d %b}", delta_color="off")
        if wt:
            c2.metric("Trend", f"{wt.per_week:+.2f} kg/week")
            c3.metric(f"Projected {A.PLAN_END:%d %b} at this trend", f"{wt.projected:.1f} kg")
        st.caption(f"Target pace: -{lo} to -{hi} kg/week (change it in analysis.py) -> about "
                   f"{last.weight_kg - hi * weeks_left:.1f}-{last.weight_kg - lo * weeks_left:.1f} kg by {A.PLAN_END:%d %b}. "
                   "The trend line uses all your weigh-ins, so it catches up a few weeks after you change your eating. "
                   "Weight swings ~1 kg day to day - judge the weekly average.")
        steps = daily[["date", "steps"]].dropna()
        fig = px.bar(steps, x="date", y="steps", height=260, title="Daily steps")
        fig.add_hline(y=10000, line_dash="dot")
        st.plotly_chart(fig, width="stretch")

# ---------------------------------------------------------------- recovery
with tab_rec:
    st.caption("Shading: red = period, orange = after ovulation (HRV is normally lower and resting HR higher here).")
    r = daily.sort_values("date").copy()
    r["hrv_7d"] = r.hrv_last_night.rolling(7, min_periods=3).mean()
    for col, title, extra in [("hrv_last_night", "HRV (ms)", "hrv_7d"), ("resting_hr", "Resting heart rate", None),
                              ("sleep_score", "Sleep score", None), ("body_battery_high", "Body Battery (daily high)", None)]:
        fig = go.Figure()
        fig.add_scatter(x=r.date, y=r[col], mode="markers+lines", name=title, line_width=1)
        if extra:
            fig.add_scatter(x=r.date, y=r[extra], mode="lines", name="7-day average", line_width=3)
        shade_phases(fig, phases)
        fig.update_layout(height=260, title=title, margin=dict(t=40, b=10), showlegend=bool(extra))
        st.plotly_chart(fig, width="stretch")
    if not phases.empty:
        tbl = daily.assign(phase=daily.date.map(phases)).dropna(subset=["phase"])
        st.subheader("Your averages by cycle phase")
        st.dataframe(tbl.groupby("phase")[["hrv_last_night", "resting_hr", "sleep_score", "skin_temp_dev"]]
                     .mean().round(1), width="stretch")

# ---------------------------------------------------------------- cycle
with tab_cycle:
    if not pred:
        st.info("Log your periods in Garmin Connect (Menstrual Cycle) to see predictions here.")
    else:
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Cycle day", pred.cycle_day, pred.phase, delta_color="off")
        c2.metric("Next period (estimate)", f"{pred.next_period:%a %d %b}",
                  f"in {(pred.next_period - pd.Timestamp(today)).days} days", delta_color="off")
        c3.metric("Ovulation", f"{pred.ovulation:%d %b}" if pred.ovulation is not None else "-",
                  "confirmed by temperature" if pred.ovulation_confirmed else "estimate - no temperature rise yet",
                  delta_color="off")
        c4.metric("Fertile window (estimate)",
                  (f"{pred.fertile_start:%d}-{pred.fertile_end:%d %b}" if pred.fertile_start.month == pred.fertile_end.month
                   else f"{pred.fertile_start:%d %b}-{pred.fertile_end:%d %b}") if pred.fertile_start is not None else "-")
        st.caption(f"Next period based on: {pred.next_period_basis}. "
                   f"Your median cycle: {pred.median_cycle:.0f} days" if pred.median_cycle else "")

        t = daily[["date", "skin_temp_dev"]].dropna()
        fig = go.Figure()
        fig.add_bar(x=t.date, y=t.skin_temp_dev, name="Skin temp vs baseline",
                    marker_color=["#d9534f" if v > 0 else "#5b8def" for v in t.skin_temp_dev])
        shade_phases(fig, phases)
        for c in cycle_info:
            fig.add_vline(x=c.start, line_color="#c0392b", line_width=2)
            if c.ovulation is not None:
                fig.add_vline(x=c.ovulation, line_dash="dot", line_color="#e67e22")
        fig.add_vrect(x0=pred.next_period - pd.Timedelta(days=2), x1=pred.next_period + pd.Timedelta(days=2),
                      fillcolor="rgba(220,60,90,0.25)", line_width=0, annotation_text="predicted period",
                      annotation_position="top left")
        fig.update_layout(height=420, yaxis_title="deg C vs your baseline", margin=dict(t=10),
                          xaxis_range=[t.date.min() - pd.Timedelta(days=2), pred.next_period + pd.Timedelta(days=5)])
        st.plotly_chart(fig, width="stretch")
        st.caption("Red lines = period start. Dotted orange = ovulation (from the temperature rise, or Garmin's "
                   "estimate). Look for 3+ nights clearly above the previous 6 = ovulation has happened; "
                   "a drop back below 0 = period within ~1-2 days. Ignore single-night spikes.")

        st.dataframe(pd.DataFrame([{
            # all text: mixing numbers with "current"/"-" in one column breaks Streamlit's table converter
            "Cycle start": f"{c.start:%d %b %Y}", "Length (days)": str(c.length or "current"),
            "Temperature rise on day": str(c.shift_day or "-"),
            "Ovulation": f"{c.ovulation:%d %b} ({c.ovulation_source})" if c.ovulation is not None else "-",
            "Days ovulation -> period": str(c.luteal_days or "-"),
        } for c in cycle_info]), hide_index=True, width="stretch")
        st.caption("Wrist temperature confirms ovulation after the fact (within ~3 days in ~78% of cycles in studies). "
                   "Good for predicting your period - not reliable enough for contraception.")

# ---------------------------------------------------------------- cardio
with tab_cardio:
    cardio_types = ["indoor_cardio", "treadmill_running", "running", "stair_climbing", "floor_climbing", "walking",
                    "cycling", "indoor_cycling", "hiking"]
    c = acts[acts.type.isin(cardio_types)].copy()
    if c.empty:
        st.info("No cardio sessions yet.")
    else:
        fig = px.scatter(c, x="start", y="duration_min", size="duration_min", color="type", hover_data=["avg_hr", "max_hr"],
                         height=360, title="Cardio sessions (bubble size = minutes)")
        st.plotly_chart(fig, width="stretch")
        show = c[["start", "name", "type", "duration_min", "avg_hr", "max_hr"]].sort_values("start", ascending=False)
        show["start"] = show.start.dt.strftime("%a %d %b %H:%M")
        st.dataframe(show, hide_index=True, width="stretch")
    v = acts[acts.vo2max.notna()][["start", "name", "vo2max"]] if "vo2max" in acts else pd.DataFrame()
    st.subheader("VO2max")
    if v.empty:
        st.write("No VO2max readings yet - they only come from outdoor runs/walks with GPS.")
    else:
        st.dataframe(v.assign(start=v.start.dt.strftime("%d %b %Y")), hide_index=True)
    checks = [x["date"] for x in P.days() if x["cardio_kind"] == "vo2check"]
    if checks:
        st.caption("Plan: VO2max check runs on " + " and ".join(f"{c:%a %d %b}" for c in checks)
                   + " - compare the readings.")
