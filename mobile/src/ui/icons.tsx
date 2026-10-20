/** Line icons drawn with react-native-svg (instead of text glyphs, which look different on every phone). */

import type { ReactNode } from 'react';
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
