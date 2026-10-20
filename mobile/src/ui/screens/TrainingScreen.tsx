/** Training tab: your plan (opens the Plan page), lift progress, sets per muscle, plan vs what you
 * did, then cardio. */

import { useMemo, useState } from 'react';
import { View } from 'react-native';

import * as A from '../../analysis';
import { fmtDate, fmtShort, todayISO, toDays } from '../../lib/dates';
import { fmt, fmtG, fmtSigned, groupBy, isNum } from '../../lib/stats';
import { hasPlan, P, projectionEnd, weekOf } from '../../plan';
import { Chart } from '../Chart';
import { Caption, KeyValue, LinkCard, ListRow, Metric, MetricGrid, Notice, Section, Select, ShowMore } from '../components';
import type { Ctx } from '../context';
import { averaged, bucketed, bucketFor, inRange, rangeStart } from '../range';
import { colorFor } from '../theme';
import { CardioSections } from './CardioScreen';

const LIFT_INFO = `**Estimated max** is the most you could lift once, worked out from your sets: weight × (1 + reps / 30) (the Epley formula).

Holding it steady during a diet means you're keeping muscle. The dashed line projects the trend of your last 6 weeks.`;

function PlanLink({ c }: { c: Ctx }) {
  const today = todayISO();
  const sub = !hasPlan()
    ? 'No plan running - start or make one'
    : today < P().firstDay
      ? `${P().name} starts ${fmtDate(P().firstDay)}`
      : `${P().name} · week ${weekOf(today)} of ${P().weeks}`;
  return <LinkCard title="Plan" sub={sub} onPress={() => c.open('plan')} />;
}

export function TrainingScreen({ c }: { c: Ctx }) {
  const { d, sessions, today } = c;
  const fc = useMemo(() => A.liftForecasts(sessions), [sessions]);
  const options = fc.length ? fc.map((f) => f.exercise) : [...new Set(sessions.map((s) => s.exercise))].sort();
  const [picked, setPicked] = useState<string | null>(null);
  const ex = picked && options.includes(picked) ? picked : options[0];
  const weekly = useMemo(() => A.weeklySetsByMuscle(d.sets), [d.sets]);
  const pva = useMemo(() => A.planVsActual(d.sets, d.activities, today), [d, today]);

  if (!sessions.length) {
    return (
      <View style={{ gap: 14 }}>
        <PlanLink c={c} />
        <Notice text="No strength data yet." />
        <CardioSections c={c} />
      </View>
    );
  }

  const g = sessions.filter((s) => s.exercise === ex);
  const b = bucketFor(c.range, sessions[0].date);
  const from = rangeStart(c.range);
  const gShown = inRange(g, (s) => s.date, c.range);
  const e1rmName = averaged('Estimated max', b, 'max');
  const topName = averaged('Heaviest set', b, 'max');
  const kg = (v: number) => `${fmt(v, 1)} kg`;
  // sets only exist per week: at least the last 4 weeks; monthly bars show the average week of the month
  const weeklyShown = inRange(weekly, (w) => w.week, c.range, 28);
  const setsBucket = b === 'month' ? 'month' : 'week';
  const row = fc.find((f) => f.exercise === ex);
  const end = projectionEnd();
  const muscleColors = colorFor(weekly.map((w) => w.muscle));
  // plan vs what you did, one row per planned session, newest first
  const bySession = [...groupBy(pva, (p) => `${p.date}|${p.session}`).values()].reverse();
  const logged = pva.filter((p) => p.actual_sets !== null);

  return (
    <View style={{ gap: 14 }}>
      <PlanLink c={c} />

      <Section title="Lift progress" info={LIFT_INFO}>
        <Select label="Exercise" options={options} value={ex} onChange={setPicked} format={A.pretty} />
        <Chart
          height={230}
          yTitle="kg"
          bucket={b}
          xMin={from ? toDays(from) - 1 : undefined}
          empty={`No ${A.pretty(ex)} sessions in this period.`}
          series={[
            {
              type: 'line', name: e1rmName, color: '#5d6ad1', markers: true,
              data: bucketed(gShown, (s) => s.date, (s) => s.best_e1rm, b, { how: 'max', name: e1rmName, fmt: kg, unit: ['session', 'sessions'] }),
            },
            b === 'day'
              ? { type: 'scatter', name: 'Heaviest set', color: '#b8336a', symbol: 'diamond', data: gShown.map((s) => ({ x: toDays(s.date), y: s.top_kg, label: `Heaviest set: ${fmt(s.top_kg, 1)} kg × ${fmt(s.top_reps)}` })) }
              : { type: 'scatter', name: topName, color: '#b8336a', symbol: 'diamond', data: bucketed(gShown, (s) => s.date, (s) => s.top_kg, b, { how: 'max', name: topName, fmt: kg, unit: ['session', 'sessions'] }) },
            ...(row && isNum(row.projected_e1rm_at_plan_end) && g.length
              ? [{ type: 'line' as const, name: 'Trend', color: '#2e9e7a', dash: true,
                data: [{ x: toDays(g[g.length - 1].date), y: row.last_e1rm }, { x: toDays(end), y: row.projected_e1rm_at_plan_end }] }]
              : []),
          ]}
          yFormat={(v) => fmt(v, 1)}
        />
        {row ? (
          <MetricGrid>
            <Metric label="Best estimated max" value={`${fmt(row.best_e1rm, 1)} kg`} />
            <Metric label="Trend" value={isNum(row.trend_kg_per_week) ? `${fmtSigned(row.trend_kg_per_week, 1)} kg/week` : '-'} />
            <Metric label={`By ${fmtShort(end)}`} value={isNum(row.projected_e1rm_at_plan_end) ? `${fmt(row.projected_e1rm_at_plan_end, 1)} kg` : '-'} />
          </MetricGrid>
        ) : null}
      </Section>

      <Section
        title={setsBucket === 'week' ? 'Sets per muscle, each week' : 'Sets per muscle, average week of each month'}
        info="Hard sets per muscle group. Sets are counted per week, so a week or month view still shows the last 4 weeks."
      >
        <Chart
          height={230}
          bucket={setsBucket}
          empty="No lifting in this period."
          series={[...muscleColors].map(([m, color]) => ({
            type: 'bar' as const, name: m, color,
            data: setsBucket === 'week'
              ? weeklyShown.filter((w) => w.muscle === m).map((w) => ({ x: toDays(w.week) + 3, y: w.sets }))
              // sets in the month / weeks in a month
              : bucketed(weeklyShown.filter((w) => w.muscle === m), (w) => w.week, (w) => w.sets, 'month', { how: 'sum' })
                .map((q) => ({ ...q, y: q.y === null ? null : Math.round((q.y / 4.35) * 10) / 10 })),
          }))}
        />
      </Section>

      <Section
        title="Plan vs what you did"
        info={`Each planned session, newest first. Tap one to see every exercise: what was planned and the heaviest set you logged.\n\nSo far ${logged.length} of ${pva.length} planned exercises are logged; the planned weight was reached on ${logged.filter((p) => p.hit_load).length}.`}
      >
        {!bySession.length ? (
          <Caption>{hasPlan() ? `Starts filling in from ${fmtShort(P().firstDay)}.` : 'No plan running.'}</Caption>
        ) : (
          <ShowMore
            items={bySession}
            limit={4}
            render={(rows) => {
              const first = rows[0];
              const done = rows.filter((p) => p.actual_sets !== null);
              const hit = done.filter((p) => p.hit_load).length;
              return (
                <ListRow
                  key={`${first.date}|${first.session}`}
                  title={`${fmtDate(first.date)} · ${first.session}`}
                  sub={done.length
                    ? `${done.length}/${rows.length} exercises logged · ${hit} at planned weight${first.done_on ? ` · done ${fmtDate(first.done_on)}` : ''}`
                    : first.date === today ? 'Today' : 'Not logged'}
                >
                  {rows.map((p) => (
                    <KeyValue
                      key={p.exercise}
                      label={p.exercise}
                      value={p.actual_sets === null
                        ? `planned ${p.plan_sets}×${p.plan_reps}${isNum(p.plan_kg) ? ` @ ${fmtG(p.plan_kg)}` : ''} · not logged`
                        : `${p.actual_sets} sets, ${isNum(p.actual_kg) ? `${fmt(p.actual_kg, 1)} kg × ` : ''}${fmt(p.actual_best_reps, 0)}${p.hit_load ? ' ✓' : ''}`}
                    />
                  ))}
                </ListRow>
              );
            }}
          />
        )}
      </Section>

      <CardioSections c={c} />
    </View>
  );
}
