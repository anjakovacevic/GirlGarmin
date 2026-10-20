/** One metric as a compact row: latest value, how it compares with your normal, and a small trend
 * line. Tap it to open the full chart. */

import { type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { isNum } from '../lib/stats';
import type { Pt } from './Chart';
import { ChevronIcon } from './icons';
import { useTheme } from './theme';

const W = 72;
const H = 28;

function Sparkline({ data, color }: { data: Pt[]; color: string }) {
  const pts = data.filter((p): p is Pt & { y: number } => isNum(p.y)).sort((a, b) => a.x - b.x);
  if (pts.length < 2) return <View style={{ width: W, height: H }} />;
  const [x0, x1] = [pts[0].x, pts[pts.length - 1].x];
  const ys = pts.map((p) => p.y);
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = (x: number) => 2 + ((x - x0) / (x1 - x0 || 1)) * (W - 4);
  const sy = (y: number) => 3 + (1 - (y - y0) / (y1 - y0 || 1)) * (H - 6);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return (
    <Svg width={W} height={H}>
      <Path d={d} stroke={color} strokeWidth={1.6} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={sx(last.x)} cy={sy(last.y)} r={2.6} fill={color} />
    </Svg>
  );
}

/** `tone`: whether the change from normal is good, bad or neither (colours the comparison). */
export function TrendRow({ label, value, delta, tone = 'off', data, children }: {
  label: string; value: string; delta?: string | null; tone?: 'good' | 'bad' | 'off'; data: Pt[]; children: ReactNode;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const color = tone === 'good' ? t.good : tone === 'bad' ? t.bad : t.muted;
  return (
    <View style={[st.row, { borderTopColor: t.border }]}>
      <Pressable onPress={() => setOpen(!open)} style={st.head} accessibilityRole="button" accessibilityState={{ expanded: open }}
        accessibilityHint={open ? 'Hides the chart' : 'Shows the chart'}>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={{ color: t.muted, fontSize: 13 }}>{label}</Text>
          <Text style={[st.value, { color: t.text }]}>{value}</Text>
          {delta ? <Text style={{ color, fontSize: 12.5, fontWeight: '600' }}>{delta}</Text> : null}
        </View>
        <Sparkline data={data} color={t.accent} />
        <ChevronIcon color={t.muted} dir={open ? 'up' : 'down'} size={16} />
      </Pressable>
      {open ? children : null}
    </View>
  );
}

const st = StyleSheet.create({
  row: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  value: { fontSize: 20, fontWeight: '700', letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
});
