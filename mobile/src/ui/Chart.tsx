/** A small SVG chart for the dashboard: lines, bars (stacked or grouped), scatter/bubbles and
 * filled areas, with shaded bands (cycle phases, target ranges) and reference lines. Tap a point
 * to see its values. x is a number: days since 1970 for time charts (see lib/dates toDays), or
 * the category index for category charts. */

import { type ReactNode, useId, useMemo, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';

import { fmtShort, fromDays, MONTHS } from '../lib/dates';
import { isNum, round } from '../lib/stats';
import { type Bucket, bucketStart, bucketTitle, barWidthFor } from './range';
import { useTheme } from './theme';

export interface Pt {
  x: number;
  y: number | null;
  color?: string; // overrides the series colour for this point
  r?: number; // bubble radius in px (scatter)
  label?: string; // what a tap shows for this point (instead of "series: value")
  text?: string; // drawn above the bar (grouped bars only)
}

interface Base {
  name: string;
  color: string;
  data: Pt[];
  legend?: boolean; // false = not in the legend
}
export type Series =
  | (Base & { type: 'line'; dash?: boolean; width?: number; markers?: boolean })
  | (Base & { type: 'bar' })
  | (Base & { type: 'scatter'; symbol?: 'circle' | 'diamond' })
  | (Base & { type: 'area' });

export interface ChartProps {
  title?: string;
  height?: number;
  xKind?: 'time' | 'number' | 'category';
  categories?: string[];
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  yTitle?: string;
  xTitle?: string;
  series: Series[];
  vbands?: { x0: number; x1: number; color: string; label?: string }[];
  hbands?: { y0: number; y1: number; color: string; label?: string }[];
  hlines?: { y: number; color?: string; dash?: boolean; label?: string }[];
  vlines?: { x: number; color?: string; dash?: boolean; width?: number }[];
  barMode?: 'stack' | 'group';
  barWidth?: number; // in x units (default: 1 day / category)
  legendItems?: { name: string; color: string }[]; // extra legend entries (e.g. per-point colours)
  yFormat?: (v: number) => string;
  /** Time charts of weekly / monthly averages: sets the bar width and what a tap shows as the date. */
  bucket?: Bucket;
  /** Shown instead of an empty chart when no series has data. */
  empty?: string;
}

const PAD = { left: 40, right: 10, top: 10, bottom: 24 };

/** About `count` round tick values covering [lo, hi]. */
function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (lo === hi) return [lo];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(round(v, 6));
  return out;
}

const tickText = (v: number) => (Math.abs(v) >= 10000 ? `${round(v / 1000, 1)}k` : String(round(v, 2)));

export function Chart(p: ChartProps) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const [sel, setSel] = useState<{ x: number; px: number; series?: Series; point?: Pt } | null>(null);
  const height = p.height ?? 240;
  const xKind = p.xKind ?? 'time';
  const barW = p.barWidth ?? (xKind === 'category' ? 0.7 : p.bucket ? barWidthFor(p.bucket) : 0.8);
  const clipId = 'clip' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const bars = p.series.filter((s) => s.type === 'bar');
  const stacked = p.barMode !== 'group';
  const hasData = p.series.some((s) => s.type !== 'area' && s.data.some((d) => isNum(d.y)));

  // stacked bar tops per x, so the y range fits the stacks
  const stackTops = useMemo(() => {
    const pos = new Map<number, number>();
    const neg = new Map<number, number>();
    if (stacked) {
      for (const s of bars) {
        for (const d of s.data) {
          if (!isNum(d.y)) continue;
          const m = d.y >= 0 ? pos : neg;
          m.set(d.x, (m.get(d.x) ?? 0) + d.y);
        }
      }
    }
    return { pos, neg };
  }, [p.series, stacked]);

  const dom = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const s of p.series) {
      for (const d of s.data) {
        xs.push(d.x);
        if (isNum(d.y) && !(s.type === 'bar' && stacked)) ys.push(d.y);
      }
    }
    if (stacked) ys.push(...stackTops.pos.values(), ...stackTops.neg.values());
    if (bars.length) ys.push(0);
    for (const b of p.vbands ?? []) xs.push(b.x0, b.x1);
    for (const v of p.vlines ?? []) xs.push(v.x);
    for (const b of p.hbands ?? []) ys.push(b.y0, b.y1);
    for (const h of p.hlines ?? []) ys.push(h.y);
    let x0 = p.xMin ?? (xKind === 'category' ? -0.5 : Math.min(...xs));
    let x1 = p.xMax ?? (xKind === 'category' ? (p.categories?.length ?? 1) - 0.5 : Math.max(...xs));
    if (xKind !== 'category' && p.xMin === undefined && bars.length) x0 -= barW / 2 + 0.2;
    if (xKind !== 'category' && p.xMax === undefined && bars.length) x1 += barW / 2 + 0.2;
    if (!Number.isFinite(x0) || !Number.isFinite(x1)) [x0, x1] = [0, 1];
    if (x0 === x1) [x0, x1] = [x0 - 1, x1 + 1];
    let y0 = Math.min(...ys);
    let y1 = Math.max(...ys);
    if (!Number.isFinite(y0) || !Number.isFinite(y1)) [y0, y1] = [0, 1];
    const padY = (y1 - y0 || Math.abs(y1) || 1) * 0.06;
    y0 = p.yMin ?? (bars.length && y0 >= 0 ? 0 : y0 - padY);
    y1 = p.yMax ?? y1 + padY;
    return { x0, x1, y0, y1 };
  }, [p, stackTops]);

  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const sx = (x: number) => PAD.left + ((x - dom.x0) / (dom.x1 - dom.x0)) * plotW;
  const sy = (y: number) => PAD.top + (1 - (y - dom.y0) / (dom.y1 - dom.y0)) * plotH;
  const pxPerX = plotW / (dom.x1 - dom.x0);

  const yTicks = niceTicks(dom.y0, dom.y1, height < 200 ? 3 : 5);
  const xTicks = useMemo(() => {
    if (xKind === 'category') return (p.categories ?? []).map((_, i) => i);
    const n = Math.max(2, Math.floor(plotW / 80));
    if (xKind === 'number') return niceTicks(dom.x0, dom.x1, n);
    const span = dom.x1 - dom.x0;
    const step = Math.max(1, Math.round(span / n));
    const out: number[] = [];
    for (let x = Math.ceil(dom.x0); x <= dom.x1; x += step) out.push(x);
    return out;
  }, [dom, plotW, xKind, p.categories]);
  // ticks more than ~10 months apart in total read better as "Oct 25" than as days
  const longSpan = dom.x1 - dom.x0 > 300;
  const xLabel = (x: number) => {
    if (xKind === 'category') return p.categories?.[Math.round(x)] ?? '';
    if (xKind !== 'time') return tickText(x);
    const d = fromDays(x);
    return longSpan ? `${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(2, 4)}` : fmtShort(d);
  };
  const tipTitle = (x: number) => (xKind === 'time' && p.bucket ? bucketTitle(bucketStart(fromDays(x), p.bucket), p.bucket) : xLabel(x));
  const yLabel = p.yFormat ?? ((v: number) => tickText(round(v, 2)));

  function onPress(e: { nativeEvent: { locationX: number; locationY: number } }) {
    const { locationX: lx, locationY: ly } = e.nativeEvent;
    let best: { d: number; x: number; series?: Series; point?: Pt } | null = null;
    for (const s of p.series) {
      if (s.type === 'area') continue;
      for (const d of s.data) {
        if (!isNum(d.y)) continue;
        const dx = sx(d.x) - lx;
        const dy = s.type === 'scatter' ? sy(d.y) - ly : 0;
        const dist = Math.hypot(dx, dy);
        if (!best || dist < best.d) best = { d: dist, x: d.x, series: s, point: d };
      }
    }
    setSel(best && best.d < 60 ? { x: best.x, px: sx(best.x), series: best.series, point: best.point } : null);
  }

  // tooltip lines for the selected x
  const tip = useMemo(() => {
    if (!sel) return null;
    const lines: { color: string; text: string }[] = [];
    if (sel.series?.type === 'scatter' && sel.point) {
      lines.push({ color: sel.point.color ?? sel.series.color, text: sel.point.label ?? `${sel.series.name}: ${yLabel(sel.point.y as number)}` });
    } else {
      for (const s of p.series) {
        if (s.type === 'area' || s.type === 'scatter') continue;
        const d = s.data.find((q) => Math.abs(q.x - sel.x) < 1e-6 && isNum(q.y));
        if (d) lines.push({ color: d.color ?? s.color, text: d.label ?? `${s.name}: ${yLabel(d.y as number)}` });
      }
    }
    return { title: tipTitle(sel.x), lines: lines.slice(0, 8) };
  }, [sel, p.series]);

  const legend = [
    ...p.series.filter((s) => s.legend !== false).map((s) => ({ name: s.name, color: s.color, dash: s.type === 'line' && s.dash })),
    ...(p.legendItems ?? []).map((l) => ({ ...l, dash: false })),
  ].filter((l, i, a) => a.findIndex((m) => m.name === l.name) === i);

  const linePath = (data: Pt[]) => {
    let d = '';
    let pen = false;
    for (const q of [...data].sort((a, b) => a.x - b.x)) {
      if (!isNum(q.y)) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${sx(q.x).toFixed(1)},${sy(q.y).toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  const barEls: ReactNode[] = [];
  if (bars.length) {
    const base = new Map<number, number>();
    const baseNeg = new Map<number, number>();
    const w = stacked ? barW : barW / bars.length;
    bars.forEach((s, i) => {
      for (const d of s.data) {
        if (!isNum(d.y)) continue;
        const off = stacked ? 0 : (i - (bars.length - 1) / 2) * w;
        const m = d.y >= 0 ? base : baseNeg;
        const from = stacked ? m.get(d.x) ?? 0 : 0;
        const to = from + d.y;
        if (stacked) m.set(d.x, to);
        const xa = sx(d.x + off - w / 2);
        const bw = Math.max(1, w * pxPerX - (w * pxPerX > 4 ? 1 : 0));
        const top = sy(Math.max(from, to));
        const h = Math.max(0.5, Math.abs(sy(from) - sy(to)));
        barEls.push(<Rect key={`${i}-${d.x}`} x={xa} y={top} width={bw} height={h} fill={d.color ?? s.color} />);
        if (d.text && !stacked) {
          barEls.push(
            <SvgText key={`l${i}-${d.x}`} x={xa + bw / 2} y={top - 3} fontSize={10} fill={t.muted} textAnchor="middle">{d.text}</SvgText>,
          );
        }
      }
    });
  }

  return (
    <View style={{ marginVertical: 6 }}>
      {p.title ? <Text style={[st.title, { color: t.text }]}>{p.title}</Text> : null}
      {p.yTitle ? <Text style={[st.axis, { color: t.muted }]}>{p.yTitle}</Text> : null}
      {!hasData ? (
        <View style={[st.empty, { height: Math.min(height, 120), backgroundColor: t.surface }]}>
          <Text style={{ color: t.muted, fontSize: 13 }}>{p.empty ?? 'Nothing recorded in this period.'}</Text>
        </View>
      ) : null}
      <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={{ height: hasData ? height : 0 }}>
        {width > 0 && hasData ? (
          <Pressable onPress={onPress} style={{ width, height }}>
            <Svg width={width} height={height}>
              <Defs>
                <ClipPath id={clipId}>
                  <Rect x={PAD.left} y={0} width={plotW} height={PAD.top + plotH} />
                </ClipPath>
              </Defs>
              {/* shaded bands behind everything */}
              {(p.vbands ?? []).map((b, i) => (
                <G key={`vb${i}`}>
                  <Rect
                    x={Math.max(PAD.left, sx(b.x0))} y={PAD.top}
                    width={Math.max(0, Math.min(sx(b.x1), PAD.left + plotW) - Math.max(PAD.left, sx(b.x0)))}
                    height={plotH} fill={b.color}
                  />
                  {b.label ? <SvgText x={sx(b.x0) + 2} y={PAD.top + 10} fontSize={10} fill={t.muted}>{b.label}</SvgText> : null}
                </G>
              ))}
              {(p.hbands ?? []).map((b, i) => (
                <G key={`hb${i}`}>
                  <Rect x={PAD.left} y={sy(Math.max(b.y0, b.y1))} width={plotW} height={Math.abs(sy(b.y0) - sy(b.y1))} fill={b.color} />
                  {b.label ? <SvgText x={PAD.left + 4} y={sy(Math.max(b.y0, b.y1)) + 11} fontSize={10} fill={t.muted}>{b.label}</SvgText> : null}
                </G>
              ))}
              {/* grid + y axis */}
              {yTicks.map((v) => (
                <G key={`y${v}`}>
                  <Line x1={PAD.left} x2={PAD.left + plotW} y1={sy(v)} y2={sy(v)} stroke={t.grid} strokeWidth={1} />
                  <SvgText x={PAD.left - 4} y={sy(v) + 3.5} fontSize={10} fill={t.muted} textAnchor="end">{yLabel(v)}</SvgText>
                </G>
              ))}
              {xTicks.map((x) => (
                <SvgText key={`x${x}`} x={sx(x)} y={height - 8} fontSize={10} fill={t.muted}
                  textAnchor={sx(x) > width - 30 ? 'end' : sx(x) < PAD.left + 15 && xKind !== 'category' ? 'start' : 'middle'}>
                  {xLabel(x)}
                </SvgText>
              ))}
              {/* data, cut off at the plot edges (a range can start in the middle of a line) */}
              <G clipPath={`url(#${clipId})`}>
              {(p.series.filter((s) => s.type === 'area') as Series[]).map((s, i) => (
                <Polygon
                  key={`a${i}`}
                  points={s.data.filter((d) => isNum(d.y)).map((d) => `${sx(d.x)},${sy(d.y as number)}`).join(' ')}
                  fill={s.color}
                />
              ))}
              {barEls}
              {(p.hlines ?? []).map((h, i) => (
                <G key={`h${i}`}>
                  <Line x1={PAD.left} x2={PAD.left + plotW} y1={sy(h.y)} y2={sy(h.y)} stroke={h.color ?? t.muted}
                    strokeWidth={1.2} strokeDasharray={h.dash === false ? undefined : '4,4'} />
                  {h.label ? <SvgText x={PAD.left + plotW - 2} y={sy(h.y) + 12} fontSize={10} fill={t.muted} textAnchor="end">{h.label}</SvgText> : null}
                </G>
              ))}
              {(p.vlines ?? []).map((v, i) => (
                <Line key={`v${i}`} x1={sx(v.x)} x2={sx(v.x)} y1={PAD.top} y2={PAD.top + plotH} stroke={v.color ?? t.muted}
                  strokeWidth={v.width ?? 1.5} strokeDasharray={v.dash ? '3,3' : undefined} />
              ))}
              {p.series.map((s, i) => {
                if (s.type === 'line') {
                  return (
                    <G key={`s${i}`}>
                      <Path d={linePath(s.data)} stroke={s.color} strokeWidth={s.width ?? 2} fill="none"
                        strokeDasharray={s.dash ? '5,4' : undefined} />
                      {s.markers
                        ? s.data.filter((d) => isNum(d.y)).map((d, j) => (
                          <Circle key={j} cx={sx(d.x)} cy={sy(d.y as number)} r={2.6} fill={d.color ?? s.color} />
                        ))
                        : null}
                    </G>
                  );
                }
                if (s.type === 'scatter') {
                  return (
                    <G key={`s${i}`}>
                      {s.data.filter((d) => isNum(d.y)).map((d, j) => {
                        const cx = sx(d.x);
                        const cy = sy(d.y as number);
                        const r = d.r ?? 4;
                        return s.symbol === 'diamond' ? (
                          <Polygon key={j} points={`${cx},${cy - r - 1} ${cx + r + 1},${cy} ${cx},${cy + r + 1} ${cx - r - 1},${cy}`} fill={d.color ?? s.color} />
                        ) : (
                          <Circle key={j} cx={cx} cy={cy} r={r} fill={d.color ?? s.color} fillOpacity={d.r ? 0.6 : 0.9}
                            stroke={d.r ? (d.color ?? s.color) : undefined} />
                        );
                      })}
                    </G>
                  );
                }
                return null;
              })}
              </G>
              {sel ? <Line x1={sel.px} x2={sel.px} y1={PAD.top} y2={PAD.top + plotH} stroke={t.text} strokeOpacity={0.35} strokeWidth={1} /> : null}
            </Svg>
            {tip && sel ? (
              <View
                pointerEvents="none"
                style={[st.tip, { backgroundColor: t.card, borderColor: t.border, left: Math.min(Math.max(PAD.left, sel.px - 90), width - 190) }]}
              >
                <Text style={[st.tipTitle, { color: t.text }]}>{tip.title}</Text>
                {tip.lines.map((l, i) => (
                  <Text key={i} style={[st.tipLine, { color: t.text }]} numberOfLines={3}>
                    <Text style={{ color: l.color }}>● </Text>{l.text}
                  </Text>
                ))}
              </View>
            ) : null}
          </Pressable>
        ) : null}
      </View>
      {p.xTitle ? <Text style={[st.axis, { color: t.muted, textAlign: 'center' }]}>{p.xTitle}</Text> : null}
      {hasData && (legend.length > 1 || (legend.length === 1 && p.legendItems)) ? (
        <View style={st.legend}>
          {legend.map((l) => (
            <View key={l.name} style={st.legendItem}>
              <View style={[st.swatch, { backgroundColor: l.color, height: l.dash ? 2 : 8 }]} />
              <Text style={[st.legendText, { color: t.muted }]}>{l.name}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Shaded bands for period (red) and post-ovulation (orange) days, for a time chart. */
export function phaseBands(phases: Map<string, string>, colors: Record<string, string>) {
  const out: { x0: number; x1: number; color: string }[] = [];
  const days = [...phases.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let cur: { ph: string; x0: number; x1: number } | null = null;
  const toX = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
  for (const [d, ph] of days) {
    const x = toX(d);
    if (cur && cur.ph === ph && x - cur.x1 <= 1) cur.x1 = x;
    else {
      if (cur && colors[cur.ph]) out.push({ x0: cur.x0 - 0.5, x1: cur.x1 + 0.5, color: colors[cur.ph] });
      cur = { ph, x0: x, x1: x };
    }
  }
  if (cur && colors[cur.ph]) out.push({ x0: cur.x0 - 0.5, x1: cur.x1 + 0.5, color: colors[cur.ph] });
  return out;
}

const st = StyleSheet.create({
  title: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  axis: { fontSize: 11 },
  tip: { position: 'absolute', top: 4, width: 180, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10 },
  tipTitle: { fontSize: 11.5, fontWeight: '700' },
  tipLine: { fontSize: 11.5 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swatch: { width: 12, borderRadius: 2 },
  legendText: { fontSize: 11.5 },
  empty: { borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
