import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addDays, fmtDate, type ISODate } from '../lib/dates';
import { P } from '../plan';
import { loadManifest } from '../workouts';
import { Button, Caption, Section } from './components';
import { ChevronIcon } from './icons';
import { useTheme } from './theme';

export type WatchAction = 'upload' | 'refresh' | 'strength' | 'cardio' | 'extend' | 'delete';

export interface SettingsProps {
  signedIn: boolean;
  lastSync: string | null; // "today at 14:05"
  syncing: boolean; // a background sync is running
  onSync: () => void;
  onClose: () => void;
  onPlanStart: (d: ISODate) => void;
  onLogin: () => void;
  onLogout: () => void;
  onWatch: (a: WatchAction) => void;
  onRebuild: () => void;
  onWipe: () => void;
}

const confirm = (title: string, text: string, ok: string, run: () => void, destructive = false) =>
  Alert.alert(title, text, [{ text: 'Cancel', style: 'cancel' }, { text: ok, style: destructive ? 'destructive' : 'default', onPress: run }]);

export function SettingsSheet(p: SettingsProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [start, setStart] = useState(P().start);
  const [onWatch, setOnWatch] = useState<number | null>(null);
  useEffect(() => {
    loadManifest().then((m) => setOnWatch(m ? m.workouts.length : 0));
  }, []);
  const plan = P();
  const needLogin = (fn: () => void) => () => (p.signedIn ? fn() : p.onLogin());

  return (
    <Modal visible animationType="slide" onRequestClose={p.onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
        <View style={st.bar}>
          <Text style={{ color: t.text, fontWeight: '700', fontSize: 24, letterSpacing: -0.5 }}>Settings</Text>
          <Pressable onPress={p.onClose} hitSlop={12}>
            <Text style={{ color: t.accent, fontSize: 16, fontWeight: '700' }}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 24 }}>
          <Section title="Training plan">
            <Text style={{ color: t.text, fontSize: 15 }}>
              {plan.weeks} weeks, {plan.sessions.length} lifting sessions a week. Edit it in mobile/src/plans/ (myPlan.ts if you have
              one, else examplePlan.ts).
            </Text>
            <Text style={[st.label, { color: t.muted }]}>Week 1 starts on (Monday)</Text>
            <View style={st.stepper}>
              <Pressable onPress={() => setStart(addDays(start, -7))} style={[st.step, { backgroundColor: t.surface }]} accessibilityLabel="A week earlier">
                <ChevronIcon color={t.text} dir="left" />
              </Pressable>
              <Text style={{ color: t.text, fontSize: 16, fontWeight: '700', flex: 1, textAlign: 'center' }}>
                {fmtDate(start, { year: true })}
              </Text>
              <Pressable onPress={() => setStart(addDays(start, 7))} style={[st.step, { backgroundColor: t.surface }]} accessibilityLabel="A week later">
                <ChevronIcon color={t.text} dir="right" />
              </Pressable>
            </View>
            {start !== plan.start ? <Button title="Save plan start" onPress={() => p.onPlanStart(start)} /> : null}
            <Caption>Plan runs {fmtDate(plan.start)} - {fmtDate(plan.end, { year: true })}. Moving the start moves the whole plan.</Caption>
          </Section>

          <Section title="Workouts on your watch">
            <Caption>
              Puts every planned session on your Garmin calendar, so it syncs to your watch: exercises, reps and target weights, with
              warm-up and rest ending when you press lap. Cardio uses your Garmin heart-rate zones. After every sync, the coming
              week's strength workouts are updated with targets from what you just lifted.
            </Caption>
            <Text style={{ color: t.text, fontSize: 15 }}>
              {onWatch === null ? '' : onWatch ? `${onWatch} workouts uploaded from this phone.` : 'Nothing uploaded from this phone yet.'}
            </Text>
            {!onWatch ? (
              <Button title="Put the plan on my watch" onPress={needLogin(() => p.onWatch('upload'))} />
            ) : (
              <>
                <Button kind="secondary" title="Update the next 7 days" onPress={needLogin(() => p.onWatch('refresh'))} />
                <Button kind="secondary" title="Re-upload strength workouts from today" onPress={needLogin(() => p.onWatch('strength'))} />
                <Button kind="secondary" title="Re-upload cardio workouts from today" onPress={needLogin(() => p.onWatch('cardio'))} />
                <Button kind="secondary" title="Add plan days not on the watch yet" onPress={needLogin(() => p.onWatch('extend'))} />
                <Button
                  kind="danger"
                  title="Remove the plan from my watch"
                  onPress={needLogin(() => confirm('Remove workouts?', 'Deletes every workout this phone uploaded (recorded activities are never touched).', 'Remove', () => p.onWatch('delete'), true))}
                />
              </>
            )}
            <Caption>
              Workouts uploaded from the computer (python -m girlgarmin.workouts) are tracked there; remove those from the computer.
            </Caption>
          </Section>

          <Section title="Garmin account">
            {p.signedIn ? (
              <>
                <Caption>
                  The app syncs by itself when you open it, at most once an hour.
                  {p.syncing ? ' Syncing now...' : p.lastSync ? ` Last synced ${p.lastSync}.` : ''}
                </Caption>
                <Button title="Sync now" onPress={p.onSync} />
                <Button kind="secondary" title="Log out" onPress={() => confirm('Log out?', "Deletes the login token from this phone. Your downloaded data stays.", 'Log out', p.onLogout)} />
              </>
            ) : (
              <Button title="Sign in with Garmin" onPress={p.onLogin} />
            )}
          </Section>

          <Section title="Your data">
            <Caption>
              Everything is stored inside this app on this phone only. Uninstalling the app deletes it. Nothing is sent anywhere except
              requests to Garmin Connect.
            </Caption>
            <Button kind="secondary" title="Rebuild tables from downloaded data" onPress={p.onRebuild} />
            <Button
              kind="danger"
              title="Delete all data on this phone"
              onPress={() => confirm('Delete all data?', 'Removes everything downloaded from Garmin and your settings from this phone. Your Garmin account is not touched.', 'Delete', p.onWipe, true)}
            />
          </Section>
          <Caption>Not medical advice, and not suitable for contraception. The cycle predictions are estimates.</Caption>
        </ScrollView>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  label: { fontSize: 12.5, marginTop: 4 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  step: { borderRadius: 999, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
