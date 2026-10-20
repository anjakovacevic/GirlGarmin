/** Cardio, shown in the Training tab: activity minutes against your weekly goal, how easy or hard
 * your cardio was, your sessions, and VO2max. */

import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import * as A from '../../analysis';
import { addDays, fmtDate, timeX, toDays, todayISO } from '../../lib/dates';
import { fmt, fmtSigned, isNum, max, mean, pct, sum } from '../../lib/stats';
import { P } from '../../plan';
import type { Activity } from '../../tables';
import { Chart } from '../Chart';
import { KeyValue, LinkCard, ListRow, Metric, MetricGrid, Notice, Section, ShowMore, Toggle } from '../components';
import type { Ctx } from '../context';
import { barWidthFor, bucketed, bucketFor, inRange, rangeStart } from '../range';
import { colorFor, useTheme } from '../theme';

const ZONES_INFO = `**Weekly goal (WHO):** ${A.WHO_WEEKLY_MIN[0]}-${A.WHO_WEEKLY_MIN[1]} minutes of moderate activity a week (zone 2-3), where a vigorous minute (zone 4-5) counts as two, plus strength training on 2+ days.

The bars use Garmin's all-day intensity minutes when your watch records them - they also count brisk walking during the day, so they're the fairer comparison. Otherwise they count your workouts only.

**Easy vs hard:** for fitness, about ${pct(A.EASY_SHARE_TARGET)} of cardio time should be easy (zone 1-2) and the rest mostly a little zone 4-5 (like intervals), rather than lots of zone 3, which tires you without adding as much. Zone 5 is for short intervals only.

Minutes use the zones your watch had when you recorded each workout.`;

const ZONE_GROUPS: [string, (p: A.ZonePeriod) => number, number][] = [
  ['Easy', (p) => p.z1_min + p.z2_min, 1],
  ['Moderate', (p) => p.z3_min, 2],
  ['Hard', (p) => p.z4_min + p.z5_min, 4],
];

const mainZone = (a: Activity) => {
  const zs = A.ZONES.map((z) => a[z] ?? 0);
  return Math.max(...zs) > 0 ? zs.indexOf(Math.max(...zs)) + 1 : null;
};

export function CardioSections({ c }: { c: Ctx }) {
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

  // zone minutes only exist per week / month: monthly for long all-time views, else weekly (at least 4 weeks)
  const per: 'Week' | 'Month' = b === 'month' ? 'Month' : 'Week';
  const unit = per.toLowerCase();
  const zt = useMemo(() => A.zoneTime(d.activities, !allActs), [d.activities, allActs]);
  const zp = useMemo(() => (zt.length ? A.zonePeriods(zt, per === 'Week' ? 'W' : 'M', d.daily) : []), [zt, per, d.daily]);
  const zpShown = inRange(zp, (p) => p.period, c.range, 28);

  let goal = <Notice text="No heart-rate zone data yet. It arrives with the next sync (or use **Sync now** in Settings)." />;
  if (zp.length) {
    const lastP = zp[zp.length - 1];
    const cur = lastP.period >= addDays(today, per === 'Week' ? -6 : -30) ? lastP : null;
    const full = cur ? zp.slice(0, -1) : zp; // leave out the week / month still in progress
    const recent = full.slice(per === 'Week' ? -4 : -3);
    const hasGarmin = zp.some((p) => p.garmin_intensity !== null);
    const minutes = (p: A.ZonePeriod) => (hasGarmin ? p.garmin_intensity : p.moderate_eq);
    const avg = mean(recent.map(minutes));
    const avgTarget = mean(recent.map((p) => p.target_lo));
    const split = ZONE_GROUPS.map(([label, f, zone]) => ({ label, zone, min: sum(zpShown.map(f)) }));
    const total = sum(split.map((s) => s.min));
    const easyShare = total ? split[0].min / total : null;

    goal = (
      <>
        <Chart
          height={210}
          yTitle="minutes"
          barWidth={per === 'Week' ? 5.6 : 24}
          bucket={per === 'Week' ? 'week' : 'month'}
          yFormat={(v) => fmt(v)}
          series={[
            { type: 'bar', name: hasGarmin ? 'Intensity minutes' : 'Minutes from workouts', color: '#5d6ad1', data: zpShown.map((p) => ({ x: toDays(p.period) + (per === 'Week' ? 3 : 14), y: minutes(p) })) },
            { type: 'line', name: 'Weekly goal', color: '#3c9a6e', dash: true, data: zpShown.map((p) => ({ x: toDays(p.period) + (per === 'Week' ? 3 : 14), y: p.target_lo })) },
          ]}
        />
        <MetricGrid>
          <Metric
            label={`Average ${unit}, last ${recent.length}`}
            value={`${fmt(avg)} min`}
            delta={isNum(avg) && isNum(avgTarget) ? `${fmtSigned(avg - avgTarget)} vs goal of ${fmt(avgTarget)}` : null}
          />
          {cur ? <Metric label={`This ${unit} so far`} value={`${fmt(minutes(cur))} min`} delta={`goal ${fmt(cur.target_lo)}`} deltaColor="off" /> : null}
        </MetricGrid>
        {total ? (
          <View style={{ gap: 6 }}>
            <Text style={{ color: t.text, fontSize: 14, fontWeight: '600' }}>
              {pct(easyShare as number)} easy <Text style={{ color: t.muted, fontWeight: '400' }}>· aim for about {pct(A.EASY_SHARE_TARGET)}</Text>
            </Text>
            <View style={[st.split, { backgroundColor: t.surface }]}>
              {split.filter((s) => s.min > 0).map((s) => (
                <View key={s.label} style={{ flex: s.min, backgroundColor: A.ZONE_COLORS[s.zone - 1] }} />
              ))}
              <View style={[st.target, { left: `${A.EASY_SHARE_TARGET * 100}%`, backgroundColor: t.text }]} />
            </View>
            <View style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>
              {split.map((s) => (
                <Text key={s.label} style={{ color: t.muted, fontSize: 12.5 }}>
                  <Text style={{ color: A.ZONE_COLORS[s.zone - 1] }}>● </Text>{s.label} {fmt(s.min)} min
                </Text>
              ))}
            </View>
          </View>
        ) : null}
        <Toggle label="Count strength and other workouts too" value={allActs} onChange={setAllActs} />
      </>
    );
  }

  const vo2 = d.activities.filter((a) => isNum(a.vo2max));
  const checks = P().days.filter((x) => x.cardioKind === 'vo2check').map((x) => x.date);
  const newest = [...cardio].reverse();

  return (
    <>
      <Section title="Cardio this period" info={ZONES_INFO}>{goal}</Section>

      {allCardio.length ? (
        <Section
          title={b === 'day' ? 'Cardio sessions' : `Cardio minutes per ${b}`}
          info={b === 'day' ? 'Bubble size = minutes. Tap a bubble, or a session below, for details.' : `Total minutes each ${b}, by activity. Tap a bar for details.`}
        >
          {b === 'day' ? (
            <Chart
              height={200}
              yTitle="minutes"
              xMin={from ? toDays(from) - 0.5 : undefined}
              xMax={toDays(todayISO()) + 1}
              empty="No cardio sessions in this period."
              legendItems={typesShown.map(([name, color]) => ({ name, color }))}
              series={[{
                type: 'scatter', name: 'Sessions', color: '#5d6ad1', legend: false,
                data: cardio.map((a) => ({
                  x: timeX(a.start), y: a.duration_min, r: 3 + 11 * Math.sqrt(a.duration_min / maxMin), color: typeColors.get(a.type),
                  label: `${fmtDate(a.date)} ${a.name} · ${fmt(a.duration_min)} min · avg HR ${fmt(a.avg_hr)}`,
                })),
              }]}
            />
          ) : (
            <Chart
              height={200}
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
          <ShowMore
            items={newest}
            limit={4}
            render={(a) => {
              const z = mainZone(a);
              return (
                <ListRow key={a.activity_id} title={a.name} sub={`${fmtDate(a.date)} · ${fmt(a.duration_min)} min${z ? ` · mostly zone ${z}` : ''}`}>
                  <KeyValue label="Started" value={a.start.slice(11, 16)} />
                  <KeyValue label="Average / max heart rate" value={`${fmt(a.avg_hr)} / ${fmt(a.max_hr)} bpm`} />
                  {A.ZONES.map((zk, i) => <KeyValue key={zk} label={`Zone ${i + 1}`} value={`${fmt(a[zk], 1)} min`} />)}
                </ListRow>
              );
            }}
          />
        </Section>
      ) : null}

      <Section
        title="VO2max"
        info={`VO2max readings only come from outdoor runs or walks with GPS.${checks.length ? `\n\nYour plan has check runs on ${checks.map((x) => fmtDate(x)).join(' and ')} - compare the readings.` : ''}`}
      >
        {vo2.length ? (
          <MetricGrid>
            <Metric label="Latest" value={String(vo2[vo2.length - 1].vo2max)} delta={fmtDate(vo2[vo2.length - 1].date, { weekday: false, year: true })} deltaColor="off" />
            {vo2.length > 1 ? (
              <Metric label={`Since ${fmtDate(vo2[0].date, { weekday: false })}`} value={fmtSigned((vo2[vo2.length - 1].vo2max as number) - (vo2[0].vo2max as number), 0)} />
            ) : null}
          </MetricGrid>
        ) : (
          <Text style={{ color: t.muted, fontSize: 14 }}>No readings yet.</Text>
        )}
      </Section>

      <LinkCard title="Heart-rate zones" sub="Check your zones and what to change in Garmin" onPress={() => c.open('zones')} />
    </>
  );
}

const st = StyleSheet.create({
  split: { height: 12, borderRadius: 6, overflow: 'hidden', flexDirection: 'row' },
  target: { position: 'absolute', top: -2, bottom: -2, width: 2, marginLeft: -1 },
});
