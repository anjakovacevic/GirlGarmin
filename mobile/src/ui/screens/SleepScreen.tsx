import { useMemo } from 'react';
import { View } from 'react-native';

import * as A from '../../analysis';
import { clockText, fmtDate, toDays } from '../../lib/dates';
import { fmt, fmtSigned, isNum, mean, median, type Num, round } from '../../lib/stats';
import { Chart, phaseBands } from '../Chart';
import { Bullets, Caption, Metric, MetricGrid, Notice, Rich, Section, Table } from '../components';
import type { Ctx } from '../context';
import { averaged, bucketed, bucketFor, inRange, rangeStart } from '../range';
import { PHASE_COLORS } from '../theme';

// pd.cut(bed_h, [0, 23, 24, 24.5, 48]): right-inclusive bins
const BED_BINS: [number, number, string][] = [
  [0, 23, 'before 23:00'], [23, 24, '23-24'], [24, A.LATE_BED_H, '24-00:30'], [A.LATE_BED_H, 48, 'after 00:30'],
];

export function SleepScreen({ c }: { c: Ctx }) {
  const nights = useMemo(() => A.sleepNights(c.d.daily, c.phases), [c.d.daily, c.phases]);
  const bands = useMemo(() => phaseBands(c.phases, PHASE_COLORS), [c.phases]);
  if (!nights.length) return <Notice text="Tap **Sync** at the top to load sleep details." />;

  const last = nights[nights.length - 1];
  const recent = nights.slice(-30);
  const usual = (col: keyof A.Night) => median(recent.map((n) => n[col] as Num));
  /** [value, delta] for a metric; '-' and no delta when your watch doesn't measure it. */
  const vsUsual = (col: keyof A.Night, digits: number, unit = ''): [string, string | null] => {
    const v = last[col] as Num;
    const u = usual(col);
    if (!isNum(v)) return ['-', null];
    return [`${fmt(v, digits)}${unit}`, isNum(u) ? `${fmtSigned(v - u, digits)}${unit} vs usual` : null];
  };
  const [deep, deepDelta] = vsUsual('deep_min', 0, ' min');
  const long = nights.filter((n) => (n.sleep_h as number) >= A.LONG_NIGHT_H);
  const tips = A.sleepTips(nights);
  const compare = A.sleepCompare(nights);
  const kindsSeen = Object.entries(A.SLEEP_KINDS).filter(([k]) => nights.some((n) => n.kind === k));
  const b = bucketFor(c.range, nights[0].date);
  const shown = inRange(nights, (n) => n.date, c.range);
  const from = rangeStart(c.range);
  const hoursName = averaged('Hours asleep', b);

  const bins = BED_BINS.map(([a, b, label]) => {
    const g = long.filter((n) => isNum(n.bed_h) && n.bed_h > a && n.bed_h <= b);
    return { label, median: median(g.map((n) => n.deep_min)), count: g.filter((n) => isNum(n.deep_min)).length, any: g.length > 0 };
  }).filter((x) => x.any);
  const phasesSeen = (['period', 'follicular', 'luteal'] as const).filter((p) => long.some((n) => n.phase === p));
  const rate = (p: string, k: 'low_battery' | 'low_deep') => {
    const m = mean(long.filter((n) => n.phase === p).map((n) => (n[k] ? 1 : 0)));
    return isNum(m) ? round(m * 100) : null;
  };

  return (
    <View style={{ gap: 12 }}>
      <Section title={`Last night (${fmtDate(last.date)}): ${last.kind}`}>
        <MetricGrid>
          <Metric label="Sleep" value={vsUsual('sleep_h', 1, ' h')[0]} delta={vsUsual('sleep_h', 1, ' h')[1]} />
          <Metric label="Deep sleep" value={deep + (isNum(last.deep_pct) ? ` (${fmt(last.deep_pct)}%)` : '')} delta={deepDelta} />
          <Metric label="Body Battery gained" value={vsUsual('body_battery_gain', 0)[0]} delta={vsUsual('body_battery_gain', 0)[1]} />
          <Metric label="Stress during sleep" value={vsUsual('sleep_stress', 0)[0]} delta={vsUsual('sleep_stress', 0)[1]} deltaColor="inverse" />
          <Metric label="Bedtime" value={clockText(last.bedtime)} />
        </MetricGrid>
        <Caption>
          'Usual' = median of your last 30 nights. A night counts as restorative when it is 7+ h, Body Battery gains more than{' '}
          {A.LOW_BATTERY_GAIN} (or you wake above {A.LOW_BATTERY_WAKE}) and deep sleep is at least {A.LOW_DEEP_PCT}% of the night.
        </Caption>
      </Section>

      <Section title={b === 'day' ? 'Every night' : `Hours asleep, ${b}ly average`}>
        <Chart
          height={230}
          yTitle="hours asleep"
          bucket={b}
          xMin={from ? toDays(from) - 1 : undefined}
          vbands={bands}
          hlines={[{ y: A.LONG_NIGHT_H }]}
          legendItems={b === 'day' ? kindsSeen.map(([name, color]) => ({ name, color })) : undefined}
          yFormat={(v) => fmt(v, 1)}
          series={b !== 'day' ? [{
            type: 'bar', name: hoursName, color: '#8a6fc4', legend: false,
            data: bucketed(shown, (n) => n.date, (n) => n.sleep_h, b, { name: hoursName, fmt: (v) => `${fmt(v, 1)} h`, unit: ['night', 'nights'] }),
          }] : [{
            type: 'bar', name: 'Sleep', color: '#b3b0bb', legend: false,
            data: shown.map((n) => ({
              x: toDays(n.date), y: n.sleep_h, color: A.SLEEP_KINDS[n.kind],
              label: `${fmt(n.sleep_h, 1)} h, ${n.kind} · deep ${fmt(n.deep_min)} min · battery +${fmt(n.body_battery_gain)} · stress ${fmt(n.sleep_stress)}`,
            })),
          }]}
        />
      </Section>

      <Section title="What would help - from your own nights">
        {tips.length ? <Bullets items={tips} /> : <Rich text="No clear pattern yet - check back after more nights." />}
      </Section>

      <Section title="Long nights that didn't restore you - what was different">
        <Table columns={compare.columns} rows={compare.rows} />
        <Caption>Medians of your 7h+ nights. Stress and heart rate during sleep usually explain low battery far better than hours slept.</Caption>
      </Section>

      <Section title="7h+ nights: calmer sleep = more battery">
        <Chart
          height={230}
          xKind="number"
          xTitle="stress during sleep"
          yTitle="Body Battery gained"
          legendItems={kindsSeen.filter(([k]) => k !== 'short (<7 h)').map(([name, color]) => ({ name, color }))}
          series={[{
            type: 'scatter', name: 'Nights', color: '#5d6ad1', legend: false,
            data: long.filter((n) => isNum(n.sleep_stress)).map((n) => ({
              x: n.sleep_stress as number, y: n.body_battery_gain, color: A.SLEEP_KINDS[n.kind],
              label: `${fmtDate(n.date)} · ${fmt(n.sleep_h, 1)} h · stress ${fmt(n.sleep_stress)} · battery +${fmt(n.body_battery_gain)}`,
            })),
          }]}
        />
      </Section>

      <Section title="Deep sleep by bedtime (7h+ nights)">
        <Chart
          height={200}
          xKind="category"
          categories={bins.map((b) => b.label)}
          yTitle="deep sleep (median min)"
          series={[{ type: 'bar', name: 'Deep sleep', color: '#8a6fc4', data: bins.map((b, i) => ({ x: i, y: b.median, text: `${b.count} nights` })) }]}
          barMode="group"
        />
      </Section>

      {phasesSeen.length ? (
        <Section title="Share of 7h+ nights with a problem, by cycle phase">
          <Chart
            height={200}
            xKind="category"
            categories={[...phasesSeen]}
            yTitle="% of nights"
            barMode="group"
            series={[
              { type: 'bar', name: 'low_battery', color: '#d99a3a', data: phasesSeen.map((p, i) => ({ x: i, y: rate(p, 'low_battery') })) },
              { type: 'bar', name: 'low_deep', color: '#8a6fc4', data: phasesSeen.map((p, i) => ({ x: i, y: rate(p, 'low_deep') })) },
            ]}
          />
          <Caption>Patterns, not proof - and not medical advice.</Caption>
        </Section>
      ) : (
        <Caption>Patterns, not proof - and not medical advice.</Caption>
      )}
    </View>
  );
}
