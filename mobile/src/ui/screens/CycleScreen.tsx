import { useMemo } from 'react';
import { View } from 'react-native';

import { addDays, diffDays, fmtDate, fmtShort, toDays } from '../../lib/dates';
import { fmt } from '../../lib/stats';
import { Chart, phaseBands } from '../Chart';
import { Caption, Metric, MetricGrid, Notice, Section, Table } from '../components';
import type { Ctx } from '../context';
import { inRange } from '../range';
import { PHASE_COLORS } from '../theme';

export function CycleScreen({ c }: { c: Ctx }) {
  const { pred, info, today } = c;
  const bands = useMemo(() => phaseBands(c.phases, PHASE_COLORS), [c.phases]);
  if (!pred) return <Notice text="Log your periods in Garmin Connect (Menstrual Cycle) to see predictions here." />;

  // always single nights: averaging would hide the rise after ovulation
  const temps = inRange(c.d.daily.filter((x) => x.skin_temp_dev !== null), (x) => x.date, c.range);
  const fs = pred.fertileStart;
  const fe = pred.fertileEnd;
  const fertile = fs && fe ? (fs.slice(0, 7) === fe.slice(0, 7) ? `${fs.slice(8)}-${fmtShort(fe)}` : `${fmtShort(fs)}-${fmtShort(fe)}`) : '-';

  return (
    <View style={{ gap: 12 }}>
      <Section>
        <MetricGrid>
          <Metric label="Cycle day" value={pred.cycleDay} delta={pred.phase} deltaColor="off" />
          <Metric label="Next period (estimate)" value={fmtDate(pred.nextPeriod)} delta={`in ${diffDays(pred.nextPeriod, today)} days`} deltaColor="off" />
          <Metric
            label="Ovulation"
            value={pred.ovulation ? fmtShort(pred.ovulation) : '-'}
            delta={pred.ovulationConfirmed ? 'confirmed by temperature' : 'estimate - no temperature rise yet'}
            deltaColor="off"
          />
          <Metric label="Fertile window (estimate)" value={fertile} />
        </MetricGrid>
        <Caption>
          Next period based on: {pred.nextPeriodBasis}.{pred.medianCycle ? ` Your median cycle: ${fmt(pred.medianCycle)} days.` : ''}
        </Caption>
      </Section>

      <Section title="Skin temperature">
        {temps.length ? (
          <Chart
            height={280}
            yTitle="deg C vs your baseline"
            xMin={toDays(temps[0].date) - 2}
            xMax={toDays(pred.nextPeriod) + 5}
            vbands={[
              ...bands,
              { x0: toDays(addDays(pred.nextPeriod, -2)), x1: toDays(addDays(pred.nextPeriod, 2)), color: 'rgba(220,60,90,0.25)', label: 'predicted period' },
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
          <Caption>No skin temperature readings in this period - your watch needs to measure overnight skin temperature.</Caption>
        )}
        <Caption>
          Red lines = period start. Dotted orange = ovulation (from the temperature rise, or Garmin's estimate). Look for 3+ nights
          clearly above the previous 6 = ovulation has happened; a drop back below 0 = period within ~1-2 days. Ignore
          single-night spikes.
        </Caption>
      </Section>

      <Section title="Your cycles">
        <Table
          columns={['Cycle start', 'Length (days)', 'Temperature rise on day', 'Ovulation', 'Days ovulation -> period']}
          rows={[...info].reverse().map((ci) => [
            fmtDate(ci.start, { weekday: false, year: true }), ci.length ?? 'current', ci.shiftDay ?? '-',
            ci.ovulation ? `${fmtShort(ci.ovulation)} (${ci.ovulationSource})` : '-', ci.lutealDays ?? '-',
          ])}
        />
        <Caption>
          Wrist temperature confirms ovulation after the fact (within ~3 days in ~78% of cycles in studies). Good for predicting
          your period - not reliable enough for contraception.
        </Caption>
      </Section>
    </View>
  );
}
