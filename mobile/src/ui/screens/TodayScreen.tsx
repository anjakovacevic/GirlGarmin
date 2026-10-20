/** Today tab: how recovered you are (the verdict first), what's planned, this week at a glance, and
 * where you are in your cycle. The date picker above it lives in App. */

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import * as A from '../../analysis';
import { addDays, fmtShort, mondayOf, WEEKDAYS } from '../../lib/dates';
import { fmt, fmtG, fmtSigned, isNum } from '../../lib/stats';
import { allDays, type CardioKind } from '../../plan';
import * as progression from '../../progression';
import { Caption, Section } from '../components';
import type { Ctx } from '../context';
import { CheckIcon, ChevronIcon } from '../icons';
import { useTheme } from '../theme';

function cardioLabel(kind: CardioKind): string {
  if (kind === 'intervals') return 'VO2max intervals';
  if (kind === 'vo2check') return 'VO2max check run';
  if (kind?.startsWith('zone2-')) return `Zone-2 walk ${kind.split('-')[1]} min`;
  return '';
}

const WEEK_INFO = `**✓** session done (even on another day of the week) · **red ring** session missed · **grey dot** session still to come · **small green dot** cardio logged.

The 30-minute zone-2 walks are optional, so they never count as missed.`;

export function TodayScreen({ c }: { c: Ctx }) {
  const t = useTheme();
  const { d, today } = c;
  const day = A.todayPlan(today);
  const rec = A.recoveryToday(d.daily, c.phases, today);
  const [showWorkout, setShowWorkout] = useState(false);

  const weekStart = mondayOf(today);
  const weekDays = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStart, i));
  const planWeek = allDays().filter((x) => x.date >= weekStart && x.date < addDays(weekStart, 7));
  // cycle day on the date shown: counted from the last period logged on or before it
  const cyc = A.predictCycle(c.info.filter((x) => x.start <= today), today);
  // lifting counts for the session it belongs to, even when done on another day of the week
  const doneOn = A.matchSessions(d.activities);
  const matched = new Set([...doneOn.values()]);
  const cardioDays = new Set(d.activities.filter((a) => a.type !== 'strength_training').map((a) => a.date));
  const notes = [
    ...planWeek.flatMap((x) => {
      const a = doneOn.get(x.date);
      return a && a.date !== x.date ? [`${x.session!.title} done ${WEEKDAYS[weekDays.indexOf(a.date)] ?? fmtShort(a.date)} instead of ${WEEKDAYS[weekDays.indexOf(x.date)]}`] : [];
    }),
    ...weekDays.filter((date) => d.activities.some((a) => a.date === date && a.type === 'strength_training' && !matched.has(a))
      && !planWeek.some((x) => doneOn.get(x.date)?.date === date)).map((date) => `Extra lifting on ${WEEKDAYS[weekDays.indexOf(date)]}`),
  ];
  const hist = progression.history(d.sets, d.activities);

  const low = rec?.hrvStatus === 'LOW';
  const hrvDiff = rec && isNum(rec.hrv) && isNum(rec.phaseBaseline) ? rec.hrv - rec.phaseBaseline : null;

  return (
    <View style={{ gap: 14 }}>
      {rec ? (
        <View style={[st.hero, { backgroundColor: t.card }]} accessibilityRole="summary">
          <Text style={[st.kicker, { color: low ? t.bad : t.good }]}>{low ? 'Recovery: take it easier' : 'Recovery: ready to train'}</Text>
          <Text style={[st.verdict, { color: t.text }]}>{rec.advice}</Text>
          <View style={st.stats}>
            <Stat label="HRV" value={isNum(rec.hrv) ? `${fmt(rec.hrv)} ms` : '-'} sub={isNum(hrvDiff) ? `${fmtSigned(hrvDiff)} vs normal` : rec.hrvStatus || ''} />
            <Stat label="Sleep score" value={fmt(rec.sleepScore)} />
            <Stat label="Resting HR" value={isNum(rec.restingHr) ? `${fmt(rec.restingHr)}` : '-'} />
          </View>
          <Text style={{ color: t.muted, fontSize: 12 }}>From last night ({fmtShort(rec.date)})</Text>
        </View>
      ) : null}

      {day?.session ? (
        <Section>
          <Pressable
            onPress={() => setShowWorkout(!showWorkout)}
            style={st.workoutHead}
            accessibilityRole="button"
            accessibilityState={{ expanded: showWorkout }}
            accessibilityHint={showWorkout ? 'Hides the exercises' : 'Shows the exercises'}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: t.muted, fontSize: 13 }}>Today's workout</Text>
              <Text style={[st.workoutTitle, { color: t.text }]}>{day.session.title}</Text>
              <Text style={{ color: t.muted, fontSize: 13.5 }}>
                {day.session.exercises.length} exercises{day.cardio ? ' + cardio' : ''} · {day.planName}, week {day.week}
              </Text>
            </View>
            <View style={[st.chevron, { backgroundColor: t.surface }]}>
              <ChevronIcon color={t.text} dir={showWorkout ? 'up' : 'down'} />
            </View>
          </Pressable>
          {showWorkout ? (
            <>
              <Caption>Warm-up: {day.session.warmup}</Caption>
              {day.session.exercises.map((ex) => {
                const tg = progression.target(ex, day.session!, today, hist, today);
                const unit = ex.perLeg ? (ex.note.toLowerCase().includes('arm') ? ' /arm' : ' /leg') : '';
                const first = tg.basedOn === null && ex.startKg !== null;
                return (
                  <View key={ex.name} style={[st.ex, { borderTopColor: t.border }]}>
                    <View style={st.exHead}>
                      <Text style={[st.exName, { color: t.text }]}>{ex.name}</Text>
                      <Text style={[st.exLoad, { color: t.accent }]}>{tg.kg !== null ? `${fmtG(tg.kg)} kg` : 'bodyweight'}</Text>
                    </View>
                    <Text style={{ color: t.text, fontSize: 15 }}>
                      {tg.sets} × {tg.reps}{unit} · {ex.rir} reps left in the tank
                    </Text>
                    {ex.note || first ? <Caption>{ex.note}{first ? ' First time - the weight is a guess, adjust it.' : ''}</Caption> : null}
                  </View>
                );
              })}
              {day.cardio ? <Caption>After lifting: {day.cardio}</Caption> : null}
            </>
          ) : null}
        </Section>
      ) : day ? (
        <Section>
          <Text style={{ color: t.muted, fontSize: 13 }}>Today</Text>
          <Text style={[st.workoutTitle, { color: t.text }]}>{cardioLabel(day.cardioKind) || 'Rest day'}</Text>
          <Text style={{ color: t.text, fontSize: 14.5, lineHeight: 21 }}>{day.cardio}</Text>
        </Section>
      ) : null}

      <Section title="This week" info={WEEK_INFO}>
        <View style={st.strip}>
          {weekDays.map((date, i) => {
            const p = planWeek.find((x) => x.date === date);
            const isToday = date === today;
            const lifted = p?.session ? doneOn.has(date) : d.activities.some((a) => a.date === date && a.type === 'strength_training');
            let mark = null;
            if (p?.session) {
              mark = lifted ? <CheckIcon color={t.good} size={16} />
                : date >= today ? <View style={[st.dot, { backgroundColor: t.border }]} />
                : <View style={[st.ring, { borderColor: t.bad }]} accessibilityLabel="missed" />;
            } else if (lifted) mark = <CheckIcon color={t.good} size={16} />;
            return (
              <View key={date} style={st.day} accessibilityLabel={`${WEEKDAYS[i]}${p?.session ? `, ${p.session.title}` : ''}${lifted ? ', done' : ''}`}>
                <Text style={{ color: t.muted, fontSize: 12 }}>{WEEKDAYS[i][0]}</Text>
                <View style={[st.date, isToday && { backgroundColor: t.accentSoft }]}>
                  <Text style={{ color: isToday ? t.accent : t.text, fontWeight: isToday ? '700' : '500', fontSize: 14 }}>{+date.slice(8)}</Text>
                </View>
                <View style={st.mark}>{mark}</View>
                <View style={[st.cardio, { backgroundColor: cardioDays.has(date) ? t.good : 'transparent' }]} />
              </View>
            );
          })}
        </View>
        {notes.map((n) => <Text key={n} style={{ color: t.muted, fontSize: 13 }}>{n}</Text>)}
        {!planWeek.length ? <Caption>No plan this week - showing what you logged.</Caption> : null}
      </Section>

      {cyc ? (
        <Section>
          <Text style={{ color: t.text, fontSize: 15 }}>
            <Text style={{ fontWeight: '700' }}>Cycle day {cyc.cycleDay}</Text>
            <Text style={{ color: t.muted }}> · {cyc.phase}</Text>
          </Text>
        </Section>
      ) : null}
    </View>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const t = useTheme();
  return (
    <View style={[st.stat, { backgroundColor: t.surface }]}>
      <Text style={{ color: t.muted, fontSize: 12.5 }}>{label}</Text>
      <Text style={{ color: t.text, fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{value}</Text>
      {sub ? <Text style={{ color: t.muted, fontSize: 11.5 }} numberOfLines={1}>{sub}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  hero: { borderRadius: 20, padding: 18, gap: 10 },
  kicker: { fontSize: 13, fontWeight: '700' },
  verdict: { fontSize: 19, lineHeight: 26, fontWeight: '600', letterSpacing: -0.3 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, gap: 1 },
  workoutHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  workoutTitle: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  chevron: { width: 36, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  ex: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, gap: 3 },
  exHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  exName: { fontSize: 15.5, fontWeight: '700', flex: 1 },
  exLoad: { fontSize: 15.5, fontWeight: '700' },
  strip: { flexDirection: 'row', justifyContent: 'space-between' },
  day: { alignItems: 'center', gap: 6, flex: 1 },
  date: { width: 32, height: 32, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  mark: { height: 18, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  ring: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.8 },
  cardio: { width: 5, height: 5, borderRadius: 3 },
});
