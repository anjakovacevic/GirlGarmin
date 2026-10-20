import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import * as A from '../../analysis';
import { addDays, fmtDate, fmtShort, mondayOf } from '../../lib/dates';
import { fmt, fmtG, fmtSigned, isNum } from '../../lib/stats';
import { type CardioKind, P } from '../../plan';
import * as progression from '../../progression';
import { Caption, Metric, MetricGrid, Notice, Section } from '../components';
import type { Ctx } from '../context';
import { CheckIcon, ChevronIcon } from '../icons';
import { useTheme } from '../theme';

function cardioLabel(kind: CardioKind): string {
  if (kind === 'intervals') return 'VO2max intervals';
  if (kind === 'vo2check') return 'VO2max check run';
  if (kind?.startsWith('zone2-')) return `Zone-2 walk ${kind.split('-')[1]} min`;
  return '';
}

export function TodayScreen({ c }: { c: Ctx }) {
  const t = useTheme();
  const { d, today } = c;
  const day = A.todayPlan(today);
  const rec = A.recoveryToday(d.daily, c.phases);
  const wt = A.weightForecast(d.weight);
  const lose = c.settings.goal === 'lose';
  const lastW = d.weight.length ? d.weight[d.weight.length - 1] : null;

  const weekStart = mondayOf(today);
  const planWeek = P().days.filter((x) => x.date >= weekStart && x.date < addDays(weekStart, 7));
  const weekDays = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStart, i));
  // cycle day on the date shown: counted from the last period logged on or before it
  const cyc = A.predictCycle(c.info.filter((x) => x.start <= today), today);
  // lifting counts for the session it belongs to, even when done on another day of the week
  const doneOn = A.matchSessions(d.activities);
  const lifted = new Set(planWeek.filter((x) => doneOn.has(x.date)).map((x) => x.date));
  const movedHere = (date: string) => planWeek.filter((x) => doneOn.get(x.date)?.date === date && x.date !== date);
  const matched = new Set([...doneOn.values()]);
  const extra = (date: string) =>
    d.activities.some((a) => a.date === date && a.type === 'strength_training' && !matched.has(a)) && !planWeek.some((x) => doneOn.get(x.date)?.date === date);
  const moved = new Set(d.activities.filter((a) => a.type !== 'strength_training').map((a) => a.date)); // any cardio activity
  // done = check, missed = red ring, still to come (or optional) = dash
  const tick = (planned: boolean, done: boolean, date: string, optional = false) =>
    !planned ? null : done ? <CheckIcon color={t.good} size={18} />
      : date > today || optional ? <Text style={{ color: t.muted }}>—</Text>
      : <View style={[st.missed, { borderColor: t.bad }]} accessibilityLabel="missed" />;

  const hist = progression.history(d.sets, d.activities);
  const [showWorkout, setShowWorkout] = useState(false);

  return (
    <View style={{ gap: 12 }}>
      <MetricGrid>
        {day ? (
          <Metric
            label="Plan"
            value={day.session ? day.session.title : day.cardio.includes('Rest') ? 'Rest' : 'Cardio'}
            delta={`week ${day.week} of ${P().weeks}`}
            deltaColor="off"
          />
        ) : (
          <Metric label="Plan" value="No plan selected" />
        )}
        {rec ? (
          <Metric
            label="HRV last night"
            value={isNum(rec.hrv) ? `${fmt(rec.hrv)} ms` : '-'}
            delta={isNum(rec.hrv) && isNum(rec.phaseBaseline) ? `${fmtSigned(rec.hrv - rec.phaseBaseline)} vs your ${rec.phase ?? ''} normal` : null}
          />
        ) : null}
        {cyc ? <Metric label="Cycle day" value={cyc.cycleDay} delta={cyc.phase} deltaColor="off" /> : null}
        {lastW ? (
          <Metric
            label="Weight"
            value={`${fmt(lastW.weight_kg, 1)} kg`}
            delta={wt ? `${fmtSigned(wt.perWeek, 2)} kg/week trend` : null}
            deltaColor={lose ? 'inverse' : 'off'}
          />
        ) : null}
      </MetricGrid>

      {rec ? (
        <Notice
          text={`**Recovery:** ${rec.advice}\nHRV status ${rec.hrvStatus || '-'} · sleep score ${fmt(rec.sleepScore)} · resting HR ${fmt(rec.restingHr)} (${fmtShort(rec.date)})`}
        />
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
              <Text style={[st.workoutTitle, { color: t.text }]}>{day.session.title}</Text>
              <Text style={{ color: t.muted, fontSize: 13.5 }}>
                {day.session.exercises.length} exercises{day.cardio ? ' + cardio' : ''} · {showWorkout ? 'tap to hide' : 'tap to see them'}
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
                  {tg.sets} × {tg.reps}{unit} · RIR {ex.rir}
                  <Text style={{ color: t.muted }}>  · {tg.basedOn ? `based on ${fmtShort(tg.basedOn)}` : 'plan'}</Text>
                </Text>
                {ex.note || first ? (
                  <Caption>{ex.note}{first ? ' First time - the load is a guess, adjust it.' : ''}</Caption>
                ) : null}
              </View>
            );
          })}
          {day.cardio ? <Caption>After lifting: {day.cardio}</Caption> : null}
          </>
          ) : null}
        </Section>
      ) : day ? (
        <Section title={fmtDate(today, { weekday: 'long' })}>
          <Text style={{ color: t.text, fontSize: 15, lineHeight: 21 }}>{day.cardio}</Text>
        </Section>
      ) : null}

      {planWeek.length ? (
        <Section title="This week">
          <View style={[st.weekRow, { borderBottomColor: t.border }]}>
            <Text style={[st.wDay, st.wHead, { color: t.muted }]}>Day</Text>
            <Text style={[st.wPlan, st.wHead, { color: t.muted }]}>Plan</Text>
            <Text style={[st.wTick, st.wHead, { color: t.muted }]}>Lift</Text>
            <Text style={[st.wTick, st.wHead, { color: t.muted }]}>Cardio</Text>
          </View>
          {planWeek.map((x) => {
            const cardio = cardioLabel(x.cardioKind);
            const isToday = x.date === today;
            const done = doneOn.get(x.date);
            return (
              <View key={x.date} style={[st.weekRow, { borderBottomColor: t.border }, isToday && [st.todayRow, { backgroundColor: t.accentSoft }]]}>
                <Text style={[st.wDay, { color: t.text, fontWeight: isToday ? '700' : '400' }]}>{fmtDate(x.date)}</Text>
                <View style={st.wPlan}>
                  <Text style={{ color: t.text, fontSize: 13.5 }}>
                    {[x.session?.title, cardio || (!x.session ? 'Rest' : '')].filter(Boolean).join(' + ')}
                  </Text>
                  {done && done.date !== x.date ? (
                    <Text style={[st.wNote, { color: t.muted }]}>Done {done.date < x.date ? 'early' : 'late'}, on {fmtDate(done.date)}</Text>
                  ) : null}
                  {movedHere(x.date).map((m) => (
                    <Text key={m.date} style={[st.wNote, { color: t.good }]}>Did {m.session!.title} here (planned {fmtDate(m.date)})</Text>
                  ))}
                  {extra(x.date) ? <Text style={[st.wNote, { color: t.good }]}>Extra lifting session</Text> : null}
                </View>
                <View style={st.wTick}>{tick(!!x.session, lifted.has(x.date), x.date)}</View>
                <View style={st.wTick}>{tick(!!cardio, moved.has(x.date), x.date, x.cardioKind === 'zone2-30')}</View>
              </View>
            );
          })}
          <Caption>
            A session done on another day of the same week still counts; the row says when. Cardio counts as done when any
            non-strength activity is recorded that day. The 30-min zone-2 walks are optional, so
            a missed one shows —.
          </Caption>
        </Section>
      ) : (
        <Section title="This week">
          <View style={[st.weekRow, { borderBottomColor: t.border }]}>
            <Text style={[st.wDay, st.wHead, { color: t.muted, flex: 1 }]}>Day</Text>
            <Text style={[st.wTick, st.wHead, { color: t.muted }]}>Lift</Text>
            <Text style={[st.wTick, st.wHead, { color: t.muted }]}>Cardio</Text>
          </View>
          {weekDays.map((date) => {
            const isToday = date === today;
            const acts = d.activities.filter((a) => a.date === date);
            return (
              <View key={date} style={[st.weekRow, { borderBottomColor: t.border }, isToday && [st.todayRow, { backgroundColor: t.accentSoft }]]}>
                <Text style={[st.wDay, { color: t.text, flex: 1, fontWeight: isToday ? '700' : '400' }]}>{fmtDate(date)}</Text>
                <View style={st.wTick}>{acts.some((a) => a.type === 'strength_training') ? <CheckIcon color={t.good} size={18} /> : null}</View>
                <View style={st.wTick}>{acts.some((a) => a.type !== 'strength_training') ? <CheckIcon color={t.good} size={18} /> : null}</View>
              </View>
            );
          })}
          <Caption>No training plan this week, so this shows the activities you logged.</Caption>
        </Section>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  workoutHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  workoutTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  chevron: { width: 36, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  ex: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, gap: 3 },
  exHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  exName: { fontSize: 15.5, fontWeight: '700', flex: 1 },
  exLoad: { fontSize: 15.5, fontWeight: '700' },
  weekRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, gap: 6 },
  wHead: { fontSize: 12, fontWeight: '700' },
  wDay: { width: 82, fontSize: 13.5 },
  wPlan: { flex: 1, gap: 1 },
  wNote: { fontSize: 12, lineHeight: 16 },
  wTick: { width: 46, textAlign: 'center', alignItems: 'center', fontSize: 14 },
  todayRow: { marginHorizontal: -8, paddingHorizontal: 8, borderRadius: 10, borderBottomWidth: 0 },
  missed: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.8 },
});
