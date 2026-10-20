/** Plan tab: the plan running now, what's coming up, plans you've made but not started, and past
 * plans. Start, move, end, edit, copy or delete them here. */

import { type ReactNode, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { addDays, diffDays, fmtDate, type ISODate, mondayOf, todayISO } from '../../lib/dates';
import { blankPlan, clash, duplicatePlan, type PlanData, planDates } from '../../plan';
import { Button, Caption, Notice, Section } from '../components';
import type { Ctx } from '../context';
import { ChevronIcon } from '../icons';
import { type KnownExercise, PlanEditor } from '../PlanEditor';
import { useTheme } from '../theme';

const range = (p: PlanData) => {
  const d = planDates(p);
  return d ? `${fmtDate(d.start, { weekday: false })} – ${fmtDate(d.end, { weekday: false, year: true })}` : '';
};
const summary = (p: PlanData) => `${p.weeks} weeks · ${p.sessions.length} ${p.sessions.length === 1 ? 'session' : 'sessions'} a week`;

export function PlanScreen({ c }: { c: Ctx }) {
  const t = useTheme();
  const today = todayISO();
  const [editing, setEditing] = useState<PlanData | null>(null);
  const [starting, setStarting] = useState<PlanData | null>(null);

  const dated = c.plans.map((p) => ({ p, d: planDates(p) }));
  const current = dated.find(({ d }) => d && d.start <= today && d.end >= today)?.p ?? null;
  const upcoming = dated.filter(({ d }) => d && d.start > today).sort((a, b) => a.d!.start.localeCompare(b.d!.start)).map(({ p }) => p);
  const past = dated.filter(({ d }) => d && d.end < today).sort((a, b) => b.d!.start.localeCompare(a.d!.start)).map(({ p }) => p);
  const drafts = c.plans.filter((p) => !p.start);

  const known = useMemo<KnownExercise[]>(() => {
    const m = new Map<string, KnownExercise>();
    for (const e of c.plans.flatMap((p) => p.sessions.flatMap((s) => s.exercises))) {
      if (e.garminCategory) m.set(`${e.garminCategory}|${e.garminName}`, { category: e.garminCategory, name: e.garminName });
    }
    for (const s of c.d.sets) if (s.category) m.set(`${s.category}|${s.exercise ?? ''}`, { category: s.category, name: s.exercise ?? '' });
    return [...m.values()].sort((a, b) => (a.name || a.category).localeCompare(b.name || b.category));
  }, [c.plans, c.d.sets]);

  const save = (p: PlanData) => c.savePlans(c.plans.some((x) => x.id === p.id) ? c.plans.map((x) => (x.id === p.id ? p : x)) : [...c.plans, p]);
  const remove = (p: PlanData) =>
    Alert.alert(`Delete "${p.name}"?`, 'The plan is removed from this phone. What you logged in Garmin stays.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => c.savePlans(c.plans.filter((x) => x.id !== p.id)) },
    ]);
  const end = (p: PlanData) =>
    Alert.alert(`End "${p.name}" today?`, 'Days after today are taken off the plan. What you logged stays, and you can start another plan.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'End plan', style: 'destructive', onPress: () => save({ ...p, endedOn: today }) },
    ]);

  const current_ = current ? planDates(current)! : null;
  const week = current_ ? Math.floor(diffDays(today, current_.start) / 7) + 1 : 0;

  return (
    <View style={{ gap: 14 }}>
      {current && current_ ? (
        <Section>
          <Text style={[st.kicker, { color: t.accent }]}>Running now</Text>
          <Text style={[st.name, { color: t.text }]}>{current.name}</Text>
          <Text style={{ color: t.muted, fontSize: 14 }}>
            Week {week} of {current.weeks}{current.deloadWeeks.includes(week) ? ' (lighter week)' : ''} · {range(current)}
          </Text>
          <View style={[st.track, { backgroundColor: t.accentSoft }]}>
            <View style={[st.fill, { backgroundColor: t.accent, width: `${Math.min(100, Math.round(((diffDays(today, current_.start) + 1) / (diffDays(current_.end, current_.start) + 1)) * 100))}%` }]} />
          </View>
          <View style={st.actions}>
            <Action label="Edit" onPress={() => setEditing(current)} />
            <Action label="Move dates" onPress={() => setStarting(current)} />
            <Action label="End today" onPress={() => end(current)} tone="danger" />
          </View>
        </Section>
      ) : (
        <Notice text={upcoming.length ? `No plan running today. **${upcoming[0].name}** starts on ${fmtDate(upcoming[0].start!)}.` : 'No plan running. Start one of your plans below, or make a new one.'} />
      )}

      {upcoming.length ? (
        <Section title="Coming up">
          {upcoming.map((p) => (
            <PlanRow key={p.id} title={p.name} sub={`Starts ${fmtDate(p.start!)} · ${summary(p)}`}>
              <Action label="Edit" onPress={() => setEditing(p)} />
              <Action label="Change start" onPress={() => setStarting(p)} />
              <Action label="Don't start" onPress={() => save({ ...p, start: null, endedOn: null })} />
            </PlanRow>
          ))}
        </Section>
      ) : null}

      <Section title="Your plans">
        {drafts.length ? null : <Caption>Plans you make or copy show up here until you start them.</Caption>}
        {drafts.map((p) => (
          <PlanRow key={p.id} title={p.name} sub={summary(p)}>
            <Action label="Start…" onPress={() => setStarting(p)} tone="accent" />
            <Action label="Edit" onPress={() => setEditing(p)} />
            <Action label="Copy" onPress={() => save(duplicatePlan(p))} />
            <Action label="Delete" onPress={() => remove(p)} tone="danger" />
          </PlanRow>
        ))}
        <Button kind="secondary" title="New plan" onPress={() => setEditing(blankPlan(current ?? c.plans[0]))} />
        {current ? <Button kind="secondary" title={`Copy "${current.name}" to change it`} onPress={() => save(duplicatePlan(current))} /> : null}
      </Section>

      {past.length ? (
        <Section title="Past plans">
          {past.map((p) => (
            <PlanRow key={p.id} title={p.name} sub={`${range(p)}${p.endedOn ? ' · ended early' : ''}`}>
              <Action label="Run again" onPress={() => save(duplicatePlan(p, p.name))} />
              <Action label="Delete" onPress={() => remove(p)} tone="danger" />
            </PlanRow>
          ))}
          <Caption>Past plans stay so the Daily tab can show what was planned on those days.</Caption>
        </Section>
      ) : null}

      <Caption>Once your plans are on your watch (Settings → Workouts on your watch), every change here reaches the Garmin calendar by itself.</Caption>

      {editing ? (
        <PlanEditor
          plan={editing}
          plans={c.plans}
          known={known}
          onClose={() => setEditing(null)}
          onSave={async (p) => {
            await save(p);
            setEditing(null);
          }}
        />
      ) : null}
      {starting ? (
        <StartPicker
          plan={starting}
          plans={c.plans}
          onClose={() => setStarting(null)}
          onSave={async (start) => {
            await save({ ...starting, start, endedOn: null });
            setStarting(null);
          }}
        />
      ) : null}
    </View>
  );
}

function PlanRow({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[st.row, { borderTopColor: t.border }]}>
      <Text style={{ color: t.text, fontSize: 16, fontWeight: '700' }}>{title}</Text>
      <Text style={{ color: t.muted, fontSize: 13.5 }}>{sub}</Text>
      <View style={st.actions}>{children}</View>
    </View>
  );
}

function Action({ label, onPress, tone }: { label: string; onPress: () => void; tone?: 'accent' | 'danger' }) {
  const t = useTheme();
  const bg = tone === 'accent' ? t.accent : tone === 'danger' ? t.errorBg : t.surface;
  const fg = tone === 'accent' ? t.accentText : tone === 'danger' ? t.bad : t.text;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.action, { backgroundColor: bg, opacity: pressed ? 0.75 : 1 }]} accessibilityRole="button">
      <Text style={{ color: fg, fontWeight: '600', fontSize: 13.5 }}>{label}</Text>
    </Pressable>
  );
}

/** Pick the Monday a plan starts on; says where it would end and whether it overlaps another plan. */
function StartPicker({ plan, plans, onSave, onClose }: { plan: PlanData; plans: PlanData[]; onSave: (start: ISODate) => void; onClose: () => void }) {
  const t = useTheme();
  const suggested = useMemo(() => {
    if (plan.start) return plan.start;
    const today = todayISO();
    const thisMonday = mondayOf(today);
    const ends = plans.filter((p) => p.id !== plan.id).map(planDates).filter((d) => d && d.end >= today).map((d) => d!.end).sort();
    const after = ends.length ? mondayOf(addDays(ends[ends.length - 1], 7)) : thisMonday === today ? today : addDays(thisMonday, 7);
    return after;
  }, [plan, plans]);
  const [start, setStart] = useState(suggested);
  const end = addDays(start, 7 * plan.weeks - 1);
  const other = clash(plans, plan, start);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={st.backdrop} onPress={onClose}>
        <Pressable style={[st.sheet, { backgroundColor: t.card }]} onPress={() => {}}>
          <Text style={[st.name, { color: t.text, fontSize: 19 }]}>When does week 1 start?</Text>
          <Text style={{ color: t.muted, fontSize: 14 }}>{plan.name} · {plan.weeks} weeks</Text>
          <View style={st.stepper}>
            <Pressable onPress={() => setStart(addDays(start, -7))} style={[st.step, { backgroundColor: t.surface }]} accessibilityLabel="A week earlier">
              <ChevronIcon color={t.text} dir="left" />
            </Pressable>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>{fmtDate(start, { year: true })}</Text>
              <Text style={{ color: t.muted, fontSize: 13 }}>ends {fmtDate(end, { year: true })}</Text>
            </View>
            <Pressable onPress={() => setStart(addDays(start, 7))} style={[st.step, { backgroundColor: t.surface }]} accessibilityLabel="A week later">
              <ChevronIcon color={t.text} dir="right" />
            </Pressable>
          </View>
          {other ? <Notice tone="error" text={`This overlaps **${other}**. Pick a later Monday, or end or move that plan first.`} /> : null}
          {start < mondayOf(todayISO()) ? <Caption>Starting in the past is fine: earlier weeks count as already done.</Caption> : null}
          <Button title={plan.start ? 'Save dates' : `Start on ${fmtDate(start)}`} disabled={!!other} onPress={() => onSave(start)} />
          <Button kind="secondary" title="Cancel" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const st = StyleSheet.create({
  kicker: { fontSize: 13, fontWeight: '600' },
  name: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 4 },
  fill: { height: 4, borderRadius: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  action: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  row: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(29,27,34,0.35)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, gap: 12 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 6 },
  step: { width: 44, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
});
