/** Line icons drawn with react-native-svg (instead of text glyphs, which look different on every phone). */

import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

type IconProps = { color: string; size?: number };

const Icon = ({ size = 22, children }: { size?: number; children: ReactNode }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">{children}</Svg>
);

const stroke = (color: string) => ({ stroke: color, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const });

export const GearIcon = ({ color, size }: IconProps) => (
  <Icon size={size}>
    <Circle cx={12} cy={12} r={3} {...stroke(color)} />
    <Path
      d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
      {...stroke(color)}
    />
  </Icon>
);

export const ChevronIcon = ({ color, size = 18, dir }: IconProps & { dir: 'left' | 'right' | 'down' | 'up' }) => (
  <Icon size={size}>
    <Path d={{ left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7', down: 'M5 9l7 7 7-7', up: 'M5 15l7-7 7 7' }[dir]} {...stroke(color)} />
  </Icon>
);

export const CheckIcon = ({ color, size = 14 }: IconProps) => (
  <Icon size={size}>
    <Path d="M5 12.5l4.5 4.5L19 7.5" {...stroke(color)} strokeWidth={2.6} />
  </Icon>
);

export const LockIcon = ({ color, size = 18 }: IconProps) => (
  <Icon size={size}>
    <Path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" {...stroke(color)} />
  </Icon>
);

export const PhoneIcon = ({ color, size = 18 }: IconProps) => (
  <Icon size={size}>
    <Path d="M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3zM11 18h2" {...stroke(color)} />
  </Icon>
);

export const KeyIcon = ({ color, size = 18 }: IconProps) => (
  <Icon size={size}>
    <Circle cx={8} cy={14} r={4} {...stroke(color)} />
    <Path d="M11 11l8-8M16 6l2.5 2.5M14 8l2 2" {...stroke(color)} />
  </Icon>
);

export const InfoIcon = ({ color, size = 18 }: IconProps) => (
  <Icon size={size}>
    <Circle cx={12} cy={12} r={9} {...stroke(color)} />
    <Path d="M12 11v5.5M12 7.6v.1" {...stroke(color)} strokeWidth={2.2} />
  </Icon>
);

// bottom tab bar
export const TodayIcon = ({ color, size }: IconProps) => (
  <Icon size={size}>
    <Circle cx={12} cy={12} r={4} {...stroke(color)} />
    <Path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" {...stroke(color)} />
  </Icon>
);

export const TrainingIcon = ({ color, size }: IconProps) => (
  <Icon size={size}>
    <Path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11" {...stroke(color)} strokeWidth={2} />
  </Icon>
);

export const RecoveryIcon = ({ color, size }: IconProps) => (
  <Icon size={size}>
    <Path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" {...stroke(color)} />
  </Icon>
);

export const CycleIcon = ({ color, size }: IconProps) => (
  <Icon size={size}>
    <Path d="M12 3.5c3 3.6 5.5 6.6 5.5 10a5.5 5.5 0 0 1-11 0c0-3.4 2.5-6.4 5.5-10z" {...stroke(color)} />
  </Icon>
);

export const BodyIcon = ({ color, size }: IconProps) => (
  <Icon size={size}>
    <Circle cx={12} cy={7.5} r={3.5} {...stroke(color)} />
    <Path d="M5 20.5v-1.5a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1.5" {...stroke(color)} />
  </Icon>
);

/** "GARMIN" wordmark with the delta triangle - drawn as an approximation of Garmin's logo. */
export const GarminMark = ({ color, size = 16 }: IconProps) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.35 }} accessibilityLabel="Garmin">
    <Svg width={size * 0.95} height={size * 0.82} viewBox="0 0 20 17">
      <Path d="M10 0.5L19.5 16.5H0.5Z" fill={color} />
    </Svg>
    <Text style={{ color, fontSize: size, fontWeight: '800', letterSpacing: size * 0.14 }}>GARMIN</Text>
  </View>
);
