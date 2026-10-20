# GirlGarmin for Android (and later iOS) 📱

The same dashboard as the GirlGarmin website, as a phone app. It runs entirely on your phone: it
downloads your data straight from Garmin Connect into the app's private storage and does every
calculation on the phone. No server, no cloud, no account other than your Garmin one.

It's built with [Expo](https://expo.dev) (React Native + TypeScript), so the same code runs on
Android today and on iPhone too.

> ⚠️ Not medical advice, and **not suitable for contraception**. The cycle predictions are
> estimates.

## What you need

- **Node.js 22 or newer** on your computer ([nodejs.org](https://nodejs.org), the "LTS" version).
- An **Android phone**, and on it the free **Expo Go** app from the Play Store.
- The phone and the computer on the **same Wi-Fi**.

## Run it on your phone

```bash
git clone https://github.com/anjakovacevic/GirlGarmin.git
cd GirlGarmin/mobile
npm install
npx expo start
```

A QR code appears in the terminal. Open **Expo Go** on the phone, tap **Scan QR code** and scan
it. The app opens on the phone.

- If the phone can't connect (some routers block it), use `npx expo start --tunnel` instead.
- Expo Go loads the app from your computer, so `npx expo start` must be running when you open it.
  For an app that works on its own, build an APK (below).

## First steps in the app

1. Tap **Sign in with Garmin**. You type your email and password on **Garmin's own sign-in page**
   (the same one the Garmin Connect app uses). GirlGarmin never sees your password, and two-step
   verification works as usual.
2. Tap **Sync**. The first download takes a while (about 4 requests per day of history, with
   pauses so Garmin doesn't block you). Keep the app open; the screen stays on. If you stop it,
   the next sync continues where it stopped. Later syncs take a minute or two.
3. **Settings** (⚙︎): pick the Monday your plan starts, and optionally put the plan on your watch.

## Build an app that runs without the computer (APK)

Pick one:

- **In the cloud (easiest, no Android tools needed):** create a free account at
  [expo.dev](https://expo.dev), then run `npm run build:apk`. When it finishes you get a link to
  an `.apk`; open it on the phone and install it (allow "install unknown apps" when asked).
- **On your computer:** install [Android Studio](https://developer.android.com/studio), connect
  the phone with USB debugging on, then run `npm run apk:local`.

The installed app keeps its data until you uninstall it.

## iPhone

Expo Go on an iPhone works the same way today: scan the QR code with the camera app. A
stand-alone iPhone app needs an Apple developer account and `npx eas-cli build --platform ios`.
Nothing in the code is Android-only.

## Your training plan

The app uses `src/plans/myPlan.ts` if it exists, otherwise `src/plans/examplePlan.ts`.
`myPlan.ts` is git-ignored, so your numbers stay private. To make one, copy `examplePlan.ts` to
`myPlan.ts` and edit it, then restart `npx expo start`.

Each exercise line has the same order as `Ex(...)` in the Python plan
(`girlgarmin/plans/example_plan.py`), so you can copy numbers across:

```ts
// ex(name, sets, rep_lo, rep_hi, start_reps, start_kg, inc_kg, rest_s, rir, garmin_category, garmin_name, {options})
ex('Barbell hip thrust', 4, 6, 10, 8, 60, 5, 150, '1-2', 'HIP_RAISE', 'BARBELL_HIP_THRUST_WITH_BENCH', { note: 'Pause 1 s at the top.' }),
```

## Privacy

- Your Garmin **password never reaches the app**: you sign in on Garmin's page, and Garmin
  hands back a one-time ticket that the app swaps for a login token.
- The token is kept in the phone's **secure storage** (Android Keystore / iOS Keychain).
  **Settings -> Log out** deletes it.
- Downloaded data lives in the app's private folder, which other apps can't read.
  **Settings -> Delete all data on this phone** removes it; uninstalling the app does too.
- The app only talks to Garmin (`*.garmin.com`). There is no analytics or tracking.

## Can't sign in?

Garmin sometimes changes its sign-in. If the in-app sign-in fails, you can reuse the login from
the computer: on the sign-in screen open **Advanced: use the login from your computer** and paste
the contents of `.garminconnect/garmin_tokens.json` from your user folder (created by
`python -m girlgarmin.login`).

## How it's built

```
mobile/
├── index.ts                 # entry point
├── metro.config.js          # picks myPlan.ts or examplePlan.ts as '@plan'
├── eas.json                 # cloud build profiles (APK)
└── src/
    ├── App.tsx              # header, date, tabs, sync / settings
    ├── garmin/auth.ts       # sign-in ticket -> tokens, refresh, secure storage
    ├── garmin/api.ts        # Garmin Connect API calls (same endpoints as the Python library)
    ├── sync.ts              # incremental download (girlgarmin/sync.py)
    ├── tables.ts            # raw JSON -> tables (sync.py build_tables)
    ├── analysis.ts          # calculations and predictions (girlgarmin/analysis.py)
    ├── progression.ts       # next targets from what you lifted (girlgarmin/progression.py)
    ├── workouts.ts          # plan -> watch workouts (girlgarmin/workouts.py)
    ├── plan.ts, plans/      # plan format + example plan
    ├── lib/                 # dates, stats helpers, storage
    └── ui/                  # screens (one per dashboard tab), chart, components
```

The calculations are a line-by-line port of the Python package and were checked against it on
real data: lift forecasts, plan vs actual, every future target, cycle detection and prediction,
recovery advice, heart-rate zone advice, sleep tips and zone minutes all give the same results.

Check the code with `npm run typecheck` and `npx expo-doctor`.
