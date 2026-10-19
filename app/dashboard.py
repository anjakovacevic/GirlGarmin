"""Local Garmin dashboard (Streamlit). Start it with:

    streamlit run app/dashboard.py        (from the repo folder, or scripts/dashboard.bat on Windows)

Tabs: Today, Training, Body & diet, Recovery, Sleep, Cycle, Cardio & VO2max, Heart-rate zones. Everything runs on your
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
from girlgarmin import progression  # noqa: E402
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
lose_weight = A.load_settings().get("goal") == "lose"

st.title("Garmin dashboard")
st.caption(f"Data up to {daily.date.max():%a %d %b %Y} · plan {P.FIRST_DAY:%d %b} - {A.PLAN_END:%d %b %Y}"
           + (" (starts soon - edit data/plan_start.txt to move it)" if date.today() < P.FIRST_DAY and hasattr(P, "START_FILE") else ""))

tab_today, tab_train, tab_body, tab_rec, tab_sleep, tab_cycle, tab_cardio, tab_zones = st.tabs(
    ["Today", "Training", "Body & diet", "Recovery", "Sleep", "Cycle", "Cardio & VO2max", "Heart-rate zones"])

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
                  delta_color="inverse" if lose_weight else "off")

    if rec:
        st.info(f"**Recovery:** {rec['advice']}  \n"
                f"HRV status {rec['hrv_status'] or '-'} · sleep score {rec['sleep_score'] or '-'} · "
                f"resting HR {rec['resting_hr']} ({rec['date']:%d %b})")

    if day and day["session"]:
        st.subheader(f"{today:%A %d %b}: {day['session'].title}")
        st.caption("Warm-up: " + day["session"].warmup)
        rows = []
        hist = progression.history(sets, acts)
        for ex in day["session"].exercises:
            t = progression.target(ex, day["session"], today, hist, today)
            unit = (" /arm" if "arm" in ex.note.lower() else " /leg") if ex.per_leg else ""
            first = t.based_on is None and ex.start_kg is not None
            rows.append({"Exercise": ex.name, "Sets": t.sets, "Reps": f"{t.reps}{unit}", "Load (kg)": t.kg, "RIR": ex.rir,
                         "Based on": f"{t.based_on:%d %b}" if t.based_on else "plan",
                         "Notes": ex.note + (" First time - the load is a guess, adjust it." if first else "")})
        st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch")
        if day["cardio"]:
            st.caption("After lifting: " + day["cardio"])
    elif day:
        st.subheader(f"{today:%A %d %b}")
        st.write(day["cardio"])

    st.subheader("This week")
    week_start = pd.Timestamp(today - timedelta(days=today.weekday()))
    plan_week = [x for x in P.days() if week_start <= pd.Timestamp(x["date"]) < week_start + pd.Timedelta(days=7)]
    day_of = acts.start.dt.normalize() if not acts.empty else pd.Series(dtype="datetime64[ns]")
    lifted = set(day_of[acts.type == "strength_training"]) if not acts.empty else set()
    moved = set(day_of[acts.type != "strength_training"]) if not acts.empty else set()  # any cardio activity

    def cardio_label(kind: str | None) -> str:
        if kind == "intervals":
            return "VO2max intervals"
        if kind == "vo2check":
            return "VO2max check run"
        if kind and kind.startswith("zone2-"):
            return f"Zone-2 walk {kind.split('-')[1]} min"
        return ""

    def tick(planned: bool, done: bool, d, optional: bool = False) -> str:
        if not planned:
            return ""
        return "✅" if done else ("—" if d > today or optional else "❌")

    st.dataframe(pd.DataFrame([{
        "Day": f"{x['date']:%a %d %b}",
        "Lifting": x["session"].title if x["session"] else "",
        "Cardio": cardio_label(x["cardio_kind"]) or ("Rest" if not x["session"] else ""),
        "Lifting done": tick(bool(x["session"]), pd.Timestamp(x["date"]) in lifted, x["date"]),
        "Cardio done": tick(bool(cardio_label(x["cardio_kind"])), pd.Timestamp(x["date"]) in moved, x["date"],
                            optional=x["cardio_kind"] == "zone2-30"),
    } for x in plan_week]), hide_index=True, width="stretch")
    st.caption("Cardio counts as done when any non-strength activity is recorded that day. "
               "The 30-min zone-2 walks are optional, so a missed one shows —.")

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
        pva = A.plan_vs_actual(sets, acts, today)
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
        goals = ["Just track my weight", "Lose weight"]
        goal = st.radio("Your goal", goals, horizontal=True, index=int(lose_weight),
                        help="Choosing 'Lose weight' shows a safe pace band based on your current weight.")
        if (goal == goals[1]) != lose_weight:
            A.save_setting("goal", "lose" if goal == goals[1] else "track")
            st.rerun()  # so the Today tab, drawn above, picks up the new goal too
        w = weight.sort_values("date")
        wt = A.weight_forecast(w)
        fig = go.Figure()
        fig.add_scatter(x=w.date, y=w.weight_kg, mode="markers+lines", name="Weigh-ins")
        last = w.iloc[-1]
        end = pd.Timestamp(A.PLAN_END)
        weeks_left = max((end - last.date).days / 7, 0)
        lo, hi = A.loss_target(last.weight_kg)
        if lose_weight:
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
        pct_lo, pct_hi = A.TARGET_LOSS_PCT_PER_WEEK
        st.caption((f"Target pace: -{lo} to -{hi} kg/week ({pct_lo}-{pct_hi}% of your current weight, which keeps "
                    f"strength and muscle best) -> about {last.weight_kg - hi * weeks_left:.1f}-"
                    f"{last.weight_kg - lo * weeks_left:.1f} kg by {A.PLAN_END:%d %b}. " if lose_weight else "")
                   + "The trend line uses all your weigh-ins, so it catches up a few weeks after you change your eating. "
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

# ---------------------------------------------------------------- sleep
with tab_sleep:
    nights = A.sleep_nights(daily, phases)
    if nights.empty:
        st.info("Click **Sync from Garmin** in the sidebar to load sleep details.")
    else:
        last = nights.iloc[-1]
        usual = nights.tail(30).median(numeric_only=True)
        st.subheader(f"Last night ({last.date:%a %d %b}): {last.kind}")
        def vs_usual(col, fmt, unit=""):
            """(value, delta) for a metric; '-' and no delta when your watch doesn't measure it."""
            v, u = last.get(col), usual.get(col)
            if pd.isna(v):
                return "-", None
            return f"{v:{fmt}}{unit}", (f"{v - u:+{fmt}}{unit} vs usual" if pd.notna(u) else None)

        c1, c2, c3, c4, c5 = st.columns(5)
        c1.metric("Sleep", *vs_usual("sleep_h", ".1f", " h"))
        deep, deep_delta = vs_usual("deep_min", ".0f", " min")
        c2.metric("Deep sleep", deep + (f" ({last.deep_pct:.0f}%)" if pd.notna(last.deep_pct) else ""), deep_delta)
        c3.metric("Body Battery gained", *vs_usual("body_battery_gain", ".0f"))
        c4.metric("Stress during sleep", *vs_usual("sleep_stress", ".0f"), delta_color="inverse")
        c5.metric("Bedtime", pd.to_datetime(last.bedtime).strftime("%H:%M") if pd.notna(last.bedtime) else "-")
        st.caption("'Usual' = median of your last 30 nights. A night counts as restorative when it is 7+ h, Body Battery "
                   f"gains more than {A.LOW_BATTERY_GAIN} (or you wake above {A.LOW_BATTERY_WAKE}) and deep sleep is "
                   f"at least {A.LOW_DEEP_PCT}% of the night.")

        fig = px.bar(nights, x="date", y="sleep_h", color="kind", color_discrete_map=A.SLEEP_KINDS,
                     hover_data={"deep_min": True, "body_battery_gain": True, "sleep_stress": True, "kind": False},
                     category_orders={"kind": list(A.SLEEP_KINDS)}, height=340, title="Every night")
        fig.add_hline(y=A.LONG_NIGHT_H, line_dash="dot", line_color="grey")
        shade_phases(fig, phases)
        fig.update_layout(yaxis_title="hours asleep", xaxis_title=None, legend_title=None, margin=dict(t=40))
        st.plotly_chart(fig, width="stretch")

        tips = A.sleep_tips(nights)
        st.subheader("What would help - from your own nights")
        st.markdown("\n".join(f"- {t}" for t in tips) if tips else "No clear pattern yet - check back after more nights.")

        st.subheader("Long nights that didn't restore you - what was different")
        st.dataframe(A.sleep_compare(nights), width="stretch")
        st.caption("Medians of your 7h+ nights. Stress and heart rate during sleep usually explain low battery far "
                   "better than hours slept.")

        long = nights[nights.sleep_h >= A.LONG_NIGHT_H]
        left, right = st.columns(2)
        fig = px.scatter(long, x="sleep_stress", y="body_battery_gain", color="kind", color_discrete_map=A.SLEEP_KINDS,
                         hover_data={"date": "|%d %b", "sleep_h": ":.1f"}, height=340,
                         title="7h+ nights: calmer sleep = more battery")
        fig.update_layout(xaxis_title="stress during sleep", yaxis_title="Body Battery gained", legend_title=None,
                          showlegend=False, margin=dict(t=40))
        left.plotly_chart(fig, width="stretch")
        bins = pd.cut(long.bed_h, [0, 23, 24, A.LATE_BED_H, 48], labels=["before 23:00", "23-24", "24-00:30", "after 00:30"])
        by_bed = long.groupby(bins, observed=True).deep_min.agg(["median", "count"]).reset_index()
        fig = px.bar(by_bed, x="bed_h", y="median", text="count", height=340, title="Deep sleep by bedtime (7h+ nights)")
        fig.update_traces(texttemplate="%{text} nights", marker_color="#8e6cc0")
        fig.update_layout(xaxis_title=None, yaxis_title="deep sleep (median min)", margin=dict(t=40))
        right.plotly_chart(fig, width="stretch")
        if long.phase.notna().any():
            by_ph = long.groupby("phase")[["low_battery", "low_deep"]].mean().mul(100).round().reset_index()
            fig = px.bar(by_ph.melt("phase", var_name="problem", value_name="pct"), x="phase", y="pct", color="problem",
                         barmode="group", height=300, title="Share of 7h+ nights with a problem, by cycle phase",
                         category_orders={"phase": ["period", "follicular", "luteal"]},
                         color_discrete_map={"low_battery": "#e0a030", "low_deep": "#8e6cc0"})
            fig.update_layout(yaxis_title="% of nights", xaxis_title=None, legend_title=None, margin=dict(t=40))
            st.plotly_chart(fig, width="stretch")
        st.caption("Patterns, not proof - and not medical advice.")

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
    c = acts[acts.type.isin(A.CARDIO_TYPES)].copy() if not acts.empty else acts
    if c.empty:
        st.info("No cardio sessions yet.")
    else:
        fig = px.scatter(c, x="start", y="duration_min", size="duration_min", color="type", hover_data=["avg_hr", "max_hr"],
                         height=360, title="Cardio sessions (bubble size = minutes)")
        st.plotly_chart(fig, width="stretch")
        zcols = [z for z in A.ZONES if z in c]
        show = c[["start", "name", "type", "duration_min", "avg_hr", "max_hr"] + zcols].sort_values("start", ascending=False)
        show["start"] = show.start.dt.strftime("%a %d %b %H:%M")
        if zcols:
            show["main zone"] = show[zcols].idxmax(axis=1).str[1].where(show[zcols].sum(axis=1) > 0)
            show = show.rename(columns={z: f"Z{z[1]} min" for z in zcols})
        st.dataframe(show, hide_index=True, width="stretch")

    st.subheader("Time in heart-rate zones")
    zc1, zc2 = st.columns([1, 2])
    per = zc1.radio("Show per", ["Week", "Month"], horizontal=True)
    all_acts = zc2.checkbox("Include strength training and other workouts", value=False,
                            help="WHO counts any activity that gets your heart rate up; strength sessions mostly sit in zone 1-2.")
    zt = A.zone_time(acts, cardio_only=not all_acts)
    if zt.empty:
        st.info("No heart-rate zone data yet - click **Sync from Garmin** in the sidebar.")
    else:
        zp = A.zone_periods(zt, "W" if per == "Week" else "M", daily)
        long_z = zp[A.ZONES].rename(columns={z: f"Zone {z[1]}" for z in A.ZONES}).reset_index(names="period")             .melt("period", var_name="zone", value_name="minutes")
        fig = px.bar(long_z, x="period", y="minutes", color="zone", color_discrete_map=A.ZONE_COLORS, height=420,
                     title=f"Workout minutes per zone, per {per.lower()}")
        fig.add_scatter(x=zp.index, y=zp.moderate_eq, mode="lines+markers", name="WHO minutes from workouts",
                        line=dict(color="black", width=2))
        if "garmin_intensity" in zp:
            fig.add_scatter(x=zp.index, y=zp.garmin_intensity, mode="lines+markers", name="Garmin all-day intensity minutes",
                            line=dict(color="#7a52b3", width=2, dash="dot"))
        fig.add_scatter(x=zp.index, y=zp.target_lo, mode="lines", name=f"WHO minimum ({A.WHO_WEEKLY_MIN[0]} min/week)",
                        line=dict(color="#3c9a5f", dash="dash"))
        fig.add_scatter(x=zp.index, y=zp.target_hi, mode="lines", name=f"WHO extra benefit ({A.WHO_WEEKLY_MIN[1]} min/week)",
                        line=dict(color="#3c9a5f", dash="dot", width=1))
        fig.update_layout(barmode="stack", xaxis_title=None, yaxis_title="minutes", legend_orientation="h",
                          margin=dict(t=40))
        st.plotly_chart(fig, width="stretch")

        cur = zp.iloc[-1] if zp.index[-1] >= pd.Timestamp(today) - pd.Timedelta(days=6 if per == "Week" else 30) else None
        full = zp.iloc[:-1] if cur is not None else zp  # leave out the week / month still in progress
        recent = full.tail(4 if per == "Week" else 3)
        m1, m2, m3, m4 = st.columns(4)
        m1.metric(f"WHO minutes from workouts, last {len(recent)} {per.lower()}s (avg)", f"{recent.moderate_eq.mean():.0f}",
                  f"target {recent.target_lo.mean():.0f}+", delta_color="off")
        if "garmin_intensity" in zp:
            m2.metric(f"Garmin all-day intensity minutes (avg)", f"{recent.garmin_intensity.mean():.0f}",
                      f"{recent.garmin_intensity.mean() - recent.target_lo.mean():+.0f} vs WHO minimum")
        easy = recent.z1_min.sum() + recent.z2_min.sum()
        tot = recent[A.ZONES].sum().sum()
        m3.metric("Easy share (zone 1-2)", f"{easy / tot:.0%}" if tot else "-", f"target ~{A.EASY_SHARE_TARGET:.0%}",
                  delta_color="off")
        m4.metric("Hard minutes (zone 4-5)", f"{recent.z4_min.sum() + recent.z5_min.sum():.0f}",
                  f"in the last {len(recent)} {per.lower()}s", delta_color="off")
        if cur is not None:
            st.caption(f"This {per.lower()} so far: {cur.moderate_eq:.0f} WHO minutes from workouts"
                       + (f", {cur.garmin_intensity:.0f} Garmin intensity minutes" if pd.notna(cur.get("garmin_intensity")) else "")
                       + f" (target {cur.target_lo:.0f}+). Averages above use the last full {per.lower()}s.")
        st.markdown(f"""
**Targets, for health**
- **WHO:** {A.WHO_WEEKLY_MIN[0]}-{A.WHO_WEEKLY_MIN[1]} min of moderate activity a week (zone 2-3), where one vigorous
  minute (zone 4-5) counts as two, plus strength training on 2+ days. The black line is your workouts only; Garmin's
  intensity minutes (purple) also count brisk walking during the day, so they are usually the fairer comparison.
- **80/20 for fitness:** about {A.EASY_SHARE_TARGET:.0%} of cardio time easy (zone 1-2), the rest harder - mostly a
  little zone 4-5 (like intervals) rather than lots of zone 3, which tires you without adding as much.
- **Zone 5** is for short intervals only - a few minutes a week at most is plenty.
""")
        st.caption("Minutes are counted with the zones your watch had when you recorded each workout (see the "
                   "Heart-rate zones tab). If you change your zones, only new workouts use them.")
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

# ---------------------------------------------------------------- heart-rate zones
with tab_zones:
    zs = A.garmin_zones()
    if zs is None:
        st.info("No heart-rate zone settings yet - click **Sync from Garmin** in the sidebar.")
    else:
        tests = A.load_hr_tests()
        with st.expander("Your test results (leave at 0 if you haven't done a test)", expanded=not tests):
            t1, t2, t3 = st.columns(3)
            new = {
                "talk_hr": t1.number_input("Talk test: avg HR, last 10 min", 0, 220, tests.get("talk_hr", 0),
                                           help="Easiest test. 20-30 min at a pace where you can still talk in full sentences."),
                "lthr": t2.number_input("Threshold test: avg HR, last 20 min", 0, 220, tests.get("lthr", 0),
                                        help="30 min run as hard as you can hold evenly = your lactate-threshold HR."),
                "max_hr": t3.number_input("Max HR test: highest HR seen", 0, 230, tests.get("max_hr", 0),
                                          help="Only when healthy and rested: 3 hard 2-3 min hill efforts, the last all-out."),
            }
            if {k: v for k, v in new.items() if v} != tests:
                A.save_hr_tests(new)
                tests = A.load_hr_tests()
        adv = A.hr_zone_advice(zs, daily, acts, tests)
        lo, hi = adv["zone2"]

        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Your zone 2 (estimate)", f"{lo}-{hi} bpm")
        c2.metric("Max HR in use", adv["max_used"], "220 - age formula" if adv["max_from_formula"] else "from your test",
                  delta_color="off")
        c3.metric("Highest HR seen in a workout", f"{adv['max_seen']:.0f}" if adv["max_seen"] else "-")
        c4.metric("Resting HR", adv["resting_now"], f"Garmin uses {zs.resting_hr}", delta_color="off")
        st.caption(f"Zone 2 based on: {adv['zone2_basis']}.")

        st.subheader("What to change in Garmin")
        if adv["tips"]:
            st.markdown("\n".join(f"- {t}" for t in adv["tips"]))
        else:
            st.success("Your Garmin zone settings match your data.")
        st.caption("Garmin Connect app: profile picture -> Settings -> User Settings -> Heart Rate Zones "
                   "(or on the watch: Settings -> User Profile -> Heart Rate).")

        st.subheader("Zones by method (bpm)")
        st.dataframe(adv["table"], width="stretch")
        st.caption("Different methods give different numbers because they start from different guesses. "
                   "Your own test results beat any formula.")

        runs = acts[acts.type.isin(["indoor_cardio", "treadmill_running", "running", "stair_climbing", "hiking",
                                    "walking", "cycling", "indoor_cycling"]) & acts.avg_hr.notna()] if not acts.empty else acts
        if not runs.empty:
            fig = px.scatter(runs, x="start", y="avg_hr", color="type", size="duration_min", hover_data=["name", "max_hr"],
                             height=380, title="Average HR of your cardio sessions vs estimated zone 2")
            fig.add_hrect(y0=lo, y1=hi, fillcolor="rgba(60,170,90,0.18)", line_width=0,
                          annotation_text="zone 2 estimate", annotation_position="top left")
            for f, name in zip(zs.floors[1:3], ["Garmin zone 2 starts", "Garmin zone 3 starts"]):
                fig.add_hline(y=f, line_dash="dot", line_color="grey", annotation_text=name, annotation_position="bottom right")
            fig.update_layout(yaxis_title="average HR (bpm)", xaxis_title=None, margin=dict(t=40))
            st.plotly_chart(fig, width="stretch")
            st.caption("If easy sessions where you could chat sit above the green band, your zones are set too low.")

        with st.expander("How to find your real zone 2"):
            st.markdown("""
1. **Talk test (free, good enough for most people).** After a warm-up, run or walk 20-30 min at a pace where you can
   speak in full sentences but wouldn't want to sing. Your average HR over the last 10 minutes is about the
   **top of zone 2**.
2. **Threshold test (more precise).** After a warm-up, run 30 min as hard as you can hold evenly. Average HR of the
   last 20 min ~ your **lactate-threshold HR (LTHR)**. Zone 2 ~ 85-89% of it.
3. **Max-HR test (hardest).** Only when healthy and well rested. After a warm-up, 3 hard uphill efforts of 2-3 min,
   the last one all-out. The highest number you see is close to your real max.

Enter your result above - the zone 2 estimate, the table and the chart update. Then copy the numbers into Garmin.
Not medical advice; if you have ever had heart symptoms, check with a doctor before an all-out test.
""")
