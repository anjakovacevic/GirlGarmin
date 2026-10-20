/** The training plans saved on the phone (plans.json), managed in the Plan tab. */

import planFile from '@plan';

import { loadSettings } from './analysis';
import { store } from './lib/store';
import { type PlanData, setSchedule, toData } from './plan';

const FILE = 'plans.json';

/** The saved plans. The first time, the plan file (src/plans/) is brought in: scheduled from the
 * start date picked in the old Settings or written in the file, else as a draft. */
export async function loadPlans(): Promise<PlanData[]> {
  const saved = await store().read<{ plans: PlanData[] }>(FILE);
  if (saved) return saved.plans;
  const start = (await loadSettings()).planStart ?? planFile.start ?? null;
  const plans = [toData(planFile, { start })];
  await savePlans(plans);
  return plans;
}

export async function savePlans(plans: PlanData[]): Promise<void> {
  await store().write(FILE, { plans });
}

/** Load the saved plans and make them the app's schedule. */
export async function applyPlans(): Promise<PlanData[]> {
  const plans = await loadPlans();
  setSchedule(plans);
  return plans;
}
