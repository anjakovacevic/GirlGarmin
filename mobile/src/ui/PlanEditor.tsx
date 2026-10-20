/** Full-screen editor for one saved plan: name and length, the week layout (what's on each day),
 * the sessions with their exercises, and the cardio details. Changes apply only on Save. */

import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { WEEKDAYS_LONG } from '../lib/dates';
import { fmtG } from '../lib/stats';
import {
  blankExercise, CARDIO_CHOICES, clash, type CardioSport, type Ex, intervalsFor, newId, type PlanData, type SessionData,
} from '../plan';
import { Button, Caption, Expander, Notice, NumberField, Section, Select, Stepper, TextField, Toggle } from './components';
import { ChevronIcon } from './icons';
import { useTheme } from './theme';

const NO_SESSION = 'none';
const SPORTS: CardioSport[] = ['running', 'cycling', 'walking'];

/** Garmin exercises to pick from: from every saved plan and from your logged sets. */
export type KnownExercise = { category: string; name: string };

export function PlanEditor({ plan, plans, known, onSave, onClose }: {
  plan: PlanData; plans: PlanData[]; known: KnownExercise[]; onSave: (p: PlanData) => void; onClose: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [p, setP] = useState<PlanData>(plan);
  const [editing, setEditing] = useState<{ session: string; index: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<PlanData>) => setP((x) => ({ ...x, ...patch }));
  const setSession = (id: string, patch: Partial<SessionData>) =>
    setP((x) => ({ ...x, sessions: x.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));

  const sessionTitle = (id: string) => (id === NO_SESSION ? 'No lifting' : p.sessions.find((s) => s.id === id)?.title || 'Untitled session');
  const exceptions = Object.entries(p.overrides).filter(([w]) => Number(w) <= p.weeks);

  function addSession() {
    const s: SessionData = { id: newId(), weekday: 0, title: `Session ${p.sessions.length + 1}`, warmup: '', exercises: [] };
    set({ sessions: [...p.sessions, s] });
  }

  function removeSession(id: string) {
    const clear = (d: [string | null, string | null]): [string | null, string | null] => [d[0] === id ? null : d[0], d[1]];
    set({
      sessions: p.sessions.filter((s) => s.id !== id),
      template: Object.fromEntries(Object.entries(p.template).map(([wd, d]) => [wd, clear(d)])),
      overrides: Object.fromEntries(Object.entries(p.overrides).map(([w, o]) => [w, Object.fromEntries(Object.entries(o).map(([wd, d]) => [wd, clear(d)]))])),
    });
  }

  function moveExercise(s: SessionData, i: number, d: number) {
    const ex = [...s.exercises];
    [ex[i], ex[i + d]] = [ex[i + d], ex[i]];
    setSession(s.id, { exercises: ex });
  }

  function save() {
    const titles = p.sessions.map((s) => s.title.trim());
    const problem =
      !p.name.trim() ? 'Give the plan a name.'
      : titles.some((x) => !x) ? 'Every session needs a name.'
      : new Set(titles).size !== titles.length ? 'Two sessions have the same name - the app tells them apart by name.'
      : p.sessions.flatMap((s) => s.exercises).find((e) => !e.name.trim()) ? 'Every exercise needs a name.'
      : (() => {
        const e = p.sessions.flatMap((s) => s.exercises).find((x) => !x.garminCategory.trim());
        return e ? `Pick the Garmin exercise for "${e.name}" - it's how the app matches your logged sets and builds watch workouts.` : null;
      })()
      ?? (p.start ? (() => {
        const other = clash(plans, p, p.start);
        return other ? `With ${p.weeks} weeks this plan would overlap "${other}". Shorten it, or move one of them in the Plan tab.` : null;
      })() : null);
    if (problem) {
      setError(problem);
      return;
    }
    onSave({ ...p, name: p.name.trim(), sessions: p.sessions.map((s) => ({ ...s, title: s.title.trim() })), deloadWeeks: p.deloadWeeks.filter((w) => w <= p.weeks) });
  }

  const editingSession = editing ? p.sessions.find((s) => s.id === editing.session) : null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[st.bar, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={{ color: t.muted, fontSize: 16, fontWeight: '600' }}>Cancel</Text>
          </Pressable>
          <Text style={{ color: t.text, fontWeight: '700', fontSize: 17 }} numberOfLines={1}>Edit plan</Text>
          <Pressable onPress={save} hitSlop={12}>
            <Text style={{ color: t.accent, fontSize: 16, fontWeight: '700' }}>Save</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
          {error ? <Notice tone="error" text={error} /> : null}

          <Section title="Basics">
            <TextField label="Name" value={p.name} onChange={(name) => set({ name })} />
            <Stepper label="Weeks" value={p.weeks} onChange={(weeks) => set({ weeks })} min={1} max={52} />
            <Text style={[st.label, { color: t.text }]}>Lighter weeks</Text>
            <View style={st.chips}>
              {Array.from({ length: p.weeks }, (_, i) => i + 1).map((w) => {
                const on = p.deloadWeeks.includes(w);
                return (
                  <Pressable
                    key={w}
                    onPress={() => set({ deloadWeeks: on ? p.deloadWeeks.filter((x) => x !== w) : [...p.deloadWeeks, w].sort((a, b) => a - b) })}
                    style={[st.chip, { backgroundColor: on ? t.accentSoft : t.surface }]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`Week ${w} lighter`}
                  >
                    <Text style={{ color: on ? t.accent : t.muted, fontWeight: on ? '700' : '500', fontSize: 13.5 }}>{w}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Caption>Lighter weeks use fewer sets and easier loads, and don't count for progression.</Caption>
          </Section>

          <Section title="Week layout">
            <Caption>What's on each day, every week of the plan.</Caption>
            {WEEKDAYS_LONG.map((day, wd) => {
              const [sid, kind] = p.template[wd] ?? [null, null];
              return (
                <View key={day} style={{ gap: 6 }}>
                  <Text style={[st.label, { color: t.text }]}>{day}</Text>
                  <View style={st.dayRow}>
                    <View style={{ flex: 1 }}>
                      <Select
                        options={[NO_SESSION, ...p.sessions.map((s) => s.id)]}
                        value={sid ?? NO_SESSION}
                        format={sessionTitle}
                        onChange={(v) => set({ template: { ...p.template, [wd]: [v === NO_SESSION ? null : v, kind] } })}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Select
                        options={CARDIO_CHOICES.map(([k]) => k)}
                        value={kind ?? 'none'}
                        format={(k) => CARDIO_CHOICES.find(([x]) => x === k)?.[1] ?? k}
                        onChange={(v) => set({ template: { ...p.template, [wd]: [sid, v === 'none' ? null : v] } })}
                      />
                    </View>
                  </View>
                </View>
              );
            })}
            {exceptions.length ? (
              <Caption>
                {exceptions.length} {exceptions.length === 1 ? 'week has' : 'weeks have'} its own changes (weeks {exceptions.map(([w]) => w).join(', ')}), kept as
                they are.
              </Caption>
            ) : null}
          </Section>

          <Section title="Sessions">
            {!p.sessions.length ? <Caption>No sessions yet. Add one, then put it on a day in the week layout.</Caption> : null}
            {p.sessions.map((s) => (
              <Expander key={s.id} title={`${s.title || 'Untitled session'} · ${s.exercises.length} exercises`}>
                <TextField label="Name" value={s.title} onChange={(title) => setSession(s.id, { title })}
                  help="Workouts on the watch are named after it, so the app can tell which session you did." />
                <TextField label="Warm-up" value={s.warmup} onChange={(warmup) => setSession(s.id, { warmup })} multiline />
                <TextField label="After lifting (optional)" value={s.cardioAfter ?? ''} onChange={(cardioAfter) => setSession(s.id, { cardioAfter: cardioAfter || undefined })} />
                {s.exercises.map((e, i) => (
                  <View key={i} style={[st.exRow, { borderTopColor: t.border }]}>
                    <Pressable style={{ flex: 1, gap: 2 }} onPress={() => setEditing({ session: s.id, index: i })} accessibilityRole="button" accessibilityHint="Edit exercise">
                      <Text style={{ color: t.text, fontSize: 15, fontWeight: '600' }}>{e.name}</Text>
                      <Text style={{ color: t.muted, fontSize: 13 }}>
                        {e.sets} × {e.repLo}-{e.repHi}{e.perLeg ? ' /side' : ''} · {e.startKg === null ? 'bodyweight' : `starts at ${fmtG(e.startKg)} kg`}
                      </Text>
                    </Pressable>
                    <Pressable onPress={() => moveExercise(s, i, -1)} disabled={i === 0} hitSlop={6} style={[st.mini, { opacity: i === 0 ? 0.3 : 1 }]} accessibilityLabel="Move up">
                      <ChevronIcon color={t.text} dir="up" size={16} />
                    </Pressable>
                    <Pressable onPress={() => moveExercise(s, i, 1)} disabled={i === s.exercises.length - 1} hitSlop={6}
                      style={[st.mini, { opacity: i === s.exercises.length - 1 ? 0.3 : 1 }]} accessibilityLabel="Move down">
                      <ChevronIcon color={t.text} dir="down" size={16} />
                    </Pressable>
                  </View>
                ))}
                <Button kind="secondary" title="Add exercise" onPress={() => setEditing({ session: s.id, index: null })} />
                <Button kind="danger" title="Remove session" onPress={() => removeSession(s.id)} />
              </Expander>
            ))}
            <Button kind="secondary" title="Add session" onPress={addSession} />
          </Section>

          <Section title="Cardio">
            <Select label="VO2max intervals are recorded as" options={SPORTS} value={p.intervalSport} onChange={(intervalSport) => set({ intervalSport })} />
            <Select label="Zone-2 walks are recorded as" options={SPORTS} value={p.zone2Sport} onChange={(zone2Sport) => set({ zone2Sport })} />
            <Expander title="Hard intervals per week">
              {Array.from({ length: p.weeks }, (_, i) => i + 1).map((w) => {
                const [n, secs] = intervalsFor(p, w);
                return (
                  <View key={w} style={{ gap: 4 }}>
                    <Text style={[st.label, { color: t.text }]}>Week {w}</Text>
                    <Stepper label="Intervals" value={n} min={1} max={12} onChange={(v) => set({ intervals: { ...p.intervals, [w]: [v, secs] } })} />
                    <Stepper label="Minutes each" value={Math.round(secs / 60)} min={1} max={10}
                      onChange={(v) => set({ intervals: { ...p.intervals, [w]: [n, v * 60] } })} />
                  </View>
                );
              })}
            </Expander>
            <Expander title="Cardio descriptions">
              <TextField label="VO2max intervals" value={p.intervalsText} onChange={(intervalsText) => set({ intervalsText })} multiline
                help="{n} becomes the number of hard intervals, {min} the minutes each." />
              <TextField label="Zone-2 walk" value={p.zone2Walk} onChange={(zone2Walk) => set({ zone2Walk })} multiline help="{m} becomes the minutes." />
              <TextField label="VO2max check run" value={p.outdoorTest} onChange={(outdoorTest) => set({ outdoorTest })} multiline />
              <TextField label="Rest day" value={p.rest} onChange={(rest) => set({ rest })} />
            </Expander>
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>

      {editing && editingSession ? (
        <ExerciseEditor
          exercise={editing.index === null ? blankExercise() : editingSession.exercises[editing.index]}
          isNew={editing.index === null}
          known={known}
          onClose={() => setEditing(null)}
          onSave={(e) => {
            const ex = [...editingSession.exercises];
            if (editing.index === null) ex.push(e);
            else ex[editing.index] = e;
            setSession(editingSession.id, { exercises: ex });
            setEditing(null);
          }}
          onRemove={editing.index === null ? undefined : () => {
            setSession(editingSession.id, { exercises: editingSession.exercises.filter((_, i) => i !== editing.index) });
            setEditing(null);
          }}
        />
      ) : null}
    </Modal>
  );
}

function ExerciseEditor({ exercise, isNew, known, onSave, onClose, onRemove }: {
  exercise: Ex; isNew: boolean; known: KnownExercise[]; onSave: (e: Ex) => void; onClose: () => void; onRemove?: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [e, setE] = useState<Ex>(exercise);
  const set = (patch: Partial<Ex>) => setE((x) => ({ ...x, ...patch }));
  const knownKey = (k: KnownExercise) => `${k.category}|${k.name}`;
  const pick = ['', ...known.map(knownKey)];

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[st.bar, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={{ color: t.muted, fontSize: 16, fontWeight: '600' }}>Cancel</Text>
          </Pressable>
          <Text style={{ color: t.text, fontWeight: '700', fontSize: 17 }}>{isNew ? 'Add exercise' : 'Edit exercise'}</Text>
          <Pressable onPress={() => onSave({ ...e, name: e.name.trim(), garminCategory: e.garminCategory.trim().toUpperCase(), garminName: e.garminName.trim().toUpperCase() })} hitSlop={12}>
            <Text style={{ color: t.accent, fontSize: 16, fontWeight: '700' }}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
          <Section>
            <TextField label="Name" value={e.name} onChange={(name) => set({ name })} />
            <Stepper label="Sets" value={e.sets} onChange={(sets) => set({ sets })} min={1} max={10} />
            <Stepper label="Fewest reps" value={e.repLo} onChange={(repLo) => set({ repLo, repHi: Math.max(repLo, e.repHi), startReps: Math.max(repLo, e.startReps) })} min={1} max={50} />
            <Stepper label="Most reps" value={e.repHi} onChange={(repHi) => set({ repHi, repLo: Math.min(repHi, e.repLo), startReps: Math.min(repHi, e.startReps) })} min={1} max={50} />
            <Stepper label="Reps in week 1" value={e.startReps} onChange={(startReps) => set({ startReps })} min={e.repLo} max={e.repHi} />
            <Caption>Each week adds a rep; once every set reaches the most reps, the weight goes up and reps drop back.</Caption>
          </Section>
          <Section>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <NumberField label="Starting weight (kg)" value={e.startKg ?? 0} decimals placeholder="bodyweight"
                onChange={(v) => set({ startKg: v || null })} help="Leave empty for bodyweight." />
              <NumberField label="Add each time (kg)" value={e.incKg} decimals onChange={(incKg) => set({ incKg })} />
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <NumberField label="Rest (seconds)" value={e.restS} onChange={(restS) => set({ restS })} />
              <View style={{ flex: 1, minWidth: 140 }}>
                <TextField label="Reps in reserve" value={e.rir} onChange={(rir) => set({ rir })} placeholder="1-2" />
              </View>
            </View>
            <Toggle label="Reps are per leg / per arm" value={e.perLeg} onChange={(perLeg) => set({ perLeg })} />
            {e.perLeg ? <Toggle label="I log both sides together in Garmin" value={e.loggedBothSides} onChange={(loggedBothSides) => set({ loggedBothSides })} /> : null}
            <TextField label="Notes" value={e.note} onChange={(note) => set({ note })} multiline />
          </Section>
          <Section title="Garmin exercise">
            <Caption>How Garmin names this exercise. The app uses it to find your logged sets and to put the workout on your watch.</Caption>
            {known.length ? (
              <Select
                label="Pick one you've used"
                options={pick}
                value={pick.includes(knownKey({ category: e.garminCategory, name: e.garminName })) ? knownKey({ category: e.garminCategory, name: e.garminName }) : ''}
                format={(k) => (k ? k.split('|')[1] || k.split('|')[0] : 'Choose...').replace(/_/g, ' ').toLowerCase()}
                onChange={(k) => {
                  if (!k) return;
                  const [garminCategory, garminName] = k.split('|');
                  set({ garminCategory, garminName });
                }}
              />
            ) : null}
            <TextField label="Category" value={e.garminCategory} onChange={(garminCategory) => set({ garminCategory })} caps="characters" placeholder="HIP_RAISE" />
            <TextField label="Exercise" value={e.garminName} onChange={(garminName) => set({ garminName })} caps="characters" placeholder="BARBELL_HIP_THRUST_WITH_BENCH" />
          </Section>
          {onRemove ? <Button kind="danger" title="Remove exercise" onPress={onRemove} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const st = StyleSheet.create({
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10, gap: 12 },
  label: { fontSize: 13, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minWidth: 40, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  dayRow: { flexDirection: 'row', gap: 8 },
  exRow: { flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  mini: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
});
