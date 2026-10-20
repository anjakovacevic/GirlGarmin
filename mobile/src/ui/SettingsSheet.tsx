import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadManifest } from '../workouts';
import { Button, Caption, Section } from './components';
import { useTheme } from './theme';

export type WatchAction = 'upload' | 'check' | 'delete';

export interface SettingsProps {
  signedIn: boolean;
  lastSync: string | null; // "today at 14:05"
  syncing: boolean; // a background sync is running
  onSync: () => void;
  onClose: () => void;
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
  const [onWatch, setOnWatch] = useState<number | null>(null);
  useEffect(() => {
    loadManifest().then((m) => setOnWatch(m ? m.workouts.length : 0));
  }, []);
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
          <Section title="Workouts on your watch">
            <Caption>
              Puts your plans on your Garmin calendar, so every session syncs to your watch: exercises, reps and target weights,
              with warm-up and rest ending when you press lap. Cardio uses your Garmin heart-rate zones.
            </Caption>
            {!onWatch ? (
              <>
                <Text style={{ color: t.text, fontSize: 15 }}>{onWatch === null ? '' : 'Not on your watch yet.'}</Text>
                <Button title="Put my plans on my watch" onPress={needLogin(() => p.onWatch('upload'))} />
              </>
            ) : (
              <>
                <Text style={{ color: t.text, fontSize: 15 }}>
                  On your watch. It follows your plans by itself: changes in the Plan tab, a plan ending or the next one starting
                  reach the calendar right away, and every sync updates the coming week's target weights.
                </Text>
                <Button kind="secondary" title="Check the watch now" onPress={needLogin(() => p.onWatch('check'))} />
                <Button
                  kind="danger"
                  title="Remove my plans from the watch"
                  onPress={needLogin(() => confirm('Remove workouts?', 'Deletes every workout this phone uploaded and stops updating the watch (recorded activities are never touched).', 'Remove', () => p.onWatch('delete'), true))}
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
});
