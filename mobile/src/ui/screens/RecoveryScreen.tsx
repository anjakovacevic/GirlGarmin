import { useMemo } from 'react';
import { View } from 'react-native';

import type { Phase } from '../../analysis';
import { toDays } from '../../lib/dates';
import { fmt, mean, type Num } from '../../lib/stats';
import type { DailyRow } from '../../tables';
import { Chart, phaseBands } from '../Chart';
import { Caption, Section, Table } from '../components';
import type { Ctx } from '../context';
import { averaged, bucketed, bucketFor, inRange, rangeStart } from '../range';
import { PHASE_COLORS } from '../theme';

const CHARTS: [keyof DailyRow, string][] = [
  ['hrv_last_night', 'HRV (ms)'],
  ['resting_hr', 'Resting heart rate'],
  ['sleep_score', 'Sleep score'],
  ['body_battery_high', 'Body Battery (daily high)'],
];

export function RecoveryScreen({ c }: { c: Ctx }) {
  const r = c.d.daily;
  const bands = useMemo(() => phaseBands(c.phases, PHASE_COLORS), [c.phases]);
  const b = bucketFor(c.range, r[0]?.date);
  const shown = inRange(r, (x) => x.date, c.range);
  const from = rangeStart(c.range);
  // 7-row rolling mean of HRV (needs 3 nights in the window)
  const hrv7 = useMemo(
    () => r.map((_, i) => {
      const w = r.slice(Math.max(0, i - 6), i + 1).map((x) => x.hrv_last_night).filter((v) => v !== null);
      return w.length >= 3 ? mean(w) : null;
    }),
    [r],
  );
  const byPhase = useMemo(() => {
    const out: [Phase, DailyRow[]][] = (['follicular', 'luteal', 'period'] as Phase[]).map((p) => [p, r.filter((x) => c.phases.get(x.date) === p)]);
    return out.filter(([, rows]) => rows.length);
  }, [r, c.phases]);

  return (
    <View style={{ gap: 12 }}>
      <Section>
        <Caption>
          Shading: red = period, orange = after ovulation (HRV is normally lower and resting HR higher here).
          {b === 'day' ? '' : ` Each point is the ${b}ly average; pick Week or Month to see single nights.`}
        </Caption>
        {CHARTS.map(([col, title]) => (
          <Chart
            key={col}
            title={b === 'day' ? title : averaged(title, b)}
            height={180}
            bucket={b}
            xMin={from ? toDays(from) - 0.5 : undefined}
            vbands={bands}
            series={[
              {
                type: 'line', name: title, color: '#5d6ad1', width: b === 'day' ? 1 : 2, markers: true,
                data: bucketed(shown, (x) => x.date, (x) => x[col] as Num, b, { name: averaged(title, b), fmt: (v) => fmt(v, 1), unit: ['night', 'nights'] }),
              },
              ...(col === 'hrv_last_night' && b === 'day'
                ? [{ type: 'line' as const, name: '7-day average', color: '#b8336a', width: 3, data: r.map((x, i) => ({ x: toDays(x.date), y: hrv7[i] })).filter((q) => !from || q.x >= toDays(from)) }]
                : []),
            ]}
          />
        ))}
      </Section>
      {byPhase.length ? (
        <Section title="Your averages by cycle phase">
          <Table
            columns={['Phase', 'HRV', 'Resting HR', 'Sleep score', 'Skin temp']}
            rows={byPhase.map(([p, rows]) => [
              p, fmt(mean(rows.map((x) => x.hrv_last_night)), 1), fmt(mean(rows.map((x) => x.resting_hr)), 1),
              fmt(mean(rows.map((x) => x.sleep_score)), 1), fmt(mean(rows.map((x) => x.skin_temp_dev)), 1),
            ])}
          />
        </Section>
      ) : null}
    </View>
  );
}
