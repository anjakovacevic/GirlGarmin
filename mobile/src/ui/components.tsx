/** Building blocks shared by the screens: cards, metrics, tables, text with **bold**, toggles. */

import { createContext, type ReactNode, useContext, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { CheckIcon, ChevronIcon, InfoIcon } from './icons';
import { useTheme } from './theme';

/** True inside a white card: tiles and controls there are filled grey; on the grey page, white. */
const InCard = createContext(false);

function useFill() {
  const t = useTheme();
  return useContext(InCard) ? t.surface : t.card;
}

/** A white card. `info` puts an "i" next to the title that opens the longer explanation, so the
 * card itself can stay short (paragraphs separated by a blank line, **bold** works). */
export function Section({ title, children, right, info }: { title?: string; children: ReactNode; right?: ReactNode; info?: string }) {
  const t = useTheme();
  return (
    <InCard.Provider value>
    <View style={[s.card, { backgroundColor: t.card }]}>
      {title || right || info ? (
        <View style={[s.row, { gap: 8 }]}>
          {title ? <Text style={[s.h2, { color: t.text, flex: 1 }]}>{title}</Text> : <View style={{ flex: 1 }} />}
          {right}
          {info ? <InfoButton title={title ?? 'About this'} text={info} /> : null}
        </View>
      ) : null}
      {children}
    </View>
    </InCard.Provider>
  );
}

/** Small "i" that opens an explanation sheet. */
export function InfoButton({ title, text }: { title: string; text: string }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`About: ${title}`}>
        <InfoIcon color={t.muted} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.infoBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={[s.infoSheet, { backgroundColor: t.card }]} onPress={() => {}}>
            <Text style={[s.h2, { color: t.text }]}>{title}</Text>
            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 10 }}>
              {text.split(/\n\s*\n/).map((para, i) => <Rich key={i} text={para} />)}
            </ScrollView>
            <Button kind="secondary" title="Close" onPress={() => setOpen(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/** A tappable white row that opens another page (Plan, Heart-rate zones). */
export function LinkCard({ title, sub, onPress }: { title: string; sub?: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [s.card, s.row, { backgroundColor: t.card, opacity: pressed ? 0.8 : 1, gap: 12 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.h2, { color: t.text }]}>{title}</Text>
        {sub ? <Text style={{ color: t.muted, fontSize: 13.5 }}>{sub}</Text> : null}
      </View>
      <ChevronIcon color={t.muted} dir="right" />
    </Pressable>
  );
}

/** A list row that opens to show more when tapped (instead of a wide table). */
export function ListRow({ title, sub, right, children }: { title: string; sub?: string; right?: ReactNode; children?: ReactNode }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const head = (
    <View style={[s.row, { gap: 10 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: t.text, fontSize: 15, fontWeight: '600' }}>{title}</Text>
        {sub ? <Text style={{ color: t.muted, fontSize: 13 }}>{sub}</Text> : null}
      </View>
      {right}
      {children ? <ChevronIcon color={t.muted} dir={open ? 'up' : 'down'} size={16} /> : null}
    </View>
  );
  return (
    <View style={[s.listRow, { borderTopColor: t.border }]}>
      {children ? (
        <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}>{head}</Pressable>
      ) : head}
      {open ? <View style={{ gap: 6, paddingTop: 8 }}>{children}</View> : null}
    </View>
  );
}

/** The first `limit` items, with a "Show all" button for the rest. */
export function ShowMore<T>({ items, limit, render }: { items: T[]; limit: number; render: (x: T, i: number) => ReactNode }) {
  const [all, setAll] = useState(false);
  return (
    <>
      {(all ? items : items.slice(0, limit)).map(render)}
      {items.length > limit ? (
        <Button kind="secondary" title={all ? 'Show fewer' : `Show all ${items.length}`} onPress={() => setAll(!all)} />
      ) : null}
    </>
  );
}

/** "Label   value" line inside an opened list row. */
export function KeyValue({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={[s.row, { gap: 12 }]}>
      <Text style={{ color: t.muted, fontSize: 13.5, flex: 1 }}>{label}</Text>
      <Text style={{ color: t.text, fontSize: 13.5, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

export function H3({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={[s.h3, { color: t.text }]}>{children}</Text>;
}

export function Caption({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={[s.caption, { color: t.muted }]}>{children}</Text>;
}

/** Text where **bold** parts are bold (the dashboard's tips use markdown bold). */
export function Rich({ text, style }: { text: string; style?: object }) {
  const t = useTheme();
  const parts = text.split('**');
  return (
    <Text style={[s.body, { color: t.text }, style]}>
      {parts.map((p, i) => (i % 2 ? <Text key={i} style={s.bold}>{p}</Text> : p))}
    </Text>
  );
}

export function Bullets({ items }: { items: string[] }) {
  const t = useTheme();
  return (
    <View style={{ gap: 8 }}>
      {items.map((x, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
          <View style={[s.dot, { backgroundColor: t.accent }]} />
          <View style={{ flex: 1 }}>
            <Rich text={x} />
          </View>
        </View>
      ))}
    </View>
  );
}

type Tone = 'info' | 'success' | 'warn' | 'error';

export function Notice({ tone = 'info', text }: { tone?: Tone; text: string }) {
  const t = useTheme();
  const bg = { info: t.infoBg, success: t.successBg, warn: t.warnBg, error: t.errorBg }[tone];
  return (
    <View style={[s.notice, { backgroundColor: bg }]}>
      <Rich text={text} />
    </View>
  );
}

/** Streamlit-style metric: label, big value, optional delta. A delta starting with "-" counts
 * as down; `deltaColor` "normal" = up is good, "inverse" = down is good, "off" = grey. */
export function Metric({ label, value, delta, deltaColor = 'normal' }: {
  label: string; value: string | number; delta?: string | null; deltaColor?: 'normal' | 'inverse' | 'off';
}) {
  const t = useTheme();
  const fill = useFill();
  const down = !!delta && delta.trim().startsWith('-');
  const good = deltaColor === 'inverse' ? down : !down;
  const color = deltaColor === 'off' ? t.muted : good ? t.good : t.bad;
  return (
    <View style={[s.metric, { backgroundColor: fill }]}>
      <Text style={[s.metricLabel, { color: t.muted }]} numberOfLines={2}>{label}</Text>
      <Text style={[s.metricValue, { color: t.text }]}>{String(value)}</Text>
      {delta ? (
        <Text style={[s.metricDelta, { color }]} numberOfLines={2}>
          {deltaColor === 'off' ? '' : down ? '↓ ' : '↑ '}{delta}
        </Text>
      ) : null}
    </View>
  );
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return <View style={s.grid}>{children}</View>;
}

export interface Column {
  label: string;
  width?: number;
  align?: 'left' | 'right';
}

/** A table that scrolls sideways when it is wider than the phone. */
export function Table({ columns, rows }: { columns: (Column | string)[]; rows: (string | number | null | undefined)[][] }) {
  const t = useTheme();
  const cols: Column[] = columns.map((c) => (typeof c === 'string' ? { label: c } : c));
  const widths = cols.map((c, i) => {
    if (c.width) return c.width;
    const longest = Math.max(c.label.length, ...rows.map((r) => String(r[i] ?? '').length));
    return Math.min(260, Math.max(56, longest * 7.4 + 18));
  });
  const cell = (v: unknown, i: number, header = false) => (
    <Text
      key={i}
      style={[s.cell, { width: widths[i], color: header ? t.muted : t.text, textAlign: cols[i].align ?? 'left' }, header && s.bold]}
    >
      {v === null || v === undefined || v === '' ? (header ? '' : '-') : String(v)}
    </Text>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 4 }}>
      <View>
        <View style={[s.tr, { borderBottomColor: t.border }]}>{cols.map((c, i) => cell(c.label, i, true))}</View>
        {rows.map((r, j) => (
          <View key={j} style={[s.tr, { borderBottomColor: t.border }]}>{r.map((v, i) => cell(v, i))}</View>
        ))}
      </View>
    </ScrollView>
  );
}

/** `stretch` spreads the options over the full width. */
export function Segmented<T extends string>({ options, value, onChange, stretch }: {
  options: T[]; value: T; onChange: (v: T) => void; stretch?: boolean;
}) {
  const t = useTheme();
  const fill = useFill();
  return (
    <View style={[s.segment, { backgroundColor: fill }, stretch && { alignSelf: 'stretch' }]} accessibilityRole="tablist">
      {options.map((o) => (
        <Pressable
          key={o}
          onPress={() => onChange(o)}
          accessibilityRole="tab"
          accessibilityState={{ selected: o === value }}
          style={[s.segItem, stretch && { flex: 1, alignItems: 'center' }, o === value && { backgroundColor: t.accentSoft }]}
        >
          <Text style={{ color: o === value ? t.accent : t.muted, fontWeight: o === value ? '700' : '600', fontSize: 13.5 }}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={() => onChange(!value)} style={[s.row, { gap: 10, justifyContent: 'flex-start', paddingVertical: 6 }]}>
      <View style={[s.box, { borderColor: value ? t.accent : t.border, backgroundColor: value ? t.accent : t.card }]}>
        {value ? <CheckIcon color={t.accentText} /> : null}
      </View>
      <Text style={[s.body, { color: t.text, flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}

export function Expander({ title, children, initiallyOpen = false }: { title: string; children: ReactNode; initiallyOpen?: boolean }) {
  const t = useTheme();
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={[s.expander, { borderColor: t.border }]}>
      <Pressable onPress={() => setOpen(!open)} style={[s.row, { paddingVertical: 10 }]}>
        <Text style={[s.body, s.bold, { color: t.text, flex: 1 }]}>{title}</Text>
        <ChevronIcon color={t.muted} dir={open ? 'up' : 'down'} />
      </Pressable>
      {open ? <View style={{ paddingBottom: 10, gap: 8 }}>{children}</View> : null}
    </View>
  );
}

export function Button({ title, onPress, kind = 'primary', disabled }: {
  title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; disabled?: boolean;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.accent : kind === 'danger' ? t.errorBg : 'transparent';
  const fg = kind === 'primary' ? t.accentText : kind === 'danger' ? t.bad : t.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [s.button, { backgroundColor: bg, borderColor: kind === 'secondary' ? t.outline : bg, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 }]}
    >
      <Text style={{ color: fg, fontWeight: '600', fontSize: 15, textAlign: 'center' }}>{title}</Text>
    </Pressable>
  );
}

/** A tappable field that opens a list to choose from. */
export function Select<T extends string>({ label, options, value, onChange, format = (v) => v }: {
  label?: string; options: T[]; value: T; onChange: (v: T) => void; format?: (v: T) => string;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View>
      {label ? <Text style={[s.caption, { color: t.muted, marginBottom: 4 }]}>{label}</Text> : null}
      <Pressable onPress={() => setOpen(true)} style={[s.select, { backgroundColor: t.surface }]} accessibilityRole="button" accessibilityLabel={label}>
        <Text style={[s.body, { color: t.text, flex: 1 }]} numberOfLines={1}>{format(value)}</Text>
        <ChevronIcon color={t.muted} dir="down" />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)}>
          <View style={[s.sheet, { backgroundColor: t.card }]}>
            <ScrollView>
              {options.map((o) => (
                <Pressable key={o} onPress={() => { onChange(o); setOpen(false); }} style={[s.option, { borderBottomColor: t.border }]}>
                  <Text style={[s.body, { color: o === value ? t.accent : t.text, fontWeight: o === value ? '700' : '400' }]}>{format(o)}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

/** Number input; 0 or empty means "not set". `decimals` allows 37.5 (a comma works too). */
export function NumberField({ label, help, value, onChange, decimals, placeholder = '0' }: {
  label: string; help?: string; value: number; onChange: (v: number) => void; decimals?: boolean; placeholder?: string;
}) {
  const t = useTheme();
  const fill = useFill();
  const [text, setText] = useState(value ? String(value) : '');
  const parse = (x: string) => (decimals ? Number(x.replace(',', '.').replace(/[^0-9.]/g, '')) : Number(x.replace(/[^0-9]/g, ''))) || 0;
  return (
    <View style={{ flex: 1, minWidth: 140 }}>
      <Text style={[s.caption, { color: t.text, fontWeight: '600' }]}>{label}</Text>
      <TextInput
        value={text}
        onChangeText={setText}
        onEndEditing={() => onChange(parse(text))}
        keyboardType={decimals ? 'decimal-pad' : 'number-pad'}
        placeholder={placeholder}
        placeholderTextColor={t.muted}
        accessibilityLabel={label}
        style={[s.input, { backgroundColor: fill, color: t.text }]}
      />
      {help ? <Text style={[s.caption, { color: t.muted }]}>{help}</Text> : null}
    </View>
  );
}

/** Labelled text input. */
export function TextField({ label, value, onChange, help, multiline, placeholder, caps = 'sentences' }: {
  label: string; value: string; onChange: (v: string) => void; help?: string; multiline?: boolean; placeholder?: string;
  caps?: 'none' | 'sentences' | 'characters';
}) {
  const t = useTheme();
  const fill = useFill();
  return (
    <View style={{ gap: 2 }}>
      <Text style={[s.caption, { color: t.text, fontWeight: '600' }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        placeholder={placeholder}
        placeholderTextColor={t.muted}
        autoCapitalize={caps}
        accessibilityLabel={label}
        style={[s.input, { backgroundColor: fill, color: t.text }, multiline && { minHeight: 72, textAlignVertical: 'top' }]}
      />
      {help ? <Text style={[s.caption, { color: t.muted }]}>{help}</Text> : null}
    </View>
  );
}

/** − value + control for small whole numbers. */
export function Stepper({ label, value, onChange, min = 1, max = 99, format = String }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; format?: (v: number) => string;
}) {
  const t = useTheme();
  const fill = useFill();
  const btn = (d: number, text: string, hint: string) => {
    const off = value + d < min || value + d > max;
    return (
      <Pressable
        onPress={() => onChange(value + d)}
        disabled={off}
        style={({ pressed }) => [s.stepBtn, { backgroundColor: fill, opacity: off ? 0.35 : pressed ? 0.7 : 1 }]}
        accessibilityLabel={hint}
        hitSlop={6}
      >
        <Text style={{ color: t.text, fontSize: 20, fontWeight: '500' }}>{text}</Text>
      </Pressable>
    );
  };
  return (
    <View style={[s.row, { gap: 10 }]}>
      <Text style={[s.body, { color: t.text, flex: 1 }]}>{label}</Text>
      {btn(-1, '−', `Less: ${label}`)}
      <Text style={[s.body, s.bold, { color: t.text, minWidth: 64, textAlign: 'center' }]}>{format(value)}</Text>
      {btn(1, '+', `More: ${label}`)}
    </View>
  );
}

export const s = StyleSheet.create({
  card: { borderRadius: 20, padding: 18, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  h2: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2, flexShrink: 1 },
  h3: { fontSize: 15, fontWeight: '600', marginTop: 6 },
  body: { fontSize: 15, lineHeight: 22 },
  bold: { fontWeight: '700' },
  caption: { fontSize: 13, lineHeight: 18 },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 9 },
  notice: { borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { flexGrow: 1, flexBasis: '45%', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, gap: 3 },
  metricLabel: { fontSize: 13 },
  metricValue: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
  metricDelta: { fontSize: 12.5, fontWeight: '600' },
  tr: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { paddingVertical: 8, paddingHorizontal: 6, fontSize: 13, fontVariant: ['tabular-nums'] },
  segment: { flexDirection: 'row', borderRadius: 12, padding: 3, alignSelf: 'flex-start' },
  segItem: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 9 },
  box: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  expander: { borderTopWidth: StyleSheet.hairlineWidth },
  button: { borderRadius: 999, borderWidth: 1, paddingVertical: 13, paddingHorizontal: 20, alignItems: 'center' },
  select: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14 },
  listRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
  infoBackdrop: { flex: 1, backgroundColor: 'rgba(29,27,34,0.35)', justifyContent: 'flex-end' },
  infoSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, gap: 14 },
  backdrop: { flex: 1, backgroundColor: 'rgba(29,27,34,0.35)', justifyContent: 'center', padding: 24 },
  sheet: { borderRadius: 20, maxHeight: '75%', paddingVertical: 6 },
  option: { paddingVertical: 14, paddingHorizontal: 18, borderBottomWidth: StyleSheet.hairlineWidth },
  stepBtn: { width: 40, height: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  input: { borderRadius: 12, paddingVertical: 11, paddingHorizontal: 14, fontSize: 16, marginVertical: 4 },
});
