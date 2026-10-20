import { View } from 'react-native';

import * as A from '../../analysis';
import { fmtDate, timeX, toDays } from '../../lib/dates';
import { fmt, isNum, max } from '../../lib/stats';
import { Chart } from '../Chart';
import { Bullets, Caption, Expander, Metric, MetricGrid, Notice, NumberField, Rich, Section, Table } from '../components';
import type { Ctx } from '../context';
import { inRange, rangeStart } from '../range';
import { colorFor } from '../theme';

const RUN_TYPES = ['indoor_cardio', 'treadmill_running', 'running', 'stair_climbing', 'hiking', 'walking', 'cycling', 'indoor_cycling'];

const HOW_TO = [
  '**Talk test (free, good enough for most people).** After a warm-up, run or walk 20-30 min at a pace where you can speak in full sentences but wouldn\'t want to sing. Your average HR over the last 10 minutes is about the **top of zone 2**.',
  '**Threshold test (more precise).** After a warm-up, run 30 min as hard as you can hold evenly. Average HR of the last 20 min ~ your **lactate-threshold HR (LTHR)**. Zone 2 ~ 85-89% of it.',
  '**Max-HR test (hardest).** Only when healthy and well rested. After a warm-up, 3 hard uphill efforts of 2-3 min, the last one all-out. The highest number you see is close to your real max.',
];

export function ZonesScreen({ c }: { c: Ctx }) {
  const zs = c.d.zones;
  if (!zs) return <Notice text="No heart-rate zone settings yet - tap **Sync** at the top." />;
  const tests = c.hrTests;
  const adv = A.hrZoneAdvice(zs, c.d.daily, c.d.activities, tests);
  const [lo, hi] = adv.zone2;
  const allRuns = c.d.activities.filter((a) => RUN_TYPES.includes(a.type) && isNum(a.avg_hr));
  const runs = inRange(allRuns, (a) => a.date, c.range);
  const from = rangeStart(c.range);
  const typeColors = colorFor(runs.map((a) => a.type));
  const maxMin = max(runs.map((a) => a.duration_min)) || 1;
  const set = (k: keyof A.HrTests) => (v: number) => c.setHrTests({ ...tests, [k]: v });

  return (
    <View style={{ gap: 12 }}>
      <Section>
        <Expander title="Your test results (leave at 0 if you haven't done a test)" initiallyOpen={!Object.keys(tests).length}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <NumberField label="Talk test: avg HR, last 10 min" value={tests.talk_hr ?? 0} onChange={set('talk_hr')}
              help="Easiest test. 20-30 min at a pace where you can still talk in full sentences." />
            <NumberField label="Threshold test: avg HR, last 20 min" value={tests.lthr ?? 0} onChange={set('lthr')}
              help="30 min run as hard as you can hold evenly = your lactate-threshold HR." />
            <NumberField label="Max HR test: highest HR seen" value={tests.max_hr ?? 0} onChange={set('max_hr')}
              help="Only when healthy and rested: 3 hard 2-3 min hill efforts, the last all-out." />
          </View>
        </Expander>
        <MetricGrid>
          <Metric label="Your zone 2 (estimate)" value={`${lo}-${hi} bpm`} />
          <Metric
            label="Max HR in use"
            value={adv.maxUsed}
            delta={tests.max_hr ? 'from your test' : adv.maxFromFormula ? '220 - age formula' : 'your Garmin setting'}
            deltaColor="off"
          />
          <Metric label="Highest HR seen in a workout" value={isNum(adv.maxSeen) ? fmt(adv.maxSeen) : '-'} />
          <Metric label="Resting HR" value={adv.restingNow} delta={`Garmin uses ${zs.restingHr ?? 'none'}`} deltaColor="off" />
        </MetricGrid>
        <Caption>Zone 2 based on: {adv.zone2Basis}.</Caption>
      </Section>

      <Section title="What to change in Garmin">
        {adv.tips.length ? <Bullets items={adv.tips} /> : <Notice tone="success" text="Your Garmin zone settings match your data." />}
        <Caption>
          Garmin Connect app: profile picture -&gt; Settings -&gt; User Settings -&gt; Heart Rate Zones (or on the watch: Settings -&gt;
          User Profile -&gt; Heart Rate).
        </Caption>
      </Section>

      <Section title="Zones by method (bpm)">
        <Table columns={['Method', 'Zone 1', 'Zone 2', 'Zone 3', 'Zone 4', 'Zone 5']} rows={adv.table.map((r) => [r.method, ...r.zones])} />
        <Caption>Different methods give different numbers because they start from different guesses. Your own test results beat any formula.</Caption>
      </Section>

      {allRuns.length ? (
        <Section title="Average HR of your cardio sessions vs estimated zone 2">
          <Chart
            height={260}
            yTitle="average HR (bpm)"
            xMin={from ? toDays(from) - 0.5 : undefined}
            empty="No cardio sessions in this period."
            hbands={[{ y0: lo, y1: hi, color: 'rgba(60,170,90,0.18)', label: 'zone 2 estimate' }]}
            hlines={[{ y: zs.floors[1], label: 'Garmin zone 2 starts' }, { y: zs.floors[2], label: 'Garmin zone 3 starts' }]}
            legendItems={[...typeColors].map(([name, color]) => ({ name, color }))}
            series={[{
              type: 'scatter', name: 'Sessions', color: '#5d6ad1', legend: false,
              data: runs.map((a) => ({
                x: timeX(a.start), y: a.avg_hr, r: 3 + 9 * Math.sqrt(a.duration_min / maxMin), color: typeColors.get(a.type),
                label: `${fmtDate(a.date)} ${a.name} · avg ${fmt(a.avg_hr)} · max ${fmt(a.max_hr)} bpm`,
              })),
            }]}
          />
          <Caption>If easy sessions where you could chat sit above the green band, your zones are set too low.</Caption>
        </Section>
      ) : null}

      <Section>
        <Expander title="How to find your real zone 2">
          <Bullets items={HOW_TO} />
          <Rich text="Enter your result above - the zone 2 estimate, the table and the chart update. Then copy the numbers into Garmin. Not medical advice; if you have ever had heart symptoms, check with a doctor before an all-out test." />
        </Expander>
      </Section>
    </View>
  );
}
