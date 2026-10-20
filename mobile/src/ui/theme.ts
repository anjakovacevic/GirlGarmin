export interface Theme {
  dark: boolean;
  bg: string;
  card: string;
  text: string;
  muted: string;
  border: string;
  /** Edge of secondary buttons, visible on both the page and cards. */
  outline: string;
  accent: string;
  accentText: string;
  /** Pale accent, behind selected or highlighted things. */
  accentSoft: string;
  /** Fill for inputs and tiles inside a card. */
  surface: string;
  grid: string;
  good: string;
  bad: string;
  info: string;
  infoBg: string;
  successBg: string;
  warnBg: string;
  errorBg: string;
}

/** One light theme on purpose: the app doesn't follow the phone's dark mode (app.json sets
 * userInterfaceStyle "light" too, so Android doesn't darken it either). */
const light: Theme = {
  dark: false,
  bg: '#f4f3f6',
  card: '#ffffff',
  text: '#1d1b22',
  muted: '#6b6773',
  border: '#e6e4ea',
  outline: '#d6d3dc',
  accent: '#b8336a',
  accentText: '#ffffff',
  accentSoft: '#f8e9f0',
  surface: '#f4f3f6',
  grid: '#efedf2',
  good: '#23825a',
  bad: '#c2353f',
  info: '#3f5fa6',
  infoBg: '#eef1f8',
  successBg: '#e8f3ec',
  warnBg: '#fbf1e1',
  errorBg: '#fbe8ea',
};

export function useTheme(): Theme {
  return light;
}

/** Colours for categories (exercise types, muscles...): plotly's order, softened to match the app. */
export const PALETTE = ['#5d6ad1', '#b8336a', '#2e9e7a', '#8a6fc4', '#d99a3a', '#4aa3c2', '#e07a9a', '#8fb26a', '#c48bd6', '#c9b04a'];

export function colorFor(keys: string[]): Map<string, string> {
  return new Map([...new Set(keys)].sort().map((k, i) => [k, PALETTE[i % PALETTE.length]]));
}

// Cycle shading behind time charts: red = period, orange = after ovulation.
export const PHASE_COLORS: Record<string, string> = { period: 'rgba(220,60,90,0.15)', luteal: 'rgba(245,160,40,0.14)' };
