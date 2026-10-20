import { View } from 'react-native';

import * as A from '../../analysis';
import { diffDays, fmtShort, toDays } from '../../lib/dates';
import { fmt, fmtSigned } from '../../lib/stats';
import { P } from '../../plan';
import { Chart, type Series } from '../Chart';
import { Caption, Metric, MetricGrid, Notice, Section, Segmented } from '../components';
import type { Ctx } from '../context';
import { averaged, bucketed, bucketFor, inRange, rangeStart } from '../range';

const GOALS = ['Just track my weight', 'Lose weight'] as const;

export function BodyScreen({ c }: { c: Ctx }) {
  const { d, range } = c;
  const allSteps = d.daily.filter((x) => x.steps !== null);
  const steps = inRange(allSteps, (x) => x.date, range);
  const sb = bucketFor(range, allSteps[0]?.date);
  const stepsName = averaged('Steps a day', sb);
  const stepsChart = (
    <Section title={sb === 'day' ? 'Daily steps' : `Steps a day, ${sb}ly average`}>
      <Chart
        height={180}
        bucket={sb}
        series={[{
          type: 'bar', name: stepsName, color: '#5d6ad1',
          data: bucketed(steps, (x) => x.date, (x) => x.steps, sb, { name: stepsName, fmt: (v) => fmt(v) }),
        }]}
        hlines={[{ y: 10000 }]}
      />
    </Section>
  );
  if (!d.weight.length) {
    return (
      <View style={{ gap: 12 }}>
        <Notice text="No weigh-ins yet. Log your weight in Garmin Connect 3-4 mornings a week." />
        {stepsChart}
      </View>
    );
  }

  const lose = c.settings.goal === 'lose';
  const w = d.weight;
  const wt = A.weightForecast(w); // the trend always uses every weigh-in
  const shown = inRange(w, (x) => x.date, range);
  const wb = bucketFor(range, w[0].date);
  const from = rangeStart(range) ?? w[0].date;
  const trendFrom = from > w[0].date ? from : w[0].date;
  const last = w[w.length - 1];
  const end = P().end;
  const weeksLeft = Math.max(diffDays(end, last.date) / 7, 0);
  const [lo, hi] = A.lossTarget(last.weight_kg);
  const [pctLo, pctHi] = A.TARGET_LOSS_PCT_PER_WEEK;
  const series: Series[] = [];
  if (lose) {
    series.push({
      type: 'area', name: `Target pace (-${lo} to -${hi} kg/week)`, color: 'rgba(46,160,67,0.18)',
      data: [
        { x: toDays(last.date), y: last.weight_kg }, { x: toDays(end), y: last.weight_kg - lo * weeksLeft },
        { x: toDays(end), y: last.weight_kg - hi * weeksLeft }, { x: toDays(last.date), y: last.weight_kg },
      ],
    });
  }
  const wName = averaged('Weigh-ins', wb);
  series.push({
    type: 'line', name: wName, color: '#5d6ad1', markers: true,
    data: bucketed(shown, (x) => x.date, (x) => x.weight_kg, wb, { name: wName, fmt: (v) => `${fmt(v, 1)} kg`, unit: ['weigh-in', 'weigh-ins'] }),
  });
  if (wt) {
    series.push({
      type: 'line', name: 'Your trend so far', color: '#b8336a', dash: true,
      data: [{ x: toDays(trendFrom), y: wt.projected - (wt.perWeek / 7) * diffDays(end, trendFrom) }, { x: toDays(end), y: wt.projected }],
    });
  }

  return (
    <View style={{ gap: 12 }}>
      <Section title="Your goal">
        <Segmented options={[...GOALS]} value={GOALS[lose ? 1 : 0]} onChange={(g) => c.setGoal(g === GOALS[1] ? 'lose' : 'track')} />
        <Caption>Choosing "Lose weight" shows a safe pace band based on your current weight.</Caption>
      </Section>
      <Section title="Weight">
        <Chart height={280} yTitle="kg" bucket={wb} xMin={toDays(from) - 1} series={series} yFormat={(v) => fmt(v, 1)}
          empty="No weigh-ins in this period." />
        <MetricGrid>
          <Metric label="Latest" value={`${fmt(last.weight_kg, 1)} kg`} delta={fmtShort(last.date)} deltaColor="off" />
          {wt ? <Metric label="Trend" value={`${fmtSigned(wt.perWeek, 2)} kg/week`} /> : null}
          {wt ? <Metric label={`Projected ${fmtShort(end)} at this trend`} value={`${fmt(wt.projected, 1)} kg`} /> : null}
        </MetricGrid>
        <Caption>
          {lose
            ? `Target pace: -${lo} to -${hi} kg/week (${pctLo}-${pctHi}% of your current weight, which keeps strength and muscle best) -> about ` +
              `${fmt(last.weight_kg - hi * weeksLeft, 1)}-${fmt(last.weight_kg - lo * weeksLeft, 1)} kg by ${fmtShort(end)}. `
            : ''}
          The trend line uses all your weigh-ins, so it catches up a few weeks after you change your eating. Weight swings ~1 kg
          day to day - judge the weekly average.
        </Caption>
      </Section>
      {stepsChart}
    </View>
  );
}
