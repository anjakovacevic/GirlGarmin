import type { CycleInfo, CyclePrediction, Data, HrTests, LiftSession, Phase, Settings } from '../analysis';
import type { ISODate } from '../lib/dates';
import type { Range } from './range';

/** Everything a dashboard tab needs, computed once per data load / date change in App. */
export interface Ctx {
  d: Data;
  today: ISODate;
  info: CycleInfo[];
  phases: Map<ISODate, Phase>;
  pred: CyclePrediction | null;
  sessions: LiftSession[];
  settings: Settings;
  setGoal: (goal: 'lose' | 'track') => void;
  hrTests: HrTests;
  setHrTests: (t: HrTests) => void;
  /** What the charts show (picked above the chart tabs, shared by all of them). */
  range: Range;
}
