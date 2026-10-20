/** Cycle tab: where you are and what comes next, skin temperature, how your cycle phases affect
 * recovery and sleep, and your past cycles. */

import { useMemo } from 'react';
import { View } from 'react-native';

import * as A from '../../analysis';
import { addDays, diffDays, fmtDate, fmtShort, toDays, todayISO } from '../../lib/dates';
import { fmt, isNum, mean, round } from '../../lib/stats';
import { Chart, phaseBands } from '../Chart';
import { Caption, KeyValue, ListRow, Metric, MetricGrid, Notice, Section, ShowMore } from '../components';
import type { Ctx } from '../context';
import { inRange, rangeStart } from '../range';
import { PHASE_COLORS } from '../theme';

const PHASE_NAMES: Record<A.Phase, string> = { period: 'Period', follicular: 'Before ovulation', luteal: 'After ovulation' };

const TEMP_INFO = `Each bar is one night's skin temperature compared with your baseline.

**Red lines** = period start. **Dotted orange** = ovulation (from the temperature rise, or Garmin's estimate).

3+ nights clearly above the previous 6 means ovulation has happened; a drop back below 0 means your period is likely within 1-2 days. Ignore single-night spikes.

This chart always shows single nights - averaging would hide the rise.`;

const CYCLES_INFO = `Wrist temperature confirms ovulation after the fact (within about 3 days in ~78% of cycles in studies). Good for predicting your period - **not reliable enough for contraception**.`;

export function CycleScreen({ c }: { c: Ctx }) {
  const { pred, info, today } = c;
  const bands = useMemo(() => phaseBands(c.phases, PHASE_COLORS), [c.phases]);
  const nights = useMemo(() => A.sleepNights(c.d.daily, c.phases), [c.d.daily, c.phases]);
  if (!pred) return <Notice text="Log your periods in Garmin Connect (Menstrual Cycle) to see predictions here." />;

  const temps = inRange(c.d.daily.filter((x) => x.skin_temp_dev !== null), (x) => x.date, c.range);
  const fs = pred.fertileStart;
  const fe = pred.fertileEnd;
  // the chart covers the chosen range up to today; the predicted period shows only when it falls inside it
  const end = todayISO();
  const from = rangeStart(c.range) ?? temps[0]?.date ?? end;
  const predicted = { x0: toDays(addDays(pred.nextPeriod, -2)), x1: toDays(addDays(pred.nextPeriod, 2)) };
  const predictedShown = predicted.x0 <= toDays(end) + 0.5;
  const fertile = fs && fe ? (fs.slice(0, 7) === fe.slice(0, 7) ? `${fs.slice(8)}-${fmtShort(fe)}` : `${fmtShort(fs)}-${fmtShort(fe)}`) : '-';

  // how each phase compares: recovery averages, and how often a long night still didn't restore you
  const phases = (['period', 'follicular', 'luteal'] as A.Phase[])
    .map((p) => ({ p, days: c.d.daily.filter((x) => c.phases.get(x.date) === p), long: nights.filter((n) => n.phase === p && (n.sleep_h as number) >= A.LONG_NIGHT_H) }))
    .filter((x) => x.days.length);
  const share = (rows: A.Night[], k: 'low_battery' | 'low_deep') => {
    const m = mean(rows.map((n) => (n[k] ? 1 : 0)));
    return isNum(m) && rows.length ? `${round(m * 100)}%` : '-';
  };

  return (
    <View style={{ gap: 14 }}>
      <Section info={`Next period based on: ${pred.nextPeriodBasis}.${pred.medianCycle ? ` Your median cycle is ${fmt(pred.medianCycle)} days.` : ''}`} title="Now">
        <MetricGrid>
          <Metric label="Cycle day" value={pred.cycleDay} delta={pred.phase} deltaColor="off" />
          <Metric label="Next period" value={fmtDate(pred.nextPeriod)} delta={`in ${diffDays(pred.nextPeriod, today)} days (estimate)`} deltaColor="off" />
          <Metric
            label="Ovulation"
            value={pred.ovulation ? fmtShort(pred.ovulation) : '-'}
            delta={pred.ovulationConfirmed ? 'confirmed by temperature' : 'estimate'}
            deltaColor="off"
          />
          <Metric label="Fertile window" value={fertile} delta="estimate" deltaColor="off" />
        </MetricGrid>
      </Section>

      <Section title="Skin temperature" info={TEMP_INFO}>
        {temps.length ? (
          <Chart
            height={260}
            yTitle="°C vs your baseline"
            xMin={toDays(from) - 0.5}
            xMax={toDays(end) + 0.5}
            vbands={[
              ...bands,
              ...(predictedShown ? [{ ...predicted, color: 'rgba(220,60,90,0.25)', label: 'predicted period' }] : []),
            ]}
            vlines={info.flatMap((ci) => [
              { x: toDays(ci.start), color: '#c8424f', width: 2 },
              ...(ci.ovulation ? [{ x: toDays(ci.ovulation), color: '#d99a3a', dash: true }] : []),
            ])}
            yFormat={(v) => fmt(v, 1)}
            series={[{
              type: 'bar', name: 'Skin temp vs baseline', color: '#c8424f',
              data: temps.map((x) => ({ x: toDays(x.date), y: x.skin_temp_dev, color: (x.skin_temp_dev as number) > 0 ? '#c8424f' : '#5d86d6' })),
            }]}
          />
        ) : (
          <Caption>No skin temperature readings in this period.</Caption>
        )}
      </Section>

      {phases.length ? (
        <Section
          title="How your cycle affects you"
          info={'Your averages in each phase, from all your data. Tap a phase for details.\n\n"Long nights that didn\'t restore you" counts 7h+ nights with low Body Battery gain or little deep sleep. Patterns, not proof.'}
        >
          {phases.map(({ p, days, long }) => (
            <ListRow
              key={p}
              title={PHASE_NAMES[p]}
              sub={`HRV ${fmt(mean(days.map((x) => x.hrv_last_night)))} ms · resting HR ${fmt(mean(days.map((x) => x.resting_hr)))} · sleep score ${fmt(mean(days.map((x) => x.sleep_score)))}`}
            >
              <KeyValue label="HRV" value={`${fmt(mean(days.map((x) => x.hrv_last_night)), 1)} ms`} />
              <KeyValue label="Resting heart rate" value={`${fmt(mean(days.map((x) => x.resting_hr)), 1)} bpm`} />
              <KeyValue label="Sleep score" value={fmt(mean(days.map((x) => x.sleep_score)), 1)} />
              <KeyValue label="Skin temperature" value={`${fmt(mean(days.map((x) => x.skin_temp_dev)), 2)} °C`} />
              <KeyValue label="Long nights with low Body Battery gain" value={share(long, 'low_battery')} />
              <KeyValue label="Long nights with little deep sleep" value={share(long, 'low_deep')} />
              <KeyValue label="Days counted" value={String(days.length)} />
            </ListRow>
          ))}
        </Section>
      ) : null}

      <Section title="Your cycles" info={CYCLES_INFO}>
        <ShowMore
          items={[...info].reverse()}
          limit={4}
          render={(ci) => (
            <ListRow
              key={ci.start}
              title={`Started ${fmtDate(ci.start, { weekday: false, year: true })}`}
              sub={ci.length ? `${ci.length} days` : 'current cycle'}
            >
              <KeyValue label="Ovulation" value={ci.ovulation ? `${fmtShort(ci.ovulation)} (${ci.ovulationSource})` : '-'} />
              <KeyValue label="Temperature rise on cycle day" value={ci.shiftDay ? String(ci.shiftDay) : '-'} />
              <KeyValue label="Days from ovulation to period" value={ci.lutealDays ? String(ci.lutealDays) : '-'} />
            </ListRow>
          )}
        />
      </Section>
      <Caption>Cycle predictions are estimates and not suitable for contraception.</Caption>
    </View>
  );
}
