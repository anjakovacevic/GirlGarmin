/** Recovery tab: HRV, resting heart rate, sleep score and Body Battery as compact rows (tap one for
 * its chart), then sleep. */

import { useMemo } from 'react';
import { View } from 'react-native';

import { toDays } from '../../lib/dates';
import { fmt, fmtSigned, isNum, mean, median, type Num } from '../../lib/stats';
import type { DailyRow } from '../../tables';
import { Chart, phaseBands } from '../Chart';
import { Section } from '../components';
import type { Ctx } from '../context';
import { averaged, bucketed, bucketFor, inRange, rangeStart } from '../range';
import { PHASE_COLORS } from '../theme';
import { TrendRow } from '../TrendRow';
import { SleepSections } from './SleepScreen';

/** column, label, unit, digits, is higher better */
const METRICS: [keyof DailyRow, string, string, number, boolean][] = [
  ['hrv_last_night', 'HRV last night', ' ms', 0, true],
  ['resting_hr', 'Resting heart rate', ' bpm', 0, false],
  ['sleep_score', 'Sleep score', '', 0, true],
  ['body_battery_high', 'Body Battery high', '', 0, true],
];

const INFO = `Each row shows the latest value and how it compares with **your normal** (the median of your last 30 days). Tap a row for the chart.

Chart shading: red = period, orange = after ovulation. HRV is normally a little lower and resting heart rate a little higher after ovulation, so a dip there is expected.`;

export function RecoveryScreen({ c }: { c: Ctx }) {
  const r = c.d.daily;
  const bands = useMemo(() => phaseBands(c.phases, PHASE_COLORS), [c.phases]);
  const b = bucketFor(c.range, r[0]?.date);
  const shown = inRange(r, (x) => x.date, c.range);
  const from = rangeStart(c.range);
  // 7-night rolling mean of HRV (needs 3 nights in the window)
  const hrv7 = useMemo(
    () => r.map((_, i) => {
      const w = r.slice(Math.max(0, i - 6), i + 1).map((x) => x.hrv_last_night).filter((v) => v !== null);
      return w.length >= 3 ? mean(w) : null;
    }),
    [r],
  );

  return (
    <View style={{ gap: 14 }}>
      <Section title="Recovery" info={INFO}>
        {METRICS.map(([col, label, unit, digits, higherBetter]) => {
          const vals = r.filter((x) => isNum(x[col] as Num));
          const latest = vals.length ? (vals[vals.length - 1][col] as number) : null;
          const normal = median(vals.slice(-30).map((x) => x[col] as Num));
          const diff = isNum(latest) && isNum(normal) ? latest - normal : null;
          const data = bucketed(shown, (x) => x.date, (x) => x[col] as Num, b, { name: averaged(label, b), fmt: (v) => fmt(v, 1), unit: ['night', 'nights'] });
          return (
            <TrendRow
              key={col}
              label={label}
              value={isNum(latest) ? `${fmt(latest, digits)}${unit}` : '-'}
              delta={isNum(diff) ? `${fmtSigned(diff, digits)}${unit} vs your normal` : null}
              tone={!isNum(diff) || Math.abs(diff) < 0.5 ? 'off' : (diff > 0) === higherBetter ? 'good' : 'bad'}
              data={data}
            >
              <Chart
                height={180}
                bucket={b}
                xMin={from ? toDays(from) - 0.5 : undefined}
                vbands={bands}
                series={[
                  { type: 'line', name: averaged(label, b), color: '#5d6ad1', width: b === 'day' ? 1 : 2, markers: true, data },
                  ...(col === 'hrv_last_night' && b === 'day'
                    ? [{ type: 'line' as const, name: '7-night average', color: '#b8336a', width: 3, data: r.map((x, i) => ({ x: toDays(x.date), y: hrv7[i] })).filter((q) => !from || q.x >= toDays(from)) }]
                    : []),
                ]}
              />
            </TrendRow>
          );
        })}
      </Section>
      <SleepSections c={c} />
    </View>
  );
}
