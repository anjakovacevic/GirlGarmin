/** GirlGarmin on your phone: the same dashboard as the website (app/dashboard.py), running
 * entirely on the phone. Data is downloaded straight from Garmin Connect into the app's private
 * storage; nothing goes anywhere else. */

import planDef from '@plan';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import * as A from './analysis';
import { Garmin } from './garmin/api';
import { clearTokens, GarminAuthError, loadTokens, type Tokens } from './garmin/auth';
import { addDays, fmtDate, type ISODate, todayISO } from './lib/dates';
import { expoStore } from './lib/expoStore';
import { setStore, store } from './lib/store';
import { defaultStart, makePlan, P, setPlan } from './plan';
import * as progression from './progression';
import { sync } from './sync';
import { buildTables, EMPTY, loadTables } from './tables';
import * as workouts from './workouts';
import { Button, Notice, Section, Segmented } from './ui/components';
import type { Ctx } from './ui/context';
import { type Job, JobSheet } from './ui/JobSheet';
import { LoginScreen } from './ui/LoginScreen';
import { BodyScreen } from './ui/screens/BodyScreen';
import { CardioScreen } from './ui/screens/CardioScreen';
import { CycleScreen } from './ui/screens/CycleScreen';
import { RecoveryScreen } from './ui/screens/RecoveryScreen';
import { SleepScreen } from './ui/screens/SleepScreen';
import { TodayScreen } from './ui/screens/TodayScreen';
import { TrainingScreen } from './ui/screens/TrainingScreen';
import { ZonesScreen } from './ui/screens/ZonesScreen';
import { SettingsSheet, type WatchAction } from './ui/SettingsSheet';
import { ChevronIcon, GearIcon, SyncIcon } from './ui/icons';
import { type Range, RANGES } from './ui/range';
import { useTheme } from './ui/theme';

setStore(expoStore());

const TABS = [
  ['Daily', TodayScreen], ['Training', TrainingScreen], ['Body & diet', BodyScreen], ['Recovery', RecoveryScreen],
  ['Sleep', SleepScreen], ['Cycle', CycleScreen], ['Cardio & VO2max', CardioScreen], ['Heart-rate zones', ZonesScreen],
] as const;

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

/** The plan with week 1 on the saved start date (fixed on first launch so the plan doesn't drift). */
async function loadPlan(): Promise<A.Settings> {
  let settings = await A.loadSettings();
  if (!settings.planStart) {
    await A.saveSetting('planStart', planDef.start ?? defaultStart());
    settings = await A.loadSettings();
  }
  setPlan(makePlan(planDef, settings.planStart as ISODate));
  return settings;
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
  const [range, setRange] = useState<Range>('Month');
  const [job, setJob] = useState<Job | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [planVersion, setPlanVersion] = useState(0);

  const reload = useCallback(async () => {
    setSettings(await loadPlan());
    setHrTestsState(await A.loadHrTests());
    setData(await A.prepare(await loadTables()));
    setPlanVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    (async () => {
      setTokens(await loadTokens().catch(() => null));
      await reload();
      setReady(true);
    })();
  }, [reload]);

  const ctx: Ctx | null = useMemo(() => {
    if (!data) return null;
    const info = data.cycles.length ? A.analyseCycles(data.daily, data.cycles) : [];
    const phases = info.length ? A.phaseByDate(data.daily, info) : new Map();
    return {
      d: data, today, info, phases, pred: A.predictCycle(info, today), sessions: data.sets.length ? A.liftSessions(data.sets) : [],
      settings, hrTests, range,
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

  const startSync = () =>
    garminJob('Syncing with Garmin Connect', async (api, o) => {
      await sync(api, o);
      await reload();
      await workouts.refresh(api, await history(), o.log);
      o.log('Done.');
    });

  const watch = (a: WatchAction) =>
    garminJob('Updating workouts on your watch', async (api, o) => {
      await api.loadProfile();
      const h = await history();
      if (a === 'upload') await workouts.createAll(api, h, o.log);
      else if (a === 'refresh') await workouts.refresh(api, h, o.log);
      else if (a === 'strength' || a === 'cardio') await workouts.replace(api, h, a, o.log);
      else if (a === 'extend') await workouts.extend(api, h, o.log);
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
  const last = hasData ? ctx.d.daily[ctx.d.daily.length - 1].date : null;
  const startsSoon = todayISO() < P().firstDay;
  const isToday = today === todayISO();

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style="dark" />
      <View style={[st.header, { paddingTop: insets.top + 6, backgroundColor: t.bg }]}>
        <View style={st.titleRow}>
          <Text style={[st.brand, { color: t.text }]}>GirlGarmin</Text>
          <Pressable onPress={startSync} style={({ pressed }) => [st.syncBtn, { backgroundColor: t.card, opacity: pressed ? 0.7 : 1 }]} hitSlop={6}>
            <SyncIcon color={t.accent} size={17} />
            <Text style={{ color: t.text, fontWeight: '600', fontSize: 14 }}>Sync</Text>
          </Pressable>
          <Pressable onPress={() => setShowSettings(true)} hitSlop={10} style={st.iconBtn} accessibilityLabel="Settings">
            <GearIcon color={t.text} />
          </Pressable>
        </View>

        <Text style={[st.sub, { color: t.muted }]} numberOfLines={2}>
          {last ? `Synced up to ${fmtDate(last, { weekday: false })}. ` : ''}Plan {fmtDate(P().firstDay, { weekday: false })} to {fmtDate(P().end, { weekday: false, year: true })}
          {startsSoon ? ' (starts soon, change it in Settings)' : ''}
        </Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.tabs} style={[st.tabBar, { borderBottomColor: t.border }]}>
          {TABS.map(([name], i) => (
            <Pressable key={name} onPress={() => setTab(i)} style={[st.tab, { borderBottomColor: i === tab ? t.accent : 'transparent' }]}>
              <Text style={{ color: i === tab ? t.text : t.muted, fontWeight: i === tab ? '700' : '500', fontSize: 14.5 }}>{name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <ScrollView key={tab} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 14 }}>
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
          </View>
        ) : (
          <Segmented options={RANGES} value={range} onChange={setRange} stretch />
        )}
        {hasData ? (
          <Screen c={ctx} />
        ) : (
          <Section title="Download your Garmin data">
            <Notice text="The first sync takes a while (about 4 requests per day of history). Keep the app open until it's done." />
            <Button title="Sync with Garmin" onPress={startSync} />
          </Section>
        )}
      </ScrollView>

      {showSettings ? (
        <SettingsSheet
          signedIn={!!tokens}
          onClose={() => setShowSettings(false)}
          onPlanStart={async (d) => {
            await A.saveSetting('planStart', d);
            await reload();
          }}
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
  header: { paddingHorizontal: 16, gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  brand: { flex: 1, fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  syncBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  iconBtn: { padding: 8 },
  dayRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 2 },
  kicker: { fontSize: 13, fontWeight: '600' },
  date: { fontSize: 30, fontWeight: '700', letterSpacing: -0.8, marginTop: 1 },
  dayBtn: { borderRadius: 999, width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  sub: { fontSize: 12.5, lineHeight: 17 },
  tabBar: { marginHorizontal: -16, borderBottomWidth: StyleSheet.hairlineWidth, flexGrow: 0 },
  tabs: { gap: 20, paddingHorizontal: 16 },
  tab: { paddingTop: 6, paddingBottom: 10, borderBottomWidth: 2 },
});
