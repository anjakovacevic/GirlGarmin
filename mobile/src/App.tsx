/** GirlGarmin on your phone: the same dashboard as the website (app/dashboard.py), running
 * entirely on the phone. Data is downloaded straight from Garmin Connect into the app's private
 * storage; nothing goes anywhere else. */

import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import * as A from './analysis';
import { Garmin } from './garmin/api';
import { clearTokens, GarminAuthError, loadTokens, type Tokens } from './garmin/auth';
import { addDays, fmtDate, type ISODate, todayISO } from './lib/dates';
import { expoStore } from './lib/expoStore';
import { setStore, store } from './lib/store';
import { hasPlan, P, type PlanData } from './plan';
import { applyPlans, savePlans } from './planStore';
import * as progression from './progression';
import { sync, SyncCancelled } from './sync';
import { buildTables, EMPTY, loadTables } from './tables';
import * as workouts from './workouts';
import { Button, Notice, Section, Segmented } from './ui/components';
import type { Ctx, Page } from './ui/context';
import { type Job, JobSheet } from './ui/JobSheet';
import { LoginScreen } from './ui/LoginScreen';
import { BodyScreen } from './ui/screens/BodyScreen';
import { CycleScreen } from './ui/screens/CycleScreen';
import { RecoveryScreen } from './ui/screens/RecoveryScreen';
import { PlanScreen } from './ui/screens/PlanScreen';
import { TodayScreen } from './ui/screens/TodayScreen';
import { TrainingScreen } from './ui/screens/TrainingScreen';
import { ZonesScreen } from './ui/screens/ZonesScreen';
import { SettingsSheet, type WatchAction } from './ui/SettingsSheet';
import { BodyIcon, ChevronIcon, CycleIcon, GearIcon, RecoveryIcon, TodayIcon, TrainingIcon } from './ui/icons';
import { type Range, RANGES } from './ui/range';
import { useTheme } from './ui/theme';

setStore(expoStore());

/** When the last sync finished; the app syncs by itself on opening when that's over an hour ago. */
const LAST_SYNC = 'last_sync.json';
const QUIET_SYNC_AFTER_MS = 60 * 60 * 1000;

const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
/** "today at 14:05" / "18 Oct at 09:12" */
const syncedText = (ms: number) =>
  `${new Date(ms).toDateString() === new Date().toDateString() ? 'today' : fmtDate(todayISO(new Date(ms)), { weekday: false })} at ${clock(ms)}`;

const TABS = [
  ['Today', TodayScreen, TodayIcon], ['Training', TrainingScreen, TrainingIcon], ['Recovery', RecoveryScreen, RecoveryIcon],
  ['Cycle', CycleScreen, CycleIcon], ['Body', BodyScreen, BodyIcon],
] as const;

/** Pages opened from a tab, full screen with a back button. */
const PAGES: Record<Page, [string, (p: { c: Ctx }) => React.ReactNode]> = {
  plan: ['Plan', PlanScreen],
  zones: ['Heart-rate zones', ZonesScreen],
};

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);
  const [tokens, setTokens] = useState<Tokens | null>(null);
  const [data, setData] = useState<A.Data | null>(null);
  const [settings, setSettings] = useState<A.Settings>({});
  const [hrTests, setHrTestsState] = useState<A.HrTests>({});
  const [today, setToday] = useState(todayISO());
  const [tab, setTab] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [range, setRange] = useState<Range>('Month');
  const [job, setJob] = useState<Job | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [planVersion, setPlanVersion] = useState(0);
  const [plans, setPlans] = useState<PlanData[]>([]);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [quiet, setQuiet] = useState<string | null>(null); // what's running in the background ("Syncing")
  const [quietError, setQuietError] = useState<string | null>(null);
  const quietCancel = useRef(false);
  const watchPending = useRef(false); // plans changed while something else was running
  const afterPlanSave = useRef(() => {});

  const reload = useCallback(async () => {
    setSettings(await A.loadSettings());
    setPlans(await applyPlans());
    setHrTestsState(await A.loadHrTests());
    setData(await A.prepare(await loadTables()));
    setPlanVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    (async () => {
      setTokens(await loadTokens().catch(() => null));
      setLastSync((await store().read<{ at: number }>(LAST_SYNC).catch(() => null))?.at ?? null);
      await reload();
      setReady(true);
    })();
  }, [reload]);

  const ctx: Ctx | null = useMemo(() => {
    if (!data) return null;
    const info = data.cycles.length ? A.analyseCycles(data.daily, data.cycles) : [];
    const phases = info.length ? A.phaseByDate(data.daily, info) : new Map();
    // pred is for the Cycle tab, which is always about today (the Daily tab works out its own date's cycle day)
    return {
      d: data, today, info, phases, pred: A.predictCycle(info, todayISO()), sessions: data.sets.length ? A.liftSessions(data.sets) : [],
      settings, hrTests, range, plans, open: setPage,
      savePlans: async (next) => {
        await savePlans(next);
        await reload();
        afterPlanSave.current(); // the watch follows the plans
      },
      setGoal: (goal) => A.saveSetting('goal', goal).then(() => setSettings((s) => ({ ...s, goal }))),
      setHrTests: (tests) => A.saveHrTests(tests).then(A.loadHrTests).then(setHrTestsState),
    };
  }, [data, today, settings, hrTests, range, planVersion]);

  /** Run something that needs Garmin in the progress sheet; asks to sign in first if needed. */
  const garminJob = (title: string, fn: (api: Garmin, o: Parameters<Job['run']>[0]) => Promise<void>) => {
    if (!tokens) {
      setShowLogin(true);
      return;
    }
    setShowSettings(false);
    setJob({
      title,
      run: async (o) => {
        // read them fresh: Garmin may have replaced the tokens during the last job
        const fresh = await loadTokens();
        if (!fresh) throw new GarminAuthError('Sign in with Garmin first.');
        await fn(new Garmin(fresh), o);
      },
    });
  };

  const history = async () => {
    const d = await A.prepare(await loadTables());
    return progression.history(d.sets, d.activities);
  };

  const synced = async () => {
    const at = Date.now();
    await store().write(LAST_SYNC, { at });
    setLastSync(at);
    setQuietError(null);
  };

  const startSync = () => {
    quietCancel.current = true; // a background sync stops at its next request; this one picks up from there
    garminJob('Syncing with Garmin Connect', async (api, o) => {
      await sync(api, o);
      await reload();
      await workouts.syncWatch(api, await history(), o.log);
      await synced();
      o.log('Done.');
    });
  };

  /** Run Garmin work without the progress sheet ("Syncing" next to the gear); problems show as a
   * line under the header. Tapping Sync now stops it at its next request. */
  const runQuietly = async (label: string, failed: string, fn: (api: Garmin, o: { log: () => void; cancelled: () => boolean }) => Promise<void>) => {
    const fresh = await loadTokens();
    if (!fresh) return;
    quietCancel.current = false;
    setQuiet(label);
    try {
      await fn(new Garmin(fresh), { log: () => {}, cancelled: () => quietCancel.current });
    } catch (e) {
      if (e instanceof GarminAuthError) setQuietError('Garmin login expired - sign in again in Settings.');
      else if (!(e instanceof SyncCancelled)) setQuietError(`${failed}: ${(e as Error).message} Try Sync now in Settings.`);
    } finally {
      setQuiet(null);
    }
  };

  /** Sync without the progress sheet, when the app opens and the last sync is over an hour old.
   * Only after a first full sync (that one takes long and needs the app kept open). */
  const quietSync = async () => {
    if (!tokens || quiet || job || !lastSync || Date.now() - lastSync < QUIET_SYNC_AFTER_MS) return;
    watchPending.current = false; // the sync updates the watch anyway
    await runQuietly('Syncing', "Couldn't sync", async (api, o) => {
      await sync(api, o);
      await reload();
      await workouts.syncWatch(api, await history(), o.log, o.cancelled);
      await synced();
    });
  };

  /** After a plan change: put the change on the Garmin calendar (only once the plans are on the watch). */
  const updateWatch = async () => {
    if (!tokens || !(await workouts.loadManifest())) return;
    if (quiet || job) {
      watchPending.current = true; // runs when the current job is done
      return;
    }
    watchPending.current = false;
    await runQuietly('Updating watch', "Couldn't update your watch", async (api, o) => {
      await api.loadProfile();
      await workouts.syncWatch(api, await history(), o.log, o.cancelled);
    });
  };
  afterPlanSave.current = updateWatch;

  // a plan change that came in while something else ran
  useEffect(() => {
    if (!quiet && !job && watchPending.current) updateWatch();
  }, [quiet, job]);
  const quietSyncRef = useRef(quietSync);
  quietSyncRef.current = quietSync;

  // on opening the app, and on coming back to it
  useEffect(() => {
    if (!ready) return;
    quietSyncRef.current();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') quietSyncRef.current();
    });
    return () => sub.remove();
  }, [ready, tokens, lastSync]);

  const watch = (a: WatchAction) =>
    garminJob('Updating workouts on your watch', async (api, o) => {
      await api.loadProfile();
      const h = await history();
      if (a === 'upload') await workouts.createAll(api, h, o.log);
      else if (a === 'check') await workouts.syncWatch(api, h, o.log);
      else await workouts.deleteAll(api, o.log);
    });

  if (!ready || !ctx) {
    return (
      <View style={[st.center, { backgroundColor: t.bg }]}>
        <ActivityIndicator color={t.accent} size="large" />
      </View>
    );
  }

  const hasData = ctx.d.daily.length > 0;
  if (showLogin || (!tokens && !hasData)) {
    return (
      <>
        <StatusBar style="dark" />
        <LoginScreen
          onLoggedIn={(tk) => {
            setTokens(tk);
            setShowLogin(false);
          }}
          onCancel={hasData || showLogin ? () => setShowLogin(false) : undefined}
        />
      </>
    );
  }

  const Screen = TABS[tab][1];
  const isToday = today === todayISO();

  // settings sit at the end of each tab's heading; a background sync shows a small spinner next to it
  const settingsButton = (
    <View style={st.settings}>
      {quiet ? <ActivityIndicator color={t.accent} size="small" accessibilityLabel={quiet} /> : null}
      <Pressable onPress={() => setShowSettings(true)} hitSlop={10} style={st.iconBtn} accessibilityLabel="Settings">
        <GearIcon color={t.text} />
      </Pressable>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style="dark" />
      <ScrollView key={tab} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: 32, gap: 14 }}>
        {tab === 0 ? (
          <View style={st.dayRow}>
            <Pressable onPress={() => setToday(todayISO())} style={{ flex: 1 }} accessibilityLabel="Go back to today">
              <Text style={[st.kicker, { color: isToday ? t.accent : t.muted }]}>
                {isToday ? 'Today' : 'Tap to go back to today'}
              </Text>
              <Text style={[st.date, { color: t.text }]} numberOfLines={1} adjustsFontSizeToFit>
                {fmtDate(today, { weekday: 'long' })}
              </Text>
            </Pressable>
            <Pressable onPress={() => setToday(addDays(today, -1))} hitSlop={8} style={[st.dayBtn, { backgroundColor: t.card }]} accessibilityLabel="Previous day">
              <ChevronIcon color={t.text} dir="left" />
            </Pressable>
            <Pressable onPress={() => setToday(addDays(today, 1))} hitSlop={8} style={[st.dayBtn, { backgroundColor: t.card }]} accessibilityLabel="Next day">
              <ChevronIcon color={t.text} dir="right" />
            </Pressable>
            {settingsButton}
          </View>
        ) : (
          <>
            <View style={st.headRow}>
              <Text style={[st.date, { color: t.text, flex: 1 }]}>{TABS[tab][0]}</Text>
              {settingsButton}
            </View>
            <Segmented options={RANGES} value={range} onChange={setRange} stretch />
          </>
        )}
        {quietError ? <Text style={[st.sub, { color: t.bad }]}>{quietError}</Text> : null}
        {hasData ? (
          <Screen c={ctx} />
        ) : (
          <Section title="Download your Garmin data">
            <Notice text="The first sync takes a while (about 4 requests per day of history). Keep the app open until it's done." />
            <Button title="Sync with Garmin" onPress={startSync} />
          </Section>
        )}
      </ScrollView>

      <View style={[st.bottomBar, { backgroundColor: t.card, borderTopColor: t.border, paddingBottom: insets.bottom + 6 }]} accessibilityRole="tablist">
        {TABS.map(([name, , Icon], i) => {
          const on = i === tab;
          return (
            <Pressable key={name} onPress={() => setTab(i)} style={st.bottomTab} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={name}>
              <View style={[st.tabPill, on && { backgroundColor: t.accentSoft }]}>
                <Icon color={on ? t.accent : t.muted} size={22} />
                <Text style={{ color: on ? t.accent : t.muted, fontSize: 11.5, fontWeight: on ? '700' : '500' }}>{name}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {page ? (
        <Modal visible animationType="slide" onRequestClose={() => setPage(null)}>
          <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
            <View style={st.pageBar}>
              <Pressable onPress={() => setPage(null)} hitSlop={12} style={st.back} accessibilityRole="button" accessibilityLabel="Back">
                <ChevronIcon color={t.accent} dir="left" />
                <Text style={{ color: t.accent, fontSize: 16, fontWeight: '600' }}>Back</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 14 }}>
              <Text style={[st.date, { color: t.text }]}>{PAGES[page][0]}</Text>
              {React.createElement(PAGES[page][1], { c: ctx })}
            </ScrollView>
          </View>
        </Modal>
      ) : null}

      {showSettings ? (
        <SettingsSheet
          signedIn={!!tokens}
          lastSync={lastSync ? syncedText(lastSync) : null}
          syncing={quiet === 'Syncing'}
          onSync={startSync}
          onClose={() => setShowSettings(false)}
          onLogin={() => {
            setShowSettings(false);
            setShowLogin(true);
          }}
          onLogout={async () => {
            await clearTokens();
            setTokens(null);
          }}
          onWatch={watch}
          onRebuild={() => {
            setShowSettings(false);
            setJob({ title: 'Rebuilding tables', run: async (o) => { await buildTables(o.log); await reload(); } });
          }}
          onWipe={async () => {
            await store().remove('raw');
            await store().remove('tables.json');
            await store().remove('settings.json');
            await store().remove('hr_tests.json');
            await store().remove('garmin_workouts.json');
            setShowSettings(false);
            setData(await A.prepare(EMPTY));
            await reload();
          }}
        />
      ) : null}

      {job ? (
        <JobSheet
          job={job}
          onClose={() => setJob(null)}
          onAuthError={async () => {
            setJob(null);
            await clearTokens();
            setTokens(null);
            setShowLogin(true);
          }}
        />
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  settings: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 2 },
  iconBtn: { padding: 8, marginRight: -8 },
  dayRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 2 },
  kicker: { fontSize: 13, fontWeight: '600' },
  date: { fontSize: 30, fontWeight: '700', letterSpacing: -0.8, marginTop: 1 },
  dayBtn: { borderRadius: 999, width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  sub: { fontSize: 12.5, lineHeight: 17 },
  bottomBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6 },
  bottomTab: { flex: 1, alignItems: 'center' },
  tabPill: { minWidth: 64, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 16, alignItems: 'center', gap: 2 },
  pageBar: { paddingHorizontal: 12, paddingVertical: 8 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2 },
});
