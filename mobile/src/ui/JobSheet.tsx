/** Full-screen progress log for long jobs (sync, putting workouts on the watch). Keeps the screen
 * on while it runs; leaving the app pauses the job, and a sync picks up where it stopped. */

import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GarminAuthError } from '../garmin/auth';
import { SyncCancelled } from '../sync';
import { Button } from './components';
import { useTheme } from './theme';

export interface Job {
  title: string;
  run: (o: { log: (s: string) => void; progress: (f: number) => void; cancelled: () => boolean }) => Promise<void>;
}

export function JobSheet({ job, onClose, onAuthError }: { job: Job; onClose: (ok: boolean) => void; onAuthError: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [lines, setLines] = useState<string[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [state, setState] = useState<'running' | 'done' | 'failed' | 'auth'>('running');
  const cancel = useRef(false);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    const log = (s: string) => setLines((l) => [...l.slice(-300), s]);
    activateKeepAwakeAsync('job').catch(() => {});
    job
      .run({ log, progress: setProgress, cancelled: () => cancel.current })
      .then(() => setState('done'))
      .catch((e) => {
        if (e instanceof SyncCancelled) log('Stopped. Everything downloaded so far is kept.');
        else log(`Error: ${(e as Error).message}`);
        setState(e instanceof GarminAuthError ? 'auth' : 'failed');
      })
      .finally(() => deactivateKeepAwake('job'));
  }, []);

  const label = { running: job.title + '...', done: 'Finished', failed: 'Stopped - see the log', auth: 'Garmin login needed' }[state];

  return (
    <Modal visible animationType="slide" onRequestClose={() => { if (state !== 'running') onClose(state === 'done'); }}>
      <View style={[st.wrap, { backgroundColor: t.bg, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
        <Text style={[st.title, { color: t.text }]}>{label}</Text>
        {state === 'running' ? (
          <View style={[st.track, { backgroundColor: t.accentSoft }]}>
            <View style={[st.fill, { backgroundColor: t.accent, width: progress === null ? '15%' : `${Math.round(progress * 100)}%` }]} />
          </View>
        ) : null}
        <ScrollView
          ref={scroll}
          style={[st.log, { backgroundColor: t.card }]}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
        >
          {lines.map((l, i) => (
            <Text key={i} style={[st.line, { color: l.startsWith('Error') ? t.bad : t.text }]}>{l}</Text>
          ))}
        </ScrollView>
        {state === 'running' ? (
          <Button kind="secondary" title="Stop" onPress={() => { cancel.current = true; }} />
        ) : state === 'auth' ? (
          <Button title="Sign in again" onPress={onAuthError} />
        ) : (
          <Button title="Close" onPress={() => onClose(state === 'done')} />
        )}
        {state === 'running' ? <Text style={{ color: t.muted, fontSize: 12.5, textAlign: 'center' }}>Keep the app open - the screen stays on until it's done.</Text> : null}
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 16, gap: 14 },
  title: { fontSize: 24, fontWeight: '700', letterSpacing: -0.5 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  log: { flex: 1, borderRadius: 20, padding: 14 },
  line: { fontSize: 12, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), lineHeight: 19 },
});
