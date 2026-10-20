import { useMemo, useState } from 'react';
import { View } from 'react-native';

import * as A from '../../analysis';
import { fmtDate, fmtShort, toDays } from '../../lib/dates';
import { fmt, fmtSigned, isNum } from '../../lib/stats';
import { P } from '../../plan';
import { Chart } from '../Chart';
import { Caption, Expander, Metric, MetricGrid, Notice, Section, Select, Table } from '../components';
import type { Ctx } from '../context';
import { averaged, bucketed, bucketFor, inRange, rangeStart } from '../range';
import { colorFor } from '../theme';

const RECENT_ROWS = 20;

function PvaTable({ rows }: { rows: A.PlanVsActual[] }) {
  return (
    <Table
      columns={['Date', 'Exercise', 'Plan', 'Plan kg', 'Sets done', 'Top kg', 'Best reps', 'Load hit', 'Session']}
      rows={rows.map((p) => [
        p.done_on ? `${fmtDate(p.date)} (done ${fmtDate(p.done_on)})` : fmtDate(p.date), p.exercise, `${p.plan_sets}x${p.plan_reps}`, p.plan_kg ?? '-', p.actual_sets ?? '-',
        isNum(p.actual_kg) ? fmt(p.actual_kg, 1) : '-', isNum(p.actual_best_reps) ? fmt(p.actual_best_reps, 1) : '-',
        p.actual_sets === null ? '' : p.hit_load ? '✓' : '✗', p.session,
      ])}
    />
  );
}

export function TrainingScreen({ c }: { c: Ctx }) {
  const { d, sessions, today } = c;
  const fc = useMemo(() => A.liftForecasts(sessions), [sessions]);
  const options = fc.length ? fc.map((f) => f.exercise) : [...new Set(sessions.map((s) => s.exercise))].sort();
  const [picked, setPicked] = useState<string | null>(null);
  const ex = picked && options.includes(picked) ? picked : options[0];
  const weekly = useMemo(() => A.weeklySetsByMuscle(d.sets), [d.sets]);
  const pva = useMemo(() => A.planVsActual(d.sets, d.activities, today), [d, today]);

  if (!sessions.length) return <Notice text="No strength data yet." />;

  const g = sessions.filter((s) => s.exercise === ex);
  const b = bucketFor(c.range, sessions[0].date);
  const from = rangeStart(c.range);
  const gShown = inRange(g, (s) => s.date, c.range);
  const e1rmName = averaged('Estimated 1-rep max', b, 'max');
  const topName = averaged('Heaviest set logged', b, 'max');
  const kg = (v: number) => `${fmt(v, 1)} kg`;
  // sets only exist per week: at least the last 4 weeks; monthly bars show the average week of the month
  const weeklyShown = inRange(weekly, (w) => w.week, c.range, 28);
  const setsBucket = b === 'month' ? 'month' : 'week';
  const row = fc.find((f) => f.exercise === ex);
  const end = P().end;
  const muscleColors = colorFor(weekly.map((w) => w.muscle));
  const logged = pva.filter((p) => p.actual_sets !== null);
  const newest = [...pva].reverse();

  return (
    <View style={{ gap: 12 }}>
      <Section title="Lift progress">
        <Select label="Exercise" options={options} value={ex} onChange={setPicked} format={A.pretty} />
        <Chart
          height={250}
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
              ? { type: 'scatter', name: 'Heaviest set logged', color: '#b8336a', symbol: 'diamond', data: gShown.map((s) => ({ x: toDays(s.date), y: s.top_kg, label: `Heaviest set: ${fmt(s.top_kg, 1)} kg × ${fmt(s.top_reps)}` })) }
              : { type: 'scatter', name: topName, color: '#b8336a', symbol: 'diamond', data: bucketed(gShown, (s) => s.date, (s) => s.top_kg, b, { how: 'max', name: topName, fmt: kg, unit: ['session', 'sessions'] }) },
            ...(row && isNum(row.projected_e1rm_at_plan_end) && g.length
              ? [{ type: 'line' as const, name: 'Projection (trend of last 6 weeks)', color: '#2e9e7a', dash: true,
                data: [{ x: toDays(g[g.length - 1].date), y: row.last_e1rm }, { x: toDays(end), y: row.projected_e1rm_at_plan_end }] }]
              : []),
          ]}
          yFormat={(v) => fmt(v, 1)}
        />
        {row ? (
          <MetricGrid>
            <Metric label="Best estimated 1RM" value={`${fmt(row.best_e1rm, 1)} kg`} />
            <Metric label="Trend" value={isNum(row.trend_kg_per_week) ? `${fmtSigned(row.trend_kg_per_week, 1)} kg/week` : '-'} />
            <Metric label={`Projected on ${fmtShort(end)}`} value={isNum(row.projected_e1rm_at_plan_end) ? `${fmt(row.projected_e1rm_at_plan_end, 1)} kg` : '-'} />
          </MetricGrid>
        ) : null}
        <Caption>Estimated 1RM = weight x (1 + reps/30) (Epley). Holding it steady during a diet means you're keeping muscle.</Caption>
      </Section>

      <Section title={setsBucket === 'week' ? 'Weekly sets per muscle' : 'Sets per muscle, average week of each month'}>
        <Chart
          height={250}
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
        {c.range === 'Week' || c.range === 'Month' ? <Caption>Sets are counted per week, so this shows at least the last 4 weeks.</Caption> : null}
      </Section>

      <Section title="Plan vs what you did">
        {!pva.length ? (
          <Caption>Starts filling in from {fmtShort(P().firstDay)}.</Caption>
        ) : (
          <>
            <PvaTable rows={newest.slice(0, RECENT_ROWS)} />
            {newest.length > RECENT_ROWS ? (
              <Expander title={`Older sessions (${newest.length - RECENT_ROWS} exercises)`}>
                <PvaTable rows={newest.slice(RECENT_ROWS)} />
              </Expander>
            ) : null}
            <Caption>
              {logged.length} of {pva.length} planned exercises logged so far; planned load reached on {logged.filter((p) => p.hit_load).length}. Newest first.
            </Caption>
          </>
        )}
        <Expander title="All forecasts">
          <Table
            columns={['Exercise', 'Sessions', 'Best e1RM', 'Last e1RM', 'Trend kg/week', `Projected ${fmtShort(P().end)}`]}
            rows={fc.map((f) => [A.pretty(f.exercise), f.sessions, fmt(f.best_e1rm, 1), fmt(f.last_e1rm, 1), fmt(f.trend_kg_per_week, 1), fmt(f.projected_e1rm_at_plan_end, 1)])}
          />
        </Expander>
      </Section>
    </View>
  );
}
