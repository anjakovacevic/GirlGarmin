import { useMemo, useState } from 'react';
import { View } from 'react-native';

import * as A from '../../analysis';
import { addDays, fmtDate, timeX, toDays, todayISO } from '../../lib/dates';
import { fmt, fmtSigned, isNum, max, mean, pct, sum } from '../../lib/stats';
import { P } from '../../plan';
import { Chart, type Series } from '../Chart';
import { Bullets, Caption, Metric, MetricGrid, Notice, Section, Table, Toggle } from '../components';
import type { Ctx } from '../context';
import { barWidthFor, bucketed, bucketFor, inRange, rangeStart } from '../range';
import { colorFor, useTheme } from '../theme';

export function CardioScreen({ c }: { c: Ctx }) {
  const t = useTheme();
  const { d, today } = c;
  const [allActs, setAllActs] = useState(false);
  const allCardio = d.activities.filter((a) => A.CARDIO_TYPES.includes(a.type));
  const cardio = inRange(allCardio, (a) => a.date, c.range);
  const typeColors = colorFor(allCardio.map((a) => a.type));
  const typesShown = [...typeColors].filter(([k]) => cardio.some((a) => a.type === k));
  const maxMin = max(cardio.map((a) => a.duration_min)) || 1;
  const b = bucketFor(c.range, allCardio[0]?.date);
  const from = rangeStart(c.range);

  // zone minutes only exist per week / month: monthly for long all-time views, else weekly, and
  // at least the last 4 weeks so a short range still has something to compare
  const per: 'Week' | 'Month' = b === 'month' ? 'Month' : 'Week';
  const zt = useMemo(() => A.zoneTime(d.activities, !allActs), [d.activities, allActs]);
  const zp = useMemo(() => (zt.length ? A.zonePeriods(zt, per === 'Week' ? 'W' : 'M', d.daily) : []), [zt, per, d.daily]);
  const zpShown = inRange(zp, (p) => p.period, c.range, 28);
  const unit = per.toLowerCase();

  let zoneBlock = <Notice text="No heart-rate zone data yet - tap **Sync** at the top." />;
  if (zp.length) {
    const lastP = zp[zp.length - 1];
    const cur = lastP.period >= addDays(today, per === 'Week' ? -6 : -30) ? lastP : null;
    const full = cur ? zp.slice(0, -1) : zp; // leave out the week / month still in progress
    const recent = full.slice(per === 'Week' ? -4 : -3);
    const hasGarmin = zp.some((p) => p.garmin_intensity !== null);
    const easy = sum(recent.map((p) => p.z1_min + p.z2_min));
    const tot = sum(recent.flatMap((p) => A.ZONES.map((z) => p[z])));
    const avgTarget = mean(recent.map((p) => p.target_lo));
    const avgGarmin = mean(recent.map((p) => p.garmin_intensity));
    const barWidth = per === 'Week' ? 5.6 : 24;
    const series: Series[] = [
      ...A.ZONES.map((z, i) => ({
        type: 'bar' as const, name: `Zone ${i + 1}`, color: A.ZONE_COLORS[i], data: zpShown.map((p) => ({ x: toDays(p.period), y: p[z] })),
      })),
      { type: 'line', name: 'WHO minutes from workouts', color: t.text, markers: true, data: zpShown.map((p) => ({ x: toDays(p.period), y: p.moderate_eq })) },
      ...(hasGarmin
        ? [{ type: 'line' as const, name: 'Garmin all-day intensity minutes', color: '#8a6fc4', dash: true, markers: true, data: zpShown.map((p) => ({ x: toDays(p.period), y: p.garmin_intensity })) }]
        : []),
      { type: 'line', name: `WHO minimum (${A.WHO_WEEKLY_MIN[0]} min/week)`, color: '#3c9a6e', dash: true, data: zpShown.map((p) => ({ x: toDays(p.period), y: p.target_lo })) },
      { type: 'line', name: `WHO extra benefit (${A.WHO_WEEKLY_MIN[1]} min/week)`, color: '#3c9a6e', dash: true, width: 1, data: zpShown.map((p) => ({ x: toDays(p.period), y: p.target_hi })) },
    ];
    zoneBlock = (
      <>
        <Chart title={`Workout minutes per zone, per ${unit}`} height={280} yTitle="minutes" barWidth={barWidth}
          bucket={per === 'Week' ? 'week' : 'month'} series={series} yFormat={(v) => fmt(v)} />
        {c.range === 'Week' || c.range === 'Month' ? <Caption>Zone minutes are counted per week, so this chart shows at least the last 4 weeks.</Caption> : null}
        <MetricGrid>
          <Metric
            label={`WHO minutes from workouts, last ${recent.length} ${unit}s (avg)`}
            value={fmt(mean(recent.map((p) => p.moderate_eq)))}
            delta={`target ${fmt(avgTarget)}+`}
            deltaColor="off"
          />
          {hasGarmin ? (
            <Metric
              label="Garmin all-day intensity minutes (avg)"
              value={fmt(avgGarmin)}
              delta={isNum(avgGarmin) && isNum(avgTarget) ? `${fmtSigned(avgGarmin - avgTarget)} vs WHO minimum` : null}
            />
          ) : null}
          <Metric label="Easy share (zone 1-2)" value={tot ? pct(easy / tot) : '-'} delta={`target ~${pct(A.EASY_SHARE_TARGET)}`} deltaColor="off" />
          <Metric
            label="Hard minutes (zone 4-5)"
            value={fmt(sum(recent.map((p) => p.z4_min + p.z5_min)))}
            delta={`in the last ${recent.length} ${unit}s`}
            deltaColor="off"
          />
        </MetricGrid>
        {cur ? (
          <Caption>
            This {unit} so far: {fmt(cur.moderate_eq)} WHO minutes from workouts
            {cur.garmin_intensity !== null ? `, ${fmt(cur.garmin_intensity)} Garmin intensity minutes` : ''} (target{' '}
            {fmt(cur.target_lo)}+). Averages above use the last full {unit}s.
          </Caption>
        ) : null}
        <Bullets
          items={[
            `**WHO:** ${A.WHO_WEEKLY_MIN[0]}-${A.WHO_WEEKLY_MIN[1]} min of moderate activity a week (zone 2-3), where one vigorous minute (zone 4-5) counts as two, plus strength training on 2+ days. The solid line is your workouts only; Garmin's intensity minutes (purple) also count brisk walking during the day, so they are usually the fairer comparison.`,
            `**80/20 for fitness:** about ${pct(A.EASY_SHARE_TARGET)} of cardio time easy (zone 1-2), the rest harder - mostly a little zone 4-5 (like intervals) rather than lots of zone 3, which tires you without adding as much.`,
            '**Zone 5** is for short intervals only - a few minutes a week at most is plenty.',
          ]}
        />
        <Caption>
          Minutes are counted with the zones your watch had when you recorded each workout (see the Heart-rate zones tab). If you
          change your zones, only new workouts use them.
        </Caption>
      </>
    );
  }

  const vo2 = d.activities.filter((a) => isNum(a.vo2max));
  const checks = P().days.filter((x) => x.cardioKind === 'vo2check').map((x) => x.date);

  return (
    <View style={{ gap: 12 }}>
      {allCardio.length ? (
        <Section title={b === 'day' ? 'Cardio sessions' : `Cardio minutes per ${b}`}>
          {b === 'day' ? (
            <Chart
              height={240}
              yTitle="minutes"
              xMin={from ? toDays(from) - 0.5 : undefined}
              xMax={toDays(todayISO()) + 1}
              empty="No cardio sessions in this period."
              legendItems={typesShown.map(([name, color]) => ({ name, color }))}
              series={[{
                type: 'scatter', name: 'Sessions', color: '#5d6ad1', legend: false,
                data: cardio.map((a) => ({
                  x: timeX(a.start), y: a.duration_min, r: 3 + 11 * Math.sqrt(a.duration_min / maxMin), color: typeColors.get(a.type),
                  label: `${fmtDate(a.date)} ${a.name} · ${a.type} · ${fmt(a.duration_min)} min · avg HR ${fmt(a.avg_hr)} · max ${fmt(a.max_hr)}`,
                })),
              }]}
            />
          ) : (
            <Chart
              height={240}
              yTitle="minutes"
              bucket={b}
              barWidth={barWidthFor(b)}
              empty="No cardio sessions in this period."
              yFormat={(v) => fmt(v)}
              series={typesShown.map(([type, color]) => ({
                type: 'bar' as const, name: type, color,
                data: bucketed(cardio.filter((a) => a.type === type), (a) => a.date, (a) => a.duration_min, b,
                  { how: 'sum', name: type, fmt: (v) => `${fmt(v)} min`, unit: ['session', 'sessions'] }),
              }))}
            />
          )}
          <Caption>{b === 'day' ? 'Bubble size = minutes. Tap a bubble for details.' : `Total minutes each ${b}, by activity. Tap a bar for details.`}</Caption>
          <Table
            columns={['Start', 'Name', 'Type', 'Min', 'Avg HR', 'Max HR', 'Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Main zone']}
            rows={[...cardio].reverse().map((a) => {
              const zs = A.ZONES.map((z) => a[z] ?? 0);
              const total = zs.reduce((x, y) => x + y, 0);
              return [
                `${fmtDate(a.date)} ${a.start.slice(11, 16)}`, a.name, a.type, fmt(a.duration_min, 1), fmt(a.avg_hr), fmt(a.max_hr),
                ...A.ZONES.map((z) => fmt(a[z], 1)), total > 0 ? zs.indexOf(Math.max(...zs)) + 1 : '-',
              ];
            })}
          />
        </Section>
      ) : (
        <Notice text="No cardio sessions yet." />
      )}

      <Section title="Time in heart-rate zones">
        <Toggle label="Include strength training and other workouts" value={allActs} onChange={setAllActs} />
        <Caption>WHO counts any activity that gets your heart rate up; strength sessions mostly sit in zone 1-2.</Caption>
        {zoneBlock}
      </Section>

      <Section title="VO2max">
        {vo2.length ? (
          <Table columns={['Date', 'Activity', 'VO2max']} rows={[...vo2].reverse().map((a) => [fmtDate(a.date, { weekday: false, year: true }), a.name, a.vo2max])} />
        ) : (
          <Caption>No VO2max readings yet - they only come from outdoor runs/walks with GPS.</Caption>
        )}
        {checks.length ? <Caption>Plan: VO2max check runs on {checks.map((x) => fmtDate(x)).join(' and ')} - compare the readings.</Caption> : null}
      </Section>
    </View>
  );
}
