# GirlGarmin 🏋️‍♀️📈

A free, private dashboard for your Garmin data, built for women who lift. It downloads everything
from Garmin Connect to your own computer and shows your training, body weight, recovery and
menstrual cycle together, with simple predictions you can check yourself. It comes with an
8-week strength plan (glute + shoulder focus) that can also be uploaded to your watch.

- **No subscriptions or cloud.** Your data stays in a folder on your computer.
- **Cycle-aware.** Your nightly skin temperature confirms ovulation, the dashboard predicts your
  next period, and recovery advice takes your cycle phase into account.
- **Training that's easy to follow.** Every set's reps and weight for 8 weeks, shown on the
  dashboard and optionally sent to your Garmin watch as workouts.

> ⚠️ Not medical advice, and **not suitable for contraception**. The cycle predictions are
> estimates.

---

## What you need

- A Garmin watch that syncs to **Garmin Connect**. The cycle view needs a recent model that
  measures overnight skin temperature (check your watch's specs). Everything else works on any
  Garmin that tracks sleep and HRV.
- A Windows, macOS or Linux computer with **Python 3.11 or newer**
  ([python.org/downloads](https://www.python.org/downloads/)). On Windows, tick **"Add python.exe
  to PATH"** during install.
- Optional but recommended: in the Garmin Connect app, log your **periods** (Menstrual Cycle
  Tracking), your **weight** (3-4 mornings a week) and fix any **reps/weights** your watch counted
  wrong after strength workouts.

## Quick start

### Windows

1. Download this repo: green **Code** button → **Download ZIP**, then unzip it. You can also use
   `git clone https://github.com/anjakovacevic/GirlGarmin.git`.
2. Open the **`scripts`** folder and double-click **`setup.bat`**. It installs everything, asks for your Garmin email, password and
   two-step verification code if you use one, and downloads your data. The first download can
   take 10 minutes or more.
3. Double-click **`scripts\dashboard.bat`**. The dashboard opens in your browser.

### macOS / Linux

```bash
git clone https://github.com/anjakovacevic/GirlGarmin.git
cd GirlGarmin
bash scripts/setup.sh       # install + Garmin login + first download
bash scripts/dashboard.sh   # open the dashboard
```

After that, click **🔄 Sync from Garmin** in the dashboard sidebar whenever you want new data.

---

## Your login is safe

- The login step (`girlgarmin/login.py`) asks for your password in the terminal and **never saves it**. It only saves
  a login *token*, and that token goes to a folder in your user home directory
  (`C:\Users\<you>\.garminconnect` or `~/.garminconnect`). That folder is **outside this project**,
  so the token can't end up on GitHub, even if you publish your own fork.
- Everything Garmin downloads goes to `data/`, which is in `.gitignore` together with token files,
  `.env` files and your private plan (`girlgarmin/plans/my_plan.py`).
- The dashboard only listens on `localhost` (see `.streamlit/config.toml`), so other devices on
  your Wi-Fi can't open it.
- To log out, delete the `.garminconnect` folder in your home directory.

---

## What the dashboard shows

| Tab | What's there | Prediction |
|---|---|---|
| **Today** | Today's session with sets / reps / kg, recovery advice, cycle day, weight, this week's plan with ✅/❌ | Recovery advice (cycle-aware) |
| **Training** | Estimated 1-rep max per exercise over time, weekly sets per muscle, plan vs what you actually did | Each lift's estimated 1RM at the end of the plan |
| **Body & diet** | Weigh-ins, target weight-loss pace band, daily steps | Weight at the end of the plan at your current trend |
| **Recovery** | HRV (+7-day average), resting HR, sleep score, Body Battery, shaded by cycle phase | Your normal values per cycle phase |
| **Cycle** | Nightly skin temperature vs baseline, period starts, detected ovulation, table of past cycles | Next period, ovulation, fertile window |
| **Cardio & VO2max** | Cardio sessions, heart rate, VO2max readings | — |

The **Today** date picker in the sidebar lets you look at any day of the plan.

### How the predictions work

- **Weight**: a straight line through your weigh-ins. It is only as good as how often you weigh
  in. 3-4 mornings a week gives a reliable trend.
- **Lifts**: estimated 1RM = weight × (1 + reps/30) (Epley formula) for your best set each
  session, with a straight-line trend over the last 6 weeks, capped at ±10%. Obvious logging
  errors (a set under half your usual weight) are ignored. During a diet, a *flat* line is a good
  result because it means you're keeping muscle.
- **Cycle**: ovulation is confirmed after the fact, when skin temperature stays clearly higher for
  3 nights than the previous 6. Period days are excluded because wrist temperature dips during
  your period. Next period = ovulation + your luteal length (14 days until your own is known).
  Before ovulation is confirmed, it's last period + your median cycle length. Studies put wrist
  temperature within ~3 days of true ovulation in ~78% of cycles. That's good enough for planning,
  **not for contraception**.
- **Recovery**: if HRV status is **Low and** sleep score is under 70, do 1 fewer set per exercise
  at the same loads. HRV is often lower after ovulation, so a Low HRV in that phase on its own is
  not a reason to cut the session.

---

## The training plan

The example plan in [`girlgarmin/plans/example_plan.py`](girlgarmin/plans/example_plan.py) is an
8-week, 4-day split:

| Mon | Tue | Wed | Thu | Fri | Sat | Sun |
|---|---|---|---|---|---|---|
| Glutes | Upper A (shoulders) + VO2max intervals | Zone-2 walk | Legs | Zone-2 walk | Upper B (shoulders + glutes) + walk | Rest |

- **Double progression**: add 1 rep per set each week. When you reach the top of the rep range,
  the weight goes up and the reps drop back to the bottom. Week 8 is a lighter week.
- **RIR** (reps in reserve) tells you how close to failure to go: RIR 1-2 = stop when you could
  still do 1-2 more clean reps.
- The plan **starts on the Monday saved in `data/plan_start.txt`**. That file is created the first
  time you run anything: next Monday, or today if today is a Monday. Edit the date to move the
  plan.

### Make it yours

1. In `girlgarmin/plans/`, copy `example_plan.py` to **`my_plan.py`**. Everything automatically
   uses `my_plan.py` when it exists (see [`girlgarmin/plan.py`](girlgarmin/plan.py)), and it's
   git-ignored, so your numbers stay private.
2. In `my_plan.py`, change each exercise's `start_kg` to a weight you can lift for the starting
   reps. The example weights are only a starting point, and week 1 is marked "adjust".
3. Swap exercises, sets or days if you like. `garmin_category` / `garmin_name` are Garmin's
   exercise IDs. Copy them from an existing exercise, or look at a workout you logged on the watch
   (`data/raw/exercise_sets/`).
4. Optional: change the weight-loss pace band (`TARGET_LOSS_KG_PER_WEEK`) in `girlgarmin/analysis.py`.

### Put the plan on your watch (optional)

```bash
python -m girlgarmin.workouts --test     # try it: uploads 2 workouts, prints them, deletes them
python -m girlgarmin.workouts            # upload + schedule all 8 weeks on your Garmin calendar
python -m girlgarmin.workouts --delete   # remove them again (do this before uploading a changed plan)
```

Strength workouts show each exercise, reps and target weight on the watch. Warm-up and rest end
when you press **lap**, not on a timer. Cardio workouts use your Garmin heart-rate zones.

Run commands like these from the repo folder. If you haven't activated the virtual environment,
use `.venv\Scripts\python.exe` (Windows) or `.venv/bin/python` (macOS/Linux) instead of `python`.

---

## Project structure

```
GirlGarmin/
├── app/
│   └── dashboard.py          # the Streamlit dashboard
├── girlgarmin/               # the Python package
│   ├── login.py              # Garmin login (password + 2FA code), saves the token outside the repo
│   ├── sync.py               # downloads new data -> data/ (incremental, safe to re-run)
│   ├── workouts.py           # uploads / schedules the plan on Garmin Connect, and removes it again
│   ├── analysis.py           # all calculations and predictions (pure pandas)
│   ├── plan.py               # picks plans/my_plan.py if it exists, else plans/example_plan.py
│   ├── paths.py              # where data and login tokens live
│   └── plans/
│       └── example_plan.py   # the example 8-week plan: exercises, loads, progression, schedule
├── scripts/                  # launchers: setup, dashboard, sync (.bat for Windows, .sh for macOS/Linux)
├── .streamlit/config.toml    # keeps the dashboard private to your computer
├── data/                     # created on first run, git-ignored: your Garmin data
├── requirements.txt
└── README.md
```

In `data/`, raw JSON from Garmin goes to `data/raw/` and the tables the dashboard reads go to
`data/*.csv`.

### Useful commands

Run these from the repo folder:

```bash
python -m girlgarmin.login               # log in to Garmin (again)
python -m girlgarmin.sync                # download new data
python -m girlgarmin.sync --fit          # also download original .FIT files
python -m girlgarmin.sync --tables-only  # rebuild the CSVs without downloading
streamlit run app/dashboard.py           # open the dashboard
```

---

## Good to know

- **Garmin's rep counting is unreliable.** Sets are sometimes logged with 0 reps or odd numbers.
  Correct them in the Garmin Connect app after a workout. The progress charts are only as good as
  the logged numbers.
- **Some exercises are logged without a name** (e.g. lateral raises). The dashboard then uses
  Garmin's exercise *category* instead.
- **Dumbbell weights** are shown exactly as you log them in Garmin (per hand or both). Pick one
  way and stick to it.
- **VO2max only updates from outdoor runs/walks with GPS** on most Garmin watches. The plan
  schedules an easy outdoor check run in week 1 and week 8 so you can compare.
- **Unofficial API.** This uses the free, open-source
  [`python-garminconnect`](https://github.com/cyberjunky/python-garminconnect) library, which talks
  to Garmin the way the app does. If Garmin changes something and syncing breaks, update it with
  `python -m pip install -U "garminconnect[workout]"`.
- **Known library bug, worked around:** the library's strength-workout helper stores weights
  1000× too high. `girlgarmin/workouts.py` sets the weight directly instead.
- **Login expired?** Run `python -m girlgarmin.login` again (or `scripts/setup.bat`).

## Contributing

Issues and pull requests are welcome, especially support for more exercises, other training
plans, or other watch models. Please **never attach your `data/` folder or tokens** to an issue.

## License

[MIT](LICENSE). Use it, change it, share it.
